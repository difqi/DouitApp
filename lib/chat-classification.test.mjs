import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCategoryHierarchy,
  resolveHierarchicalCategoryFromRows,
  serializeCategoryHierarchyForModel,
  validateSubcategoryAssignmentFromRows,
} from "./categories.ts";
import { parseAndValidateChatOutput } from "./chat/validation.ts";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-01-01T00:00:00.000Z";

const category = (id, name, type = "EXPENSE", userId = null) => ({
  id,
  name,
  type,
  user_id: userId,
  is_system: userId === null,
});
const child = (id, categoryId, name, userId = null) => ({
  id,
  category_id: categoryId,
  name,
  user_id: userId,
  is_system: userId === null,
  system_key: userId === null ? `system-${id}` : null,
  icon_name: null,
  color_hex: null,
  created_at: createdAt,
});

const categories = [
  category("food", "Makanan & Minuman"),
  category("transport", "Transportasi"),
  category("bills", "Tagihan"),
  category("services", "Jasa"),
  category("digital", "Barang Digital"),
  category("other", "Lain-lain"),
  category("saving", "Nabung"),
  category("custom", "Keluarga", "EXPENSE", ownerId),
  category("foreign-parent", "Rahasia", "EXPENSE", otherId),
];
const subcategories = [
  child("dining", "food", "Makan di Luar"),
  child("coffee", "food", "Kopi & Minuman"),
  child("groceries", "food", "Bahan Makanan"),
  child("fuel", "transport", "Bensin"),
  child("parking", "transport", "Parkir & Tol"),
  child("maintenance", "transport", "Perawatan Kendaraan"),
  child("rent-dues", "bills", "Sewa & Iuran"),
  child("mobile", "bills", "Pulsa & Data"),
  child("household", "services", "Rumah Tangga"),
  child("digital-content", "digital", "Game & Konten Digital"),
  child("custom-child", "custom", "Anak", ownerId),
  child("foreign-child", "custom", "Rahasia Anak", otherId),
];

function resolve(categoryName, subcategoryName, options = {}) {
  return resolveHierarchicalCategoryFromRows({
    categories,
    subcategories,
    userId: ownerId,
    type: "EXPENSE",
    categoryName,
    subcategoryName,
    ...options,
  });
}

test("serializes a compact parent-child taxonomy without losing hierarchy", () => {
  const serialized = serializeCategoryHierarchyForModel(buildCategoryHierarchy(categories, subcategories));
  const parsed = JSON.parse(serialized);
  const bills = parsed.find((row) => row.p === "Tagihan");
  assert.deepEqual(bills, {
    t: "EXPENSE",
    p: "Tagihan",
    s: "system",
    c: [
      { n: "Pulsa & Data", s: "system" },
      { n: "Sewa & Iuran", s: "system" },
    ],
  });
  assert.equal(parsed.find((row) => row.p === "Keluarga").s, "custom");
});

test("regression matrix accepts expected hierarchical model proposals", () => {
  const matrix = [
    ["iuran lapangan 30k", "Tagihan", "Sewa & Iuran"],
    ["sewa lapangan futsal 100k", "Tagihan", "Sewa & Iuran"],
    ["bayar kas kelas 20k", "Tagihan", "Sewa & Iuran"],
    ["servis motor 200k", "Transportasi", "Perawatan Kendaraan"],
    ["pulsa 50k", "Tagihan", "Pulsa & Data"],
    ["beli sayur 40k", "Makanan & Minuman", "Bahan Makanan"],
    ["makan ayam 25k", "Makanan & Minuman", "Makan di Luar"],
    ["ngopi 20k", "Makanan & Minuman", "Kopi & Minuman"],
    ["bensin 50k", "Transportasi", "Bensin"],
    ["parkir 5k", "Transportasi", "Parkir & Tol"],
    ["laundry 25k", "Jasa", "Rumah Tangga"],
    ["spotify 55k", "Barang Digital", "Game & Konten Digital"],
  ];

  for (const [phrase, parentName, childName] of matrix) {
    const result = resolve(parentName, childName);
    assert.equal(result.status, "matched", phrase);
    assert.equal(result.status === "matched" && result.category.name, parentName, phrase);
    assert.equal(result.status === "matched" && result.subcategory?.name, childName, phrase);
  }
});

