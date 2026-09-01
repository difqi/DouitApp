import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsSource = await readFile(
  new URL("../app/(dashboard)/settings/page.tsx", import.meta.url),
  "utf8",
);
const confirmDialogSource = await readFile(
  new URL("../app/components/ui/ConfirmDialog.tsx", import.meta.url),
  "utf8",
);
const taxonomyMigrationSource = await readFile(
  new URL("../supabase_migration_phase4_2a_taxonomy_foundation.sql", import.meta.url),
  "utf8",
);

test("Settings keeps normal CRUD on the session browser client without service role", () => {
  assert.match(settingsSource, /createClient\(\)/);
  assert.doesNotMatch(settingsSource, /createAdminClient|SUPABASE_SERVICE_ROLE|service[_-]role/i);
});

test("Settings does not remove a visible special parent before rendering eligibility controls", () => {
  assert.match(settingsSource, /setCategories\(cats\.map\(\(category\) => \(\{/);
  assert.doesNotMatch(settingsSource, /cats\.filter\([\s\S]*?SYSTEM_CATEGORY_NAMES\.SAVING/);
  assert.match(settingsSource, /const canCreate = eligibility\.status === 'eligible'/);
});

test("custom insert identity is derived from the authenticated Settings user", () => {
  assert.match(settingsSource, /buildCustomSubcategoryInsertPayload\(\{[\s\S]*?userId: user\.id,/);
  assert.doesNotMatch(settingsSource, /setSubcategoryUser|subcategoryUserId|callerUserId/);
});

test("edit and delete whitelist owned custom rows", () => {
  assert.match(settingsSource, /\.update\(buildCustomSubcategoryUpdatePayload\(/);
  assert.match(settingsSource, /\.eq\('id', subcategoryEditor\.subcategoryId \|\| ''\)[\s\S]*?\.eq\('user_id', user\.id\)[\s\S]*?\.eq\('is_system', false\)/);
  assert.match(settingsSource, /\.delete\(\)[\s\S]*?\.eq\('id', current\.id\)[\s\S]*?\.eq\('user_id', user\.id\)[\s\S]*?\.eq\('is_system', false\)/);
  assert.match(settingsSource, /const manageable = !!user && canManageSubcategory\(subcategory, user\.id\)/);
});

test("transaction usage is count-only and explicitly own-user scoped", () => {
  assert.match(settingsSource, /\.from\('transactions'\)[\s\S]*?\.select\('id', \{ count: 'exact', head: true \}\)[\s\S]*?\.eq\('user_id', user\.id\)[\s\S]*?\.eq\('subcategory_id', subcategory\.id\)/);
  assert.match(settingsSource, /Subkategori ini digunakan oleh \$\{subcategoryDeleteTarget\.usageCount\} transaksi/);
  assert.match(settingsSource, /Hapus subkategori \"\$\{subcategoryDeleteTarget\.subcategory\.name\}\"\?/);
});

test("parent deletion checks children before preserving transaction reassignment", () => {
  const childCountPosition = settingsSource.indexOf(".from('subcategories')", settingsSource.indexOf("executeDeleteCategory"));
  const reassignPosition = settingsSource.indexOf(".from('transactions')", settingsSource.indexOf("executeDeleteCategory"));
  assert.ok(childCountPosition > -1);
  assert.ok(reassignPosition > childCountPosition);
  assert.match(settingsSource, /CATEGORY_HAS_CHILDREN_MESSAGE/);
  assert.match(settingsSource, /isPostgresForeignKeyViolation\(error\)/);
  assert.match(settingsSource.slice(reassignPosition), /\.update\(\{ category_id: lainLain\.id \}\)/);
});

test("subcategory deletion relies only on the verified SET NULL FK for transaction impact", () => {
  const start = settingsSource.indexOf("const executeDeleteSubcategory");
  const end = settingsSource.indexOf("const handleDeleteRule", start);
  const deleteFlow = settingsSource.slice(start, end);
  assert.doesNotMatch(deleteFlow, /\.from\('transactions'\)|category_id|amount|merchant|status|date/);
  assert.match(taxonomyMigrationSource, /FOREIGN KEY \(subcategory_id\)[\s\S]*?REFERENCES public\.subcategories\(id\)[\s\S]*?ON DELETE SET NULL/);
});

test("confirmation dialog waits for async outcome, prevents repeats, and manages focus", () => {
  assert.match(confirmDialogSource, /const shouldClose = await onConfirm\(\)/);
  assert.match(confirmDialogSource, /if \(shouldClose !== false\) onClose\(\)/);
  assert.match(confirmDialogSource, /role="alertdialog"/);
  assert.match(confirmDialogSource, /event\.key === "Escape"/);
  assert.match(confirmDialogSource, /event\.key !== "Tab"/);
  assert.match(confirmDialogSource, /returnFocusRef\.current\?\.focus\(\)/);
});
