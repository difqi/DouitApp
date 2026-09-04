import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

function normalizeIndonesianPhone(phone: string): string {
  let clean = phone.replace(/[^0-9]/g, "");
  if (clean.startsWith("0")) {
    clean = "62" + clean.slice(1);
  } else if (clean.startsWith("8")) {
    clean = "62" + clean;
  }
  return clean;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, message: "Unauthorized. Silakan masuk terlebih dahulu." },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const rawPhone = body.phoneNumber || body.phone_number || "";
    const rawOtp = body.otpCode || body.otp_code || "";

    if (!rawPhone || !rawOtp) {
      return NextResponse.json(
        { success: false, message: "Nomor WhatsApp dan kode verifikasi wajib diisi." },
        { status: 400 }
      );
    }

    const cleanPhone = normalizeIndonesianPhone(rawPhone);
    const cleanOtp = String(rawOtp).trim();

    if (cleanOtp.length !== 4) {
      return NextResponse.json(
        { success: false, message: "Kode verifikasi harus berupa 4 digit angka." },
        { status: 400 }
      );
    }

    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const nowIso = new Date().toISOString();

    // 1. Search for matching active OTP record
    const { data: verifRecord, error: verifErr } = await supabaseAdmin
      .from("phone_verifications")
      .select("*")
      .eq("user_id", user.id)
      .eq("phone_number", cleanPhone)
      .eq("otp_code", cleanOtp)
      .eq("is_verified", false)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (verifErr) {
      console.error("[WhatsApp OTP Verify] Database query error:", verifErr);
    }

    if (!verifRecord) {
      return NextResponse.json(
        { success: false, message: "Kode verifikasi salah atau telah kedaluwarsa." },
        { status: 400 }
      );
    }

    // 2. Persist the verified number before consuming the OTP.
    const { data: updatedProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({
        whatsapp_number: cleanPhone,
        is_whatsapp_verified: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id)
      .select("id")
      .maybeSingle();

    if (profileError || !updatedProfile) {
      console.error("[WhatsApp OTP Verify] Failed to update profile:", profileError);
      return NextResponse.json(
        { success: false, message: "Verifikasi belum dapat disimpan. Silakan coba lagi." },
        { status: 500 }
      );
    }

    // 3. Mark verification record as verified
    const { data: updatedVerification, error: verificationUpdateError } = await supabaseAdmin
      .from("phone_verifications")
      .update({ is_verified: true })
      .eq("id", verifRecord.id)
      .select("id")
      .maybeSingle();

    if (verificationUpdateError || !updatedVerification) {
      console.error(
        "[WhatsApp OTP Verify] Failed to mark verification record:",
        verificationUpdateError
      );
      return NextResponse.json(
        { success: false, message: "Verifikasi belum dapat disimpan. Silakan coba lagi." },
        { status: 500 }
      );
    }

    // 4. Update auth user metadata for seamless client-side sync
    try {
      await supabaseAdmin.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...(user.user_metadata || {}),
          whatsapp_number: cleanPhone,
          is_whatsapp_verified: true,
        },
      });
    } catch (metaErr) {
      console.warn("[WhatsApp OTP Verify] auth user metadata update warning:", metaErr);
    }

    return NextResponse.json({
      success: true,
      message: "Nomor WhatsApp berhasil diverifikasi!",
      phoneNumber: cleanPhone,
      isVerified: true,
    });
  } catch (error: any) {
    console.error("[WhatsApp OTP Verify] Unexpected error:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Terjadi kesalahan internal server." },
      { status: 500 }
    );
  }
}