test("validates owned custom hierarchy and rejects foreign children", () => {
  const owned = resolve("Keluarga", "Anak");
  assert.equal(owned.status === "matched" && owned.category.id, "custom");
  assert.equal(owned.status === "matched" && owned.subcategory?.id, "custom-child");

  const foreign = resolve("Keluarga", "Rahasia Anak");
  assert.equal(foreign.status, "matched");
  assert.equal(foreign.status === "matched" && foreign.subcategory, null);
  assert.equal(foreign.status === "matched" && foreign.subcategoryStatus, "cleared_not_found");
});

test("clears invalid or cross-parent children without guessing replacements", () => {
  const crossParent = resolve("Transportasi", "Bahan Makanan");
  assert.equal(crossParent.status, "matched");
  assert.equal(crossParent.status === "matched" && crossParent.subcategory, null);
  assert.equal(crossParent.status === "matched" && crossParent.subcategoryStatus, "cleared_not_found");

  const parentOnly = resolve("Transportasi", null);
  assert.equal(parentOnly.status === "matched" && parentOnly.subcategory, null);
  assert.equal(parentOnly.status === "matched" && parentOnly.subcategoryStatus, "omitted");
});

test("unknown model parents do not silently become Lain-lain", () => {
  assert.deepEqual(resolve("Olahraga", null), { status: "not_found" });
  const explicitOther = resolve("Lain-lain", null);
  assert.equal(explicitOther.status === "matched" && explicitOther.category.id, "other");
});

test("trusted parent override cannot retain an incompatible model child", () => {
  const result = resolve("Makanan & Minuman", "Bahan Makanan", { trustedCategoryId: "transport" });
  assert.equal(result.status === "matched" && result.category.id, "transport");
  assert.equal(result.status === "matched" && result.categorySource, "trusted_override");
  assert.equal(result.status === "matched" && result.subcategory, null);
});

test("approval assignment validation rejects cross-parent and foreign child IDs", () => {
  assert.equal(validateSubcategoryAssignmentFromRows({
    categories,
    subcategories,
    userId: ownerId,
    categoryId: "transport",
    subcategoryId: "groceries",
    type: "EXPENSE",
  }).status, "invalid_parent");
  assert.equal(validateSubcategoryAssignmentFromRows({
    categories,
    subcategories,
    userId: ownerId,
    categoryId: "custom",
    subcategoryId: "foreign-child",
    type: "EXPENSE",
  }).status, "not_found");
});

test("structured parsing preserves an optional subcategory", () => {
  const base = {
    intent_class: "NEW_TRANSACTION",
    is_transaction: true,
    needs_clarification: false,
    reply_message: "Draft siap.",
    transaction_details: {
      amount: 30000,
      merchant: "Iuran Lapangan",
      type: "EXPENSE",
      category: "Tagihan",
      subcategory: "Sewa & Iuran",
      source_was_explicit: false,
      sumber_dana: null,
    },
  };
  const withChild = parseAndValidateChatOutput(JSON.stringify(base));
  assert.equal(withChild.ok, true);
  assert.equal(withChild.value.transactionDetails?.subcategory, "Sewa & Iuran");

  delete base.transaction_details.subcategory;
  const parentOnly = parseAndValidateChatOutput(JSON.stringify(base));
  assert.equal(parentOnly.ok, true);
  assert.equal(parentOnly.value.transactionDetails?.subcategory, null);
});

test("chat wiring retains child IDs, revalidates approval, and clears on parent edits", () => {
  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/(dashboard)/chat/page.tsx", import.meta.url), "utf8");
  const drafts = readFileSync(new URL("./chat/drafts.ts", import.meta.url), "utf8");

  assert.match(route, /shouldExposeCategoryInOrdinaryTransactionPicker/);
  assert.match(route, /subcategory_id: categoryResolution\.subcategory\?\.id \|\| null/);
  assert.doesNotMatch(route, /const safeFallback = categories\.find/);
  assert.match(page, /subcategory_id: draft\.preview\.subcategory_id/);
  assert.match(page, /validateSubcategoryAssignmentFromRows\(/);
  assert.match(page, /shouldExposeCategoryInOrdinaryTransactionPicker\(safeCategory\)/);
  assert.match(drafts, /subcategory_id: category\.id === existing\.category_id \? existing\.subcategory_id : null/);
});
