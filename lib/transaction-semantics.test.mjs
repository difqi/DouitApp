import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  determineDefaultTransactionKindForCategory,
  findDeterministicSavingsGoalMatch,
  isCanonicalSavingCategory,
  isSavingsTransactionForExpenseCompatibility,
  isTrustedSavingsContext,
  isTransactionKind,
  isTransferExcludedFromLegacyReport,
  resolveEffectiveTransactionKind,
  resolveNormalTransactionKind,
  resolveTransactionKindForCategoryEdit,
  resolveTrustedSavingsTransactionKind,
  shouldExposeCategoryInOrdinaryTransactionPicker,
  TRANSACTION_KINDS,
  TRUSTED_SAVINGS_CONTEXTS,
} from "./transaction-semantics.ts";

const systemCategory = (id, name, type = "EXPENSE") => ({
  id,
  user_id: null,
  name,
  type,
  is_system: true,
});

const customCategory = (id, name, type = "EXPENSE") => ({
  id,
  user_id: "11111111-1111-4111-8111-111111111111",
  name,
  type,
  is_system: false,
});

const food = systemCategory("food", "Makanan & Minuman");
const fee = systemCategory("fee", "Biaya Admin");
const saving = systemCategory("saving", "Nabung");
const transfer = systemCategory("transfer", "Transfer", "INCOME");

test("transaction kind vocabulary is intentionally small and validated exactly", () => {
  assert.deepEqual(TRANSACTION_KINDS, ["ORDINARY", "TRANSFER", "SAVING", "FEE"]);
  for (const kind of TRANSACTION_KINDS) assert.equal(isTransactionKind(kind), true);
  for (const value of [null, undefined, "", "REFUND", "fee", 1]) {
    assert.equal(isTransactionKind(value), false);
  }
});

test("ordinary system income/expense and child-independent categories default to ORDINARY", () => {
  assert.equal(determineDefaultTransactionKindForCategory(food), "ORDINARY");
  assert.equal(
    determineDefaultTransactionKindForCategory(systemCategory("salary", "Bonus", "INCOME")),
    "ORDINARY",
  );
  assert.equal(determineDefaultTransactionKindForCategory(null), "ORDINARY");
});

test("only canonical Biaya Admin maps to FEE", () => {
  assert.equal(determineDefaultTransactionKindForCategory(fee), "FEE");
  assert.equal(
    determineDefaultTransactionKindForCategory(customCategory("custom-fee", "Biaya Admin")),
    "ORDINARY",
  );
  assert.equal(
    determineDefaultTransactionKindForCategory({ ...fee, user_id: "foreign-owner" }),
    "ORDINARY",
  );
});

test("legacy inference keeps only canonical Nabung as SAVING without creating structural linkage", () => {
  assert.equal(determineDefaultTransactionKindForCategory(saving), "SAVING");
  assert.equal(
    determineDefaultTransactionKindForCategory(customCategory("custom-saving", "Nabung")),
    "ORDINARY",
  );
});

test("ordinary writers never derive SAVING from category selection", () => {
  assert.equal(resolveNormalTransactionKind(saving), "ORDINARY");
  assert.equal(resolveNormalTransactionKind(customCategory("custom-saving", "Nabung")), "ORDINARY");
  assert.equal(resolveNormalTransactionKind(food), "ORDINARY");
  assert.equal(resolveNormalTransactionKind(fee), "FEE");
  assert.equal(resolveNormalTransactionKind(transfer), "ORDINARY");
});

test("trusted SAVING requires an allowlisted context and canonical category", () => {
  assert.deepEqual(TRUSTED_SAVINGS_CONTEXTS, [
    "EXPLICIT_SAVINGS_FEATURE",
    "FONNTE_EXPLICIT_GOAL",
    "RESEND_DETERMINISTIC_GOAL",
  ]);
  for (const context of TRUSTED_SAVINGS_CONTEXTS) {
    assert.equal(isTrustedSavingsContext(context), true);
    assert.equal(resolveTrustedSavingsTransactionKind({ context, category: saving }), "SAVING");
  }
  assert.equal(isTrustedSavingsContext("GENERIC_CATEGORY_SELECTION"), false);
  assert.equal(resolveTrustedSavingsTransactionKind({
    context: "GENERIC_CATEGORY_SELECTION",
    category: saving,
  }), "ORDINARY");
  assert.equal(resolveTrustedSavingsTransactionKind({
    context: "FONNTE_EXPLICIT_GOAL",
    category: customCategory("custom-saving", "Nabung"),
  }), "ORDINARY");
});

