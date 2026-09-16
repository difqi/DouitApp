import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildTransactionApprovalRpcArgs,
  getTransactionApprovalResult,
  shouldTriggerBudgetAlertForApproval,
} from './transaction-approval.ts';

const [
  migration,
  verification,
  workspace,
  chatPage,
  createModal,
  resendRoute,
  reportPage,
  alertSource,
  settingsPage,
  contributionMigration,
  contributionTests,
  gitignore,
] = await Promise.all([
  readFile(new URL('../supabase_migration_phase4_4_5_transaction_approval_lifecycle.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase_verify_phase4_4_5_transaction_approval_lifecycle.sql', import.meta.url), 'utf8'),
  readFile(new URL('../app/components/WorkspaceViews.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/(dashboard)/chat/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/components/TransactionCreateModal.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/webhook/resend/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/(dashboard)/laporan/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./savingsAlert.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/(dashboard)/settings/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../supabase_migration_phase4_3_2_savings_linkage.sql', import.meta.url), 'utf8'),
  readFile(new URL('./savings-structural-linkage.test.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
]);

const rpcStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.set_transaction_approval_state',
);
const rpcEnd = migration.indexOf(
  'ALTER FUNCTION public.set_transaction_approval_state', rpcStart,
);
const approvalRpc = migration.slice(rpcStart, rpcEnd);
const triggerStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.enforce_transaction_approval_lifecycle',
);
const triggerEnd = migration.indexOf(
  'ALTER FUNCTION public.enforce_transaction_approval_lifecycle', triggerStart,
);
const lifecycleTrigger = migration.slice(triggerStart, triggerEnd);

test('actual status vocabulary is retained, finite, non-null, and not rewritten', () => {
  assert.match(
    migration,
    /ARRAY\['APPROVED', 'IGNORED', 'PENDING_APPROVAL'\]::text\[\]/,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT transactions_status_vocabulary_check[\s\S]*?PENDING_APPROVAL[\s\S]*?APPROVED[\s\S]*?IGNORED/,
  );
  assert.match(migration, /ALTER COLUMN status SET NOT NULL/);
  assert.match(migration, /SET DEFAULT 'PENDING_APPROVAL'::public\.transaction_status/);
  assert.match(migration, /changed historical transaction data/);
  assert.doesNotMatch(
    migration,
    /UPDATE\s+public\.transactions\s+SET\s+status\s*=\s*(?:upper|coalesce|case)/i,
  );
});

test('existing status constraints are validated exactly and never silently replaced', () => {
  const constraintBlockStart = migration.indexOf('DO $phase4_4_5_status_constraint$');
  const constraintBlockEnd = migration.indexOf(
    '$phase4_4_5_status_constraint$;', constraintBlockStart,
  );
  const constraintBlock = migration.slice(constraintBlockStart, constraintBlockEnd);
  assert.match(constraintBlock, /constraint_row\.contype/);
  assert.match(constraintBlock, /constraint_row\.convalidated/);
  assert.match(constraintBlock, /constraint_row\.conkey/);
  assert.match(constraintBlock, /pg_get_constraintdef/);
  assert.match(constraintBlock, /constraint_values IS DISTINCT FROM/);
  assert.match(constraintBlock, /IF NOT FOUND THEN[\s\S]*?ADD CONSTRAINT/);
  assert.match(constraintBlock, /incompatible transactions_status_vocabulary_check/);
  assert.doesNotMatch(constraintBlock, /DROP CONSTRAINT/);
});

