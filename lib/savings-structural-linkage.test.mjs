import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildManualWebSavingsRpcArgs,
  buildSavingsOperationKey,
  findUniqueOwnedSavingsAccount,
  getOwnedSavingsSourceAccounts,
  isWithinSavingsEmailEvidenceWindow,
  parseProviderReceivedAt,
  resolveSavingsSource,
  SAVINGS_EMAIL_EVIDENCE_WINDOW_MINUTES,
  savingsStorageRequiresAccount,
  SAVINGS_EVIDENCE_LEVELS,
  SAVINGS_RECORDING_METHODS,
  SAVINGS_STORAGE_TYPES,
} from "./savings-contributions.ts";
import { isDeterministicSavingsAccountMatch } from "../utils/bankAliases.ts";

const migration = await readFile(
  new URL("../supabase_migration_phase4_3_2_savings_linkage.sql", import.meta.url),
  "utf8",
);
const verification = await readFile(
  new URL("../supabase_verify_phase4_3_2_savings_linkage.sql", import.meta.url),
  "utf8",
);
const savingsPage = await readFile(
  new URL("../app/(dashboard)/nabung/page.tsx", import.meta.url),
  "utf8",
);
const fonnteRoute = await readFile(
  new URL("../app/api/fonnte/webhook/route.ts", import.meta.url),
  "utf8",
);
const resendRoute = await readFile(
  new URL("../app/api/webhook/resend/route.ts", import.meta.url),
  "utf8",
);
const reconciliationRoute = await readFile(
  new URL("../app/api/cron/savings-reconciliation/route.ts", import.meta.url),
  "utf8",
);
const chatPage = await readFile(
  new URL("../app/(dashboard)/chat/page.tsx", import.meta.url),
  "utf8",
);

const actor = "11111111-1111-4111-8111-111111111111";
const accounts = [
  { id: "bri", user_id: actor, name: "Bank BRI", type: "bank" },
  { id: "wallet", user_id: actor, name: "GoPay", type: "wallet" },
  { id: "foreign", user_id: "22222222-2222-4222-8222-222222222222", name: "BCA", type: "bank" },
  { id: "ownerless", user_id: null, name: "Tanpa Owner", type: "bank" },
];

test("savings contribution vocabulary matches the locked product contract", () => {
  assert.deepEqual(SAVINGS_STORAGE_TYPES, ["GOPAY_MERCHANT", "BANK_TRANSFER", "TUNAI"]);
  assert.deepEqual(SAVINGS_RECORDING_METHODS, ["AUTO_EMAIL", "MANUAL_WEB", "MANUAL_WHATSAPP"]);
  assert.deepEqual(SAVINGS_EVIDENCE_LEVELS, ["USER_CONFIRMED", "EXTERNAL_VERIFIED"]);
});

test("web Celengan Fisik resolves deterministically to Tunai without an account row", () => {
  assert.equal(savingsStorageRequiresAccount("TUNAI"), false);
  assert.deepEqual(resolveSavingsSource({
    storageType: "TUNAI",
    actorUserId: actor,
    sourceAccountId: null,
    accounts,
  }), { status: "valid", sourceAccountId: null, sourceName: "Tunai" });
  assert.equal(resolveSavingsSource({
    storageType: "TUNAI",
    actorUserId: actor,
    sourceAccountId: "bri",
    accounts,
  }).status, "source_account_forbidden");
});

test("QRIS and Bank require an explicitly owned non-null-owner account", () => {
  for (const storageType of ["GOPAY_MERCHANT", "BANK_TRANSFER"]) {
    assert.equal(savingsStorageRequiresAccount(storageType), true);
    assert.equal(resolveSavingsSource({ storageType, actorUserId: actor, accounts }).status, "source_account_required");
    assert.equal(resolveSavingsSource({ storageType, actorUserId: actor, sourceAccountId: "foreign", accounts }).status, "invalid_source_account");
    assert.equal(resolveSavingsSource({ storageType, actorUserId: actor, sourceAccountId: "ownerless", accounts }).status, "invalid_source_account");
    assert.equal(resolveSavingsSource({ storageType, actorUserId: actor, sourceAccountId: "bri", accounts }).status, "valid");
  }
  assert.deepEqual(getOwnedSavingsSourceAccounts(accounts, actor).map((account) => account.id), ["bri", "wallet"]);
});

