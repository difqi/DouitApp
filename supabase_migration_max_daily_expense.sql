-- Add max_daily_expense column to savings_goals
ALTER TABLE public.savings_goals 
ADD COLUMN IF NOT EXISTS max_daily_expense NUMERIC(15, 2) DEFAULT NULL;
