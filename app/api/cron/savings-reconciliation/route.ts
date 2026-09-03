import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV === 'development';
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!isDev && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Today in WIB (Asia/Jakarta)
  const now = new Date();
  const todayWIB = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  // Query all active goals
  const { data: goals, error } = await supabase
    .from('savings_goals')
    .select('*')
    .eq('status', 'ACTIVE');

  if (error || !goals) {
    console.error('[Reconciliation Cron] Failed to fetch goals:', error);
    return NextResponse.json({ error: 'Failed to fetch goals' }, { status: 500 });
  }

  const reconciliationResults = [];

  for (const goal of goals) {
    // Fetch logs recorded today for this goal
    const { data: logs } = await supabase
      .from('savings_logs')
      .select('*')
      .eq('goal_id', goal.id);

    const logsToday = (logs || []).filter((log: any) => {
      if (!log.created_at) return false;
      const logDateWIB = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(log.created_at));
      return logDateWIB === todayWIB;
    });

    // USER_CONFIRMED contributions are valid financial actions. Email evidence
    // may upgrade evidence later, but its absence never reverses saved money.
    const isValidDepositToday = logsToday.length > 0;

    if (isValidDepositToday) {
      reconciliationResults.push({
        goalId: goal.id,
        title: goal.title,
        status: 'VALID_DEPOSIT',
        message: 'Deposit verified for today',
      });
      continue;
    }

    // Handle Missed Day Actions
    let updatePayload: Record<string, any> = {
      streak_count: 0,
      updated_at: new Date().toISOString(),
    };

    if (goal.mode === 'RELAXED') {
      // Extend target_date by +1 day
      const tDate = new Date(goal.target_date || todayWIB);
      tDate.setDate(tDate.getDate() + 1);
      const extendedTargetDate = tDate.toISOString().split('T')[0];

      updatePayload.target_date = extendedTargetDate;

      reconciliationResults.push({
        goalId: goal.id,
        title: goal.title,
        status: 'MISSED_EXTENDED',
        newTargetDate: extendedTargetDate,
      });
    } else if (goal.mode === 'DISCIPLINED') {
      // Keep target_date fixed, recalculate daily_target
      const todayDateObj = new Date(todayWIB);
      const targetDateObj = new Date(goal.target_date || todayWIB);
      const diffMs = targetDateObj.getTime() - todayDateObj.getTime();
      const remainingDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

      const remainingAmount = Math.max(0, Number(goal.target_amount || 0) - Number(goal.current_amount || 0));
      const newDailyTarget = Math.ceil(remainingAmount / remainingDays);

      updatePayload.daily_target = newDailyTarget;

      reconciliationResults.push({
        goalId: goal.id,
        title: goal.title,
        status: 'MISSED_RECALCULATED',
        newDailyTarget,
        remainingDays,
      });
    }

    await supabase
      .from('savings_goals')
      .update(updatePayload)
      .eq('id', goal.id);
  }

  return NextResponse.json({
    success: true,
    processedCount: reconciliationResults.length,
    results: reconciliationResults,
  });
}
