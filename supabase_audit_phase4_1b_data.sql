-- Phase 4.1B read-only remediation/merchant bridge analysis.
-- Do not turn these findings into UPDATE/DELETE statements without separate review.

-- A. Safe metadata for approved transactions with no category. No merchant, notes,
-- user ID, amount, or transaction ID is returned.
SELECT
  source::text AS source,
  type::text AS transaction_type,
  count(*) AS row_count,
  min(created_at) AS earliest_created_at,
  max(created_at) AS latest_created_at,
  count(*) FILTER (WHERE nullif(trim(merchant), '') IS NOT NULL) AS rows_with_merchant_hint,
  count(*) FILTER (WHERE nullif(trim(notes), '') IS NOT NULL) AS rows_with_notes_hint
FROM public.transactions
WHERE status::text = 'APPROVED' AND category_id IS NULL
GROUP BY source::text, type::text
ORDER BY source::text, type::text;

-- B. Transfer usage metadata. The display name is not treated as semantic identity.
SELECT
  t.type::text AS transaction_type,
  t.source::text AS source,
  t.status::text AS status,
  count(*) AS row_count,
  min(t.created_at) AS earliest_created_at,
  max(t.created_at) AS latest_created_at
FROM public.transactions t
JOIN public.categories c ON c.id = t.category_id
WHERE lower(trim(c.name)) = lower('Transfer')
  AND c.is_system IS TRUE
  AND c.user_id IS NULL
GROUP BY t.type::text, t.source::text, t.status::text
ORDER BY t.type::text, t.source::text, t.status::text;

-- C. Hashed duplicate groups in each merchant table. The normalization is exact,
-- case-insensitive, whitespace-collapsing, and separator-normalizing; it is not fuzzy.
WITH operational AS (
  SELECT
    user_id,
    lower(regexp_replace(regexp_replace(trim(merchant_name), '[.,:;|/_-]+', ' ', 'g'), '\s+', ' ', 'g')) AS normalized_key,
    category_id,
    keyword,
    sumber_dana
  FROM public.merchant_rules
), legacy AS (
  SELECT
    user_id,
    lower(regexp_replace(regexp_replace(trim(merchant_pattern), '[.,:;|/_-]+', ' ', 'g'), '\s+', ' ', 'g')) AS normalized_key,
    category_id::text AS category_id,
    keyword,
    budget_limit
  FROM public.user_merchant_rules
), duplicate_groups AS (
  SELECT
    'merchant_rules'::text AS source_table,
    md5(coalesce(user_id::text, '<NULL_USER>') || ':' || coalesce(normalized_key, '<NULL_KEY>')) AS group_key_hash,
    count(*) AS row_count,
    count(DISTINCT category_id) > 1 AS category_disagrees,
    count(DISTINCT keyword) FILTER (WHERE keyword IS NOT NULL) > 1 AS keyword_disagrees,
    count(DISTINCT sumber_dana) FILTER (WHERE sumber_dana IS NOT NULL) > 1 AS source_disagrees,
    false AS budget_disagrees
  FROM operational
  GROUP BY user_id, normalized_key
  HAVING count(*) > 1

  UNION ALL

  SELECT
    'user_merchant_rules'::text,
    md5(coalesce(user_id::text, '<NULL_USER>') || ':' || coalesce(normalized_key, '<NULL_KEY>')),
    count(*),
    count(DISTINCT category_id) > 1,
    count(DISTINCT keyword) FILTER (WHERE keyword IS NOT NULL) > 1,
    false,
    count(DISTINCT budget_limit) FILTER (WHERE budget_limit IS NOT NULL) > 1
  FROM legacy
  GROUP BY user_id, normalized_key
  HAVING count(*) > 1
)
SELECT * FROM duplicate_groups ORDER BY source_table, group_key_hash;

-- D. Hashed overlap groups and disagreements across operational/legacy tables.
WITH operational AS (
  SELECT
    user_id,
    lower(regexp_replace(regexp_replace(trim(merchant_name), '[.,:;|/_-]+', ' ', 'g'), '\s+', ' ', 'g')) AS normalized_key,
    category_id,
    keyword,
    sumber_dana
  FROM public.merchant_rules
), legacy AS (
  SELECT
    user_id,
    lower(regexp_replace(regexp_replace(trim(merchant_pattern), '[.,:;|/_-]+', ' ', 'g'), '\s+', ' ', 'g')) AS normalized_key,
    category_id::text AS category_id,
    keyword,
    budget_limit
  FROM public.user_merchant_rules
)
SELECT
  md5(coalesce(o.user_id::text, '<NULL_USER>') || ':' || coalesce(o.normalized_key, '<NULL_KEY>')) AS overlap_key_hash,
  count(*) AS pair_count,
  bool_or(o.category_id IS DISTINCT FROM l.category_id) AS category_disagrees,
  bool_or(o.keyword IS DISTINCT FROM l.keyword) AS keyword_disagrees,
  bool_or(o.sumber_dana IS NOT NULL) AS operational_source_present,
  bool_or(coalesce(l.budget_limit, 0) <> 0) AS legacy_budget_present
FROM operational o
JOIN legacy l
  ON l.user_id = o.user_id
 AND l.normalized_key = o.normalized_key
GROUP BY o.user_id, o.normalized_key
ORDER BY overlap_key_hash;

-- E. Ownership anomalies by merchant table. No merchant name or user UUID is returned.
SELECT
  'merchant_rules'::text AS source_table,
  count(*) FILTER (WHERE user_id IS NULL) AS null_owner_rows
FROM public.merchant_rules

UNION ALL

SELECT
  'user_merchant_rules'::text AS source_table,
  count(*) FILTER (WHERE user_id IS NULL) AS null_owner_rows
FROM public.user_merchant_rules
ORDER BY source_table;
