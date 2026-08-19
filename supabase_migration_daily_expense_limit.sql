-- Migration: Add daily_expense_limit to profiles
-- Safe and idempotent for all environments

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS daily_expense_limit NUMERIC(15, 2) DEFAULT NULL;
