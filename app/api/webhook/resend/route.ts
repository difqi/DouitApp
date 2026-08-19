import { NextRequest, NextResponse } from "next/server";
import { Type, Schema } from "@google/genai";
import { executeWithGenAIFailover } from "@/lib/gemini";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";
import { normalizeSumberDana } from "@/utils/bankAliases";

import { sendFonnteMessageWithFailover, generateWaProgressBar } from "@/lib/fonnte";
import { checkAndSendOverBudgetAlert } from "@/lib/savingsAlert";

const resend = new Resend(process.env.RESEND_API_KEY);

// Helper: Clean and calculate similarity using Dice Coefficient
function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0.0;
  if (str1.length < 2 || str2.length < 2) return 0.0;

  const getBigrams = (str: string) => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bigram = str.substring(i, i + 2);
      bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }
    return bigrams;
  };

  const bigrams1 = getBigrams(str1);
  const bigrams2 = getBigrams(str2);

  let intersection = 0;
  for (const [bigram, count1] of bigrams1.entries()) {
    const count2 = bigrams2.get(bigram);
    if (count2) {
      intersection += Math.min(count1, count2);
    }
  }

  const totalBigrams = (str1.length - 1) + (str2.length - 1);
  return (2.0 * intersection) / totalBigrams;
}

// Helper: Determine similarity score between two merchant/account strings
function getMerchantSimilarityScore(incomingMerchant: string, targetMerchant: string): number {
  if (!incomingMerchant || !targetMerchant) return 0.0;

  const cleanA = incomingMerchant.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanB = targetMerchant.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!cleanA || !cleanB) return 0.0;
  if (cleanA === cleanB) return 1.0;

  if (cleanA.length >= 4 && cleanB.length >= 4) {
    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return 1.0;
  }

  // Levenshtein / Dice Coefficient check
  return calculateSimilarity(cleanA, cleanB);
}

// Helper: Determine if incoming merchant matches target storage_detail with >= 80% confidence
function isMerchantMatch(incomingMerchant: string, targetMerchant: string): boolean {
  return getMerchantSimilarityScore(incomingMerchant, targetMerchant) >= 0.80;
}

const emailParseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    is_transaction_notification: {
      type: Type.BOOLEAN,
      description: "True jika email ini adalah notifikasi transaksi bank."
    },
    transaction_details: {
      type: Type.OBJECT,
      nullable: true,
      description: "Detail transaksi jika is_transaction_notification = true",
      properties: {
        amount: { type: Type.NUMBER, description: "Nominal uang" },
        merchant: { type: Type.STRING, description: "Nama entitas, toko, atau sumber transaksi" },
        type: { type: Type.STRING, enum: ["INCOME", "EXPENSE"] },
        category: { type: Type.STRING, description: "Kategori transaksi" },
        sumber_dana: { type: Type.STRING, description: "Bank atau e-wallet asal (misal: 'Bank BCA', 'Bank Mandiri', 'GoPay', 'ShopeePay'). Ekstrak dari teks email atau pengirim." },
        admin_fee: { type: Type.NUMBER, nullable: true, description: "Biaya admin, biaya transfer, atau fee yang dikenakan. Ekstrak angkanya saja. Jika tidak ada, isi null." },
        notes: { type: Type.STRING, nullable: true, description: "Catatan, remark, keterangan, atau berita transfer yang menyertai transaksi" },
        confidence_score: { type: Type.NUMBER, description: "Nilai keyakinan antara 0.0 sampai 1.0. Berikan nilai di bawah 0.85 jika ada bagian teks yang buram/meragukan." }
      },
      required: ["amount", "merchant", "type", "category", "sumber_dana", "confidence_score"]
    }
  },
  required: ["is_transaction_notification"]
};

