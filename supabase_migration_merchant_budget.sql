-- Migration: Add budget_limit to user_merchant_rules
-- Instructions: Run this script in the Supabase SQL Editor to support Merchant level budget limits

ALTER TABLE public.user_merchant_rules 
ADD COLUMN IF NOT EXISTS budget_limit NUMERIC DEFAULT 0;
