import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CategoryRecord,
  CategoryWithSubcategories,
  SubcategoryRecord,
} from "@/types";

export type {
  CategoryRecord,
  CategorySelection,
  CategoryWithSubcategories,
  SubcategoryRecord,
} from "@/types";

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

export type CategoryResolution =
  | { status: "matched"; category: CategoryRecord; matchedScope: "system" | "user" }
  | { status: "not_found" | "ambiguous" | "wrong_type" };

export type SubcategoryResolution =
  | { status: "matched"; subcategory: SubcategoryRecord; matchedScope: "system" | "user" }
  | { status: "not_found" | "ambiguous" | "invalid_parent" };

export type SubcategoryAssignmentValidation =
  | { status: "matched"; subcategory: SubcategoryRecord }
  | { status: "valid"; subcategory: null }
  | { status: "not_found" | "ambiguous" | "invalid_parent" | "wrong_type" };

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

export function isCanonicalSystemSubcategory(subcategory: SubcategoryRecord): boolean {
  return subcategory.is_system === true
    && subcategory.user_id === null
    && typeof subcategory.system_key === "string"
    && subcategory.system_key.length > 0;
}

export function isOwnedCustomSubcategory(
  subcategory: SubcategoryRecord,
  userId: string,
): boolean {
  return subcategory.is_system === false
    && subcategory.user_id === userId
    && subcategory.system_key === null;
}

export function getCategoriesVisibleToUser(
  categories: CategoryRecord[],
  userId: string,
): CategoryRecord[] {
  return categories.filter((category) =>
    isCanonicalSystemCategory(category) || isOwnedCustomCategory(category, userId),
  );
}

export function getSubcategoriesVisibleToUser(
  subcategories: SubcategoryRecord[],
  userId: string,
): SubcategoryRecord[] {
  return subcategories.filter((subcategory) =>
    isCanonicalSystemSubcategory(subcategory)
      || isOwnedCustomSubcategory(subcategory, userId),
  );
}

export function getSubcategoriesForParentFromRows(
  subcategories: SubcategoryRecord[],
  categoryId: string,
  userId: string,
): SubcategoryRecord[] {
  return getSubcategoriesVisibleToUser(subcategories, userId).filter(
    (subcategory) => subcategory.category_id === categoryId,
  );
}

export function groupSubcategoriesByParent(
  subcategories: SubcategoryRecord[],
): Record<string, SubcategoryRecord[]> {
  return subcategories.reduce<Record<string, SubcategoryRecord[]>>((groups, subcategory) => {
    (groups[subcategory.category_id] ||= []).push(subcategory);
    return groups;
  }, {});
}

export function buildCategoryHierarchy(
  categories: CategoryRecord[],
  subcategories: SubcategoryRecord[],
): CategoryWithSubcategories[] {
  const grouped = groupSubcategoriesByParent(subcategories);
  return categories.map((category) => ({
    category,
    subcategories: grouped[category.id] || [],
  }));
}

