import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildSavingsMissedDayRpcArgs,
  getWibCalendarDate,
  SAVINGS_MISSED_DAY_SOURCES,
} from './savings-missed-day.ts';

const migration = await readFile(
  new URL('../supabase_migration_phase4_4_2_savings_missed_day.sql', import.meta.url),
  'utf8',
);
const contributionMigration = await readFile(
  new URL('../supabase_migration_phase4_3_2_savings_linkage.sql', import.meta.url),
  'utf8',
);
const verification = await readFile(
  new URL('../supabase_verify_phase4_4_2_savings_missed_day.sql', import.meta.url),
  'utf8',
);
const fonnteRoute = await readFile(
  new URL('../app/api/fonnte/webhook/route.ts', import.meta.url),
  'utf8',
);
const reconciliationRoute = await readFile(
  new URL('../app/api/cron/savings-reconciliation/route.ts', import.meta.url),
  'utf8',
);

const functionStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.resolve_savings_missed_day',
);
const functionEnd = migration.indexOf(
  'ALTER FUNCTION public.resolve_savings_missed_day',
  functionStart,
);
const missedDayFunction = migration.slice(functionStart, functionEnd);
const contributionFunctionStart = contributionMigration.indexOf(
  'CREATE OR REPLACE FUNCTION public.record_savings_contribution_internal',
);
const contributionFunctionEnd = contributionMigration.indexOf(
  'ALTER FUNCTION public.record_savings_contribution_internal',
  contributionFunctionStart,
);
const contributionFunction = contributionMigration.slice(
  contributionFunctionStart,
  contributionFunctionEnd,
);
const relaxedStart = missedDayFunction.indexOf(
  "IF goal_row.mode::text = 'RELAXED' THEN",
);
const disciplinedStart = missedDayFunction.indexOf(
  '\n  ELSE',
  relaxedStart,
);
const relaxedMutation = missedDayFunction.slice(
  relaxedStart,
  disciplinedStart,
);
const disciplinedMutation = missedDayFunction.slice(
  disciplinedStart,
  missedDayFunction.indexOf('\n  END IF;', disciplinedStart),
);
const skipStart = fonnteRoute.indexOf(
  "if (lowerMessage === 'skip' || lowerMessage.startsWith('skip '))",
);
const skipEnd = fonnteRoute.indexOf(
  '// Command C: UNKNOWN COMMANDS',
  skipStart,
);
const skipFlow = fonnteRoute.slice(skipStart, skipEnd);

test('WIB date and RPC argument contract use only evidence inputs', () => {
  assert.equal(
    getWibCalendarDate(new Date('2026-09-03T17:01:00.000Z')),
    '2026-09-04',
  );
  assert.deepEqual(SAVINGS_MISSED_DAY_SOURCES, [
    'USER_SKIP',
    'AUTO_RECONCILIATION',
  ]);
  assert.deepEqual(buildSavingsMissedDayRpcArgs({
    actorUserId: 'actor',
    goalId: 'goal',
    effectiveDate: '2026-09-04',
    resolutionSource: 'USER_SKIP',
  }), {
    p_actor_user_id: 'actor',
    p_goal_id: 'goal',
    p_effective_date: '2026-09-04',
    p_resolution_source: 'USER_SKIP',
  });
});

test('RELAXED first resolution extends once and records one durable operation', () => {
  assert.match(relaxedMutation, /target_date\s*=\s*goal_value\.target_date \+ 1/);
  assert.match(
    relaxedMutation,
    /total_delay_days\s*=\s*coalesce\(goal_value\.total_delay_days, 0\) \+ 1/,
  );
  assert.match(relaxedMutation, /streak_count\s*=\s*0/);
  assert.doesNotMatch(relaxedMutation, /accumulated_time_debt\s*=/);
  assert.ok(
    missedDayFunction.indexOf('INSERT INTO public.savings_missed_day_resolutions')
      > missedDayFunction.indexOf('UPDATE public.savings_goals'),
  );
});

test('RELAXED retry returns replay before any second schedule mutation', () => {
  const replayIndex = missedDayFunction.indexOf("'ALREADY_RESOLVED'::text");
  const mutationIndex = missedDayFunction.indexOf('UPDATE public.savings_goals');
  assert.ok(replayIndex >= 0);
  assert.ok(replayIndex < mutationIndex);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*?\(goal_id, effective_date\)/,
  );
});

