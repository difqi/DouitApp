'use server';

import { checkAndSendOverBudgetAlert } from '@/lib/savingsAlert';
import { authorizeBudgetAlertUser } from '@/lib/budget-alert-authorization';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Server Action to evaluate budget thresholds (75% warning & 100% over-budget)
 * and dispatch WhatsApp alerts securely from the server runtime.
 * 
 * Safely accesses FONNTE_API_TOKEN without exposing secrets to the browser.
 */
export async function triggerBudgetAlertCheck() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    const authorization = authorizeBudgetAlertUser(authError ? null : user?.id);
    if (!authorization.authorized) {
      return { success: false, error: 'Unauthorized' };
    }

    await checkAndSendOverBudgetAlert(authorization.userId, createAdminClient());
    return { success: true };
  } catch (err: any) {
    console.error('[Server Action: triggerBudgetAlertCheck] Error:', err?.message || err);
    return { success: false, error: err?.message || 'Failed to check budget alert' };
  }
}
