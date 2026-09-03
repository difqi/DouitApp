import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCategoryHierarchy,
  resolveHierarchicalCategoryFromRows,
  serializeCategoryHierarchyForModel,
} from "./categories.ts";
import {
  resolveNormalTransactionKind,
  shouldExposeCategoryInOrdinaryTransactionPicker,
} from "./transaction-semantics.ts";
import {
  buildEmailClassificationInstruction,
  emailParseSchema,
} from "./email-classification.ts";

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

const allCategories = [
  category("food", "Makanan & Minuman"),
  category("transport", "Transportasi"),
  category("bills", "Tagihan"),
  category("services", "Jasa"),
  category("digital", "Barang Digital"),
  category("other", "Lain-lain"),
  category("saving", "Nabung"),
  category("fee", "Biaya Admin"),
  category("transfer", "Transfer"),
  category("custom", "Keluarga", "EXPENSE", ownerId),
  category("foreign-parent", "Rahasia", "EXPENSE", otherId),
];
const allSubcategories = [
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
  child("foreign-parent-child", "foreign-parent", "Tersembunyi", otherId),
];

const categories = allCategories.filter((row) =>
  (row.is_system === true || row.user_id === ownerId)
  && shouldExposeCategoryInOrdinaryTransactionPicker(row),
);
const categoryIds = new Set(categories.map((row) => row.id));
const subcategories = allSubcategories.filter((row) =>
  categoryIds.has(row.category_id)
  && (row.is_system === true || row.user_id === ownerId),
);

function resolve(categoryName, subcategoryName, trustedCategoryId = null) {
  return resolveHierarchicalCategoryFromRows({
    categories,
    subcategories,
    userId: ownerId,
    type: "EXPENSE",
    categoryName,
    subcategoryName,
    trustedCategoryId,
  });
}

test("email taxonomy context is hierarchical, ownership-safe, and excludes canonical Nabung", () => {
  const context = JSON.parse(
    serializeCategoryHierarchyForModel(buildCategoryHierarchy(categories, subcategories)),
  );

  assert.equal(context.some((row) => row.p === "Nabung"), false);
  assert.equal(context.some((row) => row.p === "Rahasia"), false);
  assert.deepEqual(
    context.find((row) => row.p === "Tagihan").c.map((row) => row.n),
    ["Pulsa & Data", "Sewa & Iuran"],
  );
  assert.deepEqual(context.find((row) => row.p === "Keluarga").c, [
    { n: "Anak", s: "custom" },
  ]);

  const instruction = buildEmailClassificationInstruction(JSON.stringify(context));
  assert.match(instruction, /t=type, p=parent, c=children/);
  assert.match(instruction, /'subcategory' harus sama persis dengan child n/);
  assert.match(instruction, /Pilih Lain-lain hanya jika model secara eksplisit/);
});

test("email structured output adds only an optional subcategory to existing extraction fields", () => {
  const details = emailParseSchema.properties?.transaction_details;
  assert.equal(details?.type, "OBJECT");
  const properties = details && "properties" in details ? details.properties : null;
  assert.ok(properties);
  assert.equal(properties.subcategory.type, "STRING");
  assert.equal(properties.subcategory.nullable, true);
  assert.equal(details && "required" in details && details.required.includes("subcategory"), false);
  assert.deepEqual(details && "required" in details ? details.required : null, [
    "amount",
    "merchant",
    "type",
    "category",
    "sumber_dana",
    "confidence_score",
  ]);
});

test("email hierarchical regression matrix retains exact parent and child", () => {
  const matrix = [
    ["Bengkel motor / servis", "Transportasi", "Perawatan Kendaraan"],
    ["Telkomsel / pulsa", "Tagihan", "Pulsa & Data"],
    ["Laundry / cuci pakaian", "Jasa", "Rumah Tangga"],
    ["Futsal / sewa lapangan", "Tagihan", "Sewa & Iuran"],
    ["Pasar / beli sayur", "Makanan & Minuman", "Bahan Makanan"],
    ["SPBU / bensin", "Transportasi", "Bensin"],
    ["Parking / parkir", "Transportasi", "Parkir & Tol"],
    ["Spotify / subscription", "Barang Digital", "Game & Konten Digital"],
  ];

  for (const [evidence, parentName, childName] of matrix) {
    const result = resolve(parentName, childName);
    assert.equal(result.status, "matched", evidence);
    assert.equal(result.status === "matched" && result.category.name, parentName, evidence);
    assert.equal(result.status === "matched" && result.subcategory?.name, childName, evidence);
  }
});

