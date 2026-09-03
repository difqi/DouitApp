import { NextRequest, NextResponse } from "next/server";
import { executeWithGenAIFailover } from "@/lib/gemini";
import {
  buildEmailClassificationInstruction,
  emailParseSchema,
} from "@/lib/email-classification";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";
import { isDeterministicSavingsAccountMatch } from "@/utils/bankAliases";
import {
  buildCategoryHierarchy,
  listCategoriesForUser,
  listVisibleSubcategoriesForUser,
  resolveHierarchicalCategoryFromRows,
  resolveSystemCategoryFromRows,
  serializeCategoryHierarchyForModel,
  SYSTEM_CATEGORY_NAMES,
  type TransactionType,
} from "@/lib/categories";
import {
  findDeterministicSavingsGoalMatch,
  resolveNormalTransactionKind,
  shouldExposeCategoryInOrdinaryTransactionPicker,
} from "@/lib/transaction-semantics";
import {
  buildSavingsOperationKey,
  findUniqueOwnedSavingsAccount,
  getSingleRpcRow,
  parseProviderReceivedAt,
  type SavingsEvidenceReconciliationResult,
  type SavingsSourceAccount,
} from "@/lib/savings-contributions";

import { sendFonnteMessageWithFailover, generateWaProgressBar } from "@/lib/fonnte";
import { checkAndSendOverBudgetAlert } from "@/lib/savingsAlert";

