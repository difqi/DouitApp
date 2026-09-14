import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveSavingsGoalRemovalAction } from './savings-goal-state.ts';

const migration = await readFile(
  new URL('../supabase_migration_phase4_4_3_savings_goal_state_integrity.sql', import.meta.url), 'utf8',
);
const verification = await readFile(
  new URL('../supabase_verify_phase4_4_3_savings_goal_state_integrity.sql', import.meta.url), 'utf8',
);
const savingsPage = await readFile(
  new URL('../app/(dashboard)/nabung/page.tsx', import.meta.url), 'utf8',
);
const contributionMigration = await readFile(
  new URL('../supabase_migration_phase4_3_2_savings_linkage.sql', import.meta.url), 'utf8',
);
const missedDayMigration = await readFile(
  new URL('../supabase_migration_phase4_4_2_savings_missed_day.sql', import.meta.url), 'utf8',
);

const triggerStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.enforce_savings_goal_state_integrity',
);
const triggerEnd = migration.indexOf(
  'ALTER FUNCTION public.enforce_savings_goal_state_integrity', triggerStart,
);
const triggerFunction = migration.slice(triggerStart, triggerEnd);
const lifecycleStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.set_savings_goal_status',
);
const lifecycleEnd = migration.indexOf(
  'ALTER FUNCTION public.set_savings_goal_status', lifecycleStart,
);
const lifecycleFunction = migration.slice(lifecycleStart, lifecycleEnd);
const historyStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.get_savings_goal_history_state',
);
const historyEnd = migration.indexOf(
  'ALTER FUNCTION public.get_savings_goal_history_state', historyStart,
);
const historyFunction = migration.slice(historyStart, historyEnd);
const deleteFunctionStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.delete_empty_savings_goal',
);
const deleteFunctionEnd = migration.indexOf(
  'ALTER FUNCTION public.delete_empty_savings_goal', deleteFunctionStart,
);
const deleteFunction = migration.slice(deleteFunctionStart, deleteFunctionEnd);