test("canonical Nabung visibility is separate from ordinary picker eligibility", () => {
  assert.equal(isCanonicalSavingCategory(saving), true);
  assert.equal(shouldExposeCategoryInOrdinaryTransactionPicker(saving), false);
  assert.equal(isCanonicalSavingCategory(customCategory("custom-saving", "Nabung")), false);
  assert.equal(
    shouldExposeCategoryInOrdinaryTransactionPicker(customCategory("custom-saving", "Nabung")),
    true,
  );
  assert.equal(shouldExposeCategoryInOrdinaryTransactionPicker(fee), true);
});

test("Resend goal evidence must be an exact normalized unique destination match", () => {
  const goals = [
    { id: "laptop", storage_detail: "Toko Laptop Resmi" },
    { id: "bike", storage_detail: "Sepeda Kita" },
  ];
  assert.equal(findDeterministicSavingsGoalMatch({
    goals,
    merchant: "  TOKO   laptop resmi ",
    notes: null,
  })?.id, "laptop");
  assert.equal(findDeterministicSavingsGoalMatch({
    goals,
    merchant: "Pembayaran Toko Laptop Resmi",
    notes: null,
  }), null);
  assert.equal(findDeterministicSavingsGoalMatch({
    goals: [...goals, { id: "duplicate", storage_detail: "Toko Laptop Resmi" }],
    merchant: "Toko Laptop Resmi",
    notes: null,
  }), null);
});

test("canonical and custom Transfer remain ORDINARY while ambiguity is unresolved", () => {
  assert.equal(determineDefaultTransactionKindForCategory(transfer), "ORDINARY");
  assert.equal(
    determineDefaultTransactionKindForCategory(customCategory("custom-transfer", "Transfer")),
    "ORDINARY",
  );
});

test("explicit stored metadata precedes compatibility category mapping", () => {
  assert.equal(resolveEffectiveTransactionKind({ transactionKind: "ORDINARY", category: fee }), "ORDINARY");
  assert.equal(resolveEffectiveTransactionKind({ transactionKind: "FEE", category: food }), "FEE");
  assert.equal(resolveEffectiveTransactionKind({ transactionKind: null, category: fee }), "FEE");
  assert.equal(resolveEffectiveTransactionKind({ transactionKind: null, category: saving }), "SAVING");
  assert.equal(resolveEffectiveTransactionKind({ transactionKind: null, category: transfer }), "ORDINARY");
});

test("unrelated edits preserve kind and parent changes derive the safe next kind", () => {
  assert.equal(resolveTransactionKindForCategoryEdit({
    currentTransactionKind: "FEE",
    previousCategoryId: fee.id,
    nextCategory: fee,
  }), "FEE");
  assert.equal(resolveTransactionKindForCategoryEdit({
    currentTransactionKind: null,
    previousCategoryId: fee.id,
    nextCategory: fee,
  }), null);
  assert.equal(resolveTransactionKindForCategoryEdit({
    currentTransactionKind: "ORDINARY",
    previousCategoryId: food.id,
    nextCategory: fee,
  }), "FEE");
  assert.equal(resolveTransactionKindForCategoryEdit({
    currentTransactionKind: "FEE",
    previousCategoryId: fee.id,
    nextCategory: food,
  }), "ORDINARY");
  assert.equal(resolveTransactionKindForCategoryEdit({
    currentTransactionKind: "SAVING",
    previousCategoryId: saving.id,
    nextCategory: saving,
  }), "SAVING");
  assert.equal(resolveTransactionKindForCategoryEdit({
    currentTransactionKind: "SAVING",
    previousCategoryId: saving.id,
    nextCategory: food,
  }), "ORDINARY");
});