test('DISCIPLINED missed day keeps target_date fixed', () => {
  const disciplinedSet = disciplinedMutation.slice(
    0,
    disciplinedMutation.indexOf('RETURNING'),
  );
  assert.doesNotMatch(disciplinedSet, /target_date\s*=/);
  assert.match(disciplinedSet, /streak_count\s*=\s*0/);
  assert.match(
    disciplinedSet,
    /accumulated_time_debt\s*=[\s\S]*?\+ 1/,
  );
});

test('DISCIPLINED daily target uses remaining amount and remaining dates', () => {
  assert.match(
    disciplinedMutation,
    /daily_target\s*=\s*pg_catalog\.ceil\([\s\S]*?target_amount - coalesce\(goal_value\.current_amount, 0\)[\s\S]*?target_date - p_effective_date[\s\S]*?,\s*1\s*\)/,
  );
});

test('USER_SKIP first makes reconciliation a replay/no-op', () => {
  assert.match(skipFlow, /resolve_savings_missed_day/);
  assert.match(skipFlow, /resolutionSource: 'USER_SKIP'/);
  assert.match(reconciliationRoute, /resolve_savings_missed_day/);
  assert.match(
    reconciliationRoute,
    /resolutionSource: 'AUTO_RECONCILIATION'/,
  );
  assert.match(
    migration,
    /ON public\.savings_missed_day_resolutions \(goal_id, effective_date\)/,
  );
  assert.match(
    missedDayFunction,
    /'ALREADY_RESOLVED'[\s\S]*?existing_resolution\.resolution_source/,
  );
  assert.ok(
    missedDayFunction.indexOf("'ALREADY_RESOLVED'::text")
      < missedDayFunction.indexOf('UPDATE public.savings_goals'),
  );
});

test('reconciliation then USER_SKIP is a successful replay/no-op', () => {
  assert.match(
    missedDayFunction,
    /'ALREADY_RESOLVED'[\s\S]*?existing_resolution\.resolution_source/,
  );
  assert.match(skipFlow, /out_outcome === 'ALREADY_RESOLVED'/);
  assert.match(skipFlow, /tidak ada perubahan kedua/);
});

