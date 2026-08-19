-- Migration to add accumulated_time_debt and total_delay_days to savings_goals
ALTER TABLE public.savings_goals 
ADD COLUMN IF NOT EXISTS mode VARCHAR(30) DEFAULT 'RELAXED',
ADD COLUMN IF NOT EXISTS accumulated_time_debt NUMERIC(10, 2) DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS total_delay_days INT DEFAULT 0;
