-- Phase 4.3 read-only preflight. Run before the schema migration and retain
-- the final fingerprint row for comparison with the verification script.
-- This file intentionally performs no historical semantic classification.

-- 1. Existing transaction columns that may overlap semantic direction/nature.
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'transactions'
  AND column_name IN (
    'type',
    'source',
    'status',
    'category_id',
    'subcategory_id',
    'is_internal_transfer',
    'transaction_kind'
  )
ORDER BY ordinal_position;

-- 2. Overall/null-category baseline.
SELECT
  count(*) AS total_transactions,
  count(*) FILTER (WHERE category_id IS NULL) AS null_category_rows,
  count(*) FILTER (
    WHERE category_id IS NULL AND status::text = 'APPROVED'
  ) AS approved_null_category_rows
FROM public.transactions;

-- 3. Canonical special-parent uniqueness/type contract.
SELECT
  special.name,
  count(category_row.id) AS canonical_row_count,
  array_agg(category_row.type::text ORDER BY category_row.id)
    FILTER (WHERE category_row.id IS NOT NULL) AS canonical_types
FROM (VALUES ('Nabung'), ('Biaya Admin'), ('Transfer')) AS special(name)
LEFT JOIN public.categories category_row
  ON lower(trim(category_row.name)) = lower(special.name)
 AND category_row.is_system IS TRUE
 AND category_row.user_id IS NULL
GROUP BY special.name
ORDER BY special.name;

-- 4. Transfer audit. Do not turn this result into a category-name backfill.
SELECT
  transaction_row.type::text AS transaction_type,
  transaction_row.source::text AS source,
  transaction_row.status::text AS status,
  count(*) AS row_count,
  min(transaction_row.created_at) AS earliest_created_at,
  max(transaction_row.created_at) AS latest_created_at
FROM public.transactions transaction_row
JOIN public.categories category_row ON category_row.id = transaction_row.category_id
WHERE lower(trim(category_row.name)) = lower('Transfer')
  AND category_row.is_system IS TRUE
  AND category_row.user_id IS NULL
GROUP BY
  transaction_row.type::text,
  transaction_row.source::text,
  transaction_row.status::text
ORDER BY transaction_type, source, status;

-- 5. Nabung semantic candidates. These counts do not imply savings-log linkage.
SELECT
  transaction_row.type::text AS transaction_type,
  transaction_row.source::text AS source,
  transaction_row.status::text AS status,
  count(*) AS candidate_saving_rows
FROM public.transactions transaction_row
JOIN public.categories category_row ON category_row.id = transaction_row.category_id
WHERE lower(trim(category_row.name)) = lower('Nabung')
  AND category_row.is_system IS TRUE
  AND category_row.user_id IS NULL
GROUP BY
  transaction_row.type::text,
  transaction_row.source::text,
  transaction_row.status::text
ORDER BY transaction_type, source, status;

-- 6. Biaya Admin semantic candidates.
SELECT
  transaction_row.type::text AS transaction_type,
  transaction_row.source::text AS source,
  transaction_row.status::text AS status,
  count(*) AS candidate_fee_rows
FROM public.transactions transaction_row
JOIN public.categories category_row ON category_row.id = transaction_row.category_id
WHERE lower(trim(category_row.name)) = lower('Biaya Admin')
  AND category_row.is_system IS TRUE
  AND category_row.user_id IS NULL
GROUP BY
  transaction_row.type::text,
  transaction_row.source::text,
  transaction_row.status::text
ORDER BY transaction_type, source, status;

-- 7. Savings-model inventory. Absence of a shared transaction/goal identifier
-- confirms that counts cannot be used as a structural one-to-one relationship.
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('transactions', 'savings_logs', 'savings_goals')
  AND (
    column_name IN ('id', 'goal_id', 'transaction_id', 'savings_log_id')
    OR column_name LIKE '%transaction%'
  )
ORDER BY table_name, ordinal_position;

SELECT
  (SELECT count(*) FROM public.savings_logs) AS total_savings_logs,
  (SELECT count(*)
   FROM public.transactions transaction_row
   JOIN public.categories category_row ON category_row.id = transaction_row.category_id
   WHERE lower(trim(category_row.name)) = lower('Nabung')
     AND category_row.is_system IS TRUE
     AND category_row.user_id IS NULL) AS canonical_nabung_transactions;

-- 8. Candidate counts for a separately reviewed future backfill. Phase 4.3
-- does not execute either update, and Transfer is intentionally omitted.
SELECT
  count(*) FILTER (
    WHERE lower(trim(category_row.name)) = lower('Nabung')
      AND category_row.is_system IS TRUE
      AND category_row.user_id IS NULL
  ) AS reviewed_saving_candidate_count,
  count(*) FILTER (
    WHERE lower(trim(category_row.name)) = lower('Biaya Admin')
      AND category_row.is_system IS TRUE
      AND category_row.user_id IS NULL
  ) AS reviewed_fee_candidate_count
FROM public.transactions transaction_row
JOIN public.categories category_row ON category_row.id = transaction_row.category_id;

-- 9. Historical financial/taxonomy fingerprints. Compare these exact values
-- with section 4 of supabase_verify_phase4_3_transaction_semantics.sql.
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
