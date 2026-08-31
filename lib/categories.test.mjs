import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCategoryHierarchy,
  getSubcategoriesForParentFromRows,
  getSubcategoriesVisibleToUser,
  getKnownSystemCategoryName,
  isCanonicalSystemSubcategory,
  isOwnedCustomSubcategory,
  resolveCategoryFromRows,
  resolveCategoryIdFromRows,
  resolveSubcategoryFromRows,
  resolveSystemCategoryFromRows,
  SYSTEM_CATEGORY_NAMES,
  validateSubcategoryAssignmentFromRows,
} from "./categories.ts";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const rows = [
  { id: "system-other", user_id: null, name: "Lain-lain", type: "EXPENSE", is_system: true },
  { id: "system-saving", user_id: null, name: "Nabung", type: "EXPENSE", is_system: true },
  { id: "system-fee", user_id: null, name: "Biaya Admin", type: "EXPENSE", is_system: true },
  { id: "system-transfer", user_id: null, name: "Transfer", type: "INCOME", is_system: true },
  { id: "owner-food", user_id: ownerId, name: "Makan Khusus", type: "EXPENSE", is_system: false },
  { id: "owner-other", user_id: ownerId, name: "Lain-lain", type: "EXPENSE", is_system: false },
  { id: "foreign-food", user_id: otherId, name: "Makan Rahasia", type: "EXPENSE", is_system: false },
  { id: "malformed-foreign", user_id: otherId, name: "Nabung", type: "EXPENSE", is_system: true },
];

const taxonomyCategories = [
  ...rows,
  { id: "system-food", user_id: null, name: "Makanan & Minuman", type: "EXPENSE", is_system: true },
  { id: "system-transport", user_id: null, name: "Transportasi", type: "EXPENSE", is_system: true },
  { id: "owner-parent", user_id: ownerId, name: "Keluarga", type: "EXPENSE", is_system: false },
  { id: "foreign-parent", user_id: otherId, name: "Rahasia", type: "EXPENSE", is_system: false },
];

const subcategoryRows = [
  { id: "system-snack", category_id: "system-food", user_id: null, name: "Cemilan", is_system: true, system_key: "expense_food_snacks", icon_name: null, color_hex: null, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "system-transport-snack", category_id: "system-transport", user_id: null, name: "Cemilan", is_system: true, system_key: "expense_transport_snacks", icon_name: null, color_hex: null, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "owner-snack", category_id: "system-food", user_id: ownerId, name: "CEMILAN", is_system: false, system_key: null, icon_name: null, color_hex: null, created_at: "2026-01-02T00:00:00.000Z" },
  { id: "owner-family", category_id: "owner-parent", user_id: ownerId, name: "Anak", is_system: false, system_key: null, icon_name: null, color_hex: null, created_at: "2026-01-02T00:00:00.000Z" },
  { id: "foreign-child", category_id: "foreign-parent", user_id: otherId, name: "Pribadi", is_system: false, system_key: null, icon_name: null, color_hex: null, created_at: "2026-01-03T00:00:00.000Z" },
  { id: "malformed-system", category_id: "system-food", user_id: ownerId, name: "Rusak", is_system: true, system_key: "malformed", icon_name: null, color_hex: null, created_at: "2026-01-04T00:00:00.000Z" },
  { id: "malformed-custom", category_id: "system-food", user_id: ownerId, name: "Rusak Dua", is_system: false, system_key: "must_be_null", icon_name: null, color_hex: null, created_at: "2026-01-04T00:00:00.000Z" },
];

test("finds canonical system Lain-lain", () => {
  const result = resolveSystemCategoryFromRows(rows, SYSTEM_CATEGORY_NAMES.OTHER, "EXPENSE");
  assert.equal(result.status, "matched");
  assert.equal(result.status === "matched" && result.category.id, "system-other");
});