test('contribution and missed-day ordering serialize on the same goal row', () => {
  const missedDayLock = missedDayFunction.indexOf('FOR UPDATE;');
  const missedDayLedgerRead = missedDayFunction.indexOf(
    'FROM public.savings_missed_day_resolutions',
  );
  const contributionLock = contributionFunction.indexOf('FOR UPDATE;');
  const contributionReplayRead = contributionFunction.indexOf(
    'WHERE transaction_value.idempotency_key = p_operation_key;',
  );
  assert.match(missedDayFunction, /WHERE goal_value\.id = p_goal_id[\s\S]*?goal_value\.user_id = p_actor_user_id[\s\S]*?FOR UPDATE/);
  assert.match(contributionFunction, /WHERE id = p_goal_id[\s\S]*?user_id = p_actor_user_id[\s\S]*?FOR UPDATE/);
  assert.ok(missedDayLock >= 0 && missedDayLock < missedDayLedgerRead);
  assert.ok(contributionLock >= 0 && contributionLock < contributionReplayRead);
  assert.match(
    migration,
    /savings_missed_day_resolutions_goal_date_unique/,
  );
  assert.doesNotMatch(
    reconciliationRoute,
    /\.from\('savings_goals'\)[\s\S]*?\.update\(/,
  );
});

test('non-ACTIVE race returns NOT_ACTIVE and CAS prevents mutation', () => {
  assert.match(
    missedDayFunction,
    /goal_row\.status::text <> 'ACTIVE'[\s\S]*?'NOT_ACTIVE'/,
  );
  assert.match(
    missedDayFunction,
    /UPDATE public\.savings_goals[\s\S]*?goal_value\.status::text = 'ACTIVE'/,
  );
  assert.match(
    missedDayFunction,
    /IF NOT FOUND THEN[\s\S]*?'NOT_ACTIVE'::text/,
  );
});

test('deposit first returns VALID_DEPOSIT without ledger or missed-day mutation', () => {
  const resolutionIndex = missedDayFunction.indexOf(
    'FROM public.savings_missed_day_resolutions',
  );
  const depositLookupIndex = missedDayFunction.indexOf(
    'FROM public.savings_logs log_row',
  );
  const depositIndex = missedDayFunction.indexOf("'VALID_DEPOSIT'::text");
  const inactiveIndex = missedDayFunction.indexOf(
    "goal_row.status::text <> 'ACTIVE'",
  );
  const mutationIndex = missedDayFunction.indexOf('UPDATE public.savings_goals');
  const ledgerInsertIndex = missedDayFunction.indexOf(
    'INSERT INTO public.savings_missed_day_resolutions',
  );
  assert.ok(resolutionIndex >= 0 && resolutionIndex < depositLookupIndex);
  assert.ok(depositLookupIndex < depositIndex);
  assert.ok(depositIndex < inactiveIndex);
  assert.ok(depositIndex < mutationIndex);
  assert.ok(depositIndex < ledgerInsertIndex);
  assert.match(
    missedDayFunction,
    /FROM public\.savings_logs log_row[\s\S]*?AT TIME ZONE 'Asia\/Jakarta'/,
  );
  assert.match(
    missedDayFunction,
    /'VALID_DEPOSIT'::text,\s*NULL::uuid/,
  );
});

test('missed-day first remains final while a later contribution is allowed', () => {
  const ledgerReadIndex = missedDayFunction.indexOf(
    'FROM public.savings_missed_day_resolutions',
  );
  const depositReadIndex = missedDayFunction.indexOf(
    'FROM public.savings_logs log_row',
  );
  assert.ok(ledgerReadIndex >= 0 && ledgerReadIndex < depositReadIndex);
  assert.match(
    missedDayFunction,
    /INSERT INTO public\.savings_missed_day_resolutions[\s\S]*?'APPLIED'::text/,
  );
  assert.doesNotMatch(relaxedMutation, /\bstatus\s*=/);
  assert.doesNotMatch(disciplinedMutation, /\bstatus\s*=/);
  assert.match(contributionFunction, /INSERT INTO public\.savings_logs/);
  assert.match(
    contributionFunction,
    /current_amount = coalesce\(current_amount, 0\) \+ p_amount/,
  );
  assert.doesNotMatch(
    contributionFunction,
    /savings_missed_day_resolutions/,
  );
});

test('contribution retry remains idempotent after either serialized ordering', () => {
  const replayReadIndex = contributionFunction.indexOf(
    'WHERE transaction_value.idempotency_key = p_operation_key;',
  );
  const activeGuardIndex = contributionFunction.indexOf(
    "goal_row.status::text <> 'ACTIVE'",
  );
  const contributionInsertIndex = contributionFunction.indexOf(
    'INSERT INTO public.transactions',
  );
  assert.ok(replayReadIndex >= 0 && replayReadIndex < activeGuardIndex);
  assert.ok(replayReadIndex < contributionInsertIndex);
  assert.match(
    contributionFunction,
    /RETURN QUERY SELECT[\s\S]*?TRUE;[\s\S]*?RETURN;/,
  );
});

test('deposit-day check deliberately uses the WIB date of savings_logs.created_at', () => {
  assert.match(
    missedDayFunction,
    /log_row\.created_at AT TIME ZONE 'Asia\/Jakarta'[\s\S]*?p_effective_date/,
  );
  assert.match(
    contributionFunction,
    /created_at[\s\S]*?coalesce\(p_occurred_at, pg_catalog\.now\(\)\)/,
  );
});

test('duplicate webhook does not use notifications as lifecycle authority', () => {
  const rpcIndex = skipFlow.indexOf("'resolve_savings_missed_day'");
  const notificationIndex = skipFlow.indexOf(".from('notifications')");
  assert.ok(rpcIndex >= 0);
  assert.ok(notificationIndex > rpcIndex);
  assert.doesNotMatch(skipFlow, /existingNotifications|alreadySkippedGoalIds/);
  assert.doesNotMatch(
    skipFlow,
    /\.from\('savings_goals'\)[\s\S]*?\.update\(/,
  );
  assert.match(skipFlow, /out_outcome === 'APPLIED'/);
});

test('RPC returns complete outcomes and rejects invalid source/date inputs', () => {
  for (const outcome of [
    'APPLIED',
    'ALREADY_RESOLVED',
    'NOT_ACTIVE',
    'VALID_DEPOSIT',
    'INVALID',
  ]) {
    assert.match(missedDayFunction, new RegExp("'" + outcome + "'"));
  }
  assert.match(
    missedDayFunction,
    /p_resolution_source NOT IN \('USER_SKIP', 'AUTO_RECONCILIATION'\)/,
  );
  assert.match(
    missedDayFunction,
    /p_effective_date > current_wib_date/,
  );
});

test('ledger and canonical RPC are private except service-role execution', () => {
  assert.match(
    migration,
    /ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.savings_missed_day_resolutions[\s\S]*?service_role/,
  );
  assert.match(
    migration,
    /SECURITY DEFINER\s+SET search_path = ''/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.resolve_savings_missed_day[\s\S]*?TO service_role/,
  );
  assert.match(verification, /duplicate_goal_date_group_count/);
  assert.match(verification, /orphan_resolution_count/);
});
