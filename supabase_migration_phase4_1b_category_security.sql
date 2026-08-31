-- Phase 4.1B: Category Security
-- MANUAL REVIEW + EXECUTION REQUIRED. This file is never run by application code.
-- Data impact: NONE. No category or transaction row is inserted, updated, or deleted.

BEGIN;

-- Abort before any policy/RLS change when live category rows violate the
-- ownership invariant. Data remediation must be reviewed separately.
DO $$
DECLARE
  null_is_system bigint;
  system_with_owner bigint;
  custom_without_owner bigint;
BEGIN
  SELECT
    count(*) FILTER (WHERE is_system IS NULL),
    count(*) FILTER (WHERE is_system IS TRUE AND user_id IS NOT NULL),
    count(*) FILTER (WHERE is_system IS FALSE AND user_id IS NULL)
  INTO null_is_system, system_with_owner, custom_without_owner
  FROM public.categories;

  IF null_is_system + system_with_owner + custom_without_owner > 0 THEN
    RAISE EXCEPTION
      'Category ownership invariant violations: null_is_system=%, system_with_owner=%, custom_without_owner=%',
      null_is_system,
      system_with_owner,
      custom_without_owner;
  END IF;
END
$$;

-- Fail closed when production contains a policy that is not represented in the
-- repository audit. Review that policy explicitly instead of guessing its intent.
DO $$
DECLARE
  unknown_policy text;
BEGIN
  SELECT string_agg(policyname, ', ' ORDER BY policyname)
  INTO unknown_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'categories'
    AND policyname <> ALL (ARRAY[
      'Categories are viewable by everyone',
      'Users can view system and own categories',
      'Users can insert own categories',
      'Users can update own categories',
      'Users can delete own categories',
      'Users can view system categories and their own categories',
      'Users can insert their own categories',
      'Users can update their own categories',
      'Users can delete their own categories',
      'categories_select_own_or_system',
      'categories_insert_own_custom',
      'categories_update_own_custom',
      'categories_delete_own_custom'
    ]);

  IF unknown_policy IS NOT NULL THEN
    RAISE EXCEPTION 'Unreviewed categories policies found: %', unknown_policy;
  END IF;
END
$$;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Policy names confirmed in repository schema/migrations.
DROP POLICY IF EXISTS "Categories are viewable by everyone" ON public.categories;
DROP POLICY IF EXISTS "Users can view system and own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can insert own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can update own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can delete own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can view system categories and their own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can insert their own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can update their own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can delete their own categories" ON public.categories;

-- Canonical names are also dropped to keep re-execution idempotent.
DROP POLICY IF EXISTS "categories_select_own_or_system" ON public.categories;
DROP POLICY IF EXISTS "categories_insert_own_custom" ON public.categories;
DROP POLICY IF EXISTS "categories_update_own_custom" ON public.categories;
DROP POLICY IF EXISTS "categories_delete_own_custom" ON public.categories;

-- No anon policy is created. Current source only loads categories after a user is
-- authenticated. Service-role webhook/cron clients bypass RLS and are scoped in code.
CREATE POLICY "categories_select_own_or_system"
ON public.categories
FOR SELECT
TO authenticated
USING (
  (is_system IS TRUE AND user_id IS NULL)
  OR
  (is_system IS FALSE AND user_id = auth.uid())
);

CREATE POLICY "categories_insert_own_custom"
ON public.categories
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND is_system IS FALSE
);

CREATE POLICY "categories_update_own_custom"
ON public.categories
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND is_system IS FALSE
)
WITH CHECK (
  user_id = auth.uid()
  AND is_system IS FALSE
);

CREATE POLICY "categories_delete_own_custom"
ON public.categories
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  AND is_system IS FALSE
);

COMMIT;

-- Intentionally unchanged in Phase 4.1B:
-- * categories.is_system database default
-- * categories.budget_limit legacy column
-- * category IDs and all category/transaction data