test("finds a custom category only for its owner", () => {
  assert.equal(resolveCategoryFromRows({ categories: rows, userId: ownerId, name: "Makan Khusus" }).status, "matched");
  assert.equal(resolveCategoryFromRows({ categories: rows, userId: otherId, name: "Makan Khusus" }).status, "not_found");
});

test("never resolves another user's same-name or malformed system row", () => {
  assert.equal(resolveCategoryFromRows({ categories: rows, userId: ownerId, name: "Makan Rahasia" }).status, "not_found");
  const saving = resolveSystemCategoryFromRows(rows, SYSTEM_CATEGORY_NAMES.SAVING, "EXPENSE");
  assert.equal(saving.status === "matched" && saving.category.id, "system-saving");
});

test("owner custom row deterministically precedes a same-name system row", () => {
  const result = resolveCategoryFromRows({ categories: rows, userId: ownerId, name: "Lain-lain", type: "EXPENSE" });
  assert.equal(result.status === "matched" && result.category.id, "owner-other");
  assert.equal(result.status === "matched" && result.matchedScope, "user");
});

test("rejects wrong transaction type", () => {
  assert.equal(
    resolveCategoryFromRows({ categories: rows, userId: ownerId, name: "Transfer", type: "EXPENSE" }).status,
    "wrong_type",
  );
  assert.equal(
    resolveCategoryIdFromRows({ categories: rows, userId: ownerId, categoryId: "foreign-food", type: "EXPENSE" }).status,
    "not_found",
  );
});

test("does not choose arbitrarily among duplicate rows", () => {
  const duplicated = [...rows, { ...rows[4], id: "owner-food-duplicate" }];
  assert.equal(
    resolveCategoryFromRows({ categories: duplicated, userId: ownerId, name: "Makan Khusus", type: "EXPENSE" }).status,
    "ambiguous",
  );
});

test("all special names resolve only canonical system rows", () => {
  for (const name of Object.values(SYSTEM_CATEGORY_NAMES)) {
    const result = resolveSystemCategoryFromRows(rows, name);
    assert.equal(result.status, "matched", name);
    assert.equal(result.status === "matched" && result.category.user_id, null, name);
    assert.equal(result.status === "matched" && result.category.is_system, true, name);
  }
});

test("recognizes special display names without fuzzy matching", () => {
  assert.equal(getKnownSystemCategoryName("  biaya   ADMIN "), SYSTEM_CATEGORY_NAMES.ADMIN_FEE);
  assert.equal(getKnownSystemCategoryName("Biaya Administrasi"), null);
});

test("subcategory ownership invariant exposes only canonical system and owned custom rows", () => {
  const visible = getSubcategoriesVisibleToUser(subcategoryRows, ownerId);
  assert.deepEqual(visible.map((row) => row.id), [
    "system-snack",
    "system-transport-snack",
    "owner-snack",
    "owner-family",
  ]);
  assert.equal(isCanonicalSystemSubcategory(subcategoryRows[0]), true);
  assert.equal(isOwnedCustomSubcategory(subcategoryRows[2], ownerId), true);
  assert.equal(isCanonicalSystemSubcategory(subcategoryRows[5]), false);
  assert.equal(isOwnedCustomSubcategory(subcategoryRows[6], ownerId), false);
});

test("lists canonical system children for a parent", () => {
  const visible = getSubcategoriesForParentFromRows(subcategoryRows, "system-transport", ownerId);
  assert.deepEqual(visible.map((row) => row.id), ["system-transport-snack"]);
});

test("lists the current user's custom child", () => {
  const visible = getSubcategoriesForParentFromRows(subcategoryRows, "owner-parent", ownerId);
  assert.deepEqual(visible.map((row) => row.id), ["owner-family"]);
});

test("filters another user's custom child", () => {
  const visible = getSubcategoriesForParentFromRows(subcategoryRows, "foreign-parent", ownerId);
  assert.deepEqual(visible, []);
});

