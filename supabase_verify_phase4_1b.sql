-- Phase 4.1B read-only verification. Run manually AFTER the security migration.
-- This script does not mutate schema or data.

-- 1. RLS must be enabled.
SELECT c.relrowsecurity AS categories_rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'categories';

-- 2. Exactly the four canonical authenticated policies should remain.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'categories'
ORDER BY policyname;

WITH canonical_policy(policyname) AS (
  VALUES
    ('categories_select_own_or_system'),
    ('categories_insert_own_custom'),
    ('categories_update_own_custom'),
    ('categories_delete_own_custom')
), category_policies AS (
  SELECT policyname
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'categories'
)
SELECT
  count(*) AS total_category_policy_count,
  count(*) FILTER (
    WHERE policyname IN (SELECT policyname FROM canonical_policy)
  ) AS canonical_policy_count,
  CASE
    WHEN count(*) = 4
      AND count(*) FILTER (
        WHERE policyname IN (SELECT policyname FROM canonical_policy)
      ) = 4
    THEN 'EXACTLY_4_CANONICAL_POLICIES'
    ELSE 'INVESTIGATE'
  END AS verification_status
FROM category_policies;

-- 3. Ownership invariant exceptions. All counts should be zero.
SELECT
  count(*) FILTER (WHERE is_system IS NULL) AS null_is_system,
  count(*) FILTER (WHERE is_system IS TRUE AND user_id IS NOT NULL) AS system_with_owner,
  count(*) FILTER (WHERE is_system IS FALSE AND user_id IS NULL) AS custom_without_owner
FROM public.categories;

-- 4. Temporary special system names must resolve exactly once as system + NULL owner.
WITH expected(name) AS (
  VALUES ('Lain-lain'), ('Nabung'), ('Biaya Admin'), ('Transfer')
)
SELECT e.name, count(c.id) AS canonical_system_row_count
FROM expected e
LEFT JOIN public.categories c
  ON lower(trim(c.name)) = lower(e.name)
 AND c.is_system IS TRUE
 AND c.user_id IS NULL
GROUP BY e.name
ORDER BY e.name;

-- 5. Current mismatch baseline was 12 at the Phase 4.1A checkpoint.
-- Phase 4.1B performs no historical correction; any difference needs investigation.
SELECT
  count(*) AS transaction_category_type_mismatches,
  CASE WHEN count(*) = 12 THEN 'MATCHES_PHASE_4_1A_BASELINE'
       ELSE 'BASELINE_CHANGED_INVESTIGATE'
  END AS verification_status
FROM public.transactions t
JOIN public.categories c ON c.id = t.category_id
WHERE upper(t.type::text) <> upper(c.type::text);

-- 6. Approved NULL category rows remain review-only in this phase.
SELECT
  count(*) AS approved_null_category_count,
  CASE WHEN count(*) = 3 THEN 'MATCHES_PHASE_4_1A_BASELINE'
       ELSE 'BASELINE_CHANGED_INVESTIGATE'
  END AS verification_status
FROM public.transactions
WHERE status::text = 'APPROVED' AND category_id IS NULL;

-- Manual API verification (cannot be proven from SQL Editor's privileged role):
-- A. With only NEXT_PUBLIC_SUPABASE_ANON_KEY and no user session, SELECT categories;
--    expected: zero rows.
-- B. As authenticated user A, expected: canonical system rows + only A's custom rows.
-- C. Attempt INSERT with is_system=true, UPDATE/DELETE a system row, or access user B's
--    custom row as A; each operation must be rejected or affect zero rows.
