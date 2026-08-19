-- Migration: Add budget_limit to categories
-- Instructions: Run this script in the Supabase SQL Editor

ALTER TABLE public.categories 
ADD COLUMN IF NOT EXISTS budget_limit NUMERIC DEFAULT 0;
