-- Migration to add 'notes' to transactions and 'keyword' to user_merchant_rules
-- Please run this script in your Supabase SQL Editor

ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.user_merchant_rules 
ADD COLUMN IF NOT EXISTS keyword TEXT;
