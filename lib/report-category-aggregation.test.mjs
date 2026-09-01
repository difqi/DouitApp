import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateApprovedTransactionsByParentCategory,
  calculateParentBudgetUsage,
  filterTransactionsByParentCategory,
} from "./report-category-aggregation.ts";

const food = { id: "food", name: "Makanan & Minuman", budget_limit: 500_000 };
const transport = { id: "transport", name: "Transportasi", budget_limit: 300_000 };
const salary = { id: "salary", name: "Gaji", budget_limit: 0 };

const transaction = ({
  id,
  amount,
  categoryId = "food",
  subcategoryId = null,
  type = "EXPENSE",
  status = "APPROVED",
  categoryName = "Makanan & Minuman",
}) => ({
  id,
  amount,
  category_id: categoryId,
  subcategory_id: subcategoryId,
  type,
  status,
  categories: { name: categoryName },
});

const baseRows = [
  transaction({ id: "dining", amount: 100_000, subcategoryId: "system-dining" }),
  transaction({ id: "snacks", amount: 50_000, subcategoryId: "system-snacks" }),
  transaction({ id: "parent-only", amount: 25_000 }),
  transaction({ id: "custom", amount: 75_000, subcategoryId: "owner-meal-prep" }),
];

test("system-child, custom-child, and parent-only expenses count exactly once under the parent", () => {
  const [summary] = aggregateApprovedTransactionsByParentCategory(baseRows, [food]);
  assert.equal(summary.categoryId, "food");
  assert.equal(summary.expense, 250_000);
  assert.equal(summary.count, 4);
  assert.notEqual(summary.expense, 425_000);
});

test("deleting a used child does not change report totals or parent budget state", () => {
  const before = aggregateApprovedTransactionsByParentCategory(baseRows, [food])[0];
  const afterRows = baseRows.map((row) => row.id === "custom" ? { ...row, subcategory_id: null } : row);
  const after = aggregateApprovedTransactionsByParentCategory(afterRows, [food])[0];

  assert.equal(after.expense, before.expense);
  assert.deepEqual(
    calculateParentBudgetUsage(after.expense, after.budget),
    calculateParentBudgetUsage(before.expense, before.budget),
  );
  assert.deepEqual(calculateParentBudgetUsage(after.expense, after.budget), {
    spent: 250_000,
    remaining: 250_000,
    usagePercentage: 50,
  });
});

test("multiple parents remain isolated regardless of child assignment", () => {
  const rows = [
    ...baseRows,
    transaction({
      id: "bus",
      amount: 80_000,
      categoryId: "transport",
      subcategoryId: "system-public-transport",
      categoryName: "Transportasi",
    }),
  ];
  const summaries = aggregateApprovedTransactionsByParentCategory(rows, [food, transport]);
  assert.equal(summaries.find((summary) => summary.categoryId === "food")?.expense, 250_000);
  assert.equal(summaries.find((summary) => summary.categoryId === "transport")?.expense, 80_000);
});

test("income and non-approved rows preserve their existing accounting semantics", () => {
  const rows = [
    ...baseRows,
    transaction({ id: "salary", amount: 900_000, categoryId: "salary", subcategoryId: "salary-main", type: "INCOME", categoryName: "Gaji" }),
    transaction({ id: "pending-child", amount: 500_000, subcategoryId: "system-dining", status: "PENDING_APPROVAL" }),
    transaction({ id: "ignored-parent", amount: 700_000, status: "IGNORED" }),
  ];
  const summaries = aggregateApprovedTransactionsByParentCategory(rows, [food, salary]);
  assert.equal(summaries.find((summary) => summary.categoryId === "food")?.expense, 250_000);
  assert.equal(summaries.find((summary) => summary.categoryId === "salary")?.income, 900_000);
  assert.equal(summaries.find((summary) => summary.categoryId === "salary")?.expense, 0);
});

test("parent category filter includes null, system, and custom children but excludes other parents", () => {
  const rows = [
    ...baseRows,
    transaction({ id: "transport", amount: 10_000, categoryId: "transport", subcategoryId: "system-public-transport", categoryName: "Transportasi" }),
  ];
  assert.deepEqual(
    filterTransactionsByParentCategory(rows, "food").map((row) => row.id),
    ["dining", "snacks", "parent-only", "custom"],
  );
});

test("same-name parents do not collide because category_id is the aggregation identity", () => {
  const rows = [
    transaction({ id: "system-other", amount: 40_000, categoryId: "system-other", categoryName: "Lain-lain" }),
    transaction({ id: "custom-other", amount: 60_000, categoryId: "custom-other", categoryName: "Lain-lain" }),
  ];
  const summaries = aggregateApprovedTransactionsByParentCategory(rows);
  assert.equal(summaries.length, 2);
  assert.deepEqual(summaries.map((summary) => summary.expense), [60_000, 40_000]);
});

test("malformed or deleted child metadata cannot break parent aggregation", () => {
  const rows = [
    { ...baseRows[0], subcategory_id: "stale-child", subcategories: { name: null } },
    { ...baseRows[1], subcategory_id: null, subcategories: undefined },
  ];
  assert.equal(aggregateApprovedTransactionsByParentCategory(rows, [food])[0].expense, 150_000);
});

test("report, dashboard, and budget-alert sources keep financial logic on raw parent fields", async () => {
  const [reportSource, dashboardSource, alertSource] = await Promise.all([
    readFile(new URL("../app/(dashboard)/laporan/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("./savingsAlert.ts", import.meta.url), "utf8"),
  ]);

  assert.match(reportSource, /aggregateApprovedTransactionsByParentCategory\(filteredTx, categories\)/);
  assert.match(dashboardSource, /aggregateApprovedTransactionsByParentCategory\(currentTransactions\)/);
  assert.match(alertSource, /\.eq\('type', 'EXPENSE'\)[\s\S]*?\.eq\('status', 'APPROVED'\)/);
  assert.doesNotMatch(alertSource, /\.eq\(['"]subcategory_id['"]/);
});
