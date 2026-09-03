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

export const SUBCATEGORY_NAME_MAX_LENGTH = 80;

/**
 * Canonical system parents whose semantics are not ready for user-defined
 * children. Match both the system invariant and the display name so an owned
 * custom category with the same label remains eligible.
 */
export const BLOCKED_SYSTEM_SUBCATEGORY_PARENT_NAMES = [
  "Transfer",
  "Nabung",
  "Biaya Admin",
  "Lain-lain",
  "Bonus",
] as const;

export type SubcategoryParentEligibility =
  | { status: "eligible"; parent: CategoryRecord }
  | { status: "invalid_parent" | "blocked_parent" };

export type CustomSubcategoryValidation =
  | { status: "valid"; name: string; parent: CategoryRecord; subcategory?: SubcategoryRecord }
  | {
      status:
        | "empty_name"
        | "name_too_long"
        | "invalid_parent"
        | "blocked_parent"
        | "duplicate_name"
        | "forbidden";
    };

export type CustomSubcategoryInsertPayload = {
  category_id: string;
  user_id: string;
  name: string;
  is_system: false;
  system_key: null;
  icon_name: string | null;
  color_hex: string | null;
};

export type CustomSubcategoryUpdatePayload = Pick<
  CustomSubcategoryInsertPayload,
  "name" | "icon_name" | "color_hex"
>;

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

export type HierarchicalCategoryResolution =
  | {
      status: "matched";
      category: CategoryRecord;
      subcategory: SubcategoryRecord | null;
      categorySource: "model" | "trusted_override";
      subcategoryStatus: "matched" | "omitted" | "cleared_not_found" | "cleared_ambiguous" | "cleared_invalid_parent";
    }
  | { status: "not_found" | "ambiguous" | "wrong_type" };

type CategoryClient = Pick<SupabaseClient, "from">;

export function normalizeCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}