test("subcategory lookup is parent-scoped and allows the same child name under different parents", () => {
  const food = resolveSubcategoryFromRows({
    subcategories: subcategoryRows,
    categories: taxonomyCategories,
    userId: otherId,
    categoryId: "system-food",
    name: "cemilan",
  });
  const transport = resolveSubcategoryFromRows({
    subcategories: subcategoryRows,
    categories: taxonomyCategories,
    userId: otherId,
    categoryId: "system-transport",
    name: "CEMILAN",
  });
  assert.equal(food.status === "matched" && food.subcategory.id, "system-snack");
  assert.equal(transport.status === "matched" && transport.subcategory.id, "system-transport-snack");
});

test("owned custom subcategory precedes a case-insensitive same-name system row", () => {
  const result = resolveSubcategoryFromRows({
    subcategories: subcategoryRows,
    categories: taxonomyCategories,
    userId: ownerId,
    categoryId: "system-food",
    name: "  cemilan ",
  });
  assert.equal(result.status === "matched" && result.subcategory.id, "owner-snack");
  assert.equal(result.status === "matched" && result.matchedScope, "user");
});

test("case-insensitive duplicates in the preferred subcategory scope are ambiguous", () => {
  const duplicated = [
    ...subcategoryRows,
    { ...subcategoryRows[2], id: "owner-snack-duplicate", name: "cemilan" },
  ];
  assert.equal(resolveSubcategoryFromRows({
    subcategories: duplicated,
    categories: taxonomyCategories,
    userId: ownerId,
    categoryId: "system-food",
    name: "Cemilan",
  }).status, "ambiguous");
});

test("foreign custom parent is rejected before resolving its child", () => {
  assert.equal(resolveSubcategoryFromRows({
    subcategories: subcategoryRows,
    categories: taxonomyCategories,
    userId: ownerId,
    categoryId: "foreign-parent",
    name: "Pribadi",
  }).status, "invalid_parent");
});

test("transaction assignment rejects a child from a different parent", () => {
  assert.equal(validateSubcategoryAssignmentFromRows({
    subcategories: subcategoryRows,
    categories: taxonomyCategories,
    userId: ownerId,
    categoryId: "system-transport",
    subcategoryId: "owner-snack",
    type: "EXPENSE",
  }).status, "invalid_parent");
  assert.equal(validateSubcategoryAssignmentFromRows({
    subcategories: subcategoryRows,
    categories: taxonomyCategories,
    userId: ownerId,
    categoryId: "system-food",
    subcategoryId: "owner-snack",
    type: "EXPENSE",
  }).status, "matched");
  assert.equal(validateSubcategoryAssignmentFromRows({
    subcategories: subcategoryRows,
    categories: taxonomyCategories,
    userId: ownerId,
    categoryId: "system-food",
    subcategoryId: "owner-snack",
    type: "INCOME",
  }).status, "wrong_type");
});

test("null subcategory is a valid parent-only assignment", () => {
  const result = validateSubcategoryAssignmentFromRows({
    subcategories: subcategoryRows,
    categories: taxonomyCategories,
    userId: ownerId,
    categoryId: "system-food",
    subcategoryId: null,
    type: "EXPENSE",
  });
  assert.deepEqual(result, { status: "valid", subcategory: null });
});

test("category hierarchy groups children under their parent without cross-parent leakage", () => {
  const visible = getSubcategoriesVisibleToUser(subcategoryRows, ownerId);
  const hierarchy = buildCategoryHierarchy(
    taxonomyCategories.filter((category) => category.id === "system-food" || category.id === "system-transport"),
    visible,
  );
  assert.deepEqual(hierarchy.map(({ category, subcategories }) => ({
    categoryId: category.id,
    childIds: subcategories.map((subcategory) => subcategory.id),
  })), [
    { categoryId: "system-food", childIds: ["system-snack", "owner-snack"] },
    { categoryId: "system-transport", childIds: ["system-transport-snack"] },
  ]);
});
