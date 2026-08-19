'use server';

import { checkAndSendOverBudgetAlert } from '@/lib/savingsAlert';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

/**
 * Server Action to evaluate budget thresholds (75% warning & 100% over-budget)
 * and dispatch WhatsApp alerts securely from the server runtime.
 * 
 * Safely accesses FONNTE_API_TOKEN without exposing secrets to the browser.
 */
export async function triggerBudgetAlertCheck(userId: string) {
  try {
    if (!userId) {
      return { success: false, error: 'User ID is required' };
    }

    await checkAndSendOverBudgetAlert(userId, supabaseAdmin);
    return { success: true };
  } catch (err: any) {
    console.error('[Server Action: triggerBudgetAlertCheck] Error:', err?.message || err);
    return { success: false, error: err?.message || 'Failed to check budget alert' };
  }
}
