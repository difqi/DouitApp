import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  migration,
  verification,
  reminderRoute,
  alertSource,
  fonnteSource,
  webhookSource,
  resendSource,
  otpSource,
  savingsPageSource,
  helperSource,
  settingsSource,
  bellSource,
  notificationsPageSource,
  gitignore,
] = await Promise.all([
  readFile(new URL('../supabase_migration_phase4_4_4_notification_delivery_integrity.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase_verify_phase4_4_4_notification_delivery_integrity.sql', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/cron/savings-reminder/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('./savingsAlert.ts', import.meta.url), 'utf8'),
  readFile(new URL('./fonnte.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/fonnte/webhook/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/webhook/resend/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/auth/whatsapp-otp/send/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/(dashboard)/nabung/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./notification-delivery.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/(dashboard)/settings/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/components/NotificationBell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/(dashboard)/notifikasi/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
]);

const reminderClaimStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.claim_savings_reminder_delivery',
);
const reminderClaimEnd = migration.indexOf(
  'ALTER FUNCTION public.claim_savings_reminder_delivery',
  reminderClaimStart,
);
const reminderClaim = migration.slice(reminderClaimStart, reminderClaimEnd);

const finalizeStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.finalize_notification_delivery',
);
const finalizeEnd = migration.indexOf(
  'ALTER FUNCTION public.finalize_notification_delivery',
  finalizeStart,
);
const finalizeFunction = migration.slice(finalizeStart, finalizeEnd);
const missedDayPresentationStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.get_savings_missed_day_resolutions',
);
const missedDayPresentationEnd = migration.indexOf(
  'ALTER FUNCTION public.get_savings_missed_day_resolutions',
  missedDayPresentationStart,
);
const missedDayPresentationFunction = migration.slice(
  missedDayPresentationStart,
  missedDayPresentationEnd,
);

test('first logical savings reminder is claimed before its provider call', () => {
  const claimIndex = reminderRoute.indexOf('claimSavingsReminderDelivery(');
  const sendIndex = reminderRoute.indexOf('sendClaimedFonnteDelivery(');
  assert.ok(claimIndex >= 0);
  assert.ok(sendIndex > claimIndex);
  assert.match(reminderClaim, /INSERT INTO public\.notification_deliveries/);
  assert.match(reminderClaim, /'CLAIMED'::text/);
});

test('replay is bounded by a durable unique operation identity', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*?notification_deliveries_channel_operation_key_unique[\s\S]*?\(channel, operation_key\)/,
  );
  assert.match(reminderClaim, /ON CONFLICT \(channel, operation_key\) DO NOTHING/);
  assert.match(reminderClaim, /\('ALREADY_' \|\| delivery_row\.state\)::text/);
});

test('concurrent reminder claims serialize against canonical savings state', () => {
  assert.match(reminderClaim, /FROM public\.savings_goals[\s\S]*?FOR UPDATE/);
  assert.match(reminderClaim, /FROM public\.savings_logs/);
  assert.match(reminderClaim, /FROM public\.savings_missed_day_resolutions/);
  assert.match(reminderClaim, /savings-reminder:[\s\S]*?p_effective_date[\s\S]*?normalized_slot/);
});

test('provider failure state is separate from the UI notification row', () => {
  assert.match(migration, /state IN \('CLAIMED', 'ACCEPTED', 'FAILED', 'AMBIGUOUS'\)/);
  assert.match(helperSource, /resolveFonnteFinalState/);
  assert.match(helperSource, /p_final_state: final\.state/);
  assert.match(reminderRoute, /UI presentation is deliberately independent/);
  assert.match(reminderRoute, /UI notification insert failed/);
});

test('UI notification failure cannot change savings domain state', () => {
  const resolutionIndex = webhookSource.indexOf("'resolve_savings_missed_day'");
  const notificationIndex = webhookSource.indexOf(".from('notifications')", resolutionIndex);
  assert.ok(resolutionIndex >= 0);
  assert.ok(notificationIndex > resolutionIndex);
  assert.match(webhookSource.slice(notificationIndex), /if \(notificationError\)[\s\S]*?console\.error/);
  assert.doesNotMatch(webhookSource.slice(notificationIndex), /resolve_savings_missed_day/);
});

test('canonical missed-day resolution and deposit suppress a conflicting reminder', () => {
  const depositIndex = reminderClaim.indexOf('FROM public.savings_logs');
  const resolutionIndex = reminderClaim.indexOf('FROM public.savings_missed_day_resolutions');
  const deliveryInsertIndex = reminderClaim.indexOf('INSERT INTO public.notification_deliveries');
  assert.ok(depositIndex >= 0 && depositIndex < deliveryInsertIndex);
  assert.ok(resolutionIndex >= 0 && resolutionIndex < deliveryInsertIndex);
  assert.match(reminderClaim, /'VALID_DEPOSIT'::text/);
  assert.match(reminderClaim, /'MISSED_DAY_RESOLVED'::text/);
});

