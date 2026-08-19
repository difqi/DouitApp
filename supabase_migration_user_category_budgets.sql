-- Migration: Create user_category_budgets for system categories
-- Instructions: Run this script in the Supabase SQL Editor to allow users to set budgets on system categories

CREATE TABLE IF NOT EXISTS public.user_category_budgets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  budget_limit NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, category_id)
);

-- Optional: Enable RLS and add basic policies
ALTER TABLE public.user_category_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own category budgets"
  ON public.user_category_budgets
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own category budgets"
  ON public.user_category_budgets
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own category budgets"
  ON public.user_category_budgets
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own category budgets"
  ON public.user_category_budgets
  FOR DELETE
  USING (auth.uid() = user_id);