test('legitimate creation paths retain their audited initial states', () => {
  assert.match(
    createModal,
    /status:\s*["']APPROVED["'][\s\S]*?source:\s*["']MANUAL_FORM["']/,
  );
  assert.match(chatPage, /status:\s*'APPROVED'[\s\S]*?source:\s*'MANUAL_CHAT'/);
  assert.match(chatPage, /status:\s*feeCategory \? 'APPROVED' : 'PENDING_APPROVAL'/);
  assert.match(resendRoute, /status:\s*status,[\s\S]*?source:\s*'AUTOMATIC_EMAIL'/);
  assert.match(lifecycleTrigger, /TG_OP = 'INSERT'/);
  assert.match(
    lifecycleTrigger,
    /NEW\.status::text NOT IN \('PENDING_APPROVAL', 'APPROVED'\)/,
  );
});

test('PENDING_APPROVAL can transition to APPROVED or IGNORED only', () => {
  assert.match(
    lifecycleTrigger,
    /OLD\.status::text = 'PENDING_APPROVAL'[\s\S]*?NEW\.status::text IN \('APPROVED', 'IGNORED'\)/,
  );
  assert.match(
    approvalRpc,
    /WHEN 'APPROVE' THEN 'APPROVED'::public\.transaction_status/,
  );
  assert.match(
    approvalRpc,
    /WHEN 'REJECT' THEN 'IGNORED'::public\.transaction_status/,
  );
});

test('repeated approve and repeated reject have explicit replay outcomes', () => {
  assert.match(approvalRpc, /transaction_row\.status = target_status::text/);
  assert.match(approvalRpc, /ALREADY_APPROVED/);
  assert.match(approvalRpc, /ALREADY_REJECTED/);
  assert.deepEqual(buildTransactionApprovalRpcArgs({
    transactionId: 'tx-1',
    expectedStatus: 'PENDING_APPROVAL',
    decision: 'APPROVE',
  }), {
    p_transaction_id: 'tx-1',
    p_expected_status: 'PENDING_APPROVAL',
    p_decision: 'APPROVE',
  });
});

test('approve-after-reject and reject-after-approve are forbidden reversals', () => {
  assert.match(
    approvalRpc,
    /transaction_row\.status <> p_expected_status[\s\S]*?transaction_row\.status <> 'PENDING_APPROVAL'[\s\S]*?'INVALID_TRANSITION'/,
  );
  assert.match(lifecycleTrigger, /Illegal transaction approval transition/);
  assert.doesNotMatch(
    lifecycleTrigger,
    /OLD\.status::text = '(?:APPROVED|IGNORED)'[\s\S]*?NEW\.status::text = 'PENDING_APPROVAL'/,
  );
});

test('owner boundary, row lock, and final compare-and-set prevent stale races', () => {
  assert.match(approvalRpc, /auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(approvalRpc, /actor_user_id := auth\.uid\(\)/);
  assert.match(
    approvalRpc,
    /transaction_value\.id = p_transaction_id[\s\S]*?transaction_value\.user_id = actor_user_id[\s\S]*?FOR UPDATE/,
  );
  assert.match(
    approvalRpc,
    /UPDATE public\.transactions[\s\S]*?user_id = actor_user_id[\s\S]*?status::text = p_expected_status[\s\S]*?status::text = 'PENDING_APPROVAL'/,
  );
  assert.match(approvalRpc, /'NOT_FOUND'::text/);
});

test('canonical RPC security and grants are narrow', () => {
  assert.match(approvalRpc, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(
    migration,
    /ALTER FUNCTION public\.set_transaction_approval_state\(uuid, text, text\)[\s\S]*?OWNER TO postgres/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.set_transaction_approval_state\(uuid, text, text\)[\s\S]*?PUBLIC, anon, authenticated, service_role[\s\S]*?GRANT EXECUTE[\s\S]*?TO authenticated/,
  );
});

test('direct status update is blocked while current editable fields remain available', () => {
  assert.match(
    migration,
    /REVOKE UPDATE ON TABLE public\.transactions[\s\S]*?PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(migration, /phase4_4_5_clear_column_update_grants/);
  assert.match(
    migration,
    /GRANT UPDATE \([\s\S]*?category_id[\s\S]*?subcategory_id[\s\S]*?transaction_kind[\s\S]*?sumber_dana[\s\S]*?notes[\s\S]*?TO authenticated/,
  );
  assert.match(verification, /\('status', false\)/);
  for (const editableColumn of [
    'category_id', 'subcategory_id', 'transaction_kind', 'sumber_dana', 'notes',
  ]) {
    assert.match(verification, new RegExp("\\('" + editableColumn + "', true\\)"));
  }
});

test('transaction UI uses the RPC and edit flows no longer change status', () => {
  assert.match(workspace, /rpc\(\s*'set_transaction_approval_state'/);
  assert.match(workspace, /expectedStatus:\s*row\.status/);
  assert.match(workspace, /decision,\s*\}\)/);
  assert.doesNotMatch(
    workspace,
    /\.from\('transactions'\)\.update\(\{\s*status:/,
  );
  assert.doesNotMatch(workspace, /sharedRetroactivePayload[\s\S]{0,180}status:/);
  assert.doesNotMatch(workspace, /notes:\s*newNotes,?\s*status:/);
  assert.match(workspace, /result\.out_current_status[\s\S]*?setRows/);
});

test('approval side effect runs only for an authoritative new expense approval', () => {
  const updatedExpense = getTransactionApprovalResult([{
    out_transaction_id: 'tx-1',
    out_previous_status: 'PENDING_APPROVAL',
    out_current_status: 'APPROVED',
    out_transaction_type: 'EXPENSE',
    out_outcome: 'UPDATED',
  }]);
  assert.ok(updatedExpense);
  assert.equal(shouldTriggerBudgetAlertForApproval(updatedExpense), true);
  assert.equal(shouldTriggerBudgetAlertForApproval({
    ...updatedExpense,
    out_outcome: 'ALREADY_APPROVED',
  }), false);
  assert.equal(shouldTriggerBudgetAlertForApproval({
    ...updatedExpense,
    out_current_status: 'IGNORED',
    out_outcome: 'UPDATED',
  }), false);
  assert.match(workspace, /shouldTriggerBudgetAlertForApproval\(result\)/);
  assert.match(chatPage, /txPayload\.type === 'EXPENSE' && !idempotentReplay/);
});

test('APPROVED remains the read-time accounting authority for reports and budgets', () => {
  assert.match(reportPage, /\.eq\('status', 'APPROVED'\)/);
  assert.match(alertSource, /\.eq\('status', 'APPROVED'\)/);
  assert.doesNotMatch(reportPage, /PENDING_APPROVAL|IGNORED/);
});

test('Phase 4.3.2 linked SAVING transaction protections remain intact', () => {
  assert.match(
    contributionMigration,
    /enforce_linked_savings_transaction_immutability_trigger/,
  );
  assert.match(
    contributionMigration,
    /Linked savings transactions cannot be deleted directly/,
  );
  assert.match(
    contributionMigration,
    /NEW\.status IS DISTINCT FROM OLD\.status/,
  );
  assert.match(
    migration,
    /requires both Phase 4\.3\.2 transaction protection triggers/,
  );
  assert.match(contributionTests, /one linked log per transaction/);
});

test('canonical savings contribution still creates an approved linked transaction', () => {
  assert.match(
    contributionMigration,
    /INSERT INTO public\.transactions[\s\S]*?'SAVING'[\s\S]*?'APPROVED'::public\.transaction_status/,
  );
  assert.doesNotMatch(
    migration,
    /CREATE OR REPLACE FUNCTION public\.record_savings_contribution/,
  );
});

test('existing delete semantics remain direct for ordinary rows and protected for linked SAVING rows', () => {
  assert.match(
    settingsPage,
    /\.from\('transactions'\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\('user_id', user\.id\)/,
  );
  assert.doesNotMatch(
    migration,
    /REVOKE DELETE ON TABLE public\.transactions/,
  );
  assert.match(
    contributionMigration,
    /IF TG_OP = 'DELETE'[\s\S]*?Linked savings transactions cannot be deleted directly/,
  );
});

test('SELECT-only verifier covers status, privileges, RPC, duplicates, and predecessor compatibility', () => {
  const executableSql = verification.replace(/--.*$/gm, '');
  assert.doesNotMatch(
    executableSql,
    /^\s*(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|DO)\b/im,
  );
  assert.match(verification, /status_column_and_constraint_contract/);
  assert.match(verification, /direct_status_update_boundary/);
  assert.match(verification, /canonical_approval_rpc_contract/);
  assert.match(verification, /legal_transition_trigger_contract/);
  assert.match(verification, /duplicate_identity_contract/);
  assert.match(verification, /savings_linked_transaction_contract/);
  assert.match(verification, /phase4_3_2_compatibility_contract/);
  assert.match(verification, /raw_constraint_definition/);
  assert.match(verification, /raw_function_definition/);
});

test('Phase 4.4.5 SQL artifacts remain local under the repository ignore policy', () => {
  assert.match(gitignore, /^supabase_\*\.sql$/m);
  assert.doesNotMatch(
    gitignore,
    /^!supabase_(?:migration|verify)_phase4_4_5_/m,
  );
});
