const FALLBACK_CATEGORY_NAME = "Lain-lain";
const MISSING_CATEGORY_KEY = "__missing_parent_category__";

export type ParentCategoryTransaction = {
  amount?: unknown;
  type?: unknown;
  status?: unknown;
  category_id?: unknown;
  category?: unknown;
  categories?: unknown;
};

export type ParentCategoryBudget = {
  id: string;
  name?: unknown;
  budget_limit?: unknown;
};

export type ParentCategoryAggregation = {
  key: string;
  categoryId: string | null;
  name: string;
  income: number;
  expense: number;
  net: number;
  count: number;
  budget: number;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getRelationCategoryName(relation: unknown): string {
  const candidate = Array.isArray(relation) ? relation[0] : relation;
  if (!candidate || typeof candidate !== "object") return "";
  return normalizeText((candidate as { name?: unknown }).name);
}

export function getParentCategoryId(transaction: ParentCategoryTransaction): string | null {
  return normalizeText(transaction.category_id) || null;
}

export function getParentCategoryKey(transaction: ParentCategoryTransaction): string {
  return getParentCategoryId(transaction) || MISSING_CATEGORY_KEY;
}

export function getParentCategoryName(transaction: ParentCategoryTransaction): string {
  return normalizeText(transaction.category)
    || getRelationCategoryName(transaction.categories)
    || FALLBACK_CATEGORY_NAME;
}

/**
 * Aggregates approved transactions exactly once under transactions.category_id.
 * Child metadata is intentionally ignored: it is descriptive taxonomy detail,
 * never an additional financial amount or transaction type signal.
 */
export function aggregateApprovedTransactionsByParentCategory(
  transactions: ParentCategoryTransaction[],
  categories: ParentCategoryBudget[] = [],
): ParentCategoryAggregation[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const totals = new Map<string, ParentCategoryAggregation>();

  for (const transaction of transactions) {
    if (transaction.status !== "APPROVED") continue;
    if (transaction.type !== "INCOME" && transaction.type !== "EXPENSE") continue;

    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount)) continue;

    const categoryId = getParentCategoryId(transaction);
    const key = getParentCategoryKey(transaction);
    const category = categoryId ? categoryById.get(categoryId) : undefined;
    const name = normalizeText(category?.name) || getParentCategoryName(transaction);
    const budget = Number(category?.budget_limit) || 0;
    const current = totals.get(key) || {
      key,
      categoryId,
      name,
      income: 0,
      expense: 0,
      net: 0,
      count: 0,
      budget,
    };

    if (transaction.type === "INCOME") {
      current.income += amount;
      current.net += amount;
    } else {
      current.expense += amount;
      current.net -= amount;
    }
    current.count += 1;
    totals.set(key, current);
  }

  return [...totals.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/** Parent filters include parent-only, system-child, and owned custom-child rows. */
export function filterTransactionsByParentCategory<T extends ParentCategoryTransaction>(
  transactions: T[],
  categoryId: string,
): T[] {
  return transactions.filter((transaction) => getParentCategoryId(transaction) === categoryId);
}

export function calculateParentBudgetUsage(spent: number, budget: number) {
  const safeSpent = Number(spent) || 0;
  const safeBudget = Number(budget) || 0;
  return {
    spent: safeSpent,
    remaining: Math.max(safeBudget - safeSpent, 0),
    usagePercentage: safeBudget > 0 ? (safeSpent / safeBudget) * 100 : 0,
  };
}
