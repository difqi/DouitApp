import { sendFonnteMessageWithFailover } from "@/lib/fonnte";
import { resolveSystemCategory, SYSTEM_CATEGORY_NAMES } from "@/lib/categories";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSavingsTransactionForExpenseCompatibility } from "@/lib/transaction-semantics";

function getSupabaseClient(providedClient?: any) {
  if (providedClient) return providedClient;
  return createAdminClient();
}

/**
 * Checks today's approved non-savings expenses against active savings goals' safe limits.
 * Automatically dispatches:
 * 1. 75% Warning Alert (when expenses hit >= 75% and < 100% of safe limit)
 * 2. 100% Over-Budget Alert (when expenses exceed 100% of safe limit, unlocking "Skip")
 *
 * Consolidates all active goals into a SINGLE WhatsApp message to avoid multi-target spam.
 * Strictly enforces 1x daily deduplication per user via the notifications table.
 */
export async function checkAndSendOverBudgetAlert(userId: string, customSupabase?: any) {
  try {
    if (!userId) return;
    const supabase = getSupabaseClient(customSupabase);

    // Current date string in WIB (Asia/Jakarta)
    const todayWIB = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    // 1. Fetch system 'Nabung' category to exclude savings deposits
    const nabungCategory = await resolveSystemCategory({
      supabase,
      name: SYSTEM_CATEGORY_NAMES.SAVING,
      type: "EXPENSE",
    });
    const nabungCategoryId = nabungCategory.status === "matched"
      ? nabungCategory.category.id
      : undefined;

    // 2. Fetch total expenses recorded today for user
    const { data: todayTxs, error: txErr } = await supabase
      .from('transactions')
      .select('amount, transaction_date, created_at, status, type, category_id, transaction_kind, merchant, notes')
      .eq('user_id', userId)
      .eq('type', 'EXPENSE')
      .eq('status', 'APPROVED');

    if (txErr || !todayTxs) return;

    // Filter transactions created/occurring today in WIB and strictly exclude savings
    const todayTotalExpenses = todayTxs
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

    if (todayTotalExpenses <= 0) return;

    // 3. Fetch active savings goals
    const { data: activeGoals, error: goalErr } = await supabase
      .from('savings_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'ACTIVE');

    if (goalErr || !activeGoals || activeGoals.length === 0) return;

    // Fetch user profile to get global daily_expense_limit and verified WhatsApp number
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, daily_expense_limit, whatsapp_number, is_whatsapp_verified')
      .eq('id', userId)
      .maybeSingle();

    // Determine target recipient phone number (Profile verified phone first, fallback to goal phone)
    const targetPhone =
      (profile?.whatsapp_number && profile.whatsapp_number.trim()) ||
      activeGoals.find((g: any) => g.whatsapp_number && g.whatsapp_number.trim())?.whatsapp_number;

    if (!targetPhone) {
      console.warn(`[Savings Alert] No phone number available for user ${userId}`);
      return;
    }

    // Calculate total daily commitment across all active savings goals
    const activeGoalsCommitment = activeGoals.reduce(
      (sum: number, g: any) => sum + (Number(g.daily_target) || 0),
      0
    );

    // Derive base daily budget (profile level first, fallback to goal max_daily_expense)
    const baseBudget =
      Number(profile?.daily_expense_limit) ||
      Number(activeGoals.find((g: any) => Number(g.max_daily_expense) > 0)?.max_daily_expense) ||
      0;

    const netSafeDailyLimit = Math.max(0, baseBudget - activeGoalsCommitment);
    if (netSafeDailyLimit <= 0) return;

    // Fetch existing warning notifications today for deduplication
    const { data: existingAlerts } = await supabase
      .from('notifications')
      .select('id, created_at, metadata')
      .eq('user_id', userId)
      .eq('type', 'WARNING');

    const expensePercentage = (todayTotalExpenses / netSafeDailyLimit) * 100;
    const formatNum = (val: number) => new Intl.NumberFormat('id-ID').format(val);
    const formattedTotalExpenses = formatNum(todayTotalExpenses);
    const formattedSafeLimit = formatNum(netSafeDailyLimit);

    // --- 100% OVER-BUDGET ALERT (CONSOLIDATED) ---
    if (expensePercentage >= 100) {
      const alreadySent100 = existingAlerts?.some((n: any) => {
        if (!n.created_at) return false;
        const nDateWIB = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(n.created_at));
        return nDateWIB === todayWIB && n.metadata?.action_type === 'OVER_BUDGET_ALERT';
      });

      if (alreadySent100) return;

      const overAmount = todayTotalExpenses - netSafeDailyLimit;
      const formattedOver = formatNum(overAmount);
      const totalDailySaving = activeGoals.reduce(
        (sum: number, g: any) => sum + (Number(g.daily_target) || 0),
        0
      );

      let targetListText = "";
      if (activeGoals.length === 1) {
        const goal = activeGoals[0];
        const dailyTarget = Number(goal.daily_target) || 0;
        targetListText = `Sebaiknya skip setoran *Rp ${formatNum(dailyTarget)}* untuk target *"${goal.title}"* hari ini agar keuangan Anda tetap aman.`;
      } else {
        const goalItems = activeGoals
          .map((g: any) => {
            const daily = Number(g.daily_target) || 0;
            const acc = g.storage_detail || g.storage_type;
            return `• *${g.title}*: Rp ${formatNum(daily)}${acc ? ` (ke ${acc})` : ''}`;
          })
          .join("\n");

        targetListText = `Sebaiknya skip setoran tabungan (total *Rp ${formatNum(totalDailySaving)}*) hari ini agar keuangan Anda tetap aman:\n${goalItems}`;
      }

      const alertMessage = 
`🚨 *Douit Alert: Pengeluaran Melebihi Batas Aman!*

Pengeluaran Anda hari ini sudah mencapai *Rp ${formattedTotalExpenses}* (melebihi batas aman harian *Rp ${formattedSafeLimit}* sebesar *+Rp ${formattedOver}*).

*Saran Douit:*
${targetListText}

Target akan otomatis diperpanjang 1 hari (Mode Santai) jika tidak ada setoran yang masuk hari ini.

Ketik *"Skip"* untuk konfirmasi istirahat semua target hari ini, atau ketik *"Skip [nama target]"* jika hanya ingin melewati target tertentu.`;

      await sendFonnteMessageWithFailover({
        target: targetPhone,
        message: alertMessage,
      });

      await supabase.from('notifications').insert({
        user_id: userId,
        title: activeGoals.length === 1 
          ? `Peringatan Over-Budget (${activeGoals[0].title})` 
          : `Peringatan Over-Budget (${activeGoals.length} Target Tabungan)`,
        message: `Pengeluaran Anda hari ini sudah mencapai Rp ${formattedTotalExpenses} (melebihi batas aman harian Rp ${formattedSafeLimit} sebesar +Rp ${formattedOver}).`,
        type: 'WARNING',
        metadata: {
          action_type: 'OVER_BUDGET_ALERT',
          goal_ids: activeGoals.map((g: any) => g.id),
          date: todayWIB,
          total_expenses: todayTotalExpenses,
          safe_limit: netSafeDailyLimit,
          over_amount: overAmount,
        },
      });

      console.log(`🚨 Consolidated over-budget WhatsApp alert sent to ${targetPhone} for user ${userId}`);
    }
    // --- 75% BUDGET WARNING ALERT (CONSOLIDATED) ---
    else if (expensePercentage >= 75) {
      const alreadySent75 = existingAlerts?.some((n: any) => {
        if (!n.created_at) return false;
        const nDateWIB = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(n.created_at));
        return (
          nDateWIB === todayWIB &&
          (n.metadata?.action_type === 'BUDGET_WARNING_75' || n.metadata?.action_type === 'OVER_BUDGET_ALERT')
        );
      });

      if (alreadySent75) return;

      const remainingSafe = netSafeDailyLimit - todayTotalExpenses;
      const formattedRemaining = formatNum(remainingSafe);
      const totalDailySaving = activeGoals.reduce(
        (sum: number, g: any) => sum + (Number(g.daily_target) || 0),
        0
      );

      let targetInfoText = "";
      if (activeGoals.length === 1) {
        const goal = activeGoals[0];
        const dailyTarget = Number(goal.daily_target) || 0;
        targetInfoText = `*Target Tabungan:* "${goal.title}" (Setoran harian: Rp ${formatNum(dailyTarget)})`;
      } else {
        const goalItems = activeGoals
          .map((g: any) => `• *${g.title}*: Rp ${formatNum(Number(g.daily_target) || 0)}`)
          .join("\n");
        targetInfoText = `*Target Tabungan Aktif (Total harian: Rp ${formatNum(totalDailySaving)}):*\n${goalItems}`;
      }

      const waMessage = 
`⚠️ *Douit Alert: Pengeluaran Mencapai 75% Batas Aman!*

Pengeluaran Anda hari ini sudah mencapai *Rp ${formattedTotalExpenses}* (${Math.round(expensePercentage)}% dari batas aman harian *Rp ${formattedSafeLimit}*).
Sisa batas aman hari ini: *Rp ${formattedRemaining}*.

${targetInfoText}

_Tetap pantau pengeluaran Anda agar target tabungan tetap tercapai sesuai rencana!_ 💪`;

      await sendFonnteMessageWithFailover({
        target: targetPhone,
        message: waMessage,
      });

      await supabase.from('notifications').insert({
        user_id: userId,
        title: activeGoals.length === 1
          ? `Peringatan 75% Batas Harian (${activeGoals[0].title})`
          : `Peringatan 75% Batas Harian (${activeGoals.length} Target)`,
        message: `Pengeluaran Anda hari ini sudah mencapai Rp ${formattedTotalExpenses} (75% dari batas aman harian Rp ${formattedSafeLimit}). Sisa: Rp ${formattedRemaining}.`,
        type: 'WARNING',
        metadata: {
          action_type: 'BUDGET_WARNING_75',
          goal_ids: activeGoals.map((g: any) => g.id),
          date: todayWIB,
          total_expenses: todayTotalExpenses,
          safe_limit: netSafeDailyLimit,
          remaining_safe: remainingSafe,
        },
      });

      console.log(`⚠️ Consolidated 75% Budget Warning WhatsApp alert sent to ${targetPhone} for user ${userId}`);
    }
  } catch (err) {
    console.error("[Savings Alert] Error checking expense limits:", err);
  }
}

export const checkAndSendBudgetAlert = checkAndSendOverBudgetAlert;
export const checkAndSendBudgetAlerts = checkAndSendOverBudgetAlert;
export const checkAndSendExpenseBudgetAlerts = checkAndSendOverBudgetAlert;
