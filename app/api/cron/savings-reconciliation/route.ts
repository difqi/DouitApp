import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSingleRpcRow } from '@/lib/savings-contributions';
import {
  buildSavingsMissedDayRpcArgs,
  getWibCalendarDate,
  type SavingsMissedDayResult,
} from '@/lib/savings-missed-day';

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

  const todayWIB = getWibCalendarDate();

  // This prefilter is only an optimization. The RPC repeats the ACTIVE check
  // with a row lock and compare-and-set at the mutation boundary.
  const { data: goals, error } = await supabase
    .from('savings_goals')
    .select('id, user_id, title')
    .eq('status', 'ACTIVE');

  if (error || !goals) {
    console.error('[Reconciliation Cron] Failed to fetch goals:', error);
    return NextResponse.json({ error: 'Failed to fetch goals' }, { status: 500 });
  }

  const reconciliationResults: Array<Record<string, unknown>> = [];
  let failureCount = 0;

  for (const goal of goals) {
    // USER_CONFIRMED contributions remain valid financial actions. Email evidence
    // may upgrade evidence later, but its absence never reverses saved money.
    // The RPC checks canonical/historical savings_logs for the effective WIB date.
    const { data: resolutionData, error: resolutionError } = await supabase.rpc(
      'resolve_savings_missed_day',
      buildSavingsMissedDayRpcArgs({
        actorUserId: goal.user_id,
        goalId: goal.id,
        effectiveDate: todayWIB,
        resolutionSource: 'AUTO_RECONCILIATION',
      }),
    );

    if (resolutionError) {
      failureCount += 1;
      console.error(
        `[Reconciliation Cron] Missed-day RPC failed for goal ${goal.id}:`,
        resolutionError.message,
      );
      reconciliationResults.push({
        goalId: goal.id,
        title: goal.title,
        status: 'FAILED',
        message: 'Missed-day resolution failed',
      });
      continue;
    }

    const resolution = getSingleRpcRow<SavingsMissedDayResult>(resolutionData);
    if (!resolution) {
      failureCount += 1;
      console.error(
        `[Reconciliation Cron] Missed-day RPC returned no row for goal ${goal.id}`,
      );
      reconciliationResults.push({
        goalId: goal.id,
        title: goal.title,
        status: 'FAILED',
        message: 'Missed-day resolution result missing',
      });
      continue;
    }

    if (resolution.out_outcome === 'INVALID') {
      failureCount += 1;
      console.error(
        `[Reconciliation Cron] Invalid missed-day state for goal ${goal.id}`,
      );
    }

    reconciliationResults.push({
      goalId: goal.id,
      title: goal.title,
      status: resolution.out_outcome,
      mode: resolution.out_mode,
      effectiveDate: resolution.out_effective_date,
      resolvedSource: resolution.out_resolved_source,
      targetDate: resolution.out_target_date,
      dailyTarget: resolution.out_daily_target,
    });
  }

  return NextResponse.json({
    success: failureCount === 0,
    processedCount: reconciliationResults.length,
    failureCount,
    results: reconciliationResults,
  }, { status: failureCount === 0 ? 200 : 500 });
}
