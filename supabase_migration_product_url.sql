-- Add product_url column to savings_goals
ALTER TABLE public.savings_goals 
ADD COLUMN IF NOT EXISTS product_url TEXT DEFAULT NULL;

-- Make image_url nullable
ALTER TABLE public.savings_goals 
ALTER COLUMN image_url DROP NOT NULL;