export function normalizeSubcategoryDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateSubcategoryName(
  value: string,
): { status: "valid"; name: string } | { status: "empty_name" | "name_too_long" } {
  const name = normalizeSubcategoryDisplayName(value);
  if (!name) return { status: "empty_name" };
  if (name.length > SUBCATEGORY_NAME_MAX_LENGTH) return { status: "name_too_long" };
  return { status: "valid", name };
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

export function canManageSubcategory(
  subcategory: SubcategoryRecord,
  userId: string,
): boolean {
  return isOwnedCustomSubcategory(subcategory, userId);
}

export function isBlockedSystemSubcategoryParent(category: CategoryRecord): boolean {
  if (!isCanonicalSystemCategory(category)) return false;
  const normalizedName = normalizeCategoryName(category.name);
  return BLOCKED_SYSTEM_SUBCATEGORY_PARENT_NAMES.some(
    (name) => normalizeCategoryName(name) === normalizedName,
  );
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

function isSubcategoryRecord(value: unknown): value is SubcategoryRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.category_id === "string"
    && (typeof row.user_id === "string" || row.user_id === null)
    && typeof row.name === "string"
    && typeof row.is_system === "boolean"
    && (typeof row.system_key === "string" || row.system_key === null)
    && (typeof row.icon_name === "string" || row.icon_name === null)
    && (typeof row.color_hex === "string" || row.color_hex === null)
    && typeof row.created_at === "string";
}

/**
 * Normalizes Supabase to-one relation shapes and accepts only the exact child
 * assigned to this transaction, with canonical system/owner visibility.
 */
export function normalizeTransactionSubcategory({
  relation,
  categoryId,
  subcategoryId,
  userId,
}: {
  relation: unknown;
  categoryId?: string | null;
  subcategoryId?: string | null;
  userId: string;
}): SubcategoryRecord | null {
  if (!categoryId || !subcategoryId || !userId) return null;

  const candidates = (Array.isArray(relation) ? relation : [relation])
    .filter(isSubcategoryRecord)
    .filter((subcategory) =>
      subcategory.id === subcategoryId && subcategory.category_id === categoryId,
    );
  const visible = getSubcategoriesVisibleToUser(candidates, userId);
  return visible.length === 1 ? visible[0] : null;
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

/** Stable picker order: canonical system rows, then owned custom rows, alphabetically. */
export function sortSubcategoriesForSelection(
  subcategories: SubcategoryRecord[],
): SubcategoryRecord[] {
  return [...subcategories].sort((left, right) => {
    if (left.is_system !== right.is_system) return left.is_system ? -1 : 1;
    const nameOrder = left.name.localeCompare(right.name, "id-ID", { sensitivity: "base" });
    return nameOrder || left.id.localeCompare(right.id);
  });
}

export function preserveSubcategoryForCategoryChange({
  previousCategoryId,
  nextCategoryId,
  subcategoryId,
}: {
  previousCategoryId: string;
  nextCategoryId: string;
  subcategoryId: string | null;
}): string | null {
  return previousCategoryId === nextCategoryId ? subcategoryId : null;
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

/** Compact, deterministic model context. Callers must pass only visible parents and children. */
export function serializeCategoryHierarchyForModel(
  hierarchy: CategoryWithSubcategories[],
): string {
  const safeLabel = (value: string) => value.replace(/[\r\n\t]/g, " ").trim().slice(0, 120);
  const rows = [...hierarchy]
    .sort((left, right) => {
      const typeOrder = left.category.type.localeCompare(right.category.type);
      const nameOrder = left.category.name.localeCompare(right.category.name, "id-ID", { sensitivity: "base" });
      return typeOrder || nameOrder || left.category.id.localeCompare(right.category.id);
    })
    .map(({ category, subcategories }) => ({
      t: category.type.toUpperCase(),
      p: safeLabel(category.name),
      s: isCanonicalSystemCategory(category) ? "system" : "custom",
      c: [...subcategories]
        .sort((left, right) => {
          const nameOrder = left.name.localeCompare(right.name, "id-ID", { sensitivity: "base" });
          return nameOrder || left.id.localeCompare(right.id);
        })
        .map((subcategory) => ({
          n: safeLabel(subcategory.name),
          s: isCanonicalSystemSubcategory(subcategory) ? "system" : "custom",
        })),
    }));
  return JSON.stringify(rows);
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

export function getSubcategoryParentEligibilityFromRows({
  categories,
  userId,
  categoryId,
}: {
  categories: CategoryRecord[];
  userId: string;
  categoryId: string;
}): SubcategoryParentEligibility {
  const parent = getCategoriesVisibleToUser(categories, userId).find(
    (category) => category.id === categoryId,
  );
  if (!parent) return { status: "invalid_parent" };
  if (isBlockedSystemSubcategoryParent(parent)) return { status: "blocked_parent" };
  return { status: "eligible", parent };
}

export function findSubcategoryNameCollision({
  subcategories,
  userId,
  categoryId,
  name,
  excludeSubcategoryId,
}: {
  subcategories: SubcategoryRecord[];
  userId: string;
  categoryId: string;
  name: string;
  excludeSubcategoryId?: string;
}): SubcategoryRecord | null {
  const normalizedName = normalizeCategoryName(name);
  return getSubcategoriesForParentFromRows(subcategories, categoryId, userId).find(
    (subcategory) => subcategory.id !== excludeSubcategoryId
      && normalizeCategoryName(subcategory.name) === normalizedName,
  ) || null;
}

export function validateCustomSubcategoryCreate({
  categories,
  subcategories,
  userId,
  categoryId,
  name,
}: {
  categories: CategoryRecord[];
  subcategories: SubcategoryRecord[];
  userId: string;
  categoryId: string;
  name: string;
}): CustomSubcategoryValidation {
  const nameValidation = validateSubcategoryName(name);
  if (nameValidation.status !== "valid") return nameValidation;

  const parentValidation = getSubcategoryParentEligibilityFromRows({
    categories,
    userId,
    categoryId,
  });
  if (parentValidation.status !== "eligible") return parentValidation;

  if (findSubcategoryNameCollision({
    subcategories,
    userId,
    categoryId,
    name: nameValidation.name,
  })) {
    return { status: "duplicate_name" };
  }

  return {
    status: "valid",
    name: nameValidation.name,
    parent: parentValidation.parent,
  };
}

export function validateCustomSubcategoryUpdate({
  categories,
  subcategories,
  userId,
  subcategoryId,
  name,
}: {
  categories: CategoryRecord[];
  subcategories: SubcategoryRecord[];
  userId: string;
  subcategoryId: string;
  name: string;
}): CustomSubcategoryValidation {
  const subcategory = subcategories.find((row) => row.id === subcategoryId);
  if (!subcategory || !canManageSubcategory(subcategory, userId)) {
    return { status: "forbidden" };
  }

  const parent = getCategoriesVisibleToUser(categories, userId).find(
    (category) => category.id === subcategory.category_id,
  );
  if (!parent) return { status: "invalid_parent" };

  const nameValidation = validateSubcategoryName(name);
  if (nameValidation.status !== "valid") return nameValidation;

  if (findSubcategoryNameCollision({
    subcategories,
    userId,
    categoryId: subcategory.category_id,
    name: nameValidation.name,
    excludeSubcategoryId: subcategory.id,
  })) {
    return { status: "duplicate_name" };
  }

  return { status: "valid", name: nameValidation.name, parent, subcategory };
}

function normalizeOptionalIconName(value?: string | null): string | null {
  const normalized = value?.trim() || "";
  return normalized && normalized.length <= 50 ? normalized : null;
}

function normalizeOptionalColorHex(value?: string | null): string | null {
  const normalized = value?.trim() || "";
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : null;
}

export function buildCustomSubcategoryInsertPayload({
  categoryId,
  userId,
  name,
  iconName,
  colorHex,
}: {
  categoryId: string;
  userId: string;
  name: string;
  iconName?: string | null;
  colorHex?: string | null;
}): CustomSubcategoryInsertPayload {
  return {
    category_id: categoryId,
    user_id: userId,
    name,
    is_system: false,
    system_key: null,
    icon_name: normalizeOptionalIconName(iconName),
    color_hex: normalizeOptionalColorHex(colorHex),
  };
}

export function buildCustomSubcategoryUpdatePayload({
  name,
  iconName,
  colorHex,
}: {
  name: string;
  iconName?: string | null;
  colorHex?: string | null;
}): CustomSubcategoryUpdatePayload {
  return {
    name,
    icon_name: normalizeOptionalIconName(iconName),
    color_hex: normalizeOptionalColorHex(colorHex),
  };
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "23505";
}

export function isPostgresForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "23503";
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

/**
 * Resolves an untrusted model parent plus optional child against the visible
 * taxonomy. A trusted parent override (for example a merchant rule) wins only
 * when its ID is valid; an incompatible or unknown child is cleared, never
 * replaced with a different child.
 */
export function resolveHierarchicalCategoryFromRows({
  categories,
  subcategories,
  userId,
  type,
  categoryName,
  subcategoryName,
  trustedCategoryId,
}: {
  categories: CategoryRecord[];
  subcategories: SubcategoryRecord[];
  userId: string;
  type: TransactionType;
  categoryName: string;
  subcategoryName?: string | null;
  trustedCategoryId?: string | null;
}): HierarchicalCategoryResolution {
  const trustedResolution = trustedCategoryId
    ? resolveCategoryIdFromRows({
        categories,
        userId,
        categoryId: trustedCategoryId,
        type,
      })
    : null;
  const modelResolution = trustedResolution?.status === "matched"
    ? null
    : resolveCategoryFromRows({ categories, userId, name: categoryName, type });
  const parentResolution = trustedResolution?.status === "matched"
    ? trustedResolution
    : modelResolution!;

  if (parentResolution.status !== "matched") return { status: parentResolution.status };

  const categorySource = trustedResolution?.status === "matched"
    ? "trusted_override" as const
    : "model" as const;
  const candidateChild = typeof subcategoryName === "string" ? subcategoryName.trim() : "";
  if (!candidateChild) {
    return {
      status: "matched",
      category: parentResolution.category,
      subcategory: null,
      categorySource,
      subcategoryStatus: "omitted",
    };
  }

  const childResolution = resolveSubcategoryFromRows({
    subcategories,
    categories,
    userId,
    categoryId: parentResolution.category.id,
    name: candidateChild,
  });
  if (childResolution.status === "matched") {
    return {
      status: "matched",
      category: parentResolution.category,
      subcategory: childResolution.subcategory,
      categorySource,
      subcategoryStatus: "matched",
    };
  }

  return {
    status: "matched",
    category: parentResolution.category,
    subcategory: null,
    categorySource,
    subcategoryStatus: `cleared_${childResolution.status}`,
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
    .order("is_system", { ascending: false })
    .order("name", { ascending: true });

  if (error) throw error;
  return sortSubcategoriesForSelection(
    getSubcategoriesForParentFromRows(
      (data || []) as SubcategoryRecord[],
      categoryId,
      userId,
    ),
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
