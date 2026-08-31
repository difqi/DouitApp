import assert from "node:assert/strict";
import test from "node:test";

import { authorizeBudgetAlertUser } from "./budget-alert-authorization.ts";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";

test("rejects an unauthenticated budget-alert request", () => {
  assert.deepEqual(authorizeBudgetAlertUser(null), { authorized: false, status: 401 });
});

test("rejects an authenticated attempt to process another user", () => {
  assert.deepEqual(authorizeBudgetAlertUser(userA, userB), { authorized: false, status: 403 });
  assert.deepEqual(authorizeBudgetAlertUser(userA, 123), { authorized: false, status: 403 });
});

test("derives the processing identity from the authenticated user", () => {
  assert.deepEqual(authorizeBudgetAlertUser(userA), { authorized: true, userId: userA });
  assert.deepEqual(authorizeBudgetAlertUser(userA, userA), { authorized: true, userId: userA });
});
