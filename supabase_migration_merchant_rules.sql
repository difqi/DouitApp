CREATE TABLE IF NOT EXISTS public.merchant_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    merchant_name TEXT NOT NULL,
    category_id TEXT,
    keyword TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, merchant_name)
);

CREATE INDEX IF NOT EXISTS idx_merchant_rules_user ON public.merchant_rules(user_id);

ALTER TABLE public.merchant_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own merchant rules" ON public.merchant_rules;
CREATE POLICY "Users can view own merchant rules" 
ON public.merchant_rules FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own merchant rules" ON public.merchant_rules;
CREATE POLICY "Users can insert own merchant rules" 
ON public.merchant_rules FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own merchant rules" ON public.merchant_rules;
CREATE POLICY "Users can update own merchant rules" 
ON public.merchant_rules FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own merchant rules" ON public.merchant_rules;
CREATE POLICY "Users can delete own merchant rules" 
ON public.merchant_rules FOR DELETE USING (auth.uid() = user_id);
