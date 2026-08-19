-- Migration: Create category_budgets and cleanup duplicates
-- Description: Decouples category budgets from the categories table and removes auto-created duplicates.

-- 1. Create category_budgets table
CREATE TABLE IF NOT EXISTS public.category_budgets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  amount NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, category_id)
);

-- 2. Enable RLS and add basic policies
ALTER TABLE public.category_budgets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'category_budgets' AND policyname = 'Users can view their own category budgets'
  ) THEN
    CREATE POLICY "Users can view their own category budgets"
      ON public.category_budgets FOR SELECT USING (auth.uid() = user_id);
    
    CREATE POLICY "Users can insert their own category budgets"
      ON public.category_budgets FOR INSERT WITH CHECK (auth.uid() = user_id);
    
    CREATE POLICY "Users can update their own category budgets"
      ON public.category_budgets FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    
    CREATE POLICY "Users can delete their own category budgets"
      ON public.category_budgets FOR DELETE USING (auth.uid() = user_id);
  END IF;
END
$$;

-- 3. Data Migration & Cleanup

DO $$
DECLARE
    dup_record RECORD;
    sys_cat_id UUID;
    non_dup_record RECORD;
BEGIN
    -- A. Migrate duplicates (custom categories that share a name case-insensitively with a system category)
    FOR dup_record IN 
        SELECT c_dup.id as dup_id, c_dup.user_id, c_dup.name, c_dup.budget_limit
        FROM public.categories c_dup
        WHERE c_dup.is_system = false
          AND EXISTS (
              SELECT 1 FROM public.categories c_sys 
              WHERE c_sys.is_system = true 
                AND lower(c_sys.name) = lower(c_dup.name)
          )
    LOOP
        -- Find the system category ID
        SELECT id INTO sys_cat_id FROM public.categories 
        WHERE is_system = true AND lower(name) = lower(dup_record.name) LIMIT 1;

        -- If budget > 0, UPSERT to category_budgets under the system category ID
        IF dup_record.budget_limit > 0 THEN
            INSERT INTO public.category_budgets (user_id, category_id, amount)
            VALUES (dup_record.user_id, sys_cat_id, dup_record.budget_limit)
            ON CONFLICT (user_id, category_id) DO UPDATE 
            SET amount = EXCLUDED.amount, updated_at = now();
        END IF;

        -- Reassign transactions to the system category
        UPDATE public.transactions 
        SET category_id = sys_cat_id 
        WHERE category_id = dup_record.dup_id;

        -- Delete the duplicate custom category
        DELETE FROM public.categories WHERE id = dup_record.dup_id;
    END LOOP;

    -- B. Migrate non-duplicate custom categories
    FOR non_dup_record IN
        SELECT id, user_id, budget_limit 
        FROM public.categories 
        WHERE is_system = false 
          AND budget_limit > 0
          -- Not matching any system category name (which we just deleted above anyway)
    LOOP
        INSERT INTO public.category_budgets (user_id, category_id, amount)
        VALUES (non_dup_record.user_id, non_dup_record.id, non_dup_record.budget_limit)
        ON CONFLICT (user_id, category_id) DO UPDATE 
        SET amount = EXCLUDED.amount, updated_at = now();
    END LOOP;
END
$$;
