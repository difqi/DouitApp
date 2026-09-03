-- Phase 4.3 schema-only transaction semantics foundation.
-- Run manually only after reviewing/running the Phase 4.3 audit SQL.
-- No transaction row is backfilled or otherwise mutated by this migration.

BEGIN;

-- Keep the before/after assertion stable against concurrent transaction writes.
LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE phase4_3_transaction_semantics_state ON COMMIT DROP AS
SELECT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'transactions'
    AND column_name = 'transaction_kind'
) AS column_preexisted;

CREATE TEMP TABLE phase4_3_transaction_semantics_baseline ON COMMIT DROP AS
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

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transaction_kind TEXT NULL;

DO $$
DECLARE
  column_data_type text;
  column_is_nullable text;
  column_default_expression text;
BEGIN
  SELECT data_type, is_nullable, column_default
  INTO column_data_type, column_is_nullable, column_default_expression
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'transactions'
    AND column_name = 'transaction_kind';

  IF NOT FOUND
    OR column_data_type <> 'text'
    OR column_is_nullable <> 'YES'
    OR column_default_expression IS NOT NULL
  THEN
    RAISE EXCEPTION
      'Phase 4.3 requires transactions.transaction_kind as nullable TEXT with no default';
  END IF;
END
$$;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_transaction_kind_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_transaction_kind_check
  CHECK (
    transaction_kind IS NULL
    OR transaction_kind IN ('ORDINARY', 'TRANSFER', 'SAVING', 'FEE')
  ) NOT VALID;

ALTER TABLE public.transactions
  VALIDATE CONSTRAINT transactions_transaction_kind_check;

DO $$
DECLARE
  baseline_row record;
  current_row record;
  column_was_present boolean;
BEGIN
  SELECT * INTO baseline_row
  FROM phase4_3_transaction_semantics_baseline;

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
  INTO current_row
  FROM public.transactions;

  IF baseline_row.transaction_count IS DISTINCT FROM current_row.transaction_count
    OR baseline_row.amount_sum IS DISTINCT FROM current_row.amount_sum
    OR baseline_row.amount_fingerprint IS DISTINCT FROM current_row.amount_fingerprint
    OR baseline_row.category_id_fingerprint IS DISTINCT FROM current_row.category_id_fingerprint
    OR baseline_row.subcategory_id_fingerprint IS DISTINCT FROM current_row.subcategory_id_fingerprint
    OR baseline_row.status_fingerprint IS DISTINCT FROM current_row.status_fingerprint
  THEN
    RAISE EXCEPTION 'Phase 4.3 migration changed historical transaction data';
  END IF;

  SELECT column_preexisted INTO column_was_present
  FROM phase4_3_transaction_semantics_state;

  IF column_was_present IS FALSE
    AND EXISTS (
      SELECT 1 FROM public.transactions WHERE transaction_kind IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'Phase 4.3 schema migration unexpectedly classified historical rows';
  END IF;
END
$$;

COMMIT;