test("provider account reconciliation accepts exactly one owned match", () => {
  assert.equal(findUniqueOwnedSavingsAccount({
    accounts,
    actorUserId: actor,
    matches: (account) => account.name === "Bank BRI",
  })?.id, "bri");
  assert.equal(findUniqueOwnedSavingsAccount({
    accounts,
    actorUserId: actor,
    matches: () => true,
  }), null);
  assert.equal(isDeterministicSavingsAccountMatch("Bank BRI", "BRI"), true);
  assert.equal(isDeterministicSavingsAccountMatch("GoPay", "go-pay"), true);
  assert.equal(isDeterministicSavingsAccountMatch("Bank BRI", "bank"), false);
  assert.equal(isDeterministicSavingsAccountMatch("GoPay Utama", "GoPay"), false);
});

test("stable operation identities are namespaced and retries reuse the same key", () => {
  const first = buildSavingsOperationKey({ namespace: "manual_web", stableId: "deposit-123" });
  const retry = buildSavingsOperationKey({ namespace: "manual_web", stableId: "deposit-123" });
  const distinct = buildSavingsOperationKey({ namespace: "manual_web", stableId: "deposit-124" });
  assert.equal(first, "savings:manual_web:deposit-123");
  assert.equal(retry, first);
  assert.notEqual(distinct, first);
  assert.equal(buildSavingsOperationKey({ namespace: "fonnte", stableId: "sender message" }), null);
});

test("email evidence uses a reliable provider timestamp and an inclusive 30-minute window", () => {
  assert.equal(SAVINGS_EMAIL_EVIDENCE_WINDOW_MINUTES, 30);
  const receivedAt = "2026-09-02T05:00:00.000Z";
  assert.equal(parseProviderReceivedAt(receivedAt), receivedAt);
  assert.equal(parseProviderReceivedAt("not-a-timestamp"), null);
  assert.equal(parseProviderReceivedAt(undefined), null);
  assert.equal(isWithinSavingsEmailEvidenceWindow({
    contributionAt: "2026-09-02T04:30:00.000Z",
    emailReceivedAt: receivedAt,
  }), true);
  assert.equal(isWithinSavingsEmailEvidenceWindow({
    contributionAt: "2026-09-02T04:29:59.999Z",
    emailReceivedAt: receivedAt,
  }), false);
  assert.equal(isWithinSavingsEmailEvidenceWindow({
    contributionAt: "2026-09-02T05:00:00.001Z",
    emailReceivedAt: receivedAt,
  }), false, "a contribution created after the provider receipt cannot be upgraded");
  assert.equal(isWithinSavingsEmailEvidenceWindow({
    contributionAt: "2026-09-01T23:59:00.000Z",
    emailReceivedAt: "2026-09-02T00:01:00.000Z",
  }), true, "calendar boundaries do not matter inside the bounded window");
});

test("manual web payload exposes no caller-controlled user or semantic fields", () => {
  const payload = buildManualWebSavingsRpcArgs({
    goalId: "goal",
    amount: 10_000,
    sourceAccountId: null,
    operationKey: "savings:manual_web:deposit-123",
    notes: "Setoran",
  });
  assert.equal(payload.p_goal_id, "goal");
  assert.equal("p_actor_user_id" in payload, false);
  assert.equal("p_recording_method" in payload, false);
  assert.equal("p_evidence_level" in payload, false);
  assert.equal("p_occurred_at" in payload, false);
});

