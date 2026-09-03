import { NextResponse } from 'next/server';
import { sendFonnteMessage, getWaProgressBarBlocks } from '@/lib/fonnte';
import { calculateGoalMetrics, SavingsGoal as SavingsGoalCalc } from '@/lib/savings-calc';
import { isDeterministicSavingsAccountMatch } from '@/utils/bankAliases';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildSavingsOperationKey,
  findUniqueOwnedSavingsAccount,
  getSingleRpcRow,
  type SavingsContributionResult,
  type SavingsSourceAccount,
} from '@/lib/savings-contributions';

interface FonnteWebhookPayload {
  sender?: string;
  message?: string;
  name?: string;
  device?: string;
  secret?: string;
  inboxid?: string | number;
  inbox_id?: string | number;
  [key: string]: any;
}

export async function POST(req: Request) {
  try {
    const isProduction = process.env.NODE_ENV === 'production';
    const expectedWebhookSecret = process.env.FONNTE_WEBHOOK_SECRET?.trim();
    if (isProduction && !expectedWebhookSecret) {
      return NextResponse.json({ status: false, error: 'Unauthorized' }, { status: 401 });
    }

    let sender = '';
    let messageText = '';
    let providerEventId = '';
    let webhookSecret = '';

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = (await req.json()) as FonnteWebhookPayload;
      sender = body?.sender || '';
      messageText = body?.message || '';
      providerEventId = String(body?.inboxid || body?.inbox_id || '').trim();
      webhookSecret = String(body?.secret || '').trim();
    } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      sender = (formData.get('sender') as string) || '';
      messageText = (formData.get('message') as string) || '';
      providerEventId = String(formData.get('inboxid') || formData.get('inbox_id') || '').trim();
      webhookSecret = String(formData.get('secret') || '').trim();
    } else {
      try {
        const body = (await req.clone().json()) as FonnteWebhookPayload;
        sender = body?.sender || '';
        messageText = body?.message || '';
        providerEventId = String(body?.inboxid || body?.inbox_id || '').trim();
        webhookSecret = String(body?.secret || '').trim();
      } catch {
        const text = await req.text();
        const params = new URLSearchParams(text);
        sender = params.get('sender') || '';
        messageText = params.get('message') || '';
        providerEventId = params.get('inboxid') || params.get('inbox_id') || '';
        webhookSecret = params.get('secret') || '';
      }
    }

    webhookSecret = webhookSecret.trim();
    if (expectedWebhookSecret && webhookSecret !== expectedWebhookSecret) {
      return NextResponse.json({ status: false, error: 'Unauthorized' }, { status: 401 });
    }

    // The sender-to-user ownership lookup below validates the identity used by all admin mutations.
    const supabaseAdmin = createAdminClient();

    sender = String(sender).trim();
    messageText = String(messageText).trim();

    if (!sender || !messageText) {
      return NextResponse.json({ status: true }, { status: 200 });
    }

    // Sanitize sender phone number formats (support 08..., 628..., +628...)
    const digitsOnly = sender.replace(/[^0-9]/g, '');
    if (!digitsOnly) {
      return NextResponse.json({ status: true }, { status: 200 });
    }

    let phone62 = digitsOnly;
    let phone08 = digitsOnly;

    if (digitsOnly.startsWith('0')) {
      phone62 = '62' + digitsOnly.slice(1);
    } else if (digitsOnly.startsWith('62')) {
      phone08 = '0' + digitsOnly.slice(2);
    } else {
      phone62 = '62' + digitsOnly;
      phone08 = '0' + digitsOnly;
    }

    const phonePlus62 = '+' + phone62;

    // 1. Identify user owning this phone number from savings_goals (primary) or profiles
    let userId: string | null = null;

    const phoneFilter = `whatsapp_number.eq.${phone62},whatsapp_number.eq.${phone08},whatsapp_number.eq.${phonePlus62},whatsapp_number.eq.${digitsOnly}`;
    const { data: goalMatches, error: goalMatchErr } = await supabaseAdmin
      .from('savings_goals')
      .select('user_id')
      .or(phoneFilter);

    const goalOwnerIds = [...new Set(
      (goalMatches || [])
        .map((goalRow: { user_id?: string | null }) => goalRow.user_id)
        .filter((ownerId): ownerId is string => typeof ownerId === 'string' && ownerId.length > 0),
    )];

    if (goalMatchErr) {
      console.error('[Fonnte Webhook] Failed to resolve sender ownership:', goalMatchErr.message);
      return NextResponse.json({ status: false, error: 'Sender ownership lookup failed' }, { status: 500 });
    }

    if (goalOwnerIds.length > 1) {
      console.error('[Fonnte Webhook] Ambiguous sender ownership; refusing financial mutation');
      return NextResponse.json({ status: true, note: 'Ambiguous sender ownership' }, { status: 200 });
    }

    if (goalOwnerIds.length === 1) {
      userId = goalOwnerIds[0];
    } else {
      // Fallback: check profiles if phone column exists
      try {
        const { data: profiles } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .or(`phone.eq.${phone62},phone.eq.${phone08},phone.eq.${phonePlus62},phone.eq.${digitsOnly}`)
          .limit(2);

        const profileIds = [...new Set(
          (profiles || [])
            .map((profile: { id?: string | null }) => profile.id)
            .filter((profileId): profileId is string => typeof profileId === 'string' && profileId.length > 0),
        )];
        if (profileIds.length === 1) {
          userId = profileIds[0];
        } else if (profileIds.length > 1) {
          console.error('[Fonnte Webhook] Ambiguous profile phone ownership; refusing financial mutation');
          return NextResponse.json({ status: true, note: 'Ambiguous sender ownership' }, { status: 200 });
        }
      } catch {
        // Ignored if profiles.phone column does not exist
      }
    }

    if (!userId) {
      console.warn('[Fonnte Webhook] Unrecognized sender phone number');
      await sendFonnteMessage(sender, "Nomor WhatsApp Anda belum terhubung dengan akun Douit AI. Pastikan nomor telah diinput saat membuat target nabung.");
      return NextResponse.json({ status: true }, { status: 200 });
    }

    // Today in WIB (Asia/Jakarta) format YYYY-MM-DD
    const todayWIB = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    // 2. Command Parser Logic: "Nabung [keyword] [nominal]" optionally followed by "pakai [account_name]"
    if (/^nabung\b/i.test(messageText)) {
      const afterNabung = messageText.replace(/^nabung\s*/i, '').trim();

      let mainPart = afterNabung;
      let rawAccountInput = '';

      // Check for "pakai <account_name>"
      const pakaiMatch = afterNabung.match(/^(.*?)\s+pakai\s+(.+)$/i);
      if (pakaiMatch) {
        mainPart = pakaiMatch[1].trim();
        rawAccountInput = pakaiMatch[2].trim();
      }

      // In mainPart, extract optional keyword and numeric nominal
      let keyword = '';
      let amount = 0;
      let hasKeyword = false;

      const nominalMatch = mainPart.match(/^(?:(.*)\s+)?(\d[\d.,]*)$/);
      if (nominalMatch) {
        keyword = (nominalMatch[1] || '').trim();
        const rawNominal = nominalMatch[2].replace(/[.,]/g, '');
        amount = parseInt(rawNominal, 10);
        hasKeyword = keyword.length > 0;
      }

      if (isNaN(amount) || amount <= 0) {
        await sendFonnteMessage(
          sender,
          "🤖 *Douit AI Assistant*\n\nFormat setoran tidak valid.\nContoh:\n• *Nabung salad 5000 pakai bri*\n• *Nabung celengan 10000*"
        );
        return NextResponse.json({ status: true }, { status: 200 });
      }

      const operationKey = buildSavingsOperationKey({
        namespace: 'fonnte',
        stableId: providerEventId,
      });
      if (!operationKey) {
        console.error('[Fonnte Webhook] Savings command rejected: stable inboxid is unavailable');
        await sendFonnteMessage(
          sender,
          'Setoran belum dicatat karena identitas pesan WhatsApp tidak tersedia. Silakan catat melalui halaman Nabung agar tidak berisiko tercatat ganda.',
        );
        return NextResponse.json({ status: true, note: 'Stable provider event ID required' });
      }

      // Query user's active savings goals with savings_logs
      const { data: activeGoals, error: activeGoalsErr } = await supabaseAdmin
        .from('savings_goals')
        .select('*, savings_logs(id, amount, created_at)')
        .eq('user_id', userId)
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false });

      if (activeGoalsErr) {
        console.error('[Fonnte Webhook] Error fetching active goals:', activeGoalsErr);
      }

      if (!activeGoals || activeGoals.length === 0) {
        await sendFonnteMessage(sender, "Anda belum memiliki target tabungan aktif di Douit AI.");
        return NextResponse.json({ status: true }, { status: 200 });
      }

      let goal: any = null;

      if (hasKeyword) {
        // Target Matching:
        // 1. Check if first word of goal.title matches extracted keyword (case-insensitive)
        const firstWordMatches = activeGoals.filter((g: any) => {
          const firstWord = (g.title || '').trim().split(/\s+/)[0].toLowerCase();
          return firstWord === keyword.toLowerCase();
        });

        if (firstWordMatches.length === 1) {
          goal = firstWordMatches[0];
        } else if (firstWordMatches.length > 1) {
          await sendFonnteMessage(
            sender,
            `Ada lebih dari satu target yang cocok dengan '*${keyword}*'. Gunakan kata kunci target yang lebih spesifik.`,
          );
          return NextResponse.json({ status: true, note: 'Ambiguous savings goal' }, { status: 200 });
        }

        // 2. Fallback: Check if goal.title contains keyword anywhere
        if (!goal) {
          const containsMatches = activeGoals.filter((g: any) => {
            return (g.title || '').toLowerCase().includes(keyword.toLowerCase());
          });
          if (containsMatches.length === 1) {
            goal = containsMatches[0];
          } else if (containsMatches.length > 1) {
            await sendFonnteMessage(
              sender,
              `Ada lebih dari satu target yang cocok dengan '*${keyword}*'. Gunakan kata kunci target yang lebih spesifik.`,
            );
            return NextResponse.json({ status: true, note: 'Ambiguous savings goal' }, { status: 200 });
          }
        }

        if (!goal) {
          await sendFonnteMessage(
            sender,
            `❌ Target tabungan dengan kata kunci '*${keyword}*' tidak ditemukan. Pastikan kata kunci sesuai dengan judul target Anda.`
          );
          return NextResponse.json({ status: true }, { status: 200 });
        }
      } else {
        if (activeGoals.length !== 1) {
          await sendFonnteMessage(
            sender,
            'Sebutkan kata kunci target karena Anda memiliki lebih dari satu target tabungan aktif.',
          );
          return NextResponse.json({ status: true, note: 'Savings goal keyword required' }, { status: 200 });
        }
        goal = activeGoals[0];
      }

      // Strict 1x Daily Limit Check Per Goal
      const { data: existingTodayLogs } = await supabaseAdmin
        .from('savings_logs')
        .select('id, created_at')
        .eq('goal_id', goal.id)
        .eq('user_id', userId);

      const alreadyDepositedToday =
        goal.last_deposit_date === todayWIB ||
        (existingTodayLogs || []).some((log: any) => {
          if (!log.created_at) return false;
          const logDateWIB = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(log.created_at));
          return logDateWIB === todayWIB;
        });

      if (alreadyDepositedToday) {
        console.log(`[Fonnte Webhook] Rejection: Goal "${goal.title}" (${goal.id}) already received deposit today (${todayWIB}).`);
        await sendFonnteMessage(
          sender,
          `⚠️ Anda sudah mencatat setoran untuk target *${goal.title}* hari ini. Setoran via chat dibatasi 1x per hari per target.`
        );
        return NextResponse.json({ status: true }, { status: 200 });
      }

      // Account Validation based on savings destination method
      const isCashGoal = goal.storage_type === 'TUNAI';
      let recordedSumberDana = 'Tunai';
      let sourceAccountId: string | null = null;

      if (isCashGoal) {
        recordedSumberDana = 'Tunai';
      } else {
        // Non-Cash Goals (GOPAY_MERCHANT / BANK_TRANSFER)
        const { data: userAccounts } = await supabaseAdmin
          .from('payment_accounts')
          .select('id, user_id, name, type, is_primary')
          .eq('user_id', userId)
          .not('user_id', 'is', null);

        const registeredAccounts = userAccounts || [];
        const registeredListStr = registeredAccounts.length > 0
          ? registeredAccounts.map((a: any) => a.name).join(', ')
          : 'Belum ada rekening/e-wallet terdaftar';

        const displayKeyword = keyword || (goal.title || '').split(/\s+/)[0];

        if (!rawAccountInput) {
          await sendFonnteMessage(
            sender,
`❌ *Setoran Gagal Dicatat!*
Target ini memerlukan sumber dana rekening/e-wallet yang valid.
Harap sertakan sumber rekening/wallet yang Anda gunakan.
Daftar rekening terdaftar Anda: ${registeredListStr}.
Format: Nabung ${displayKeyword} ${amount} pakai [nama_rekening]`
          );
          return NextResponse.json({ status: true }, { status: 200 });
        }

        const matchedAccount = findUniqueOwnedSavingsAccount({
          accounts: registeredAccounts as SavingsSourceAccount[],
          actorUserId: userId,
          matches: (account) => {
            return isDeterministicSavingsAccountMatch(account.name, rawAccountInput);
          },
        });

        if (!matchedAccount) {
          await sendFonnteMessage(
            sender,
`❌ *Setoran Gagal Dicatat!*
Target ini memerlukan sumber dana rekening/e-wallet yang valid.
Rekening/wallet "${rawAccountInput}" tidak terdaftar di akun Anda.
Daftar rekening terdaftar Anda: ${registeredListStr}.
Format: Nabung ${displayKeyword} ${amount} pakai [nama_rekening]`
          );
          return NextResponse.json({ status: true }, { status: 200 });
        }

        recordedSumberDana = matchedAccount.name;
        sourceAccountId = matchedAccount.id;
      }

      const { data: contributionData, error: contributionError } = await supabaseAdmin.rpc(
        'record_savings_contribution_as_service',
        {
          p_actor_user_id: userId,
          p_goal_id: goal.id,
          p_amount: amount,
          p_source_account_id: sourceAccountId,
          p_recording_method: 'MANUAL_WHATSAPP',
          p_evidence_level: 'USER_CONFIRMED',
          p_operation_key: operationKey,
          p_external_event_id: null,
          p_notes: `Setoran via WhatsApp Bot (Fonnte) - Sumber Dana: ${recordedSumberDana}`,
          p_occurred_at: new Date().toISOString(),
          p_raw_email_body: null,
        },
      );

      if (contributionError) {
        console.error('[Fonnte Webhook] Atomic savings contribution failed:', contributionError.message);
        return NextResponse.json({ status: false, error: 'Savings contribution failed' }, { status: 500 });
      }

      const contribution = getSingleRpcRow<SavingsContributionResult>(contributionData);
      if (!contribution) {
        console.error('[Fonnte Webhook] Atomic savings contribution returned no result');
        return NextResponse.json({ status: false, error: 'Savings contribution result missing' }, { status: 500 });
      }

      // 2. Build updated deposits array & calculate metrics
      const updatedDeposits = [
        ...(goal.savings_logs || []).map((l: any) => ({
          date: l.created_at,
          amount: Number(l.amount || 0),
        })),
        { date: new Date().toISOString(), amount },
      ];

      const newCurrentAmount = Number(contribution.out_current_amount || 0);
      const targetAmount = Number(goal.target_amount || 0);
      const isCompleted = newCurrentAmount >= targetAmount;

      const updatedGoal: SavingsGoalCalc = {
        id: goal.id,
        name: goal.title,
        targetAmount: targetAmount,
        currentAmount: newCurrentAmount,
        dailyTarget: Number(goal.daily_target || 0),
        startDate: goal.start_date || todayWIB,
        targetDate: goal.target_date || undefined,
        totalDelayDays: Number(goal.total_delay_days) || 0,
        mode: goal.mode || 'RELAXED',
        paymentAccount: recordedSumberDana || goal.storage_detail || goal.account_name,
        productUrl: goal.product_url,
        status: isCompleted ? 'completed' : 'active',
        deposits: updatedDeposits,
      };

      const metrics = calculateGoalMetrics(updatedGoal);
      const progressPercent = Math.min(100, Math.round((updatedGoal.currentAmount / Math.max(1, updatedGoal.targetAmount)) * 100));

      // 10-segment block progress bar (Gambar 1 style: 10 blocks = 100%)
      const filledBlocks = Math.min(10, Math.max(0, Math.floor(progressPercent / 10)));
      const emptyBlocks = 10 - filledBlocks;
      const progressBar = "🟧".repeat(filledBlocks) + "⬛".repeat(emptyBlocks);

      console.log(
        `[Fonnte Webhook] Atomic contribution ${contribution.out_replayed ? 'replayed' : 'created'} for goal ${goal.id}`,
      );

      // Send formatted confirmation only after the atomic contribution succeeds.
      // Formatted Date (e.g. 15 Sep 2026)
      const dateIndo = metrics.estimatedDate.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      // Deposit Note if setoran is under or over daily target
      let depositNote = "";
      if (amount < updatedGoal.dailyTarget) {
        const deficitAmount = updatedGoal.dailyTarget - amount;
        const loadFraction = Number((deficitAmount / Math.max(1, updatedGoal.dailyTarget)).toFixed(1));
        depositNote = `\n⚠️ *Catatan Setoran:* Setoran kurang dari target harian (Beban waktu +${loadFraction} hari, Total beban: ${metrics.fractionalDrift} hari)`;
      } else if (amount > updatedGoal.dailyTarget) {
        const surplusAmount = amount - updatedGoal.dailyTarget;
        const surplusFraction = Number((surplusAmount / Math.max(1, updatedGoal.dailyTarget)).toFixed(1));
        depositNote = `\n✨ *Catatan Setoran:* Setoran melebihi target harian (Surplus waktu ${surplusFraction} hari, Total surplus: ${metrics.fractionalDrift} hari)`;
      }

      const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://douit.my.id').trim().replace(/\/$/, '');
      const publicProductUrl = goal.id ? `${baseUrl}/p/${goal.id}` : (goal.product_url || '-');

      let footerText = "_Terus pertahankan konsistensi Anda!_ 💪";
      if (isCompleted || progressPercent >= 100) {
        footerText = `🥳 *Selamat! Target Tabungan Anda Sudah 100% Tercapai!* 🎉\n\nSaatnya mewujudkan impian Anda! Beli produknya langsung di sini:\n🔗 ${publicProductUrl}`;
      }

      const depositConfirmationMessage = `🎉 *Setoran Berhasil Dicatat!*

Target: *${updatedGoal.name}*
Sumber Dana: *${recordedSumberDana || "Tunai"}*
Setoran: *Rp ${amount.toLocaleString("id-ID")}*
Total Terkumpul: *Rp ${updatedGoal.currentAmount.toLocaleString("id-ID")}* / *Rp ${updatedGoal.targetAmount.toLocaleString("id-ID")}*
Progress: ${progressBar} 🎯 *${progressPercent}%*
Streak: 🔥 *${metrics.currentStreak} Hari Aktif*
📅 Estimasi Target: *${dateIndo}* (Sisa ${metrics.remainingDays} hari)
⏳ Status Jadwal: ${metrics.scheduleStatusText}${depositNote}

${footerText}`;

      await sendFonnteMessage(sender, depositConfirmationMessage);
      return NextResponse.json({ status: true }, { status: 200 });
    }


    const lowerMessage = messageText.trim().toLowerCase();

    if (lowerMessage === 'skip' || lowerMessage.startsWith('skip ')) {
      const specificTargetName = lowerMessage.replace(/^skip\s*/i, '').trim();

      // Query user's active savings goals
      const { data: activeGoals, error: activeGoalsErr } = await supabaseAdmin
        .from('savings_goals')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false });

      if (activeGoalsErr) {
        console.error('[Fonnte Webhook] Error fetching active goals:', activeGoalsErr);
      }

      if (!activeGoals || activeGoals.length === 0) {
        await sendFonnteMessage(sender, "Tidak ada target tabungan aktif yang ditemukan di akun Douit AI Anda.");
        return NextResponse.json({ status: true }, { status: 200 });
      }

      let skippedGoals = activeGoals;

      // If user specified a specific goal (e.g. "Skip Salad", "Skip POCO F7")
      if (specificTargetName) {
        const matched = activeGoals.filter((g: any) => {
          const titleLower = (g.title || '').toLowerCase();
          const firstWord = titleLower.split(/\s+/)[0];
          return (
            titleLower.includes(specificTargetName) ||
            specificTargetName.includes(titleLower) ||
            firstWord === specificTargetName ||
            specificTargetName.includes(firstWord)
          );
        });

        if (matched.length === 0) {
          await sendFonnteMessage(
            sender,
            `❌ Target tabungan dengan nama/kata kunci "*${specificTargetName}*" tidak ditemukan di daftar target aktif Anda.`
          );
          return NextResponse.json({ status: true }, { status: 200 });
        }

        skippedGoals = matched;
      }

      // Check if any of these goals have already been skipped today
      const { data: existingNotifications } = await supabaseAdmin
        .from('notifications')
        .select('id, created_at, metadata')
        .eq('user_id', userId)
        .eq('type', 'INFO');

      const alreadySkippedGoalIds = new Set<string>();
      (existingNotifications || []).forEach((n: any) => {
        if (!n.created_at) return;
        const nDateWIB = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(n.created_at));

        if (nDateWIB === todayWIB && n.metadata?.action_type === 'SKIP_SAVINGS') {
          if (n.metadata?.goal_id) alreadySkippedGoalIds.add(n.metadata.goal_id);
          if (Array.isArray(n.metadata?.goal_ids)) {
            n.metadata.goal_ids.forEach((id: string) => alreadySkippedGoalIds.add(id));
          }
        }
      });

      const goalsToProcess = skippedGoals.filter((g: any) => !alreadySkippedGoalIds.has(g.id));

      if (goalsToProcess.length === 0) {
        await sendFonnteMessage(
          sender,
          skippedGoals.length === 1
            ? `⚠️ Anda sudah mengambil konfirmasi *Skip* untuk target *${skippedGoals[0].title}* hari ini.`
            : `⚠️ Anda sudah mengambil konfirmasi *Skip* untuk target-target tabungan hari ini.`
        );
        return NextResponse.json({ status: true }, { status: 200 });
      }

      // Execution: extend target_date by +1 day and increment total_delay_days for each goal being skipped (Mode Santai / RELAXED)
      for (const goal of goalsToProcess) {
        const currentDelays = Number(goal.total_delay_days) || 0;
        const newDelays = currentDelays + 1;

        let newTargetDate = goal.target_date;
        if (goal.target_date && /^\d{4}-\d{2}-\d{2}$/.test(goal.target_date)) {
          const [y, m, d] = goal.target_date.split('-').map(Number);
          const targetDateObj = new Date(y, m - 1, d);
          targetDateObj.setDate(targetDateObj.getDate() + 1);
          newTargetDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(targetDateObj);
        } else {
          // If target_date was null or missing, compute from today + remainingDays + 1
          const dailyTarget = Math.max(1, Number(goal.daily_target) || 1);
          const remainingAmount = Math.max(0, Number(goal.target_amount || 0) - Number(goal.current_amount || 0));
          const remainingDays = Math.ceil(remainingAmount / dailyTarget);
          const targetDateObj = new Date();
          targetDateObj.setDate(targetDateObj.getDate() + remainingDays + 1);
          newTargetDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(targetDateObj);
        }

        await supabaseAdmin
          .from('savings_goals')
          .update({
            target_date: newTargetDate,
            total_delay_days: newDelays,
            updated_at: new Date().toISOString(),
          })
          .eq('id', goal.id);
      }

      // Record skip in notifications table for 1x daily limit deduplication & cron reminder suppression
      await supabaseAdmin.from('notifications').insert({
        user_id: userId,
        title: goalsToProcess.length === 1
          ? `Istirahat Menabung (${goalsToProcess[0].title})`
          : `Istirahat Menabung (${goalsToProcess.length} Target)`,
        message: `Konfirmasi skip menabung hari ini untuk: ${goalsToProcess.map((g: any) => g.title).join(', ')}.`,
        type: 'INFO',
        metadata: {
          action_type: 'SKIP_SAVINGS',
          goal_id: goalsToProcess.length === 1 ? goalsToProcess[0].id : undefined,
          goal_ids: goalsToProcess.map((g: any) => g.id),
          date: todayWIB,
        },
      });

      // Build confirmation response message
      let replyConfirmation = "";
      if (goalsToProcess.length === 1) {
        replyConfirmation = 
`😴 *Istirahat Menabung Dicatat!*

Target: *${goalsToProcess[0].title}*
Status: Istirahat hari ini (Mode Santai: target otomatis disesuaikan)

Keuangan Anda diprioritaskan hari ini. Istirahat sejenak agar arus kas tetap sehat! 💪`;
      } else {
        const listItems = goalsToProcess
          .map((g: any) => `• *${g.title}* (Mode Santai)`)
          .join("\n");

        replyConfirmation = 
`😴 *Istirahat Menabung Dicatat!*

Target yang diistirahatkan hari ini:
${listItems}

Status: Semua target di atas otomatis disesuaikan 1 hari. Keuangan Anda diprioritaskan hari ini! 💪`;
      }

      await sendFonnteMessage(sender, replyConfirmation);
      return NextResponse.json({ status: true }, { status: 200 });
    }

    // Command C: UNKNOWN COMMANDS
    const menuReply = 
`🤖 *Douit AI Assistant*

Perintah yang tersedia:
• Ketik *Nabung [kata_kunci] [nominal]* (Contoh: *Nabung salad 20000 pakai bca*)
• Ketik *Skip* (Untuk istirahat semua target hari ini)
• Ketik *Skip [nama target]* (Untuk istirahat target tertentu)`;

    await sendFonnteMessage(sender, menuReply);
    return NextResponse.json({ status: true }, { status: 200 });
  } catch (error) {
    console.error('[Fonnte Webhook] Error:', error);
    return NextResponse.json({ status: false, error: 'Internal Error' }, { status: 500 });
  }
}
