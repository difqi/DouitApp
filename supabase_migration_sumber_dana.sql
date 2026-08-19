-- 1. Add sumber_dana column to transactions if it doesn't exist
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS sumber_dana TEXT DEFAULT 'Tunai';

-- 2. Add sumber_dana column to merchant_rules for default rules
ALTER TABLE public.merchant_rules 
ADD COLUMN IF NOT EXISTS sumber_dana TEXT;

-- 3. Update existing records with fallback
UPDATE public.transactions 
SET sumber_dana = 'Tunai' 
WHERE sumber_dana IS NULL;