test('deleting a UI notification does not reopen delivery eligibility', () => {
  assert.doesNotMatch(reminderRoute, /existingNotifications|SKIP_SAVINGS/);
  assert.doesNotMatch(alertSource, /existingAlerts/);
  assert.doesNotMatch(reminderClaim, /public\.notifications/);
  assert.match(savingsPageSource, /rpc\('get_savings_missed_day_resolutions'/);
  assert.doesNotMatch(savingsPageSource, /n\.metadata\?\.action_type === 'SKIP_SAVINGS'/);
});

test('forwarding status authority is durable profile state, not notification history', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS email_forwarding_status text NOT NULL DEFAULT 'UNLINKED'/);
  assert.match(migration, /CHECK \(email_forwarding_status IN \('UNLINKED', 'PENDING', 'ACTIVE', 'FAILED'\)\)/);
  assert.match(settingsSource, /from\('profiles'\)[\s\S]*?select\('email_forwarding_status'\)/);

  const statusFetchStart = settingsSource.indexOf('const fetchEmailIntegrationStatus');
  const statusFetchEnd = settingsSource.indexOf('const fetchRulesAndCategories', statusFetchStart);
  const statusFetch = settingsSource.slice(statusFetchStart, statusFetchEnd);
  assert.doesNotMatch(statusFetch, /from\('notifications'\)/);
  assert.doesNotMatch(statusFetch, /is_confirmed|confirmation_url/);
});

