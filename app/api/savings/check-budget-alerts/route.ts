import { NextResponse } from 'next/server';
import { checkAndSendOverBudgetAlert } from '@/lib/savingsAlert';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function POST(req: Request) {
  try {
    const body: any = await req.json().catch(() => ({}));
    const userId = body?.userId;

    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 });
    }

    await checkAndSendOverBudgetAlert(userId, supabaseAdmin);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[API: check-budget-alerts] Error:', err?.message || err);
    return NextResponse.json({ success: false, error: err?.message || 'Internal Error' }, { status: 500 });
  }
}
