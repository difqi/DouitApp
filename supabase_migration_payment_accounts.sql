-- 1. Create payment_accounts table
CREATE TABLE IF NOT EXISTS public.payment_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('bank', 'wallet', 'cash')),
    initial_balance NUMERIC DEFAULT 0,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- 2. Enable RLS & Indexes
CREATE INDEX IF NOT EXISTS idx_payment_accounts_user ON public.payment_accounts(user_id);
ALTER TABLE public.payment_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own accounts" ON public.payment_accounts;
CREATE POLICY "Users can view own accounts" ON public.payment_accounts FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own accounts" ON public.payment_accounts;
CREATE POLICY "Users can insert own accounts" ON public.payment_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own accounts" ON public.payment_accounts;
CREATE POLICY "Users can update own accounts" ON public.payment_accounts FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own accounts" ON public.payment_accounts;
CREATE POLICY "Users can delete own accounts" ON public.payment_accounts FOR DELETE USING (auth.uid() = user_id);
