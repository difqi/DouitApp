import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendFonnteMessageWithFailover } from '@/lib/fonnte';
import { calculateGoalMetrics, SavingsGoal as SavingsGoalCalc } from '@/lib/savings-calc';
import { resolveSystemCategory, SYSTEM_CATEGORY_NAMES } from '@/lib/categories';
import { isSavingsTransactionForExpenseCompatibility } from '@/lib/transaction-semantics';

export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV === 'development';
  const url = new URL(req.url);
  const force = isDev && (url.searchParams.get('force') === 'true' || url.searchParams.get('test') === 'true');

  const authHeader = req.headers.get('authorization');
  if (!isDev && process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const now = new Date();

  // Exact WIB Time (HH:mm)
  const currentWibTime = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta',
  }).format(now); // e.g. "14:49"

  // Today in WIB (YYYY-MM-DD)
  const todayWIB = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  // Query active goals with whatsapp number configured and their savings_logs
  const { data: goals, error } = await supabase
    .from('savings_goals')
    .select('*, savings_logs(id, amount, created_at)')
    .eq('status', 'ACTIVE')
    .not('whatsapp_number', 'is', null);

  if (error || !goals) {
    return NextResponse.json({ error: 'Failed to fetch goals' }, { status: 500 });
  }

  const dispatched = [];

  for (const goal of goals) {
    if (!force) {
      // 1. Skip if user already deposited today
      if (goal.last_deposit_date === todayWIB) {
        continue;
      }

      // 2. Exact HH:mm matching against scheduled reminder times
      const times: string[] = goal.reminder_times || (goal.reminder_time ? [goal.reminder_time.slice(0, 5)] : ['08:00']);
      const matchedSlot = times.find((t) => t.trim().padStart(5, '0') === currentWibTime);

      if (!matchedSlot) {
        continue;
      }

      // 3. Deduplication safeguard & Skip Suppression
      const { data: existingNotifications } = await supabase
        .from('notifications')
        .select('id, created_at, metadata')
        .eq('user_id', goal.user_id)
        .eq('type', 'INFO');

      // Requirement A: Skip Suppression - check if user already confirmed "Skip" for this goal today
      const alreadySkippedToday = existingNotifications?.some((n: any) => {
        if (!n.created_at) return false;
        const nDateWIB = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(n.created_at));

        if (nDateWIB !== todayWIB) return false;
        if (n.metadata?.action_type !== 'SKIP_SAVINGS') return false;

        // Check if skip covers this specific goal or all goals
        if (n.metadata?.goal_id === goal.id) return true;
        if (Array.isArray(n.metadata?.goal_ids) && n.metadata.goal_ids.includes(goal.id)) return true;
        return false;
      });

      if (alreadySkippedToday) {
        // User already confirmed skip for this goal today; suppress subsequent reminders
        continue;
      }

      const alreadySentSlotToday = existingNotifications?.some((n: any) => {
        if (!n.created_at) return false;
        const nDateWIB = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(n.created_at));
        return (
          nDateWIB === todayWIB &&
          n.metadata?.action_type === 'SAVINGS_REMINDER' &&
          n.metadata?.goal_id === goal.id &&
          n.metadata?.slot === currentWibTime
        );
      });

      if (alreadySentSlotToday) {
        continue;
      }
    }

    // 4. Calculate today's non-savings expenses vs safe limit
    const { data: userTxs } = await supabase
      .from('transactions')
      .select('amount, transaction_date, created_at, type, status, merchant, notes, category_id, transaction_kind')
      .eq('user_id', goal.user_id)
      .eq('type', 'EXPENSE')
      .eq('status', 'APPROVED');

    const nabungCategory = await resolveSystemCategory({
      supabase,
      name: SYSTEM_CATEGORY_NAMES.SAVING,
      type: 'EXPENSE',
    });
    const nabungCategoryId = nabungCategory.status === 'matched'
      ? nabungCategory.category.id
      : undefined;

    const todayExpense = (userTxs || [])
      .filter((tx: any) => {
        const rawDate = tx.transaction_date || tx.created_at;
        if (!rawDate) return false;
        const txDateWIB = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(rawDate));
        if (txDateWIB !== todayWIB) return false;

        if (isSavingsTransactionForExpenseCompatibility({
          transaction: tx,
          canonicalSavingCategoryId: nabungCategoryId,
        })) return false;

        return true;
      })
      .reduce((sum: number, tx: any) => sum + (Number(tx.amount) || 0), 0);

    // Fetch user profile daily_expense_limit
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('id, daily_expense_limit')
      .eq('id', goal.user_id)
      .maybeSingle();

    // Calculate total daily commitment for all active goals of this user
    const userActiveGoals = goals.filter((g: any) => g.user_id === goal.user_id);
    const activeGoalsCommitment = userActiveGoals.reduce(
      (sum: number, g: any) => sum + (Number(g.daily_target) || 0),
      0
    );

    const baseBudget =
      Number(userProfile?.daily_expense_limit) ||
      Number(userActiveGoals.find((g: any) => Number(g.max_daily_expense) > 0)?.max_daily_expense) ||
      0;

    const safeDailyLimit = Math.max(0, baseBudget - activeGoalsCommitment);
    const safeRemaining = Math.max(0, safeDailyLimit - todayExpense);

    // Dynamic contextual warning note if expenses exceed safe daily limit (Requirement B)
    let overBudgetNote = "";
    if (safeDailyLimit > 0 && todayExpense > safeDailyLimit) {
      const overAmount = todayExpense - safeDailyLimit;
      overBudgetNote = `\n\n⚠️ *Perhatian Pengeluaran:*
Pengeluaran hari ini telah melampaui batas aman sebesar *Rp ${overAmount.toLocaleString("id-ID")}*. Jika kondisi keuangan sedang padat, Anda disarankan untuk istirahat menabung hari ini.
_Ketik *"Skip"* atau *"Skip ${goal.title}"* jika ingin melewati setoran hari ini._`;
    }

    // 5. Build Goal Object & Calculate Metrics
    const goalAccount = goal.storage_detail || goal.account_name || (goal.storage_type === 'BANK_TRANSFER' ? 'Bank' : goal.storage_type === 'GOPAY_MERCHANT' ? 'QRIS' : 'Tunai');

    const goalForCalc: SavingsGoalCalc = {
      id: goal.id,
      name: goal.title,
      targetAmount: Number(goal.target_amount || 0),
      currentAmount: Number(goal.current_amount || 0),
      dailyTarget: Number(goal.daily_target || 0),
      startDate: goal.start_date || todayWIB,
      targetDate: goal.target_date || undefined,
      totalDelayDays: Number(goal.total_delay_days) || 0,
      mode: goal.mode || 'RELAXED',
      paymentAccount: goalAccount,
      productUrl: goal.product_url,
      status: goal.status === 'COMPLETED' ? 'completed' : 'active',
      deposits: (goal.savings_logs || []).map((l: any) => ({
        date: l.created_at,
        amount: Number(l.amount || 0),
      })),
    };

    const metrics = calculateGoalMetrics(goalForCalc);
    const progressPercent = Math.min(100, Math.round((goalForCalc.currentAmount / Math.max(1, goalForCalc.targetAmount)) * 100));

    // 10-segment block progress bar (Gambar 1 style: 10 blocks = 100%)
    const filledBlocks = Math.min(10, Math.max(0, Math.floor(progressPercent / 10)));
    const emptyBlocks = 10 - filledBlocks;
    const progressBar = "🟧".repeat(filledBlocks) + "⬛".repeat(emptyBlocks);

    // Base App URL & Proxy Link for OpenGraph preview
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://douit.my.id').trim().replace(/\/$/, '');
    const publicProxyUrl = goal.id ? `${baseUrl}/p/${goal.id}` : (goal.product_url || '-');

    // Formatted Date
    const dateIndo = metrics.estimatedDate.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    // Destination Account formatting
    let destinationAccount = "celenganmu";
    if (goal.storage_type === 'TUNAI') {
      destinationAccount = "celenganmu";
    } else if (goal.storage_detail || goal.account_name) {
      destinationAccount = `rekening *${goal.storage_detail || goal.account_name}*`;
    } else if (goal.storage_type === 'BANK_TRANSFER') {
      destinationAccount = "rekening *Bank Transfer*";
    } else if (goal.storage_type === 'GOPAY_MERCHANT') {
      destinationAccount = "rekening *QRIS/GoPay*";
    }

    // Gambar 1 Clean Message Layout with contextual Over-Budget Note
    const reminderMessage = `*Pengingat Menabung Douit AI* 🎯

Target: *${goal.title}*
Terkumpul: *Rp ${goalForCalc.currentAmount.toLocaleString("id-ID")}* / *Rp ${goalForCalc.targetAmount.toLocaleString("id-ID")}*
Progress: ${progressBar} 🎯 *${progressPercent}%*
Streak: 🔥 *${metrics.currentStreak} Hari Aktif*
📅 Estimasi Target: *${dateIndo}* (Sisa ${metrics.remainingDays} hari)
⏳ Status Jadwal: ${metrics.scheduleStatusText}
📊 Status Dompet: Pengeluaran hari ini Rp ${todayExpense.toLocaleString("id-ID")} / Rp ${safeDailyLimit.toLocaleString("id-ID")} (Sisa aman: Rp ${safeRemaining.toLocaleString("id-ID")})${overBudgetNote}

Yuk sisihkan *Rp ${goalForCalc.dailyTarget.toLocaleString("id-ID")}* hari ini ke ${destinationAccount}!

_Ketik "Nabung ${goal.title.toLowerCase()} [nominal]" untuk mencatat setoran manual._

🔗 *Link Produk:*
${publicProxyUrl}`;

    const res = await sendFonnteMessageWithFailover({
      target: goal.whatsapp_number,
      message: reminderMessage,
      imageUrl: goal.image_url,
    });

    // Record deduplication notification log
    await supabase.from('notifications').insert({
      user_id: goal.user_id,
      title: `Pengingat Menabung: ${goal.title}`,
      message: `Setoran harian Rp ${goalForCalc.dailyTarget.toLocaleString("id-ID")} untuk target ${goal.title}.`,
      type: 'INFO',
      metadata: {
        action_type: 'SAVINGS_REMINDER',
        goal_id: goal.id,
        slot: currentWibTime,
        date: todayWIB,
      },
    });

    dispatched.push({ goalId: goal.id, success: res.success, slot: currentWibTime });
  }

  return NextResponse.json({ success: true, count: dispatched.length, dispatched, timeWIB: currentWibTime });
}
