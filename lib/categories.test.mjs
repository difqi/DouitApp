import assert from "node:assert/strict";
import test from "node:test";

import {
  getKnownSystemCategoryName,
  resolveCategoryFromRows,
  resolveCategoryIdFromRows,
  resolveSystemCategoryFromRows,
  SYSTEM_CATEGORY_NAMES,
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