export function isValidSubcategoryParentFromRows({
  categories,
  userId,
  categoryId,
}: {
  categories: CategoryRecord[];
  userId: string;
  categoryId: string;
}): boolean {
  return getCategoriesVisibleToUser(categories, userId).some(
    (category) => category.id === categoryId,
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

/**
 * Resolves an exact child name only inside an ownership-safe parent. An owner's
 * custom child takes precedence over a same-name system child. Duplicate rows in
 * the preferred scope remain ambiguous instead of being selected arbitrarily.
 */
export function resolveSubcategoryFromRows({
  subcategories,
  categories,
  userId,
  categoryId,
  name,
}: {
  subcategories: SubcategoryRecord[];
  categories: CategoryRecord[];
  userId: string;
  categoryId: string;
  name: string;
}): SubcategoryResolution {
  if (!isValidSubcategoryParentFromRows({ categories, userId, categoryId })) {
    return { status: "invalid_parent" };
  }

  const normalizedName = normalizeCategoryName(name);
  const matches = getSubcategoriesForParentFromRows(
    subcategories,
    categoryId,
    userId,
  ).filter(
    (subcategory) => normalizeCategoryName(subcategory.name) === normalizedName,
  );

  if (matches.length === 0) return { status: "not_found" };
  const ownedMatches = matches.filter((subcategory) =>
    isOwnedCustomSubcategory(subcategory, userId),
  );
  const preferredMatches = ownedMatches.length > 0
    ? ownedMatches
    : matches.filter(isCanonicalSystemSubcategory);

  if (preferredMatches.length !== 1) return { status: "ambiguous" };
  const subcategory = preferredMatches[0];
  return {
    status: "matched",
    subcategory,
    matchedScope: isCanonicalSystemSubcategory(subcategory) ? "system" : "user",
  };
}

/** Validates an optional transaction subcategory assignment against its parent. */
export function validateSubcategoryAssignmentFromRows({
  subcategories,
  categories,
  userId,
  categoryId,
  subcategoryId,
  type,
}: {
  subcategories: SubcategoryRecord[];
  categories: CategoryRecord[];
  userId: string;
  categoryId: string;
  subcategoryId?: string | null;
  type?: TransactionType;
}): SubcategoryAssignmentValidation {
  const parentMatches = getCategoriesVisibleToUser(categories, userId).filter(
    (category) => category.id === categoryId,
  );
  if (parentMatches.length === 0) return { status: "invalid_parent" };
  if (parentMatches.length !== 1) return { status: "ambiguous" };
  if (!hasCompatibleType(parentMatches[0], type)) return { status: "wrong_type" };
  if (subcategoryId == null) return { status: "valid", subcategory: null };

  const childMatches = getSubcategoriesVisibleToUser(subcategories, userId).filter(
    (subcategory) => subcategory.id === subcategoryId,
  );
  if (childMatches.length === 0) return { status: "not_found" };
  if (childMatches.length !== 1) return { status: "ambiguous" };
  if (childMatches[0].category_id !== categoryId) return { status: "invalid_parent" };
  return { status: "matched", subcategory: childMatches[0] };
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

const VISIBLE_SUBCATEGORY_COLUMNS =
  "id, category_id, user_id, name, is_system, system_key, icon_name, color_hex, created_at";

export async function listVisibleSubcategoriesForUser(
  supabase: CategoryClient,
  userId: string,
): Promise<SubcategoryRecord[]> {
  const { data, error } = await supabase
    .from("subcategories")
    .select(VISIBLE_SUBCATEGORY_COLUMNS)
    .or(`and(is_system.eq.true,user_id.is.null),and(is_system.eq.false,user_id.eq.${userId})`)
    .order("name", { ascending: true });

  if (error) throw error;
  return getSubcategoriesVisibleToUser((data || []) as SubcategoryRecord[], userId);
}

export async function listSubcategoriesForParent(
  supabase: CategoryClient,
  categoryId: string,
  userId: string,
): Promise<SubcategoryRecord[]> {
  const { data, error } = await supabase
    .from("subcategories")
    .select(VISIBLE_SUBCATEGORY_COLUMNS)
    .eq("category_id", categoryId)
    .or(`and(is_system.eq.true,user_id.is.null),and(is_system.eq.false,user_id.eq.${userId})`)
    .order("name", { ascending: true });

  if (error) throw error;
  return getSubcategoriesForParentFromRows(
    (data || []) as SubcategoryRecord[],
    categoryId,
    userId,
  );
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

export async function resolveSubcategoryForUser({
  supabase,
  userId,
  categoryId,
  name,
}: {
  supabase: CategoryClient;
  userId: string;
  categoryId: string;
  name: string;
}): Promise<SubcategoryResolution> {
  const [categories, subcategories] = await Promise.all([
    listCategoriesForUser(supabase, userId),
    listSubcategoriesForParent(supabase, categoryId, userId),
  ]);
  return resolveSubcategoryFromRows({
    subcategories,
    categories,
    userId,
    categoryId,
    name,
  });
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