// Resend Webhook handler
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("svix-signature");
    
    // In production, svix signature verification can be used:
    // import { Webhook } from "svix";
    // const wh = new Webhook(process.env.RESEND_WEBHOOK_SECRET!);
    // wh.verify(rawBody, req.headers);
    
    const payload = JSON.parse(rawBody);

    const emailId = payload.email_id || payload.data?.email_id || payload.id;
    const messageId = payload.data?.message_id || payload.message_id || crypto.randomUUID();
    const fromField = payload.data?.from || payload.from || "";
    const toField = payload.data?.to || payload.to || payload.data?.received_for || "";
    const subjectField = payload.data?.subject || payload.subject || "";
    const createdAt = payload.data?.created_at || payload.created_at || new Date().toISOString();

    // --- DIAGNOSTIC STEP: QUERY OFFICIAL RESEND RECEIVING API ---
    let receivingData: any = null;
    let receivingError: any = null;

    if (emailId && typeof emailId === "string" && !emailId.startsWith("mock_")) {
      try {
        const { data, error } = await resend.emails.receiving.get(emailId);
        receivingData = data;
        receivingError = error;
      } catch (e: any) {
        receivingError = e?.message || e;
      }
    }

    // --- DIAGNOSTIC LOG PRINTING ---
    console.log("============================================================");
    console.log("🔍 RESEND INBOUND DIAGNOSTIC INVESTIGATION LOG");
    console.log("============================================================");
    console.log("[1] WEBHOOK PAYLOAD CAPTURE:");
    console.log(`  - Event Type: ${payload.type || "N/A"}`);
    console.log(`  - Email ID: ${emailId}`);
    console.log(`  - Message ID: ${messageId}`);
    console.log(`  - From: ${JSON.stringify(fromField)}`);
    console.log(`  - To: ${JSON.stringify(toField)}`);
    console.log(`  - Subject: ${JSON.stringify(subjectField)}`);
    console.log(`  - Created At: ${createdAt}`);
    console.log(`  - Webhook payload.text present: ${!!(payload.text || payload.data?.text)} (len: ${(payload.text || payload.data?.text || "").length})`);
    console.log(`  - Webhook payload.html present: ${!!(payload.html || payload.data?.html)} (len: ${(payload.html || payload.data?.html || "").length})`);

    console.log("[2] OFFICIAL RESEND RECEIVING API RESPONSE (GET /emails/receiving/{id}):");
    console.log(`  - Error: ${receivingError ? JSON.stringify(receivingError) : "NONE"}`);
    console.log(`  - Success Data Returned: ${!!receivingData}`);
    if (receivingData) {
      console.log(`  - Object Type: ${receivingData.object}`);
      console.log(`  - ID: ${receivingData.id}`);
      console.log(`  - From: ${receivingData.from}`);
      console.log(`  - To: ${JSON.stringify(receivingData.to)}`);
      console.log(`  - Received For: ${JSON.stringify(receivingData.received_for)}`);
      console.log(`  - Subject: ${receivingData.subject}`);
      console.log(`  - HTML Body Present: ${!!receivingData.html} (length: ${receivingData.html?.length || 0})`);
      console.log(`  - Text Body Present: ${!!receivingData.text} (length: ${receivingData.text?.length || 0})`);
      console.log(`  - Attachments Count: ${receivingData.attachments?.length || 0}`);
      console.log(`  - Attachments Metadata: ${JSON.stringify(receivingData.attachments || [])}`);
      console.log(`  - Headers Present: ${!!receivingData.headers}`);
      console.log(`  - Raw Info: ${JSON.stringify(receivingData.raw || null)}`);
    }

    const htmlBody = receivingData?.html || payload.html || payload.data?.html || "";
    const textBody = receivingData?.text || payload.text || payload.data?.text || payload.body || "";
    const combinedBody = (textBody + "\n" + htmlBody).trim();

    console.log("[3] BODY CONTENT INSPECTION:");
    console.log(`  - Combined Body Length: ${combinedBody.length}`);
    console.log(`  - Text Body Snippet (first 400 chars):\n${textBody.slice(0, 400) || "(EMPTY)"}`);
    console.log(`  - HTML Body Snippet (first 400 chars):\n${htmlBody.slice(0, 400) || "(EMPTY)"}`);
    console.log("============================================================");

    let emailData: any = receivingData || {
      id: emailId,
      to: toField,
      from: fromField,
      subject: subjectField,
      text: textBody,
      html: htmlBody
    };

    const toAddressRaw = Array.isArray(toField) ? toField[0] : toField || receivingData?.to?.[0] || "";
    let cleanToAddress = toAddressRaw;
    const match = cleanToAddress.match(/<(.+)>/);
    if (match) {
      cleanToAddress = match[1];
    }
    cleanToAddress = cleanToAddress.trim().toLowerCase();

    if (!cleanToAddress) {
      console.error("Could not extract destination email address from payload/API");
      return NextResponse.json({ error: "Invalid destination address" }, { status: 400 });
    }

    const emailBody = textBody || htmlBody || subjectField || "";
    const prefix = cleanToAddress.split('@')[0];
    
    console.log(`Incoming TO: ${toAddressRaw}`);
    console.log(`Extracted Prefix: ${prefix}`);

    const supabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Find the user by inbound_email_alias using prefix or exact match
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .or(`inbound_email_alias.eq.${cleanToAddress},inbound_email_alias.like.${prefix}%`)
      .single();
      
    console.log(`DB Query Result:`, profile || profileError);

    if (profileError || !profile) {
      console.log(`Unknown alias: ${cleanToAddress}`);
      return NextResponse.json({ success: true, note: "Ignored, unknown alias" });
    }

    // --- FORWARDING DETECTION & LINK EXTRACTION ---
    const fromStr = (receivingData?.from || (typeof fromField === "string" ? fromField : JSON.stringify(fromField)) || "").toLowerCase();
    const subjectStr = (receivingData?.subject || (typeof subjectField === "string" ? subjectField : JSON.stringify(subjectField)) || "").toLowerCase();

    const isForwardingEmail = 
      fromStr.includes("forwarding-noreply@google.com") ||
      subjectStr.includes("konfirmasi penerusan") ||
      subjectStr.includes("forwarding confirmation") ||
      subjectStr.includes("penerusan gmail");

    if (isForwardingEmail) {
      console.log("=== FORWARDING EMAIL DETECTED - PROCESSING DIAGNOSTIC LINK EXTRACTION ===");
      
      const cleanedBody = combinedBody
        .replace(/=\r?\n/g, "")
        .replace(/(\r\n|\n|\r)/gm, " ")
        .replace(/&amp;/g, "&");

      // Extract specific Gmail verification URL starting with /mail/vf- (supports mail.google.com & mail-settings.google.com)
      const vfMatch = cleanedBody.match(/https:\/\/[a-z0-9.-]*google\.com\/mail\/vf-[^\s"<>\n\r]+/i);
      
      // General fallback match to any google mail link
      const generalMatch = cleanedBody.match(/https:\/\/[a-z0-9.-]*google\.com\/[^\s"<>\n\r]+/i);

      const confirmationUrl = vfMatch ? vfMatch[0] : (generalMatch ? generalMatch[0] : null);

      if (confirmationUrl) {
        console.log("=== ✅ REAL GMAIL CONFIRMATION URL EXTRACTED ===", confirmationUrl);
      } else {
        console.log("=== ❌ GMAIL CONFIRMATION URL NOT FOUND IN INBOUND BODY ===");
        console.log("Full Cleaned Body Logged For Diagnostic Analysis:\n", cleanedBody);
      }

      await supabase.from("notifications").insert({
        user_id: profile.id,
        title: "Konfirmasi Penautan Email Transaksi",
        message: confirmationUrl 
          ? "Penyedia email meminta verifikasi untuk mengalihkan email transaksi ke Douit."
          : "Email konfirmasi penerusan terdeteksi, namun link verifikasi belum dapat diekstrak dari body email.",
        type: "INFO",
        is_read: false,
        metadata: {
          action_type: "FORWARDING_CONFIRMATION",
          confirmation_url: confirmationUrl,
          has_body: combinedBody.length > 0,
          receiving_api_success: !!receivingData,
          is_confirmed: false,
          provider: "Gmail"
        }
      });

      return NextResponse.json({
        success: true,
        message: "Forwarding verification processed",
        diagnostic: {
          email_id: emailId,
          receiving_api_used: true,
          receiving_api_success: !!receivingData,
          has_text: !!receivingData?.text,
          has_html: !!receivingData?.html,
          confirmation_url_extracted: !!confirmationUrl,
          confirmation_url: confirmationUrl
        }
      }, { status: 200 });
    }

    // Check for idempotency
    const { data: existingTx } = await supabase
      .from('transactions')
      .select('id')
      .eq('idempotency_key', messageId)
      .single();

    if (existingTx) {
      console.log(`Transaction already processed for messageId: ${messageId}`);
      return NextResponse.json({ success: true, note: "Already processed" });
    }

    const { data: categories } = await supabase.from('categories').select('id, name').or(`user_id.eq.${profile.id},is_system.eq.true`);
    const categoryNames = categories ? categories.map(c => c.name).join(", ") : "Lain-lain";

    const fullEmailContent = `
      From: ${emailData.from || payload.from || ''}
      Subject: ${emailData.subject || payload.subject || ''}
      Body: ${emailBody}
    `;

    const response = await executeWithGenAIFailover(async (aiInstance) => {
      return await aiInstance.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Ekstrak data notifikasi bank berikut:\n\n${fullEmailContent}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: emailParseSchema,
          systemInstruction: `Anda bertugas membaca notifikasi email dari bank/e-wallet dan mengekstrak rincian transaksi. Perhatikan secara spesifik label "Berita:", "Catatan:", "Remark:", "Keterangan:", atau "Description:" untuk diekstrak ke dalam 'notes'. Prioritaskan isi 'notes' untuk menentukan 'category'. Kategori HARUS dipilih dari daftar berikut: [${categoryNames}]. Ekstrak nama bank/e-wallet ke 'sumber_dana'. Jika terdapat biaya admin atau transfer fee terpisah dari jumlah pokok, pisahkan angkanya ke dalam 'admin_fee' dan keluarkan dari 'amount'. 'amount' hanya untuk jumlah utama transaksi.`
        }
      });
    });

    let textResponse = response.text || "{}";
    textResponse = textResponse.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(textResponse);
    
    console.log("=== AI PARSED DATA ===");
    console.log(JSON.stringify(parsed, null, 2));

    if (parsed.is_transaction_notification && parsed.transaction_details) {
      const tx = parsed.transaction_details;

      // Domain Fallback for empty or unknown sumber_dana
      if (!tx.sumber_dana || tx.sumber_dana.toLowerCase().includes("tidak diketahui")) {
        const fromHeader = (emailData.from || payload.from || "").toLowerCase();
        const subjectHeader = (emailData.subject || payload.subject || "").toLowerCase();
        
        if (fromHeader.includes("bankbca.co.id") || subjectHeader.includes("bca")) {
          tx.sumber_dana = "Bank BCA";
        } else if (fromHeader.includes("bri.co.id") || subjectHeader.includes("bri")) {
          tx.sumber_dana = "Bank BRI";
        } else if (fromHeader.includes("mandiri")) {
          tx.sumber_dana = "Bank Mandiri";
        } else if (fromHeader.includes("bni")) {
          tx.sumber_dana = "Bank BNI";
        }
      }

      let status = tx.confidence_score >= 0.85 ? 'APPROVED' : 'PENDING_APPROVAL';
      let categoryId = null;

      // 0. Check for Active Savings Goal Matching (Score >= 80%)
      let matchedGoal: any = null;
      try {
        const { data: activeGoals } = await supabase
          .from('savings_goals')
          .select('*')
          .eq('user_id', profile.id)
          .eq('status', 'ACTIVE')
          .in('storage_type', ['GOPAY_MERCHANT', 'BANK_TRANSFER'])
          .not('storage_detail', 'is', null);

        if (activeGoals && activeGoals.length > 0) {
          matchedGoal = activeGoals.find((g) => {
            if (!g.storage_detail) return false;
            return (
              isMerchantMatch(tx.merchant, g.storage_detail) ||
              (tx.notes && isMerchantMatch(tx.notes, g.storage_detail))
            );
          });
        }
      } catch (err) {
        console.error("Error checking active goals for transaction matching:", err);
      }

      if (matchedGoal) {
        console.log(`🎯 Savings Goal Matched! Goal: "${matchedGoal.title}" (${matchedGoal.id}) matched with incoming "${tx.merchant}"`);
        // Assign system "Nabung" category
        const { data: nabungCategory } = await supabase
          .from('categories')
          .select('id')
          .eq('name', 'Nabung')
          .single();

        if (nabungCategory) {
          categoryId = nabungCategory.id;
        } else {
          // Fallback to "Lain-lain" if Nabung category doesn't exist yet
          const { data: fallbackCategory } = await supabase
            .from('categories')
            .select('id')
            .eq('name', 'Lain-lain')
            .single();
          if (fallbackCategory) categoryId = fallbackCategory.id;
        }

        // Standardize transaction title/merchant and notes to "Nabung {goal.title}"
        tx.merchant = `Nabung ${matchedGoal.title}`;
        tx.notes = `Nabung ${matchedGoal.title}`;
        status = 'APPROVED';
      } else {
        // 1. Check Adaptive Learning Rules (merchant_rules)
        const { data: rules } = await supabase
          .from('merchant_rules')
          .select('merchant_name, keyword, category_id, sumber_dana')
          .eq('user_id', profile.id);

        let matchedRule = null;
        if (rules && rules.length > 0) {
          matchedRule = rules.find(rule => {
            const matchMerchant = tx.merchant.toLowerCase().includes(rule.merchant_name.toLowerCase()) || 
              emailBody.toLowerCase().includes(rule.merchant_name.toLowerCase());
            const matchKeyword = rule.keyword ? (tx.notes?.toLowerCase().includes(rule.keyword.toLowerCase()) || emailBody.toLowerCase().includes(rule.keyword.toLowerCase())) : true;
            return matchMerchant && matchKeyword;
          });
        }

        if (matchedRule) {
          // Bypass AI category and force approve
          categoryId = matchedRule.category_id;
          status = 'APPROVED';
          if (matchedRule.keyword) tx.notes = matchedRule.keyword;
          if (matchedRule.sumber_dana) tx.sumber_dana = matchedRule.sumber_dana;
        } else {
          // 2. Lookup Category ID from AI's category string
          const { data: categoryRow } = await supabase
            .from('categories')
            .select('id')
            .eq('name', tx.category)
            .single();
          
          if (categoryRow) {
            categoryId = categoryRow.id;
          } else {
            // Fallback to "Lain-lain"
            const { data: fallbackCategory } = await supabase
              .from('categories')
              .select('id')
              .eq('name', 'Lain-lain')
              .single();
            if (fallbackCategory) categoryId = fallbackCategory.id;
          }
        }
      }

      // Fetch user's payment accounts for matching
      const { data: accounts } = await supabase
        .from('payment_accounts')
        .select('id, name, type')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: true }); // ensure consistent ordering

      let targetAccountName = 'Tunai';
      let isFallback = false;
      const rawSumberDana = tx.sumber_dana || "";
      
      const extractBankKeyword = (sumberDana: string) => {
        if (!sumberDana) return "";
        return sumberDana.replace(/bank\s+/i, '').trim();
      };
      const keyword = extractBankKeyword(rawSumberDana);

      if (accounts && accounts.length > 0) {
        let matchedAccount = null;
        if (keyword) {
           matchedAccount = accounts.find(acc => acc.name.toLowerCase().includes(keyword.toLowerCase()));
        }

        if (matchedAccount) {
          targetAccountName = matchedAccount.name;
        } else {
          // Fallback
          const defaultAccount = accounts.find(a => a.type === 'BANK' || a.type === 'bank') || accounts[0];
          targetAccountName = defaultAccount.name;
          isFallback = true;
          
          if (keyword) {
            console.warn(`⚠️ No account found for '${keyword}'. Assigned to fallback account '${defaultAccount.name}'.`);
          }

          const detectedBank = rawSumberDana && rawSumberDana !== "Tidak Diketahui" ? rawSumberDana : "Bank Anda";
          await supabase.from('notifications').insert({
            user_id: profile.id,
            title: "Rekening Bank Belum Terdaftar",
            message: `Terdeteksi transaksi dari ${detectedBank}, tetapi Anda belum menambahkan rekening tersebut.`,
            type: "WARNING",
            metadata: {
              bank_keyword: keyword || detectedBank,
              suggested_action: "CREATE_ACCOUNT"
            }
          });
        }
      }

      let finalNotes = tx.notes || "";
      if (isFallback && keyword) {
        finalNotes = finalNotes ? `${finalNotes} [UNMATCHED_BANK:${keyword}]` : `[UNMATCHED_BANK:${keyword}]`;
      }

      const txPayload = {
        user_id: profile.id,
        amount: tx.amount,
        type: tx.type,
        merchant: tx.merchant,
        category_id: categoryId,
        sumber_dana: rawSumberDana || "Tunai", // Preserve raw source name
        status: status,
        source: 'AUTOMATIC_EMAIL',
        confidence_score: matchedGoal ? 1.0 : tx.confidence_score,
        idempotency_key: messageId,
        raw_email_body: emailBody,
        notes: finalNotes || null
      };

      const payloads = [txPayload];

      if (tx.admin_fee && tx.admin_fee > 0) {
        const { data: adminCat } = await supabase
          .from('categories')
          .select('id')
          .eq('name', 'Biaya Admin')
          .single();

        payloads.push({
          ...txPayload,
          amount: tx.admin_fee,
          merchant: "Biaya Admin " + (rawSumberDana || "Bank"),
          category_id: adminCat?.id || null,
          idempotency_key: `${messageId}-adminfee`
        });
      }

      const { error: insertError } = await supabase.from('transactions').insert(payloads);

      if (insertError) {
        console.error("Webhook insert error:", insertError);
        return NextResponse.json({ error: "Failed to save transaction" }, { status: 500 });
      }
      
      console.log('✅ Successfully processed transaction from webhook:', parsed);

      if (tx.type === 'EXPENSE' && status === 'APPROVED') {
        checkAndSendOverBudgetAlert(profile.id, supabase).catch(err => 
          console.error("Over budget check failed in resend webhook:", err)
        );
      }

      // --- SAVINGS GOALS PROGRESS SYNC & WHATSAPP NOTIFICATION ---
      if (matchedGoal) {
        try {
          // 1. Insert into savings_logs
          await supabase.from('savings_logs').insert({
            goal_id: matchedGoal.id,
            user_id: profile.id,
            amount: tx.amount,
            notes: `Setoran otomatis QRIS/Bank via email (${tx.merchant})`,
            source_type: 'INBOUND_EMAIL'
          });

          // 2. Update current_amount, streak & status on savings_goals
          const newCurrent = (matchedGoal.current_amount || 0) + tx.amount;
          const isCompleted = newCurrent >= matchedGoal.target_amount;
          const todayStr = new Date().toISOString().split('T')[0];

          let newStreak = matchedGoal.streak_count || 0;
          if (matchedGoal.last_deposit_date !== todayStr) {
            newStreak += 1;
          }

          await supabase
            .from('savings_goals')
            .update({
              current_amount: newCurrent,
              streak_count: newStreak,
              last_deposit_date: todayStr,
              status: isCompleted ? 'COMPLETED' : matchedGoal.status,
              updated_at: new Date().toISOString()
            })
            .eq('id', matchedGoal.id);

          // 3. Send WhatsApp Notification via Fonnte
          const targetPhone = matchedGoal.whatsapp_number;
          if (targetPhone) {
            const formatRupiah = (val: number) => new Intl.NumberFormat('id-ID').format(val);
            const percentage = Math.min(100, Math.round((newCurrent / matchedGoal.target_amount) * 100));

            const waMessage = `🎉 *Setoran Otomatis QRIS Terdeteksi!*

Target: *${matchedGoal.title}*
Setoran Masuk: *Rp ${formatRupiah(tx.amount)}* (via ${tx.merchant})
Total Terkumpul: *Rp ${formatRupiah(newCurrent)}* / Rp ${formatRupiah(matchedGoal.target_amount)}
Progress: ${generateWaProgressBar(percentage)}
Streak: 🔥 *${newStreak} Hari Aktif*

_Tabungan impian Anda makin dekat! Tetap konsisten!_ 💪`;

            await sendFonnteMessageWithFailover({
              target: targetPhone,
              message: waMessage,
              url: matchedGoal.image_url || undefined,
            });
            console.log(`📱 WhatsApp auto-notification sent for goal "${matchedGoal.title}" to ${targetPhone}`);
          }
        } catch (savingsErr) {
          console.error("Error processing savings goal auto-deposit sync:", savingsErr);
        }
      }
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Webhook Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