test('forwarding constraint preflight is idempotent and fail-closed', () => {
  const constraintStart = migration.indexOf('DO $phase4_4_4_forwarding_constraint$');
  const constraintEnd = migration.indexOf('$phase4_4_4_forwarding_constraint$;', constraintStart);
  const constraintBlock = migration.slice(constraintStart, constraintEnd);

  assert.match(constraintBlock, /constraint_row\.contype/);
  assert.match(constraintBlock, /constraint_row\.convalidated/);
  assert.match(constraintBlock, /constraint_row\.conkey/);
  assert.match(constraintBlock, /pg_get_constraintdef/);
  assert.match(constraintBlock, /pg_get_expr/);
  assert.match(constraintBlock, /IF NOT FOUND THEN[\s\S]*?ADD CONSTRAINT profiles_email_forwarding_status_check/);
  assert.match(constraintBlock, /actual_values IS DISTINCT FROM expected_values/);
  assert.match(constraintBlock, /normalized_shape <> 'email_forwarding_status=ANYARRAY/);
  assert.match(constraintBlock, /RAISE EXCEPTION[\s\S]*?incompatible profiles_email_forwarding_status_check/);
  assert.doesNotMatch(constraintBlock, /DROP CONSTRAINT/);
});

test('forwarding postcheck and SELECT-only verifier prove the exact contract', () => {
  const postcheckStart = migration.indexOf('DO $phase4_4_4_postcheck$');
  const postcheck = migration.slice(postcheckStart);

  assert.match(postcheck, /attribute_row\.atttypid/);
  assert.match(postcheck, /attribute_row\.attnotnull/);
  assert.match(postcheck, /status_default_expression IS NULL/);
  assert.match(postcheck, /status_default_expression NOT IN/);
  assert.match(postcheck, /forwarding_constraint\.contype <> 'c'/);
  assert.match(postcheck, /NOT forwarding_constraint\.convalidated/);
  assert.match(postcheck, /forwarding_constraint\.conkey IS DISTINCT FROM ARRAY\[status_attribute_number\]::smallint\[\]/);
  assert.match(postcheck, /actual_values IS DISTINCT FROM expected_values/);
  assert.match(postcheck, /normalized_shape <> 'email_forwarding_status=ANYARRAY/);

  assert.match(verification, /THEN 'PASS'[\s\S]*?ELSE 'FAIL'[\s\S]*?forwarding_status_contract/);
  assert.match(verification, /exact_vocabulary/);
  assert.match(verification, /exact_constraint_shape/);
  assert.match(verification, /raw_constraint_definition/);
});

test('migration does not backfill forwarding authority from UI notifications', () => {
  assert.doesNotMatch(
    migration,
    /UPDATE\s+public\.profiles[\s\S]*?(?:FROM|JOIN)\s+public\.notifications/i,
  );
  assert.doesNotMatch(
    migration,
    /email_forwarding_status[\s\S]{0,300}metadata\s*(?:->|->>)/i,
  );
});

test('forwarding notification deletion and insertion failure cannot alter authority', () => {
  const forwardingStart = resendSource.indexOf('if (isForwardingEmail)');
  const forwardingEnd = resendSource.indexOf('// Check for idempotency', forwardingStart);
  const forwardingFlow = resendSource.slice(forwardingStart, forwardingEnd);
  const statusUpdateIndex = forwardingFlow.indexOf("from('profiles')");
  const notificationInsertIndex = forwardingFlow.indexOf('from("notifications")');

  assert.ok(statusUpdateIndex >= 0);
  assert.ok(notificationInsertIndex > statusUpdateIndex);
  assert.match(forwardingFlow, /forwardingNotificationError[\s\S]*?console\.error/);
  assert.doesNotMatch(forwardingFlow.slice(notificationInsertIndex), /email_forwarding_status/);
  assert.doesNotMatch(bellSource, /is_confirmed/);
  assert.doesNotMatch(notificationsPageSource, /is_confirmed/);
  assert.match(bellSource, /window\.open\([\s\S]*?await markAsRead/);
  assert.match(notificationsPageSource, /window\.open\([\s\S]*?await markAsRead/);
});

test('forwarding status is service-owned and alias regeneration resets it', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.protect_email_forwarding_status\(\)/);
  assert.match(migration, /auth\.role\(\) = 'authenticated'/);
  assert.match(migration, /NEW\.inbound_email_alias IS DISTINCT FROM OLD\.inbound_email_alias[\s\S]*?NEW\.email_forwarding_status := 'UNLINKED'/);
  assert.match(migration, /NEW\.email_forwarding_status := OLD\.email_forwarding_status/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.protect_email_forwarding_status\(\)[\s\S]*?PUBLIC, anon, authenticated, service_role/);
  assert.match(resendSource, /email_forwarding_status: forwardingStatus/);
  assert.match(resendSource, /email_forwarding_status: 'ACTIVE'/);
});

test('missed-day presentation RPC is authenticated, owner-bound, read-only, and minimal', () => {
  assert.match(missedDayPresentationFunction, /auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(missedDayPresentationFunction, /actor_user_id := auth\.uid\(\)/);
  assert.match(missedDayPresentationFunction, /goal_row\.user_id = actor_user_id/);
  assert.match(missedDayPresentationFunction, /RETURNS TABLE \(\s*out_goal_id uuid\s*\)/);
  assert.doesNotMatch(missedDayPresentationFunction, /out_resolution_source|resolution_source/);
  assert.doesNotMatch(missedDayPresentationFunction, /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_savings_missed_day_resolutions\(date\)[\s\S]*?PUBLIC, anon, authenticated, service_role[\s\S]*?GRANT EXECUTE[\s\S]*?TO authenticated/);
});

test('Phase 4.4.4 SQL artifacts remain covered by the repository ignore policy', () => {
  assert.match(gitignore, /^supabase_\*\.sql$/m);
  assert.doesNotMatch(gitignore, /^!supabase_(?:migration|verify)_phase4_4_4_/m);
});

test('non-ACTIVE goal cannot become an eligible reminder claim', () => {
  const activeCheckIndex = reminderClaim.indexOf("goal_row.status::text <> 'ACTIVE'");
  const insertIndex = reminderClaim.indexOf('INSERT INTO public.notification_deliveries');
  assert.ok(activeCheckIndex >= 0 && activeCheckIndex < insertIndex);
  assert.match(reminderClaim, /'GOAL_NOT_ACTIVE'::text/);
});

test('provider acceptance is finalized and provider message ID is retained', () => {
  assert.match(fonnteSource, /deliveryOutcome: 'ACCEPTED'/);
  assert.match(fonnteSource, /providerMessageId/);
  assert.match(helperSource, /state: 'ACCEPTED'/);
  assert.match(finalizeFunction, /state = p_final_state/);
  assert.match(finalizeFunction, /provider_message_id = CASE/);
  assert.match(finalizeFunction, /finalized_at = pg_catalog\.now\(\)/);
});

test('failure and crash-window semantics are at-most-one application attempt', () => {
  assert.match(migration, /CHECK \(attempt_count = 1\)/);
  assert.doesNotMatch(migration, /SET[\s\S]{0,80}state = 'CLAIMED'[\s\S]{0,80}WHERE[\s\S]{0,80}state IN \('FAILED'/);
  assert.match(fonnteSource, /outcome as ambiguous instead of treating it as a safe rejection/);
  assert.match(fonnteSource, /const explicitlyRejected = data\?\.status === false/);
  assert.match(fonnteSource, /deliveryOutcome: 'AMBIGUOUS'/);
  assert.match(finalizeFunction, /IF delivery_row\.state <> 'CLAIMED'/);
});

test('all selected send-worthy domain confirmations use stable delivery claims', () => {
  assert.match(webhookSource, /SAVINGS_CONTRIBUTION_CONFIRMATION/);
  assert.match(webhookSource, /SAVINGS_SKIP_CONFIRMATION/);
  assert.match(resendSource, /SAVINGS_EMAIL_CONFIRMATION/);
  assert.match(otpSource, /WHATSAPP_OTP/);
  assert.match(alertSource, /claimBudgetAlertDelivery/);
});

test('migration is private and verification artifact is SELECT-only', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.notification_deliveries[\s\S]*?PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(migration, /SET search_path = ''/);
  assert.doesNotMatch(migration, /GRANT (SELECT|INSERT|UPDATE|DELETE)[\s\S]*?notification_deliveries/);
  assert.doesNotMatch(
    verification,
    /^\s*(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/im,
  );
});
