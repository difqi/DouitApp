import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("route authenticates and passes only the authorized identity to the admin helper", async () => {
  const source = await readFile(new URL("../app/api/savings/check-budget-alerts/route.ts", import.meta.url), "utf8");
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /authorizeBudgetAlertUser\(/);
  assert.match(source, /checkAndSendOverBudgetAlert\(authorization\.userId,/);
  assert.doesNotMatch(source, /checkAndSendOverBudgetAlert\(requestedUserId,/);
});

test("server action has no caller-controlled user ID parameter", async () => {
  const source = await readFile(new URL("../app/actions/savings-alert.ts", import.meta.url), "utf8");
  assert.match(source, /export async function triggerBudgetAlertCheck\(\)/);
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /checkAndSendOverBudgetAlert\(authorization\.userId,/);
});