test("migration adds nullable linkage metadata without historical pairing", () => {
  for (const column of ["transaction_id", "recording_method", "evidence_level", "external_event_id", "source_account_id"]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column} (?:uuid|text) NULL`));
  }
  assert.match(migration, /AUTO_EMAIL.*MANUAL_WEB.*MANUAL_WHATSAPP/s);
  assert.match(migration, /USER_CONFIRMED.*EXTERNAL_VERIFIED/s);
  assert.doesNotMatch(migration, /UPDATE\s+public\.savings_logs\s+SET\s+transaction_id\s*=/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.transactions\s+SET\s+transaction_kind\s*=/i);
});

test("one linked log per transaction and conservative delete behavior are structural", () => {
  assert.match(migration, /FOREIGN KEY \(transaction_id\)[\s\S]*?REFERENCES public\.transactions\(id\)[\s\S]*?ON DELETE RESTRICT/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS savings_logs_transaction_id_unique[\s\S]*?WHERE transaction_id IS NOT NULL/);
  assert.match(migration, /FOREIGN KEY \(source_account_id\)[\s\S]*?REFERENCES public\.payment_accounts\(id\)[\s\S]*?ON DELETE RESTRICT/);
  assert.match(migration, /FOREIGN KEY \(goal_id\) REFERENCES public\.savings_goals\(id\)[\s\S]*?ON DELETE RESTRICT/);
  assert.match(migration, /enforce_linked_savings_transaction_immutability_trigger/);
  assert.match(migration, /Linked savings transaction financial identity is immutable/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER enforce_saving_transaction_linkage_commit_trigger/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /New SAVING transactions require a linked savings contribution in the same transaction/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON public\.transactions/);
});

test("transaction, log, and goal writes share one atomic function failure boundary", () => {
  const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.record_savings_contribution_internal");
  const end = migration.indexOf("REVOKE ALL ON FUNCTION public.record_savings_contribution_internal", start);
  const atomicFunction = migration.slice(start, end);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_savings_contribution_internal/);
  assert.match(atomicFunction, /FOR UPDATE/);
  assert.match(atomicFunction, /INSERT INTO public\.transactions/);
  assert.match(atomicFunction, /INSERT INTO public\.savings_logs/);
  assert.match(atomicFunction, /current_amount = coalesce\(current_amount, 0\) \+ p_amount/);
  assert.match(atomicFunction, /RAISE EXCEPTION 'Savings goal update failed'/);
  assert.ok(atomicFunction.indexOf("INSERT INTO public.transactions") < atomicFunction.indexOf("INSERT INTO public.savings_logs"));
  assert.ok(atomicFunction.indexOf("INSERT INTO public.savings_logs") < atomicFunction.indexOf("UPDATE public.savings_goals"));
  assert.match(migration, /^BEGIN;[\s\S]*COMMIT;\s*$/m);
});

test("RPC enforces canonical Nabung, enum types, source rules, and ownership", () => {
  assert.match(migration, /category_row\.name = 'Nabung'/);
  assert.match(migration, /category_row\.is_system IS TRUE/);
  assert.match(migration, /category_row\.user_id IS NULL/);
  assert.match(migration, /'EXPENSE'::public\.transaction_type/);
  assert.match(migration, /'APPROVED'::public\.transaction_status/);
  assert.match(migration, /transaction_kind,[\s\S]*?'SAVING'/);
  assert.match(migration, /account_row\.user_id IS NOT NULL[\s\S]*?account_row\.user_id = p_actor_user_id/);
});

test("idempotent retries cannot increment twice while distinct keys remain distinct", () => {
  assert.match(migration, /WHERE transaction_value\.idempotency_key = p_operation_key/);
  assert.match(migration, /out_replayed boolean/);
  assert.match(migration, /Savings operation key collides with a different operation/);
  assert.match(migration, /LOCK TABLE public\.savings_goals/);
  assert.match(migration, /current_amount = coalesce\(current_amount, 0\) \+ p_amount/);
});

test("email reconciliation uses one locked RPC to upgrade uniquely or create atomically", () => {
  const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.reconcile_savings_contribution_evidence");
  const end = migration.indexOf("REVOKE ALL ON FUNCTION public.reconcile_savings_contribution_evidence", start);
  const reconcileFunction = migration.slice(start, end);
  assert.match(reconcileFunction, /log_row\.user_id = p_actor_user_id/);
  assert.match(reconcileFunction, /log_row\.goal_id = p_goal_id/);
  assert.match(reconcileFunction, /log_row\.amount = p_amount/);
  assert.match(reconcileFunction, /log_row\.source_account_id = p_source_account_id/);
  assert.match(reconcileFunction, /transaction_row\.transaction_date BETWEEN[\s\S]*?interval '30 minutes'/);
  assert.match(reconcileFunction, /log_row\.created_at BETWEEN[\s\S]*?interval '30 minutes'/);
  assert.doesNotMatch(reconcileFunction, /AT TIME ZONE 'Asia\/Jakarta'/);
  assert.match(reconcileFunction, /candidate_count > 1[\s\S]*?'AMBIGUOUS'/);
  assert.match(reconcileFunction, /evidence_level = 'EXTERNAL_VERIFIED'/);
  assert.match(reconcileFunction, /record_savings_contribution_internal\(/);
  assert.match(reconcileFunction, /'AUTO_EMAIL'[\s\S]*?'EXTERNAL_VERIFIED'/);
  assert.doesNotMatch(reconcileFunction, /current_amount\s*=/);
});

test("web, WhatsApp, and email writers use RPCs instead of independent financial writes", () => {
  const webStart = savingsPage.indexOf("const handleQuickDeposit");
  const webEnd = savingsPage.indexOf("const handleDeleteGoal", webStart);
  const webFlow = savingsPage.slice(webStart, webEnd);
  assert.match(webFlow, /\.rpc\([\s\S]*?'record_savings_contribution'/);
  assert.doesNotMatch(webFlow, /from\('savings_logs'\)\.insert|from\('savings_goals'\)[\s\S]*?\.update/);

  assert.match(fonnteRoute, /p_recording_method: 'MANUAL_WHATSAPP'/);
  assert.match(fonnteRoute, /p_evidence_level: 'USER_CONFIRMED'/);
  assert.match(fonnteRoute, /Stable provider event ID required/);
  assert.match(fonnteRoute, /Ambiguous sender ownership/);
  assert.match(fonnteRoute, /Ambiguous savings goal/);
  assert.doesNotMatch(fonnteRoute, /from\('savings_logs'\)\.insert/);

  assert.match(resendRoute, /reconcile_savings_contribution_evidence/);
  assert.match(resendRoute, /p_external_event_id: operationKey/);
  assert.match(resendRoute, /parseProviderReceivedAt\(receivingData\?\.created_at\)/);
  assert.match(resendRoute, /const occurredAt = providerReceivedAt!/);
  assert.doesNotMatch(resendRoute, /from\('savings_logs'\)\.insert/);
});

test("no-email reconciliation never reduces saved money", () => {
  assert.match(reconciliationRoute, /absence never reverses saved money/);
  assert.doesNotMatch(reconciliationRoute, /unverifiedClaimAmount|reversedClaimAmount/);
  assert.doesNotMatch(reconciliationRoute, /current_amount\s*:/);
});

test("security definer functions have empty search_path and restricted grants", () => {
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = ''/g);
  assert.equal((migration.match(/OWNER TO postgres/g) || []).length, 6);
  assert.match(migration, /actor_user_id := auth\.uid\(\)/);
  assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_savings_contribution[\s\S]*?TO authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_savings_contribution_as_service[\s\S]*?TO service_role/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.savings_logs[\s\S]*?authenticated/);
  assert.doesNotMatch(migration, /pg_catalog\.(?:current_setting|set_config)\s*\(/);
  assert.match(verification, /authenticated_internal_execute/);
  assert.match(verification, /authenticated_transaction_trigger_execute/);
  assert.match(verification, /authenticated_log_insert/);
  assert.match(verification, /deferred_transaction_linkage_trigger_count/);
  assert.match(verification, /function_owner/);
});

test("ordinary chat stays outside trusted savings RPCs and report amount remains transaction-only", () => {
  assert.match(chatPage, /resolveNormalTransactionKind\(safeCategory\)/);
  assert.doesNotMatch(chatPage, /record_savings_contribution|transaction_kind:\s*['"]SAVING['"]/);
});

test("verification locks exact no-backfill fingerprints and security contract", () => {
  assert.match(verification, /204826ccb66ec48f8a27e124f8702c9c/);
  assert.match(verification, /26576443d0d09f18f82e1fd1042d8145/);
  assert.match(verification, /bacd5ba5f91ee132e31465040d1a090e/);
  assert.match(verification, /linked_rows[\s\S]*?THEN 'PASS'/);
  assert.match(verification, /authenticated_browser_execute/);
  assert.match(verification, /service_wrapper_execute/);
  assert.ok(
    migration.indexOf("Phase 4.3.2 savings_logs baseline differs")
      < migration.indexOf("ADD COLUMN IF NOT EXISTS transaction_id"),
    "exact retained baseline must fail before additive DDL",
  );
  assert.ok(
    migration.indexOf("Phase 4.3.2 migration changed historical financial data")
      > migration.indexOf("CREATE OR REPLACE FUNCTION public.reconcile_savings_contribution_evidence"),
    "the same baseline must be checked again before commit",
  );
});
