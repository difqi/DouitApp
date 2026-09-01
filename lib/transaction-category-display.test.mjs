import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeTransactionSubcategory,
} from "./categories.ts";
import { formatTransactionCategoryLabel } from "./transaction-category-display.ts";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

const systemChild = {
  id: "system-dining",
  category_id: "food",
  user_id: null,
  name: "Makan di Luar",
  is_system: true,
  system_key: "expense_food_dining_out",
  icon_name: null,
  color_hex: null,
  created_at: "2026-01-01T00:00:00.000Z",
};
const ownCustomChild = {
  ...systemChild,
  id: "owner-meal-prep",
  user_id: ownerId,
  name: "Meal Prep",
  is_system: false,
  system_key: null,
};
const foreignCustomChild = {
  ...ownCustomChild,
  id: "foreign-secret",
  user_id: otherId,
  name: "Rahasia",
};

const workspaceSource = await readFile(
  new URL("../app/components/WorkspaceViews.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = await readFile(
  new URL("../app/(dashboard)/page.tsx", import.meta.url),
  "utf8",
);
const globalsSource = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("formatter renders parent and child with one compact separator", () => {
  assert.equal(
    formatTransactionCategoryLabel("Makanan & Minuman", "Makan di Luar"),
    "Makanan & Minuman · Makan di Luar",
  );
});

test("formatter keeps parent-only, null-child, and missing-child labels unchanged", () => {
  assert.equal(formatTransactionCategoryLabel("Makanan & Minuman"), "Makanan & Minuman");
  assert.equal(formatTransactionCategoryLabel("Makanan & Minuman", null), "Makanan & Minuman");
  assert.equal(formatTransactionCategoryLabel("Makanan & Minuman", "  "), "Makanan & Minuman");
});

test("formatter preserves the existing parent fallback and never emits duplicate separators", () => {
  assert.equal(formatTransactionCategoryLabel(null, null), "Lain-lain");
  assert.doesNotMatch(formatTransactionCategoryLabel("Nabung", null), /·/);
  assert.doesNotMatch(formatTransactionCategoryLabel("Transfer", ""), /·\s*·/);
});

test("long custom names remain intact for UI-level truncation", () => {
  const longName = "Kebutuhan Aquascape dan Perawatan Tanaman Air Bulanan";
  assert.equal(
    formatTransactionCategoryLabel("Hobi Khusus", longName),
    `Hobi Khusus · ${longName}`,
  );
  assert.match(globalsSource, /transaction-feed-secondary[\s\S]*?text-overflow: ellipsis/);
  assert.match(globalsSource, /dashboard-recent-category-cell[\s\S]*?text-overflow: ellipsis/);
});

test("canonical system child hydrates from object or array relation shape", () => {
  for (const relation of [systemChild, [systemChild]]) {
    const result = normalizeTransactionSubcategory({
      relation,
      categoryId: "food",
      subcategoryId: systemChild.id,
      userId: ownerId,
    });
    assert.equal(result?.name, "Makan di Luar");
  }
});

test("the current user's custom child hydrates without a transaction ownership badge", () => {
  const result = normalizeTransactionSubcategory({
    relation: ownCustomChild,
    categoryId: "food",
    subcategoryId: ownCustomChild.id,
    userId: ownerId,
  });
  assert.equal(result?.name, "Meal Prep");
  assert.doesNotMatch(workspaceSource, /subcategory[^\n]*Pribadi/i);
});

test("foreign custom child metadata is never exposed", () => {
  assert.equal(normalizeTransactionSubcategory({
    relation: foreignCustomChild,
    categoryId: "food",
    subcategoryId: foreignCustomChild.id,
    userId: ownerId,
  }), null);
});

test("null or deleted child naturally falls back to parent-only", () => {
  assert.equal(normalizeTransactionSubcategory({
    relation: null,
    categoryId: "food",
    subcategoryId: null,
    userId: ownerId,
  }), null);
  assert.equal(normalizeTransactionSubcategory({
    relation: null,
    categoryId: "food",
    subcategoryId: ownCustomChild.id,
    userId: ownerId,
  }), null);
});

test("mismatched, stale, malformed, or ambiguous relation metadata is rejected", () => {
  assert.equal(normalizeTransactionSubcategory({
    relation: systemChild,
    categoryId: "transport",
    subcategoryId: systemChild.id,
    userId: ownerId,
  }), null);
  assert.equal(normalizeTransactionSubcategory({
    relation: { ...systemChild, name: null },
    categoryId: "food",
    subcategoryId: systemChild.id,
    userId: ownerId,
  }), null);
  assert.equal(normalizeTransactionSubcategory({
    relation: [systemChild, systemChild],
    categoryId: "food",
    subcategoryId: systemChild.id,
    userId: ownerId,
  }), null);
});

test("main list, calendar/mobile feed, and dashboard recent rows share the formatter", () => {
  assert.match(workspaceSource, /transaction-feed-secondary[\s\S]*?formatTransactionCategoryLabel\(row\.category, row\.subcategory\?\.name\)/);
  assert.match(workspaceSource, /transaction-category-cell[\s\S]*?formatTransactionCategoryLabel\(row\.category, row\.subcategory\?\.name\)/);
  assert.match(dashboardSource, /dashboard-recent-category-cell[\s\S]*?formatTransactionCategoryLabel\(tx\.category, tx\.subcategory\?\.name\)/);
  assert.match(dashboardSource, /dashboard-transaction-feed-footer[\s\S]*?formatTransactionCategoryLabel\(tx\.category, tx\.subcategory\?\.name\)/);
});

test("transaction detail uses separate category and optional subcategory fields", () => {
  assert.match(workspaceSource, />Kategori<\/dt><dd>\{row\.category\}<\/dd>/);
  assert.match(workspaceSource, /\{row\.subcategory && <div><dt>[\s\S]*?>Subkategori<\/dt><dd>\{row\.subcategory\.name\}<\/dd>/);
});

test("transaction reads hydrate in-query and search includes the child without changing existing matches", () => {
  for (const source of [workspaceSource, dashboardSource]) {
    assert.match(source, /subcategories \(id, category_id, user_id, name, is_system, system_key, icon_name, color_hex, created_at\)/);
    assert.match(source, /normalizeTransactionSubcategory\(/);
    assert.doesNotMatch(source, /createAdminClient|SUPABASE_SERVICE_ROLE|service[_-]role/i);
  }
  assert.match(workspaceSource, /matchSubcategory = row\.subcategory\?\.name\.toLowerCase\(\)\.includes\(q\)/);
  assert.match(workspaceSource, /matchMerchant/);
  assert.match(workspaceSource, /matchCategory/);
});