test('status vocabulary is finite, preflighted, non-null, and not normalized', () => {
  assert.match(migration, /status::text NOT IN \(\s*'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'\s*\)/);
  assert.match(migration, /found null or unexpected savings goal statuses/);
  assert.match(migration, /ADD CONSTRAINT savings_goals_status_vocabulary_check[\s\S]*?CHECK \([\s\S]*?'ACTIVE'[\s\S]*?'PAUSED'[\s\S]*?'COMPLETED'[\s\S]*?'ARCHIVED'/);
  assert.match(migration, /ALTER COLUMN status SET NOT NULL/);
  assert.doesNotMatch(migration, /UPDATE\s+public\.savings_goals\s+SET\s+status\s*=\s*(?:upper|coalesce|case)/i);
});

test('existing status constraints are inspected instead of replaced', () => {
  assert.match(migration, /pg_get_constraintdef/);
  assert.match(migration, /constraint_row\.convalidated/);
  assert.match(migration, /literal_count = 4/);
  assert.match(migration, /allowed_literal_count = 4/);
  assert.match(migration, /found an unverified status constraint/);
  assert.doesNotMatch(migration, /DROP CONSTRAINT.*status/is);
});

test('new goals start with canonical zero progress and ACTIVE status', () => {
  for (const initialGuard of [
    'NEW.status::text <> \'ACTIVE\'',
    'NEW.current_amount IS DISTINCT FROM 0::numeric',
    'NEW.streak_count IS DISTINCT FROM 0',
    'NEW.last_deposit_date IS NOT NULL',
    'NEW.total_delay_days IS DISTINCT FROM 0',
    'NEW.accumulated_time_debt IS DISTINCT FROM 0::numeric',
  ]) assert.ok(triggerFunction.includes(initialGuard), initialGuard);
  assert.match(savingsPage, /\.from\('savings_goals'\)[\s\S]*?\.insert\(newGoalPayload\)/);
  assert.match(savingsPage, /current_amount:\s*0[\s\S]*?accumulated_time_debt:\s*0\.0[\s\S]*?total_delay_days:\s*0[\s\S]*?streak_count:\s*0[\s\S]*?status:\s*'ACTIVE'/);
  assert.match(savingsPage, /const newGoalPayload = \{[\s\S]*?whatsapp_number:[\s\S]*?mode,[\s\S]*?status:\s*'ACTIVE'/);
  assert.match(savingsPage, /setMode\('RELAXED'\)/);
  assert.match(savingsPage, /setMode\('DISCIPLINED'\)/);
});

test('direct updates are column-scoped and derived fields are protected', () => {
  assert.match(migration, /REVOKE UPDATE ON TABLE public\.savings_goals FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /clear_column_update_grants/);
  const grantStart = migration.indexOf('GRANT UPDATE (');
  const grantEnd = migration.indexOf(
    ') ON TABLE public.savings_goals TO authenticated;', grantStart,
  );
  const editableGrant = migration.slice(grantStart, grantEnd);
  assert.match(editableGrant, /title[\s\S]*?max_daily_expense[\s\S]*?reminder_times[\s\S]*?whatsapp_number/);
  assert.doesNotMatch(editableGrant, /\bmode\b/);
  for (const protectedColumn of [
    'target_amount', 'current_amount', 'daily_target', 'start_date',
    'target_date', 'mode', 'streak_count', 'last_deposit_date', 'status',
    'updated_at', 'total_delay_days', 'accumulated_time_debt',
  ]) {
    assert.match(migration, new RegExp('\'' + protectedColumn + '\''));
    assert.match(verification, new RegExp('\\(\'' + protectedColumn + '\', false\\)'));
  }
});

test('authenticated direct DELETE is revoked and verified as false', () => {
  assert.match(
    migration,
    /REVOKE DELETE ON TABLE public\.savings_goals FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /has_table_privilege\('authenticated', 'public\.savings_goals', 'DELETE'\)[\s\S]*?authenticated still has direct DELETE/,
  );
  assert.match(
    verification,
    /authenticated_delete[\s\S]*?direct_delete_status/,
  );
});

test('lifecycle graph blocks terminal reactivation and reserves completion', () => {
  assert.match(triggerFunction, /OLD\.status::text = 'ACTIVE'[\s\S]*?'PAUSED', 'COMPLETED', 'ARCHIVED'/);
  assert.match(triggerFunction, /OLD\.status::text = 'PAUSED'[\s\S]*?'ACTIVE', 'ARCHIVED'/);
  assert.match(triggerFunction, /OLD\.status::text = 'COMPLETED'[\s\S]*?NEW\.status::text = 'ARCHIVED'/);
  assert.match(triggerFunction, /Archived savings goals are terminal/);
  assert.match(triggerFunction, /completion requires target amount to be reached/);
  assert.match(lifecycleFunction, /p_status NOT IN \('ACTIVE', 'PAUSED', 'ARCHIVED'\)/);
});

test('lifecycle RPC is owner-bound, locked, CAS-protected, and narrow', () => {
  assert.match(lifecycleFunction, /auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(lifecycleFunction, /actor_user_id := auth\.uid\(\)/);
  assert.match(lifecycleFunction, /goal_row\.id = p_goal_id[\s\S]*?goal_row\.user_id = actor_user_id[\s\S]*?FOR UPDATE/);
  assert.match(lifecycleFunction, /UPDATE public\.savings_goals[\s\S]*?goal_row\.status::text = previous_status/);
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.set_savings_goal_status\(uuid, text\)[\s\S]*?PUBLIC, anon, authenticated, service_role[\s\S]*?GRANT EXECUTE[\s\S]*?TO authenticated/);
});

test('history RPC exposes only owner-bound durable-history booleans', () => {
  assert.match(historyFunction, /auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(historyFunction, /actor_user_id := auth\.uid\(\)/);
  assert.match(historyFunction, /goal_row\.user_id = actor_user_id/);
  assert.match(historyFunction, /EXISTS \([\s\S]*?public\.savings_logs/);
  assert.match(historyFunction, /EXISTS \([\s\S]*?public\.savings_missed_day_resolutions/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_savings_goal_history_state\(uuid\)[\s\S]*?PUBLIC, anon, authenticated, service_role[\s\S]*?GRANT EXECUTE[\s\S]*?TO authenticated/);
});

test('canonical delete RPC is owner-bound, ACTIVE-only, locked, and CAS-protected', () => {
  assert.match(deleteFunction, /auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(deleteFunction, /actor_user_id := auth\.uid\(\)/);
  assert.match(deleteFunction, /actor_user_id IS NULL OR p_goal_id IS NULL/);
  assert.match(
    deleteFunction,
    /goal_row\.id = p_goal_id[\s\S]*?goal_row\.user_id = actor_user_id[\s\S]*?FOR UPDATE/,
  );
  assert.match(deleteFunction, /goal_status <> 'ACTIVE'[\s\S]*?'NOT_ACTIVE'::text/);
  assert.match(
    deleteFunction,
    /DELETE FROM public\.savings_goals goal_row[\s\S]*?goal_row\.user_id = actor_user_id[\s\S]*?goal_row\.status::text = 'ACTIVE'/,
  );
  assert.match(deleteFunction, /RETURN QUERY SELECT deleted_goal_id, 'DELETED'::text/);
});

test('canonical delete RPC rejects every durable-history combination', () => {
  assert.match(
    deleteFunction,
    /EXISTS \([\s\S]*?public\.savings_logs[\s\S]*?OR EXISTS \([\s\S]*?public\.savings_missed_day_resolutions[\s\S]*?'HAS_HISTORY'::text/,
  );
  assert.match(
    deleteFunction,
    /DELETE FROM public\.savings_goals[\s\S]*?AND NOT EXISTS \([\s\S]*?public\.savings_logs[\s\S]*?AND NOT EXISTS \([\s\S]*?public\.savings_missed_day_resolutions/,
  );
  assert.doesNotMatch(deleteFunction, /DELETE FROM public\.savings_logs/);
  assert.doesNotMatch(deleteFunction, /DELETE FROM public\.savings_missed_day_resolutions/);
});

test('canonical delete RPC security and conflict ownership are narrow', () => {
  assert.match(deleteFunction, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(
    migration,
    /ALTER FUNCTION public\.delete_empty_savings_goal\(uuid\) OWNER TO postgres/,
  );
  assert.match(
    migration,
    /COMMENT ON FUNCTION public\.delete_empty_savings_goal\(uuid\)[\s\S]*?Douit Phase 4\.4\.3 savings goal state integrity/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.delete_empty_savings_goal\(uuid\)[\s\S]*?PUBLIC, anon, authenticated, service_role[\s\S]*?GRANT EXECUTE[\s\S]*?TO authenticated/,
  );
  assert.match(migration, /delete_function_oid[\s\S]*?pg_catalog\.aclexplode/);
});

test('SECURITY INVOKER trigger validates state without spoofable trust signals', () => {
  const executableTrigger = triggerFunction.replace(/--.*$/gm, '');
  assert.doesNotMatch(executableTrigger, /SECURITY DEFINER/);
  assert.match(executableTrigger, /SECURITY INVOKER/);
  assert.match(executableTrigger, /SET search_path = ''/);
  assert.doesNotMatch(executableTrigger, /current_setting|set_config|current_user|session_user/i);
  assert.match(contributionMigration, /record_savings_contribution_internal[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/);
  assert.match(missedDayMigration, /resolve_savings_missed_day[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/);
});

test('delete versus archive covers every durable-history combination', () => {
  assert.equal(resolveSavingsGoalRemovalAction({
    hasSavingsLogs: false,
    hasMissedDayResolutions: false,
  }), 'DELETE');
  assert.equal(resolveSavingsGoalRemovalAction({
    hasSavingsLogs: true,
    hasMissedDayResolutions: false,
  }), 'ARCHIVE');
  assert.equal(resolveSavingsGoalRemovalAction({
    hasSavingsLogs: false,
    hasMissedDayResolutions: true,
  }), 'ARCHIVE');
  assert.equal(resolveSavingsGoalRemovalAction({
    hasSavingsLogs: true,
    hasMissedDayResolutions: true,
  }), 'ARCHIVE');

  const deleteStart = savingsPage.indexOf('const confirmDeleteGoal');
  const deleteEnd = savingsPage.indexOf('const formatRupiah', deleteStart);
  const deleteFlow = savingsPage.slice(deleteStart, deleteEnd);
  assert.match(deleteFlow, /rpc\('get_savings_goal_history_state'/);
  assert.match(deleteFlow, /resolveSavingsGoalRemovalAction/);
  assert.match(deleteFlow, /rpc\('set_savings_goal_status'/);
  assert.match(deleteFlow, /p_status:\s*'ARCHIVED'/);
  assert.match(deleteFlow, /rpc\('delete_empty_savings_goal'/);
  assert.match(deleteFlow, /out_outcome === 'DELETED'/);
  assert.match(deleteFlow, /out_outcome === 'NOT_ACTIVE'/);
  assert.doesNotMatch(deleteFlow, /from\('savings_goals'\)[\s\S]*?\.delete\(\)/);
  assert.doesNotMatch(deleteFlow, /from\('savings_goals'\)[\s\S]*?\.update\(\{\s*status:/);
});

test('history race is rechecked by delete RPC and archived only by the app', () => {
  assert.match(
    deleteFunction,
    /FOR UPDATE[\s\S]*?public\.savings_logs[\s\S]*?public\.savings_missed_day_resolutions[\s\S]*?DELETE FROM public\.savings_goals/,
  );
  const deleteStart = savingsPage.indexOf('const confirmDeleteGoal');
  const deleteEnd = savingsPage.indexOf('const formatRupiah', deleteStart);
  const deleteFlow = savingsPage.slice(deleteStart, deleteEnd);
  assert.match(
    deleteFlow,
    /rpc\('delete_empty_savings_goal'[\s\S]*?out_outcome === 'HAS_HISTORY'[\s\S]*?rpc\('set_savings_goal_status'/,
  );
  assert.doesNotMatch(deleteFunction, /set_savings_goal_status|status\s*=\s*'ARCHIVED'/);
});

test('Phase 4.3.2 contribution and Phase 4.4.2 missed-day stay compatible', () => {
  assert.match(contributionMigration, /Savings contribution requires an ACTIVE goal[\s\S]*?UPDATE public\.savings_goals[\s\S]*?current_amount = coalesce\(current_amount, 0\) \+ p_amount[\s\S]*?THEN 'COMPLETED'/);
  assert.match(missedDayMigration, /goal_row\.status::text <> 'ACTIVE'[\s\S]*?UPDATE public\.savings_goals[\s\S]*?goal_value\.status::text = 'ACTIVE'/);
  assert.match(missedDayMigration, /target_date = goal_value\.target_date \+ 1/);
  assert.match(missedDayMigration, /daily_target = pg_catalog\.ceil\([\s\S]*?accumulated_time_debt[\s\S]*?\+ 1/);
  assert.match(migration, /canonical predecessor compatibility failed/);
});

test('verification is read-only and covers all requested checks', () => {
  const executableSql = verification
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(
    executableSql,
    /^\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE|CALL|DO)\b/im,
  );
  for (const expectedCheck of [
    'unexpected_or_null_status_count', 'authenticated_table_update',
    'authenticated_delete', 'direct_delete_status',
    'ownership_check_present', 'canonical_delete_present',
    'history_race_outcome_present',
    'transition_matrix', 'user_completed_status_rejected',
    'active_boundary_present',
    'orphan_savings_log_count', 'orphan_missed_day_resolution_count',
  ]) assert.ok(verification.includes(expectedCheck), expectedCheck);
});

test('migration is transactional and has no historical progress rewrite', () => {
  assert.match(migration, /^BEGIN;[\s\S]*COMMIT;\s*$/m);
  assert.doesNotMatch(migration, /UPDATE\s+public\.savings_logs/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.transactions/i);
  assert.doesNotMatch(migration, /SET\s+current_amount\s*=\s*(?:SELECT|COALESCE\(\(SELECT)/i);
});