const resend = new Resend(process.env.RESEND_API_KEY);

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
    const webhookCreatedAt = payload.data?.created_at || payload.created_at;

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

    // Only the authenticated Resend Receiving API response is strong enough for
    // automatic manual->email evidence reconciliation. The webhook timestamp is
    // still retained as a compatibility fallback for generic email transactions.
    const providerReceivedAt = parseProviderReceivedAt(receivingData?.created_at);
    const createdAt = providerReceivedAt
      || parseProviderReceivedAt(webhookCreatedAt)
      || new Date().toISOString();

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

    const [categories, visibleSubcategories] = await Promise.all([
      listCategoriesForUser(supabase, profile.id),
      listVisibleSubcategoriesForUser(supabase, profile.id),
    ]);
    const ordinaryCategories = categories.filter((category) =>
      shouldExposeCategoryInOrdinaryTransactionPicker(category),
    );
    const ordinaryCategoryIds = new Set(ordinaryCategories.map((category) => category.id));
    const ordinarySubcategories = visibleSubcategories.filter((subcategory) =>
      ordinaryCategoryIds.has(subcategory.category_id),
    );
    const taxonomyContext = serializeCategoryHierarchyForModel(
      buildCategoryHierarchy(ordinaryCategories, ordinarySubcategories),
    );

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
          systemInstruction: buildEmailClassificationInstruction(taxonomyContext),
        }
      });
    });

    let textResponse = response.text || "{}";
    textResponse = textResponse.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(textResponse);
    
    if (parsed.is_transaction_notification && parsed.transaction_details) {
      const tx = parsed.transaction_details;
      const transactionType: TransactionType | null = tx.type === 'INCOME' || tx.type === 'EXPENSE'
        ? tx.type
        : null;

      if (!transactionType) {
        return NextResponse.json({ error: "Invalid transaction type" }, { status: 422 });
      }

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
      let subcategoryId = null;

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
          matchedGoal = findDeterministicSavingsGoalMatch({
            goals: activeGoals,
            merchant: tx.merchant,
            notes: tx.notes,
          });
        }
      } catch (err) {
        console.error("Error checking active goals for transaction matching:", err);
      }

      // Nabung is currently an EXPENSE-only system category. Do not create a
      // category/type mismatch if an inbound income happens to match goal text.
      if (matchedGoal && transactionType !== 'EXPENSE') matchedGoal = null;

      const { data: accounts } = await supabase
        .from('payment_accounts')
        .select('id, user_id, name, type')
        .eq('user_id', profile.id)
        .not('user_id', 'is', null)
        .order('created_at', { ascending: true });

      const rawSumberDana = tx.sumber_dana || "";
      const savingsAccount = matchedGoal
        ? findUniqueOwnedSavingsAccount({
            accounts: (accounts || []) as SavingsSourceAccount[],
            actorUserId: profile.id,
            matches: (account) => isDeterministicSavingsAccountMatch(
              account.name,
              rawSumberDana,
            ),
          })
        : null;
      const savingsOperationKey = matchedGoal
        ? buildSavingsOperationKey({ namespace: 'resend', stableId: emailId })
        : null;

      if (matchedGoal && (!savingsAccount || !savingsOperationKey || !providerReceivedAt)) {
        console.warn('[Resend Webhook] Savings match downgraded: stable email/account/timestamp identity is unavailable');
        matchedGoal = null;
      }

      if (matchedGoal) {
        console.log(`🎯 Savings Goal Matched! Goal: "${matchedGoal.title}" (${matchedGoal.id}) matched with incoming "${tx.merchant}"`);
        // Assign system "Nabung" category
        const nabungCategory = resolveSystemCategoryFromRows(
          categories,
          SYSTEM_CATEGORY_NAMES.SAVING,
          'EXPENSE',
        );

        if (nabungCategory.status === 'matched') {
          categoryId = nabungCategory.category.id;
        } else {
          // Fallback to "Lain-lain" if Nabung category doesn't exist yet
          const fallbackCategory = resolveSystemCategoryFromRows(
            categories,
            SYSTEM_CATEGORY_NAMES.OTHER,
            'EXPENSE',
          );
          if (fallbackCategory.status === 'matched') categoryId = fallbackCategory.category.id;
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

        const categoryResolution = resolveHierarchicalCategoryFromRows({
          categories: ordinaryCategories,
          subcategories: ordinarySubcategories,
          userId: profile.id,
          type: transactionType,
          categoryName: typeof tx.category === 'string' ? tx.category : '',
          subcategoryName: typeof tx.subcategory === 'string' ? tx.subcategory : null,
          trustedCategoryId: matchedRule?.category_id || null,
        });

        if (categoryResolution.status === 'matched') {
          categoryId = categoryResolution.category.id;
          subcategoryId = categoryResolution.subcategory?.id || null;
          if (matchedRule && categoryResolution.categorySource === 'trusted_override') {
            status = 'APPROVED';
            if (matchedRule.keyword) tx.notes = matchedRule.keyword;
            if (matchedRule.sumber_dana) tx.sumber_dana = matchedRule.sumber_dana;
          }
        } else {
          // Keep unresolved model taxonomy pending; never silently reinterpret it as Lain-lain.
          status = 'PENDING_APPROVAL';
        }
      }

      if (!categoryId) status = 'PENDING_APPROVAL';

      let targetAccountName = 'Tunai';
      let isFallback = false;
      
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

      if (matchedGoal) {
        const sourceAccount = savingsAccount!;
        const operationKey = savingsOperationKey!;
        const occurredAt = providerReceivedAt!;

        const { data: reconciliationData, error: reconciliationError } = await supabase.rpc(
          'reconcile_savings_contribution_evidence',
          {
            p_actor_user_id: profile.id,
            p_goal_id: matchedGoal.id,
            p_amount: tx.amount,
            p_source_account_id: sourceAccount.id,
            p_external_event_id: operationKey,
            p_notes: `Setoran otomatis QRIS/Bank via email (${tx.merchant})`,
            p_occurred_at: occurredAt,
            p_raw_email_body: emailBody,
          },
        );

        if (reconciliationError) {
          console.error('[Resend Webhook] Savings evidence reconciliation failed:', reconciliationError.message);
          return NextResponse.json({ error: 'Savings evidence reconciliation failed' }, { status: 500 });
        }

        const reconciliation = getSingleRpcRow<SavingsEvidenceReconciliationResult>(reconciliationData);
        if (!reconciliation) {
          return NextResponse.json({ error: 'Savings evidence result missing' }, { status: 500 });
        }
        if (reconciliation.out_outcome === 'AMBIGUOUS') {
          console.warn('[Resend Webhook] Ambiguous manual savings evidence; no duplicate created');
          return NextResponse.json({ success: true, note: 'Savings evidence requires review' });
        }

        const currentAmount = Number(reconciliation.out_current_amount || 0);
        const createdContribution = reconciliation.out_outcome === 'CREATED';

        if (tx.admin_fee && tx.admin_fee > 0) {
          const adminCat = resolveSystemCategoryFromRows(
            categories,
            SYSTEM_CATEGORY_NAMES.ADMIN_FEE,
            'EXPENSE',
          );
          const { error: feeError } = await supabase.from('transactions').upsert({
            user_id: profile.id,
            amount: tx.admin_fee,
            type: 'EXPENSE',
            merchant: `Biaya Admin ${sourceAccount.name}`,
            category_id: adminCat.status === 'matched' ? adminCat.category.id : null,
            subcategory_id: null,
            transaction_kind: 'FEE',
            sumber_dana: sourceAccount.name,
            status: adminCat.status === 'matched' ? 'APPROVED' : 'PENDING_APPROVAL',
            source: 'AUTOMATIC_EMAIL',
            confidence_score: 1.0,
            idempotency_key: `${operationKey}:adminfee`,
            raw_email_body: emailBody,
            notes: finalNotes || null,
            transaction_date: occurredAt,
          }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
          if (feeError) console.error('[Resend Webhook] Admin fee insert failed:', feeError.message);
        }

        if (createdContribution) {
          checkAndSendOverBudgetAlert(profile.id, supabase).catch(err =>
            console.error('Over budget check failed in resend webhook:', err)
          );
        }

        const targetPhone = matchedGoal.whatsapp_number;
        if (targetPhone) {
          const formatRupiah = (value: number) => new Intl.NumberFormat('id-ID').format(value);
          const percentage = Math.min(100, Math.round((currentAmount / matchedGoal.target_amount) * 100));
          const evidenceLabel = reconciliation.out_outcome === 'UPGRADED'
            ? 'Setoran Manual Terverifikasi'
            : 'Setoran Otomatis Terverifikasi';
          const waMessage = `🎉 *${evidenceLabel}!*

Target: *${matchedGoal.title}*
Setoran: *Rp ${formatRupiah(tx.amount)}* (via ${tx.merchant})
Total Terkumpul: *Rp ${formatRupiah(currentAmount)}* / Rp ${formatRupiah(matchedGoal.target_amount)}
Progress: ${generateWaProgressBar(percentage)}

_Tabungan impian Anda makin dekat! Tetap konsisten!_ 💪`;
          await sendFonnteMessageWithFailover({
            target: targetPhone,
            message: waMessage,
            url: matchedGoal.image_url || undefined,
          });
        }

        return NextResponse.json({
          success: true,
          savings_outcome: reconciliation.out_outcome,
        });
      }

      const txPayload = {
        user_id: profile.id,
        amount: tx.amount,
        type: transactionType,
        merchant: tx.merchant,
        category_id: categoryId,
        subcategory_id: subcategoryId,
        transaction_kind: resolveNormalTransactionKind(
          categories.find((category) => category.id === categoryId),
        ),
        sumber_dana: rawSumberDana || "Tunai", // Preserve raw source name
        status: status,
        source: 'AUTOMATIC_EMAIL',
        confidence_score: tx.confidence_score,
        idempotency_key: messageId,
        raw_email_body: emailBody,
        notes: finalNotes || null
      };

      const payloads = [txPayload];

      if (tx.admin_fee && tx.admin_fee > 0) {
        const adminCat = resolveSystemCategoryFromRows(
          categories,
          SYSTEM_CATEGORY_NAMES.ADMIN_FEE,
          'EXPENSE',
        );

        payloads.push({
          ...txPayload,
          amount: tx.admin_fee,
          type: 'EXPENSE',
          merchant: "Biaya Admin " + (rawSumberDana || "Bank"),
          category_id: adminCat.status === 'matched' ? adminCat.category.id : null,
          subcategory_id: null,
          transaction_kind: 'FEE',
          status: adminCat.status === 'matched' ? txPayload.status : 'PENDING_APPROVAL',
          idempotency_key: `${messageId}-adminfee`
        });
      }

      const { error: insertError } = await supabase.from('transactions').insert(payloads);

      if (insertError) {
        console.error("Webhook insert error:", insertError);
        return NextResponse.json({ error: "Failed to save transaction" }, { status: 500 });
      }
      
      console.log('[Resend Webhook] Transaction processed');

      if (transactionType === 'EXPENSE' && status === 'APPROVED') {
        checkAndSendOverBudgetAlert(profile.id, supabase).catch(err => 
          console.error("Over budget check failed in resend webhook:", err)
        );
      }

    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Webhook Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
