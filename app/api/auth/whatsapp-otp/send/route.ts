import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { sendFonnteMessageWithFailover } from "@/lib/fonnte";

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

    if (!rawPhone || typeof rawPhone !== "string") {
      return NextResponse.json(
        { success: false, message: "Nomor WhatsApp wajib diisi." },
        { status: 400 }
      );
    }

    const cleanPhone = normalizeIndonesianPhone(rawPhone);
    if (cleanPhone.length < 10 || cleanPhone.length > 16 || !cleanPhone.startsWith("628")) {
      return NextResponse.json(
        { success: false, message: "Format nomor WhatsApp tidak valid. Gunakan format contoh: 081234567890" },
        { status: 400 }
      );
    }

    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Enforce 60-Second Cooldown
    const { data: latestVerif } = await supabaseAdmin
      .from("phone_verifications")
      .select("last_sent_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestVerif) {
      const lastSentTime = new Date(latestVerif.last_sent_at || latestVerif.created_at).getTime();
      const diffSeconds = Math.floor((Date.now() - lastSentTime) / 1000);
      if (diffSeconds < 60) {
        const waitSeconds = 60 - diffSeconds;
        return NextResponse.json(
          {
            success: false,
            message: `Mohon tunggu ${waitSeconds} detik sebelum meminta kode baru.`,
            cooldown: waitSeconds,
          },
          { status: 429 }
        );
      }
    }

    // 2. Enforce 24-Hour Max 3 Requests Rate Limit
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: attemptsCount, error: countErr } = await supabaseAdmin
      .from("phone_verifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", twentyFourHoursAgo);

    if (countErr) {
      console.warn("[WhatsApp OTP Send] Count error:", countErr);
    }

    const usedAttempts = attemptsCount || 0;
    if (usedAttempts >= 3) {
      return NextResponse.json(
        {
          success: false,
          message: "Batas pengiriman kode tercapai (maksimal 3 kali dalam 24 jam). Silakan coba lagi besok.",
          remainingAttempts: 0,
        },
        { status: 429 }
      );
    }

    // 3. Generate 4-Digit OTP Code (Expires in 5 minutes)
    const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // 4. Save to phone_verifications table
    const { error: insertErr } = await supabaseAdmin
      .from("phone_verifications")
      .insert({
        user_id: user.id,
        phone_number: cleanPhone,
        otp_code: otpCode,
        expires_at: expiresAt,
        is_verified: false,
        attempts_today: usedAttempts + 1,
        last_sent_at: new Date().toISOString(),
      });

    if (insertErr) {
      console.error("[WhatsApp OTP Send] Database insert error:", insertErr);
      return NextResponse.json(
        { success: false, message: "Gagal memproses kode verifikasi di server. Silakan coba lagi." },
        { status: 500 }
      );
    }

    // 5. Dispatch OTP via Fonnte API
    const fonnteMessage = `🔐 *Kode Verifikasi Douit AI*\n\nKode verifikasi nomor WhatsApp Anda adalah: *${otpCode}*\n\nKode ini berlaku selama 5 menit. Jangan bagikan kode ini kepada siapa pun.`;
    const sendResult = await sendFonnteMessageWithFailover({
      target: cleanPhone,
      message: fonnteMessage,
    });

    if (!sendResult.success && !sendResult.status) {
      console.error("[WhatsApp OTP Send] Fonnte message dispatch error:", sendResult.error);
      return NextResponse.json(
        {
          success: false,
          message: "Gagal mengirim pesan WhatsApp. Pastikan nomor aktif dan coba lagi.",
        },
        { status: 500 }
      );
    }

    const remainingAttempts = Math.max(0, 3 - (usedAttempts + 1));
    return NextResponse.json({
      success: true,
      message: "Kode verifikasi berhasil dikirim ke WhatsApp Anda.",
      cooldown: 60,
      remainingAttempts,
      phoneNumber: cleanPhone,
    });
  } catch (error: any) {
    console.error("[WhatsApp OTP Send] Unexpected error:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Terjadi kesalahan internal server." },
      { status: 500 }
    );
  }
}
