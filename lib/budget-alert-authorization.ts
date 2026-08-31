export type BudgetAlertAuthorization =
  | { authorized: true; userId: string }
  | { authorized: false; status: 401 | 403 };

export function authorizeBudgetAlertUser(
  authenticatedUserId: string | null | undefined,
  requestedUserId?: unknown,
): BudgetAlertAuthorization {
  if (!authenticatedUserId) return { authorized: false, status: 401 };
  if (requestedUserId !== undefined && requestedUserId !== authenticatedUserId) {
    return { authorized: false, status: 403 };
  }
  return { authorized: true, userId: authenticatedUserId };
}
