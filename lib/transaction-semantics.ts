import type { CategoryRecord, TransactionKind } from "../types";

export type { TransactionKind } from "../types";

export const TRANSACTION_KINDS = [
  "ORDINARY",
  "TRANSFER",
  "SAVING",
  "FEE",
] as const satisfies readonly TransactionKind[];

type SemanticCategory = Pick<
  CategoryRecord,
  "id" | "user_id" | "name" | "type" | "is_system"
>;

type TransactionKindInput = unknown;

const CANONICAL_SEMANTIC_CATEGORY_NAMES = {
  SAVING: "Nabung",
  ADMIN_FEE: "Biaya Admin",
} as const;

export const TRUSTED_SAVINGS_CONTEXTS = [
  "EXPLICIT_SAVINGS_FEATURE",
  "FONNTE_EXPLICIT_GOAL",
  "RESEND_DETERMINISTIC_GOAL",
] as const;

export type TrustedSavingsContext = typeof TRUSTED_SAVINGS_CONTEXTS[number];

function normalizeSemanticCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}

export function isTransactionKind(value: unknown): value is TransactionKind {
  return typeof value === "string"
    && (TRANSACTION_KINDS as readonly string[]).includes(value);
}

function isCanonicalCategoryNamed(category: SemanticCategory, name: string): boolean {
  return category.is_system === true
    && category.user_id === null
    && normalizeSemanticCategoryName(category.name) === normalizeSemanticCategoryName(name);
}

export function isTrustedSavingsContext(value: unknown): value is TrustedSavingsContext {
  return typeof value === "string"
    && (TRUSTED_SAVINGS_CONTEXTS as readonly string[]).includes(value);
}

export function isCanonicalSavingCategory(
  category?: SemanticCategory | null,
): boolean {
  return !!category
    && isCanonicalCategoryNamed(category, CANONICAL_SEMANTIC_CATEGORY_NAMES.SAVING);
}

/** Category visibility is broader than eligibility in an ordinary transaction picker. */
export function shouldExposeCategoryInOrdinaryTransactionPicker(
  category: SemanticCategory,
): boolean {
  return !isCanonicalSavingCategory(category);
}

/**
 * Semantic kind for ordinary transaction writers. A taxonomy choice alone can
 * never establish savings intent; canonical Transfer remains ordinary too.
 */
export function resolveNormalTransactionKind(
  category?: SemanticCategory | null,
): TransactionKind {
  if (
    category
    && isCanonicalCategoryNamed(category, CANONICAL_SEMANTIC_CATEGORY_NAMES.ADMIN_FEE)
  ) {
    return "FEE";
  }
  return "ORDINARY";
}

/**
 * SAVING requires both a trusted workflow context and the canonical savings
 * category. Callers fall back to ordinary semantics if either proof is absent.
 */
export function resolveTrustedSavingsTransactionKind({
  context,
  category,
}: {
  context: unknown;
  category?: SemanticCategory | null;
}): TransactionKind {
  if (isTrustedSavingsContext(context) && isCanonicalSavingCategory(category)) {
    return "SAVING";
  }
  return resolveNormalTransactionKind(category);
}

type SavingsGoalDestination = {
  storage_detail?: unknown;
};

function normalizeSavingsDestination(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
  return normalized || null;
}

/**
 * Resend savings matching is intentionally strict: exactly one active goal must
 * have a destination equal to a normalized merchant or note. Fuzzy/substring
 * matches are not trusted savings evidence.
 */
export function findDeterministicSavingsGoalMatch<T extends SavingsGoalDestination>({
  goals,
  merchant,
  notes,
}: {
  goals: T[];
  merchant: unknown;
  notes: unknown;
}): T | null {
  const incomingReferences = new Set(
    [merchant, notes]
      .map(normalizeSavingsDestination)
      .filter((value): value is string => value !== null),
  );
  if (incomingReferences.size === 0) return null;

  const matches = goals.filter((goal) => {
    const destination = normalizeSavingsDestination(goal.storage_detail);
    return destination !== null && incomingReferences.has(destination);
  });
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Legacy-compatible semantic inference for stored rows without explicit kind.
 *
 * Do not use this helper for new ordinary writes: canonical Nabung is retained
 * here only so historical NULL rows preserve Phase 4.3 compatibility behavior.
 */
export function determineDefaultTransactionKindForCategory(
  category?: SemanticCategory | null,
): TransactionKind {
  if (
    category
    && isCanonicalCategoryNamed(category, CANONICAL_SEMANTIC_CATEGORY_NAMES.SAVING)
  ) {
    return "SAVING";
  }
  return resolveNormalTransactionKind(category);
}

/** Explicit stored metadata wins; only safe canonical legacy mappings are inferred. */
export function resolveEffectiveTransactionKind({
  transactionKind,
  category,
}: {
  transactionKind: TransactionKindInput;
  category?: SemanticCategory | null;
}): TransactionKind {
  if (isTransactionKind(transactionKind)) return transactionKind;
  return determineDefaultTransactionKindForCategory(category);
}

/**
 * Category changes are semantic mutations. Unrelated edits preserve the stored
 * value, including NULL on legacy rows.
 */
export function resolveTransactionKindForCategoryEdit({
  currentTransactionKind,
  previousCategoryId,
  nextCategory,
}: {
  currentTransactionKind: TransactionKind | null;
  previousCategoryId?: string | null;
  nextCategory: SemanticCategory;
}): TransactionKind | null {
  if (previousCategoryId === nextCategory.id) return currentTransactionKind;
  return resolveNormalTransactionKind(nextCategory);
}

type SavingsCompatibilityTransaction = {
  transaction_kind?: unknown;
  category_id?: unknown;
  merchant?: unknown;
  notes?: unknown;
};

/**
 * Temporary expense-limit compatibility for legacy NULL rows. New explicit
 * metadata takes precedence over the canonical category ID and old text hints.
 */
export function isSavingsTransactionForExpenseCompatibility({
  transaction,
  canonicalSavingCategoryId,
}: {
  transaction: SavingsCompatibilityTransaction;
  canonicalSavingCategoryId?: string | null;
}): boolean {
  if (isTransactionKind(transaction.transaction_kind)) {
    return transaction.transaction_kind === "SAVING";
  }

  if (
    canonicalSavingCategoryId
    && transaction.category_id === canonicalSavingCategoryId
  ) {
    return true;
  }

  const merchant = typeof transaction.merchant === "string"
    ? transaction.merchant.toLocaleLowerCase("id-ID")
    : "";
  const notes = typeof transaction.notes === "string"
    ? transaction.notes.toLocaleLowerCase("id-ID")
    : "";
  return merchant.startsWith("nabung")
    || notes.includes("setoran tabungan")
    || notes.includes("setoran via whatsapp");
}

const LEGACY_INTERNAL_TRANSFER_CATEGORY_NAMES = new Set([
  "pindah saldo",
  "transfer antar rekening",
]);

/**
 * Report compatibility only. Explicit kind wins; NULL legacy rows retain the
 * exact historical name exclusions. Canonical "Transfer" is deliberately absent.
 */
export function isTransferExcludedFromLegacyReport({
  transactionKind,
  categoryName,
}: {
  transactionKind: TransactionKindInput;
  categoryName?: unknown;
}): boolean {
  if (isTransactionKind(transactionKind)) return transactionKind === "TRANSFER";
  if (typeof categoryName !== "string") return false;
  return LEGACY_INTERNAL_TRANSFER_CATEGORY_NAMES.has(
    normalizeSemanticCategoryName(categoryName),
  );
}
