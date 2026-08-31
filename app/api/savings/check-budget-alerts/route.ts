import { NextResponse } from 'next/server';
import { checkAndSendOverBudgetAlert } from '@/lib/savingsAlert';
import { authorizeBudgetAlertUser } from '@/lib/budget-alert-authorization';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    const body: unknown = await req.json().catch(() => ({}));
    const requestedUserId = body && typeof body === 'object' && 'userId' in body
      ? (body as { userId?: unknown }).userId
      : undefined;
    const authorization = authorizeBudgetAlertUser(
      authError ? null : user?.id,
      requestedUserId,
    );

    if (!authorization.authorized) {
      const error = authorization.status === 401 ? 'Unauthorized' : 'Forbidden';
      return NextResponse.json({ success: false, error }, { status: authorization.status });
    }

    await checkAndSendOverBudgetAlert(authorization.userId, createAdminClient());
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[API: check-budget-alerts] Error:', err?.message || err);
    return NextResponse.json({ success: false, error: err?.message || 'Internal Error' }, { status: 500 });
  }
}
