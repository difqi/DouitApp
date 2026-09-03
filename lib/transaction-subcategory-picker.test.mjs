import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getSubcategoriesForParentFromRows,
  preserveSubcategoryForCategoryChange,
  sortSubcategoriesForSelection,
  validateSubcategoryAssignmentFromRows,
} from "./categories.ts";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

const categories = [
  { id: "food", user_id: null, name: "Makanan & Minuman", type: "EXPENSE", is_system: true },
  { id: "transport", user_id: null, name: "Transportasi", type: "EXPENSE", is_system: true },
  { id: "saving", user_id: null, name: "Nabung", type: "EXPENSE", is_system: true },
  { id: "hobby", user_id: ownerId, name: "Hobi Khusus", type: "EXPENSE", is_system: false },
];

const child = (overrides) => ({
  id: "system-dining",
  category_id: "food",
  user_id: null,
  name: "Makan di Luar",
  is_system: true,
  system_key: "expense_food_dining_out",
  icon_name: null,
  color_hex: null,
  created_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const subcategories = [
  child({}),
  child({ id: "system-snacks", name: "Cemilan", system_key: "expense_food_snacks" }),
  child({ id: "owner-meal-prep", user_id: ownerId, name: "Meal Prep", is_system: false, system_key: null }),
  child({ id: "foreign-secret", user_id: otherId, name: "Rahasia", is_system: false, system_key: null }),
  child({ id: "transport-public", category_id: "transport", name: "Transportasi Umum", system_key: "expense_transport_public" }),
  child({ id: "owner-aquascape", category_id: "hobby", user_id: ownerId, name: "Aquascape", is_system: false, system_key: null }),
];

const createSource = await readFile(
  new URL("../app/components/TransactionCreateModal.tsx", import.meta.url),
  "utf8",
);
const workspaceSource = await readFile(
  new URL("../app/components/WorkspaceViews.tsx", import.meta.url),
  "utf8",
);
const pickerSource = await readFile(
  new URL("../app/components/SubcategorySelect.tsx", import.meta.url),
  "utf8",
);

test("parent-only transaction remains valid and no child is auto-selected", () => {
  assert.equal(validateSubcategoryAssignmentFromRows({
    subcategories,
    categories,
    userId: ownerId,
    categoryId: "food",
    subcategoryId: null,
    type: "EXPENSE",
  }).status, "valid");
  assert.match(createSource, /useState<string \| null>\(null\)/);
  assert.doesNotMatch(pickerSource, /onChange\(rows\[0\]/);
});

test("system and owned custom children are selectable while foreign children are excluded", () => {
  const visible = getSubcategoriesForParentFromRows(subcategories, "food", ownerId);
  assert.deepEqual(visible.map((row) => row.id), [
    "system-dining",
    "system-snacks",
    "owner-meal-prep",
  ]);
  for (const subcategoryId of ["system-dining", "owner-meal-prep"]) {
    assert.equal(validateSubcategoryAssignmentFromRows({
      subcategories,
      categories,
      userId: ownerId,
      categoryId: "food",
      subcategoryId,
      type: "EXPENSE",
    }).status, "matched");
  }
  assert.equal(validateSubcategoryAssignmentFromRows({
    subcategories,
    categories,
    userId: ownerId,
    categoryId: "food",
    subcategoryId: "foreign-secret",
    type: "EXPENSE",
  }).status, "not_found");
});

test("a child from another parent is rejected and a custom-parent child is accepted", () => {
  assert.equal(validateSubcategoryAssignmentFromRows({
    subcategories,
    categories,
    userId: ownerId,
    categoryId: "food",
    subcategoryId: "transport-public",
    type: "EXPENSE",
  }).status, "invalid_parent");
  assert.equal(validateSubcategoryAssignmentFromRows({
    subcategories,
    categories,
    userId: ownerId,
    categoryId: "hobby",
    subcategoryId: "owner-aquascape",
    type: "EXPENSE",
  }).status, "matched");
});

test("picker ordering is system-first, custom-second, and alphabetical within each group", () => {
  const ordered = sortSubcategoriesForSelection([
    subcategories[2],
    subcategories[0],
    subcategories[1],
    child({ id: "owner-alpha", user_id: ownerId, name: "Bekal", is_system: false, system_key: null }),
  ]);
  assert.deepEqual(ordered.map((row) => row.id), [
    "system-snacks",
    "system-dining",
    "owner-alpha",
    "owner-meal-prep",
  ]);
});

test("category changes clear a child while unchanged categories preserve it", () => {
  assert.equal(preserveSubcategoryForCategoryChange({
    previousCategoryId: "food",
    nextCategoryId: "transport",
    subcategoryId: "system-dining",
  }), null);
  assert.equal(preserveSubcategoryForCategoryChange({
    previousCategoryId: "food",
    nextCategoryId: "food",
    subcategoryId: "system-dining",
  }), "system-dining");
});

test("create submits an explicit selected UUID or null after live assignment validation", () => {
  assert.match(createSource, /validateSubcategoryAssignmentFromRows\(/);
  assert.match(createSource, /subcategory_id: selectedSubcategoryId/);
  assert.match(createSource, /listSubcategoriesForParent\([\s\S]*?selectedCategoryId[\s\S]*?user\.id/);
  assert.match(createSource, /isSubmittingRef\.current/);
});

test("ordinary transaction pickers use semantic eligibility instead of a global name filter", () => {
  assert.match(createSource, /shouldExposeCategoryInOrdinaryTransactionPicker\(category\)/);
  assert.match(workspaceSource, /shouldExposeCategoryInOrdinaryTransactionPicker\(category\)/);
  assert.doesNotMatch(createSource, /category\.name\s*!==\s*["']Nabung["']/);
  assert.doesNotMatch(workspaceSource, /category\.name\s*!==\s*["']Nabung["']/);
  assert.match(pickerSource, /subcategories\.length === 0\) return null/);
});

test("edit loads and preserves the existing child until the user changes parent or child", () => {
  assert.match(workspaceSource, /setEditSubcategoryId\(row\.subcategory_id \|\| null\)/);
  assert.match(workspaceSource, /const newSubcategoryId = categoryChanged \? null : editSubcategoryId/);
  assert.match(workspaceSource, /subcategory_id: newSubcategoryId/);
  assert.match(workspaceSource, /onChange=\{setEditSubcategoryId\}/);
});

test("retroactive updates preserve same-parent children and clear only category-changed rows", () => {
  assert.match(workspaceSource, /update\(sharedRetroactivePayload\)[\s\S]*?\.eq\('category_id', newCategoryId\)/);
  assert.match(workspaceSource, /subcategory_id: null,[\s\S]*?\.neq\('category_id', newCategoryId\)/);
});

test("picker queries one parent with session ownership filters and no service role", () => {
  assert.match(pickerSource, /listSubcategoriesForParent\(supabase, categoryId, userId\)/);
  assert.doesNotMatch(pickerSource, /createAdminClient|SUPABASE_SERVICE_ROLE|service[_-]role/i);
  assert.doesNotMatch(createSource, /createAdminClient|SUPABASE_SERVICE_ROLE|service[_-]role/i);
  assert.doesNotMatch(workspaceSource, /createAdminClient|SUPABASE_SERVICE_ROLE|service[_-]role/i);
});

test("stale parent responses cannot replace the current picker options", () => {
  assert.match(pickerSource, /const requestId = \+\+requestIdRef\.current/);
  assert.match(pickerSource, /requestId !== requestIdRef\.current/);
  assert.match(pickerSource, /active = false/);
});

test("picker exposes accessible loading and field-level failure states", () => {
  assert.match(pickerSource, /ariaLabel="Subkategori opsional"/);
  assert.match(pickerSource, /ariaBusy=\{isLoading\}/);
  assert.match(pickerSource, /role="status">Memuat subkategori\.\.\./);
  assert.match(pickerSource, /role="alert"/);
  assert.match(pickerSource, /Tanpa subkategori/);
});
