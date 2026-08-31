import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Temporary display-name compatibility mapping.
 *
 * These names are not stable semantic identities. A future reviewed migration may
 * replace them with a system_key after the live catalog has been canonicalized.
 */
export const SYSTEM_CATEGORY_NAMES = {
  OTHER: "Lain-lain",
  SAVING: "Nabung",
  ADMIN_FEE: "Biaya Admin",
  TRANSFER: "Transfer",
} as const;

export type TransactionType = "INCOME" | "EXPENSE";

export type CategoryRecord = {
  id: string;
  user_id: string | null;
  name: string;
  type: string;
  is_system: boolean;
};

export type CategoryResolution =
  | { status: "matched"; category: CategoryRecord; matchedScope: "system" | "user" }
  | { status: "not_found" | "ambiguous" | "wrong_type" };

type CategoryClient = Pick<SupabaseClient, "from">;

export function normalizeCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}

export function getKnownSystemCategoryName(value: string): string | null {
  const normalizedValue = normalizeCategoryName(value);
  return Object.values(SYSTEM_CATEGORY_NAMES).find(
    (name) => normalizeCategoryName(name) === normalizedValue,
  ) || null;
}

export function isCanonicalSystemCategory(category: CategoryRecord): boolean {
  return category.is_system === true && category.user_id === null;
}

export function isOwnedCustomCategory(category: CategoryRecord, userId: string): boolean {
  return category.is_system === false && category.user_id === userId;
}

export function getCategoriesVisibleToUser(
  categories: CategoryRecord[],
  userId: string,
): CategoryRecord[] {
  return categories.filter((category) =>
    isCanonicalSystemCategory(category) || isOwnedCustomCategory(category, userId),
  );
}

function hasCompatibleType(category: CategoryRecord, type?: TransactionType): boolean {
  return !type || category.type.toUpperCase() === type;
}

function resolvePreferredScope(
  candidates: CategoryRecord[],
  userId: string,
): CategoryResolution {
  const ownedCandidates = candidates.filter((category) => isOwnedCustomCategory(category, userId));
  const preferredCandidates = ownedCandidates.length > 0
    ? ownedCandidates
    : candidates.filter(isCanonicalSystemCategory);

  if (preferredCandidates.length !== 1) return { status: "ambiguous" };
  const category = preferredCandidates[0];
  return {
    status: "matched",
    category,
    matchedScope: isCanonicalSystemCategory(category) ? "system" : "user",
  };
}

/**
 * Resolves an exact, ownership-safe category name. An owner's compatible custom
 * category takes precedence over a system category with the same display name.
 */
export function resolveCategoryFromRows({
  categories,
  userId,
  name,
  type,
}: {
  categories: CategoryRecord[];
  userId: string;
  name: string;
  type?: TransactionType;
}): CategoryResolution {
  const normalizedName = normalizeCategoryName(name);
  const nameMatches = getCategoriesVisibleToUser(categories, userId).filter(
    (category) => normalizeCategoryName(category.name) === normalizedName,
  );

  if (nameMatches.length === 0) return { status: "not_found" };
  const compatibleMatches = nameMatches.filter((category) => hasCompatibleType(category, type));
  if (compatibleMatches.length === 0) return { status: "wrong_type" };
  return resolvePreferredScope(compatibleMatches, userId);
}

export function resolveCategoryIdFromRows({
  categories,
  userId,
  categoryId,
  type,
}: {
  categories: CategoryRecord[];
  userId: string;
  categoryId: string;
  type?: TransactionType;
}): CategoryResolution {
  const idMatches = getCategoriesVisibleToUser(categories, userId).filter(
    (category) => category.id === categoryId,
  );
  if (idMatches.length === 0) return { status: "not_found" };
  const compatibleMatches = idMatches.filter((category) => hasCompatibleType(category, type));
  if (compatibleMatches.length === 0) return { status: "wrong_type" };
  if (compatibleMatches.length !== 1) return { status: "ambiguous" };
  return {
    status: "matched",
    category: compatibleMatches[0],
    matchedScope: isCanonicalSystemCategory(compatibleMatches[0]) ? "system" : "user",
  };
}

/** Resolves only canonical system rows; same-name custom rows are never candidates. */
export function resolveSystemCategoryFromRows(
  categories: CategoryRecord[],
  name: string,
  type?: TransactionType,
): CategoryResolution {
  const normalizedName = normalizeCategoryName(name);
  const nameMatches = categories.filter(
    (category) => isCanonicalSystemCategory(category)
      && normalizeCategoryName(category.name) === normalizedName,
  );
  if (nameMatches.length === 0) return { status: "not_found" };
  const compatibleMatches = nameMatches.filter((category) => hasCompatibleType(category, type));
  if (compatibleMatches.length === 0) return { status: "wrong_type" };
  if (compatibleMatches.length !== 1) return { status: "ambiguous" };
  return { status: "matched", category: compatibleMatches[0], matchedScope: "system" };
}

export async function listCategoriesForUser(
  supabase: CategoryClient,
  userId: string,
): Promise<CategoryRecord[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, user_id, name, type, is_system")
    .or(`user_id.eq.${userId},and(is_system.eq.true,user_id.is.null)`);

  if (error) throw error;
  return getCategoriesVisibleToUser((data || []) as CategoryRecord[], userId);
}

export async function resolveCategoryForUser({
  supabase,
  userId,
  name,
  type,
}: {
  supabase: CategoryClient;
  userId: string;
  name: string;
  type?: TransactionType;
}): Promise<CategoryResolution> {
  const categories = await listCategoriesForUser(supabase, userId);
  return resolveCategoryFromRows({ categories, userId, name, type });
}

export async function resolveSystemCategory({
  supabase,
  name,
  type,
}: {
  supabase: CategoryClient;
  name: string;
  type?: TransactionType;
}): Promise<CategoryResolution> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, user_id, name, type, is_system")
    .eq("is_system", true)
    .is("user_id", null);

  if (error) throw error;
  return resolveSystemCategoryFromRows((data || []) as CategoryRecord[], name, type);
}
