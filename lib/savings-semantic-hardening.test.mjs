import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getCategoriesVisibleToUser, resolveSystemCategoryFromRows } from "./categories.ts";
import {
  resolveNormalTransactionKind,
  resolveTransactionKindForCategoryEdit,
  resolveTrustedSavingsTransactionKind,
  shouldExposeCategoryInOrdinaryTransactionPicker,
} from "./transaction-semantics.ts";

const ownerId = "11111111-1111-4111-8111-111111111111";
const canonicalSaving = {
  id: "system-saving",
  user_id: null,
  name: "Nabung",
  type: "EXPENSE",
  is_system: true,
};
const customSaving = {
  id: "custom-saving",
  user_id: ownerId,
  name: "Nabung",
  type: "EXPENSE",
  is_system: false,
};
const food = {
  id: "system-food",
  user_id: null,
  name: "Makanan & Minuman",
  type: "EXPENSE",
  is_system: true,
};
const fee = {
  id: "system-fee",
  user_id: null,
  name: "Biaya Admin",
  type: "EXPENSE",
  is_system: true,
};

const [createSource, workspaceSource, settingsSource, chatSource, resendSource, fonnteSource, savingsSource, reminderSource, reconciliationSource] = await Promise.all([
  readFile(new URL("../app/components/TransactionCreateModal.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/WorkspaceViews.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/(dashboard)/settings/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/(dashboard)/chat/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/webhook/resend/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/fonnte/webhook/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/(dashboard)/nabung/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/cron/savings-reminder/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/cron/savings-reconciliation/route.ts", import.meta.url), "utf8"),
]);

test("canonical Nabung remains globally visible and resolvable but is not ordinary-selectable", () => {
  assert.deepEqual(getCategoriesVisibleToUser([canonicalSaving], ownerId), [canonicalSaving]);
  const resolved = resolveSystemCategoryFromRows([canonicalSaving], "Nabung", "EXPENSE");
  assert.equal(resolved.status, "matched");
  assert.equal(shouldExposeCategoryInOrdinaryTransactionPicker(canonicalSaving), false);
  assert.match(settingsSource, /setCategories\(cats\.map\(\(category\) => \(\{/);
  assert.doesNotMatch(settingsSource, /shouldExposeCategoryInOrdinaryTransactionPicker/);
});

test("same-name custom Nabung remains ordinary-selectable and never gains trusted semantics", () => {
  assert.equal(shouldExposeCategoryInOrdinaryTransactionPicker(customSaving), true);
  assert.equal(resolveNormalTransactionKind(customSaving), "ORDINARY");
  assert.equal(resolveTrustedSavingsTransactionKind({
    context: "EXPLICIT_SAVINGS_FEATURE",
    category: customSaving,
  }), "ORDINARY");
});

test("ordinary kinds retain canonical fee and Transfer behavior while blocking SAVING", () => {
  assert.equal(resolveNormalTransactionKind(food), "ORDINARY");
  assert.equal(resolveNormalTransactionKind(fee), "FEE");
  assert.equal(resolveNormalTransactionKind({
    ...food,
    id: "system-transfer",
    name: "Transfer",
  }), "ORDINARY");
  assert.equal(resolveNormalTransactionKind(canonicalSaving), "ORDINARY");
});

test("manual create picker and payload enforce ordinary eligibility server-side at submit time", () => {
  assert.match(createSource, /\.filter\(\(category\) =>[\s\S]*?shouldExposeCategoryInOrdinaryTransactionPicker\(category\)/);
  assert.match(createSource, /if \(!shouldExposeCategoryInOrdinaryTransactionPicker\(safeCategory\)\)/);
  assert.match(createSource, /transaction_kind: resolveNormalTransactionKind\(safeCategory\)/);
  assert.doesNotMatch(createSource, /resolveTrustedSavingsTransactionKind/);
});

test("manual edit keeps the current legacy category only until the user changes away", () => {
  assert.match(workspaceSource, /category\.id === editRow\.category_id[\s\S]*?editCategoryId === editRow\.category_id/);
  assert.match(workspaceSource, /categoryChanged && !shouldExposeCategoryInOrdinaryTransactionPicker\(safeCategory\)/);
  assert.equal(resolveTransactionKindForCategoryEdit({
    currentTransactionKind: "SAVING",
    previousCategoryId: canonicalSaving.id,
    nextCategory: canonicalSaving,
  }), "SAVING");
  assert.equal(resolveTransactionKindForCategoryEdit({
    currentTransactionKind: "SAVING",
    previousCategoryId: canonicalSaving.id,
    nextCategory: food,
  }), "ORDINARY");
  assert.equal(resolveTransactionKindForCategoryEdit({
    currentTransactionKind: "ORDINARY",
    previousCategoryId: food.id,
    nextCategory: canonicalSaving,
  }), "ORDINARY");
  assert.match(workspaceSource, /categoryChanged[\s\S]*?transaction_kind: nextTransactionKind/);
});

test("historical Nabung remains readable through normal category display code", () => {
  assert.match(workspaceSource, /category: \(d\.categories as any\)\?\.name \|\| 'Lain-lain'/);
  assert.match(workspaceSource, /formatTransactionCategoryLabel\(row\.category, row\.subcategory\?\.name\)/);
});

test("generic chat uses ordinary policy and does not claim a savings workflow", () => {
  assert.match(chatSource, /txPayload\.transaction_kind = resolveNormalTransactionKind\(safeCategory\)/);
  assert.doesNotMatch(chatSource, /resolveTrustedSavingsTransactionKind|EXPLICIT_SAVINGS_FEATURE/);
});

test("Resend trusts only deterministic goal matching and otherwise uses ordinary semantics", () => {
  assert.match(resendSource, /matchedGoal = findDeterministicSavingsGoalMatch\(/);
  assert.match(resendSource, /reconcile_savings_contribution_evidence/);
  assert.match(resendSource, /p_external_event_id: operationKey/);
  assert.match(resendSource, /transaction_kind: resolveNormalTransactionKind\(/);
  assert.doesNotMatch(resendSource, /isMerchantMatch|getMerchantSimilarityScore|calculateSimilarity/);
});

test("explicit Fonnte Nabung uses the trusted atomic savings workflow", () => {
  assert.match(fonnteSource, /if \(\/\^nabung\\b\/i\.test\(messageText\)\)/);
  assert.match(fonnteSource, /record_savings_contribution_as_service/);
  assert.match(fonnteSource, /p_recording_method: 'MANUAL_WHATSAPP'/);
  assert.match(fonnteSource, /p_evidence_level: 'USER_CONFIRMED'/);
  assert.doesNotMatch(fonnteSource, /from\('savings_logs'\)\.insert\(/);
});

test("quick deposit uses the atomic RPC and cron jobs create no transactions", () => {
  const quickDepositStart = savingsSource.indexOf("const handleQuickDeposit");
  const quickDepositEnd = savingsSource.indexOf("const handleDeleteGoal", quickDepositStart);
  const quickDeposit = savingsSource.slice(quickDepositStart, quickDepositEnd);
  assert.match(quickDeposit, /record_savings_contribution/);
  assert.doesNotMatch(quickDeposit, /from\('savings_logs'\)\.insert|from\('savings_goals'\)[\s\S]*?\.update/);
  assert.doesNotMatch(reminderSource, /from\('transactions'\)\s*\.insert\(/);
  assert.doesNotMatch(reconciliationSource, /from\('transactions'\)\s*\.insert\(/);
});