test("savings expense compatibility gives explicit metadata precedence", () => {
  assert.equal(isSavingsTransactionForExpenseCompatibility({
    transaction: { transaction_kind: "SAVING", category_id: "food" },
    canonicalSavingCategoryId: saving.id,
  }), true);
  assert.equal(isSavingsTransactionForExpenseCompatibility({
    transaction: { transaction_kind: "ORDINARY", category_id: saving.id, merchant: "Nabung test" },
    canonicalSavingCategoryId: saving.id,
  }), false);
  assert.equal(isSavingsTransactionForExpenseCompatibility({
    transaction: { transaction_kind: null, category_id: saving.id },
    canonicalSavingCategoryId: saving.id,
  }), true);
  assert.equal(isSavingsTransactionForExpenseCompatibility({
    transaction: { transaction_kind: null, merchant: "Nabung target" },
  }), true);
  assert.equal(isSavingsTransactionForExpenseCompatibility({
    transaction: { transaction_kind: null, notes: "Setoran tabungan manual" },
  }), true);
});

test("report transfer resolution preserves NULL-row names but never assumes canonical Transfer", () => {
  assert.equal(isTransferExcludedFromLegacyReport({ transactionKind: null, categoryName: "Pindah Saldo" }), true);
  assert.equal(isTransferExcludedFromLegacyReport({ transactionKind: null, categoryName: "transfer antar rekening" }), true);
  assert.equal(isTransferExcludedFromLegacyReport({ transactionKind: null, categoryName: "Transfer" }), false);
  assert.equal(isTransferExcludedFromLegacyReport({ transactionKind: "ORDINARY", categoryName: "Pindah Saldo" }), false);
  assert.equal(isTransferExcludedFromLegacyReport({ transactionKind: "TRANSFER", categoryName: "Makanan" }), true);
});

test("all transaction writers use context-specific application policy without Gemini schema changes", async () => {
  const [manual, workspace, chat, resend, fonnte, chatRoute] = await Promise.all([
    readFile(new URL("../app/components/TransactionCreateModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/WorkspaceViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/chat/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/webhook/resend/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/fonnte/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(manual, /transaction_kind: resolveNormalTransactionKind\(safeCategory\)/);
  assert.match(workspace, /nextTransactionKind = resolveTransactionKindForCategoryEdit\(/);
  assert.match(workspace, /categoryChanged[\s\S]*?transaction_kind: nextTransactionKind/);
  assert.match(chat, /txPayload\.transaction_kind = resolveNormalTransactionKind\(safeCategory\)/);
  assert.match(chat, /transaction_kind: 'FEE'/);
  assert.match(resend, /findDeterministicSavingsGoalMatch\(/);
  assert.match(resend, /reconcile_savings_contribution_evidence/);
  assert.match(resend, /p_external_event_id: operationKey/);
  assert.match(resend, /transaction_kind: resolveNormalTransactionKind\(/);
  assert.match(resend, /transaction_kind: 'FEE'/);
  assert.match(fonnte, /record_savings_contribution_as_service/);
  assert.match(fonnte, /p_recording_method: 'MANUAL_WHATSAPP'/);
  assert.doesNotMatch(chatRoute, /transaction_kind/);
});

test("administrative category reassignment and unrelated account edits do not rewrite kind", async () => {
  const [settings, wallet] = await Promise.all([
    readFile(new URL("../app/(dashboard)/settings/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/dompet/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(settings, /\.update\(\{ category_id: lainLain\.id \}\)/);
  assert.doesNotMatch(settings, /transaction_kind/);
  assert.match(wallet, /\.update\(\{[\s\S]*?sumber_dana: newAccount\.name,[\s\S]*?notes: nextNotes \|\| null/);
  assert.doesNotMatch(wallet, /transaction_kind/);
});

test("schema migration is nullable, constrained, and contains no historical UPDATE", async () => {
  const migration = await readFile(
    new URL("../supabase_migration_phase4_3_transaction_semantics.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS transaction_kind TEXT NULL/);
  assert.match(migration, /transaction_kind IN \('ORDINARY', 'TRANSFER', 'SAVING', 'FEE'\)/);
  assert.doesNotMatch(migration, /UPDATE\s+public\.transactions/i);
  assert.doesNotMatch(migration, /SET\s+transaction_kind/i);
});