test("email resolution clears cross-parent, unknown, and foreign children while retaining the parent", () => {
  for (const childName of ["Bahan Makanan", "Tidak Ada", "Rahasia Anak"]) {
    const result = resolve("Transportasi", childName);
    assert.equal(result.status, "matched", childName);
    assert.equal(result.status === "matched" && result.category.id, "transport", childName);
    assert.equal(result.status === "matched" && result.subcategory, null, childName);
  }
});

test("email resolution accepts parent-only and an owned custom hierarchy", () => {
  const parentOnly = resolve("Transportasi", null);
  assert.equal(parentOnly.status === "matched" && parentOnly.subcategory, null);

  const custom = resolve("Keluarga", "Anak");
  assert.equal(custom.status === "matched" && custom.category.id, "custom");
  assert.equal(custom.status === "matched" && custom.subcategory?.id, "custom-child");
});

test("unknown email parent is unresolved while explicit Lain-lain remains valid", () => {
  assert.deepEqual(resolve("Olahraga", null), { status: "not_found" });
  const explicitOther = resolve("Lain-lain", null);
  assert.equal(explicitOther.status === "matched" && explicitOther.category.id, "other");
});

test("merchant parent override clears an incompatible child and retains a compatible child", () => {
  const incompatible = resolve("Makanan & Minuman", "Bahan Makanan", "transport");
  assert.equal(incompatible.status === "matched" && incompatible.category.id, "transport");
  assert.equal(incompatible.status === "matched" && incompatible.categorySource, "trusted_override");
  assert.equal(incompatible.status === "matched" && incompatible.subcategory, null);

  const compatible = resolve("Transportasi", "Bensin", "transport");
  assert.equal(compatible.status === "matched" && compatible.category.id, "transport");
  assert.equal(compatible.status === "matched" && compatible.subcategory?.id, "fuel");
});

test("ordinary email taxonomy cannot derive SAVING while fee and Transfer semantics remain locked", () => {
  assert.equal(categories.some((row) => row.id === "saving"), false);
  assert.deepEqual(resolve("Nabung", null), { status: "not_found" });
  assert.equal(resolveNormalTransactionKind(allCategories.find((row) => row.id === "saving")), "ORDINARY");
  assert.equal(resolveNormalTransactionKind(allCategories.find((row) => row.id === "fee")), "FEE");
  assert.equal(resolveNormalTransactionKind(allCategories.find((row) => row.id === "transfer")), "ORDINARY");
});

test("Resend wiring persists the validated child and keeps fee and savings paths isolated", () => {
  const route = readFileSync(
    new URL("../app/api/webhook/resend/route.ts", import.meta.url),
    "utf8",
  );
  const ordinaryStart = route.indexOf("// 1. Check Adaptive Learning Rules");
  const ordinaryEnd = route.indexOf("if (!categoryId) status = 'PENDING_APPROVAL';");
  const ordinaryClassification = route.slice(ordinaryStart, ordinaryEnd);

  assert.match(route, /listVisibleSubcategoriesForUser\(supabase, profile\.id\)/);
  assert.match(route, /serializeCategoryHierarchyForModel\(/);
  assert.match(route, /emailParseSchema/);
  assert.match(route, /buildEmailClassificationInstruction\(taxonomyContext\)/);
  assert.match(route, /resolveHierarchicalCategoryFromRows\(/);
  assert.match(route, /subcategory_id: subcategoryId/);
  assert.doesNotMatch(ordinaryClassification, /SYSTEM_CATEGORY_NAMES\.OTHER/);
  assert.match(ordinaryClassification, /status = 'PENDING_APPROVAL'/);
  assert.match(route, /subcategory_id: null,\s+transaction_kind: 'FEE'/);
  assert.match(route, /findDeterministicSavingsGoalMatch\(\{/);
  assert.match(route, /reconcile_savings_contribution_evidence/);
  assert.match(route, /p_occurred_at: occurredAt/);
});

test("Resend extraction, funding, confidence, fee, and idempotency fields remain wired", () => {
  const route = readFileSync(
    new URL("../app/api/webhook/resend/route.ts", import.meta.url),
    "utf8",
  );

  const details = emailParseSchema.properties?.transaction_details;
  const properties = details && "properties" in details ? details.properties : null;
  assert.ok(properties);
  for (const field of [
    "amount",
    "merchant",
    "type",
    "sumber_dana",
    "admin_fee",
    "notes",
    "confidence_score",
  ]) {
    assert.ok(properties[field], field);
  }
  assert.match(route, /tx\.confidence_score >= 0\.85/);
  assert.match(route, /\.eq\('idempotency_key', messageId\)/);
  assert.match(route, /idempotency_key: messageId/);
  assert.match(route, /const rawSumberDana = tx\.sumber_dana \|\| ""/);
  assert.match(route, /admin_fee && tx\.admin_fee > 0/);
});
