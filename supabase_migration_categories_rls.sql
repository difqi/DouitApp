-- Migration: Enforce RLS policies on the categories table
-- This resolves the "new row violates row-level security policy" error.

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Allow users to read both global system categories and their own categories
DROP POLICY IF EXISTS "Users can view system categories and their own categories" ON public.categories;
CREATE POLICY "Users can view system categories and their own categories"
  ON public.categories
  FOR SELECT
  USING (
    auth.uid() = user_id OR (user_id IS NULL AND is_system = true)
  );

-- Allow authenticated users to insert their own personalized categories
DROP POLICY IF EXISTS "Users can insert their own categories" ON public.categories;
CREATE POLICY "Users can insert their own categories"
  ON public.categories
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to update their own personalized categories
DROP POLICY IF EXISTS "Users can update their own categories" ON public.categories;
CREATE POLICY "Users can update their own categories"
  ON public.categories
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to delete their own personalized categories
DROP POLICY IF EXISTS "Users can delete their own categories" ON public.categories;
CREATE POLICY "Users can delete their own categories"
  ON public.categories
  FOR DELETE
  USING (auth.uid() = user_id);
