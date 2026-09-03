-- Phase 4.3 post-migration verification. Run after the migration and compare
-- section 4 fingerprints with the retained preflight result.

-- 1. Expected: one nullable TEXT column with no default.
SELECT
  count(*) AS compatible_column_count,
  CASE
    WHEN count(*) = 1 THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS verification_status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'transactions'
  AND column_name = 'transaction_kind'
  AND data_type = 'text'
  AND is_nullable = 'YES'
  AND column_default IS NULL;

-- 2. Expected: one validated check constraint. Inspect definition for the exact
-- ORDINARY/TRANSFER/SAVING/FEE nullable vocabulary.
SELECT
  constraint_row.conname,
  constraint_row.convalidated,
  pg_get_constraintdef(constraint_row.oid) AS definition,
  CASE
    WHEN constraint_row.conname = 'transactions_transaction_kind_check'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated IS TRUE
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%ORDINARY%'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%TRANSFER%'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%SAVING%'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%FEE%'
    THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS verification_status
FROM pg_constraint constraint_row
WHERE constraint_row.conrelid = 'public.transactions'::regclass
  AND constraint_row.conname = 'transactions_transaction_kind_check';

-- 3. Expected unexpected_kind_count = 0. Immediately after a first schema-only
-- rollout and before application writes, expected explicit_kind_count = 0.
SELECT
  count(*) FILTER (WHERE transaction_kind IS NULL) AS legacy_null_kind_count,
  count(*) FILTER (WHERE transaction_kind IS NOT NULL) AS explicit_kind_count,
  count(*) FILTER (
    WHERE transaction_kind IS NOT NULL
      AND transaction_kind NOT IN ('ORDINARY', 'TRANSFER', 'SAVING', 'FEE')
  ) AS unexpected_kind_count
FROM public.transactions;

-- 4. Must exactly match the final row from the preflight audit. The migration
-- also asserts these fields inside its transaction before COMMIT.
SELECT
  count(*) AS transaction_count,
  coalesce(sum(amount), 0) AS amount_sum,
  md5(coalesce(string_agg(
    md5(concat_ws('|', id::text, amount::text)),
    '' ORDER BY id
  ), '')) AS amount_fingerprint,
  md5(coalesce(string_agg(
    md5(concat_ws('|', id::text, coalesce(category_id::text, '<NULL>'))),
    '' ORDER BY id
  ), '')) AS category_id_fingerprint,
  md5(coalesce(string_agg(
    md5(concat_ws('|', id::text, coalesce(subcategory_id::text, '<NULL>'))),
    '' ORDER BY id
  ), '')) AS subcategory_id_fingerprint,
  md5(coalesce(string_agg(
    md5(concat_ws('|', id::text, status::text)),
    '' ORDER BY id
  ), '')) AS status_fingerprint
FROM public.transactions;

-- 5. RLS remains enabled and existing policies remain inventory-visible; this
-- migration does not create, drop, or loosen transaction policies.
SELECT
  class_row.relrowsecurity AS rls_enabled,
  count(policy_row.policyname) AS transaction_policy_count,
  CASE
    WHEN class_row.relrowsecurity IS TRUE
      AND count(policy_row.policyname) > 0
    THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS verification_status
FROM pg_class class_row
JOIN pg_namespace namespace_row ON namespace_row.oid = class_row.relnamespace
LEFT JOIN pg_policies policy_row
  ON policy_row.schemaname = namespace_row.nspname
 AND policy_row.tablename = class_row.relname
WHERE namespace_row.nspname = 'public'
  AND class_row.relname = 'transactions'
GROUP BY class_row.relrowsecurity;
