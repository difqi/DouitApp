-- Phase 4.3.2 Savings Structural Linkage & Atomicity.
-- Generate/review only. Run manually after the Phase 4.3.2 audit is retained.
-- This migration performs schema/function changes only: no historical row DML,
-- linkage pairing, semantic classification, or backfill.

BEGIN;

-- Freeze the three financial-domain baselines while schema invariants are added.
LOCK TABLE public.savings_logs IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.savings_goals IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE;

-- Fail closed if live financial state has moved since the retained audit JSON.
DO $phase4_3_2_preflight$
DECLARE
  log_row record;
  goal_row record;
  transaction_row record;
  canonical_nabung_count bigint;
  unexpected_storage_count bigint;
  transaction_type_values text[];
  transaction_status_values text[];
  transaction_source_values text[];
BEGIN
  SELECT
    count(*) AS row_count,
    coalesce(sum(amount), 0) AS amount_sum,
    md5(coalesce(string_agg(
      md5(concat_ws('|', id::text, goal_id::text, user_id::text, amount::text,
        coalesce(source_type, '<NULL>'), created_at::text)),
      '' ORDER BY id
    ), '')) AS fingerprint
  INTO log_row
  FROM public.savings_logs;

  IF log_row.row_count <> 8
    OR log_row.amount_sum <> 20500::numeric
    OR log_row.fingerprint <> '204826ccb66ec48f8a27e124f8702c9c'
  THEN
    RAISE EXCEPTION 'Phase 4.3.2 savings_logs baseline differs from retained audit JSON';
  END IF;

  SELECT
    count(*) AS row_count,
    coalesce(sum(current_amount), 0) AS current_amount_sum,
    md5(coalesce(string_agg(
      md5(concat_ws('|', id::text, user_id::text, current_amount::text,
        status::text, coalesce(last_deposit_date::text, '<NULL>'))),
      '' ORDER BY id
    ), '')) AS fingerprint
  INTO goal_row
  FROM public.savings_goals;

  IF goal_row.row_count <> 4
    OR goal_row.current_amount_sum <> 20500::numeric
    OR goal_row.fingerprint <> '26576443d0d09f18f82e1fd1042d8145'
  THEN
    RAISE EXCEPTION 'Phase 4.3.2 savings_goals baseline differs from retained audit JSON';
  END IF;

  SELECT
    count(*) AS row_count,
    coalesce(sum(amount), 0) AS amount_sum,
    md5(coalesce(string_agg(
      md5(concat_ws('|', id::text, amount::text, type::text,
        coalesce(category_id::text, '<NULL>'), status::text,
        coalesce(transaction_kind::text, '<NULL>'))),
      '' ORDER BY id
    ), '')) AS fingerprint
  INTO transaction_row
  FROM public.transactions;

  IF transaction_row.row_count <> 170
    OR transaction_row.amount_sum <> 6894758::numeric
    OR transaction_row.fingerprint <> 'bacd5ba5f91ee132e31465040d1a090e'
  THEN
    RAISE EXCEPTION 'Phase 4.3.2 transactions baseline differs from retained audit JSON';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name = 'type'
      AND data_type = 'USER-DEFINED'
      AND udt_schema = 'public'
      AND udt_name = 'transaction_type'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name = 'status'
      AND data_type = 'USER-DEFINED'
      AND udt_schema = 'public'
      AND udt_name = 'transaction_status'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name = 'source'
      AND data_type = 'USER-DEFINED'
      AND udt_schema = 'public'
      AND udt_name = 'transaction_source'
  ) THEN
    RAISE EXCEPTION 'Phase 4.3.2 requires the verified transaction enum contract';
  END IF;

  SELECT array_agg(enum_row.enumlabel ORDER BY enum_row.enumlabel)
  INTO transaction_type_values
  FROM pg_enum enum_row
  WHERE enum_row.enumtypid = 'public.transaction_type'::regtype;

  SELECT array_agg(enum_row.enumlabel ORDER BY enum_row.enumlabel)
  INTO transaction_status_values
  FROM pg_enum enum_row
  WHERE enum_row.enumtypid = 'public.transaction_status'::regtype;

  SELECT array_agg(enum_row.enumlabel ORDER BY enum_row.enumlabel)
  INTO transaction_source_values
  FROM pg_enum enum_row
  WHERE enum_row.enumtypid = 'public.transaction_source'::regtype;

  IF transaction_type_values IS DISTINCT FROM ARRAY['EXPENSE', 'INCOME']::text[]
    OR transaction_status_values IS DISTINCT FROM
      ARRAY['APPROVED', 'IGNORED', 'PENDING_APPROVAL']::text[]
    OR transaction_source_values IS DISTINCT FROM
      ARRAY['AUTOMATIC_EMAIL', 'MANUAL_CHAT', 'MANUAL_FORM']::text[]
  THEN
    RAISE EXCEPTION 'Phase 4.3.2 transaction enum values differ from the verified live contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name = 'transaction_kind'
      AND data_type = 'text'
      AND is_nullable = 'YES'
      AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'Phase 4.3.2 requires nullable transactions.transaction_kind TEXT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.transactions'::regclass
      AND constraint_row.conname = 'transactions_transaction_kind_check'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated IS TRUE
      AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%ORDINARY%'
      AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%TRANSFER%'
      AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%SAVING%'
      AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%FEE%'
  ) THEN
    RAISE EXCEPTION 'Phase 4.3.2 requires the verified transaction_kind CHECK';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name = 'idempotency_key'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'Phase 4.3.2 requires nullable transactions.idempotency_key TEXT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_class table_row ON table_row.oid = index_row.indrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
    JOIN pg_attribute attribute_row
      ON attribute_row.attrelid = table_row.oid
     AND attribute_row.attnum = ANY(index_row.indkey)
    WHERE namespace_row.nspname = 'public'
      AND table_row.relname = 'transactions'
      AND attribute_row.attname = 'idempotency_key'
      AND index_row.indisunique IS TRUE
      AND index_row.indisvalid IS TRUE
      AND index_row.indnkeyatts = 1
      AND index_row.indkey::smallint[] = ARRAY[attribute_row.attnum]::smallint[]
  ) THEN
    RAISE EXCEPTION 'Phase 4.3.2 requires a valid unique transactions.idempotency_key index';
  END IF;

  SELECT count(*)
  INTO canonical_nabung_count
  FROM public.categories category_row
  WHERE category_row.name = 'Nabung'
    AND category_row.type::text = 'EXPENSE'
    AND category_row.is_system IS TRUE
    AND category_row.user_id IS NULL;

  IF canonical_nabung_count <> 1 THEN
    RAISE EXCEPTION 'Phase 4.3.2 requires exactly one canonical system EXPENSE Nabung category';
  END IF;

  SELECT count(*)
  INTO unexpected_storage_count
  FROM public.savings_goals goal_row
  WHERE goal_row.storage_type IS NULL
     OR goal_row.storage_type NOT IN ('GOPAY_MERCHANT', 'BANK_TRANSFER', 'TUNAI');

  IF unexpected_storage_count <> 0 THEN
    RAISE EXCEPTION 'Phase 4.3.2 found a non-canonical savings storage type';
  END IF;
END
$phase4_3_2_preflight$;

ALTER TABLE public.savings_logs
  ADD COLUMN IF NOT EXISTS transaction_id uuid NULL,
  ADD COLUMN IF NOT EXISTS recording_method text NULL,
  ADD COLUMN IF NOT EXISTS evidence_level text NULL,
  ADD COLUMN IF NOT EXISTS external_event_id text NULL,
  ADD COLUMN IF NOT EXISTS source_account_id uuid NULL;

-- Existing columns with these names must be exactly the additive nullable types.
DO $phase4_3_2_column_contract$
DECLARE
  incompatible_count bigint;
BEGIN
  SELECT count(*)
  INTO incompatible_count
  FROM (VALUES
    ('transaction_id', 'uuid'),
    ('recording_method', 'text'),
    ('evidence_level', 'text'),
    ('external_event_id', 'text'),
    ('source_account_id', 'uuid')
  ) expected(column_name, data_type)
  LEFT JOIN information_schema.columns column_row
    ON column_row.table_schema = 'public'
   AND column_row.table_name = 'savings_logs'
   AND column_row.column_name = expected.column_name
  WHERE column_row.column_name IS NULL
     OR column_row.data_type <> expected.data_type
     OR column_row.is_nullable <> 'YES'
     OR column_row.column_default IS NOT NULL;

  IF incompatible_count <> 0 THEN
    RAISE EXCEPTION 'Phase 4.3.2 found incompatible savings_logs structural columns';
  END IF;
END
$phase4_3_2_column_contract$;

DO $phase4_3_2_constraint_preflight$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname, contype, pg_get_constraintdef(oid, true) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.savings_logs'::regclass
      AND conname IN (
        'savings_logs_recording_method_check',
        'savings_logs_evidence_level_check',
        'savings_logs_linked_metadata_check',
        'savings_logs_external_evidence_check',
        'savings_logs_transaction_id_fkey',
        'savings_logs_source_account_id_fkey'
      )
  LOOP
    IF (constraint_row.conname = 'savings_logs_recording_method_check'
        AND (constraint_row.contype <> 'c'
          OR constraint_row.definition NOT LIKE '%AUTO_EMAIL%'
          OR constraint_row.definition NOT LIKE '%MANUAL_WEB%'
          OR constraint_row.definition NOT LIKE '%MANUAL_WHATSAPP%'))
      OR (constraint_row.conname = 'savings_logs_evidence_level_check'
        AND (constraint_row.contype <> 'c'
          OR constraint_row.definition NOT LIKE '%USER_CONFIRMED%'
          OR constraint_row.definition NOT LIKE '%EXTERNAL_VERIFIED%'))
      OR (constraint_row.conname = 'savings_logs_linked_metadata_check'
        AND (constraint_row.contype <> 'c'
          OR constraint_row.definition NOT LIKE '%transaction_id%'
          OR constraint_row.definition NOT LIKE '%recording_method%'
          OR constraint_row.definition NOT LIKE '%evidence_level%'))
      OR (constraint_row.conname = 'savings_logs_external_evidence_check'
        AND (constraint_row.contype <> 'c'
          OR constraint_row.definition NOT LIKE '%external_event_id%'
          OR constraint_row.definition NOT LIKE '%EXTERNAL_VERIFIED%'))
      OR (constraint_row.conname = 'savings_logs_transaction_id_fkey'
        AND (constraint_row.contype <> 'f'
          OR constraint_row.definition NOT LIKE '%FOREIGN KEY (transaction_id)%'
          OR constraint_row.definition NOT LIKE '%REFERENCES transactions(id)%'
          OR constraint_row.definition NOT LIKE '%ON DELETE RESTRICT%'))
      OR (constraint_row.conname = 'savings_logs_source_account_id_fkey'
        AND (constraint_row.contype <> 'f'
          OR constraint_row.definition NOT LIKE '%FOREIGN KEY (source_account_id)%'
          OR constraint_row.definition NOT LIKE '%REFERENCES payment_accounts(id)%'
          OR constraint_row.definition NOT LIKE '%ON DELETE RESTRICT%'))
    THEN
      RAISE EXCEPTION 'Phase 4.3.2 found incompatible constraint %', constraint_row.conname;
    END IF;
  END LOOP;
END
$phase4_3_2_constraint_preflight$;

ALTER TABLE public.savings_logs
  DROP CONSTRAINT IF EXISTS savings_logs_recording_method_check,
  DROP CONSTRAINT IF EXISTS savings_logs_evidence_level_check,
  DROP CONSTRAINT IF EXISTS savings_logs_linked_metadata_check,
  DROP CONSTRAINT IF EXISTS savings_logs_external_evidence_check,
  DROP CONSTRAINT IF EXISTS savings_logs_transaction_id_fkey,
  DROP CONSTRAINT IF EXISTS savings_logs_source_account_id_fkey;

ALTER TABLE public.savings_logs
  ADD CONSTRAINT savings_logs_recording_method_check
  CHECK (
    recording_method IS NULL
    OR recording_method IN ('AUTO_EMAIL', 'MANUAL_WEB', 'MANUAL_WHATSAPP')
  ) NOT VALID,
  ADD CONSTRAINT savings_logs_evidence_level_check
  CHECK (
    evidence_level IS NULL
    OR evidence_level IN ('USER_CONFIRMED', 'EXTERNAL_VERIFIED')
  ) NOT VALID,
  ADD CONSTRAINT savings_logs_linked_metadata_check
  CHECK (
    transaction_id IS NULL
    OR (recording_method IS NOT NULL AND evidence_level IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT savings_logs_external_evidence_check
  CHECK (
    external_event_id IS NULL
    OR evidence_level = 'EXTERNAL_VERIFIED'
  ) NOT VALID,
  ADD CONSTRAINT savings_logs_transaction_id_fkey
  FOREIGN KEY (transaction_id)
  REFERENCES public.transactions(id)
  ON DELETE RESTRICT
  NOT VALID,
  ADD CONSTRAINT savings_logs_source_account_id_fkey
  FOREIGN KEY (source_account_id)
  REFERENCES public.payment_accounts(id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.savings_logs
  VALIDATE CONSTRAINT savings_logs_recording_method_check,
  VALIDATE CONSTRAINT savings_logs_evidence_level_check,
  VALIDATE CONSTRAINT savings_logs_linked_metadata_check,
  VALIDATE CONSTRAINT savings_logs_external_evidence_check,
  VALIDATE CONSTRAINT savings_logs_transaction_id_fkey,
  VALIDATE CONSTRAINT savings_logs_source_account_id_fkey;

CREATE UNIQUE INDEX IF NOT EXISTS savings_logs_transaction_id_unique
  ON public.savings_logs (transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS savings_logs_external_event_id_unique
  ON public.savings_logs (external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS savings_logs_source_account_id_idx
  ON public.savings_logs (source_account_id)
  WHERE source_account_id IS NOT NULL;

-- CREATE INDEX IF NOT EXISTS must not silently accept a same-name incompatible
-- object left by an unknown deployment. Verify the exact key/predicate contract.
DO $phase4_3_2_index_contract$
DECLARE
  incompatible_count bigint;
BEGIN
  SELECT count(*)
  INTO incompatible_count
  FROM (VALUES
    ('savings_logs_transaction_id_unique', 'transaction_id', TRUE),
    ('savings_logs_external_event_id_unique', 'external_event_id', TRUE),
    ('savings_logs_source_account_id_idx', 'source_account_id', FALSE)
  ) expected(index_name, column_name, must_be_unique)
  LEFT JOIN pg_class index_row
    ON index_row.relname = expected.index_name
   AND index_row.relnamespace = 'public'::regnamespace
  LEFT JOIN pg_index index_meta
    ON index_meta.indexrelid = index_row.oid
   AND index_meta.indrelid = 'public.savings_logs'::regclass
  LEFT JOIN pg_attribute attribute_row
    ON attribute_row.attrelid = index_meta.indrelid
   AND attribute_row.attname = expected.column_name
  WHERE index_meta.indexrelid IS NULL
     OR index_meta.indisvalid IS DISTINCT FROM TRUE
     OR index_meta.indisunique IS DISTINCT FROM expected.must_be_unique
     OR index_meta.indnkeyatts <> 1
     OR index_meta.indkey::smallint[] <> ARRAY[attribute_row.attnum]::smallint[]
     OR pg_get_expr(index_meta.indpred, index_meta.indrelid)
          IS DISTINCT FROM format('(%I IS NOT NULL)', expected.column_name);

  IF incompatible_count <> 0 THEN
    RAISE EXCEPTION 'Phase 4.3.2 found incompatible savings_logs indexes';
  END IF;
END
$phase4_3_2_index_contract$;

-- Replace only the verified goal/log CASCADE relationship. Existing history is
-- untouched; future hard-delete attempts are blocked when contribution rows exist.
DO $phase4_3_2_goal_delete$
DECLARE
  goal_fk record;
  goal_fk_count bigint;
BEGIN
  SELECT count(*)
  INTO goal_fk_count
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.savings_logs'::regclass
    AND constraint_row.confrelid = 'public.savings_goals'::regclass
    AND constraint_row.contype = 'f'
    AND constraint_row.conkey = ARRAY[
      (SELECT attnum FROM pg_attribute
       WHERE attrelid = 'public.savings_logs'::regclass AND attname = 'goal_id')
    ]::smallint[];

  IF goal_fk_count <> 1 THEN
    RAISE EXCEPTION 'Phase 4.3.2 requires exactly one savings_logs.goal_id FK';
  END IF;

  SELECT constraint_row.oid, constraint_row.conname, constraint_row.confdeltype
  INTO goal_fk
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.savings_logs'::regclass
    AND constraint_row.confrelid = 'public.savings_goals'::regclass
    AND constraint_row.contype = 'f'
    AND constraint_row.conkey = ARRAY[
      (SELECT attnum FROM pg_attribute
       WHERE attrelid = 'public.savings_logs'::regclass AND attname = 'goal_id')
    ]::smallint[];

  IF goal_fk.confdeltype = 'c' THEN
    EXECUTE format(
      'ALTER TABLE public.savings_logs DROP CONSTRAINT %I',
      goal_fk.conname
    );
    EXECUTE
      'ALTER TABLE public.savings_logs '
      'ADD CONSTRAINT savings_logs_goal_id_fkey '
      'FOREIGN KEY (goal_id) REFERENCES public.savings_goals(id) '
      'ON DELETE RESTRICT NOT VALID';
    EXECUTE
      'ALTER TABLE public.savings_logs '
      'VALIDATE CONSTRAINT savings_logs_goal_id_fkey';
  ELSIF goal_fk.confdeltype <> 'r' THEN
    RAISE EXCEPTION 'Phase 4.3.2 requires savings_logs.goal_id ON DELETE RESTRICT';
  END IF;
END
$phase4_3_2_goal_delete$;

-- The live audit confirmed these names did not exist. On a rerun, only objects
-- explicitly marked as belonging to this migration may be replaced.
DO $phase4_3_2_function_preflight$
DECLARE
  incompatible_function_count bigint;
BEGIN
  SELECT count(*)
  INTO incompatible_function_count
  FROM pg_proc procedure_row
  JOIN pg_namespace namespace_row
    ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND procedure_row.proname IN (
      'enforce_savings_log_linkage',
      'enforce_linked_savings_transaction_immutability',
      'record_savings_contribution_internal',
      'record_savings_contribution',
      'record_savings_contribution_as_service',
      'reconcile_savings_contribution_evidence'
    )
    AND coalesce(
      obj_description(procedure_row.oid, 'pg_proc'),
      ''
    ) <> 'Douit Phase 4.3.2 canonical savings linkage';

  IF incompatible_function_count <> 0 THEN
    RAISE EXCEPTION 'Phase 4.3.2 found an unowned conflicting savings function';
  END IF;
END
$phase4_3_2_function_preflight$;

-- Do not silently replace a same-named trigger owned by another migration.
DO $phase4_3_2_trigger_preflight$
DECLARE
  incompatible_trigger_count bigint;
BEGIN
  SELECT count(*)
  INTO incompatible_trigger_count
  FROM pg_trigger trigger_row
  JOIN pg_proc procedure_row ON procedure_row.oid = trigger_row.tgfoid
  JOIN (VALUES
    ('enforce_savings_log_linkage_trigger', 'public.savings_logs'::regclass,
      'enforce_savings_log_linkage'),
    ('enforce_linked_savings_transaction_immutability_trigger', 'public.transactions'::regclass,
      'enforce_linked_savings_transaction_immutability'),
    ('enforce_saving_transaction_linkage_commit_trigger', 'public.transactions'::regclass,
      'enforce_linked_savings_transaction_immutability')
  ) expected(trigger_name, table_oid, function_name)
    ON expected.trigger_name = trigger_row.tgname
   AND expected.table_oid = trigger_row.tgrelid
  WHERE trigger_row.tgisinternal IS FALSE
    AND (
      procedure_row.proname <> expected.function_name
      OR coalesce(obj_description(procedure_row.oid, 'pg_proc'), '')
        <> 'Douit Phase 4.3.2 canonical savings linkage'
    );

  IF incompatible_trigger_count <> 0 THEN
    RAISE EXCEPTION 'Phase 4.3.2 found an unowned conflicting savings trigger';
  END IF;
END
$phase4_3_2_trigger_preflight$;

-- Cross-table and direct-write guard. Legacy unlinked rows remain readable and
-- unchanged, but every new savings_log must come from the canonical RPC path.
CREATE OR REPLACE FUNCTION public.enforce_savings_log_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  goal_row record;
  transaction_row record;
  account_row record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.transaction_id IS NOT NULL THEN
      RAISE EXCEPTION 'Linked savings contributions cannot be deleted directly';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.transaction_id IS NULL THEN
    RAISE EXCEPTION 'New savings contributions require a linked transaction';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.transaction_id IS NULL THEN
    IF NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
      OR NEW.recording_method IS DISTINCT FROM OLD.recording_method
      OR NEW.evidence_level IS DISTINCT FROM OLD.evidence_level
      OR NEW.external_event_id IS DISTINCT FROM OLD.external_event_id
      OR NEW.source_account_id IS DISTINCT FROM OLD.source_account_id
    THEN
      RAISE EXCEPTION 'Historical unlinked savings rows cannot be paired automatically';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.goal_id IS DISTINCT FROM OLD.goal_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.notes IS DISTINCT FROM OLD.notes
      OR NEW.source_type IS DISTINCT FROM OLD.source_type
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
      OR NEW.recording_method IS DISTINCT FROM OLD.recording_method
      OR NEW.source_account_id IS DISTINCT FROM OLD.source_account_id
    THEN
      RAISE EXCEPTION 'Linked savings contribution identity is immutable';
    END IF;

    IF NOT (
      OLD.evidence_level = 'USER_CONFIRMED'
      AND OLD.external_event_id IS NULL
      AND NEW.evidence_level = 'EXTERNAL_VERIFIED'
      AND NEW.external_event_id IS NOT NULL
    ) AND (
      NEW.evidence_level IS DISTINCT FROM OLD.evidence_level
      OR NEW.external_event_id IS DISTINCT FROM OLD.external_event_id
    ) THEN
      RAISE EXCEPTION 'Only USER_CONFIRMED to EXTERNAL_VERIFIED evidence upgrades are allowed';
    END IF;
  END IF;

  SELECT id, user_id, storage_type
  INTO goal_row
  FROM public.savings_goals
  WHERE id = NEW.goal_id;

  IF NOT FOUND OR goal_row.user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Savings goal ownership mismatch';
  END IF;

  SELECT
    transaction_value.id,
    transaction_value.user_id,
    transaction_value.amount,
    transaction_value.type::text AS transaction_type,
    transaction_value.status::text AS transaction_status,
    transaction_value.source::text AS transaction_source,
    transaction_value.transaction_kind,
    transaction_value.category_id,
    transaction_value.sumber_dana,
    category_value.name AS category_name,
    category_value.type::text AS category_type,
    category_value.is_system AS category_is_system,
    category_value.user_id AS category_user_id
  INTO transaction_row
  FROM public.transactions transaction_value
  LEFT JOIN public.categories category_value
    ON category_value.id = transaction_value.category_id
  WHERE transaction_value.id = NEW.transaction_id;

  IF NOT FOUND
    OR transaction_row.user_id IS DISTINCT FROM NEW.user_id
    OR transaction_row.amount IS DISTINCT FROM NEW.amount
    OR transaction_row.transaction_type IS DISTINCT FROM 'EXPENSE'
    OR transaction_row.transaction_status IS DISTINCT FROM 'APPROVED'
    OR transaction_row.transaction_kind IS DISTINCT FROM 'SAVING'
    OR transaction_row.category_name IS DISTINCT FROM 'Nabung'
    OR transaction_row.category_type IS DISTINCT FROM 'EXPENSE'
    OR transaction_row.category_is_system IS DISTINCT FROM TRUE
    OR transaction_row.category_user_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'Linked transaction is not a canonical owned SAVING transaction';
  END IF;

  IF NEW.recording_method = 'MANUAL_WEB'
    AND transaction_row.transaction_source IS DISTINCT FROM 'MANUAL_FORM'
  THEN
    RAISE EXCEPTION 'MANUAL_WEB requires MANUAL_FORM transaction source';
  ELSIF NEW.recording_method = 'MANUAL_WHATSAPP'
    AND transaction_row.transaction_source IS DISTINCT FROM 'MANUAL_CHAT'
  THEN
    RAISE EXCEPTION 'MANUAL_WHATSAPP requires MANUAL_CHAT transaction source';
  ELSIF NEW.recording_method = 'AUTO_EMAIL'
    AND transaction_row.transaction_source IS DISTINCT FROM 'AUTOMATIC_EMAIL'
  THEN
    RAISE EXCEPTION 'AUTO_EMAIL requires AUTOMATIC_EMAIL transaction source';
  END IF;

  IF goal_row.storage_type = 'TUNAI' THEN
    IF NEW.source_account_id IS NOT NULL OR transaction_row.sumber_dana <> 'Tunai' THEN
      RAISE EXCEPTION 'TUNAI contributions require literal Tunai and no account row';
    END IF;
  ELSIF goal_row.storage_type IN ('GOPAY_MERCHANT', 'BANK_TRANSFER') THEN
    IF NEW.source_account_id IS NULL THEN
      RAISE EXCEPTION 'QRIS and bank contributions require an owned source account';
    END IF;

    SELECT id, user_id, name
    INTO account_row
    FROM public.payment_accounts
    WHERE id = NEW.source_account_id;

    IF NOT FOUND
      OR account_row.user_id IS NULL
      OR account_row.user_id IS DISTINCT FROM NEW.user_id
      OR nullif(trim(account_row.name), '') IS NULL
      OR (
        TG_OP = 'INSERT'
        AND transaction_row.sumber_dana IS DISTINCT FROM account_row.name
      )
    THEN
      RAISE EXCEPTION 'Savings source account ownership/display mismatch';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported savings storage type';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.enforce_savings_log_linkage() OWNER TO postgres;

COMMENT ON FUNCTION public.enforce_savings_log_linkage()
  IS 'Douit Phase 4.3.2 canonical savings linkage';

REVOKE ALL ON FUNCTION public.enforce_savings_log_linkage()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_savings_log_linkage_trigger
  ON public.savings_logs;
CREATE TRIGGER enforce_savings_log_linkage_trigger
BEFORE INSERT OR UPDATE OR DELETE ON public.savings_logs
FOR EACH ROW
EXECUTE FUNCTION public.enforce_savings_log_linkage();

-- All new writes now go through SECURITY DEFINER RPCs. Removing table DML from
-- API-facing roles makes the trigger invariants non-bypassable through direct
-- PostgREST table writes while preserving existing reads under RLS.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.savings_logs
  FROM PUBLIC, anon, authenticated, service_role;

-- Once a transaction is the accounting side of a savings contribution, its
-- financial identity cannot be rewritten through a generic transaction editor.
CREATE OR REPLACE FUNCTION public.enforce_linked_savings_transaction_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_WHEN = 'AFTER' THEN
    -- Deferred until commit: the atomic RPC may insert the transaction first,
    -- but a new/promoted SAVING row cannot commit without exactly one linked log.
    -- Unrelated edits to legacy unlinked SAVING rows remain compatible.
    IF (TG_OP = 'INSERT' OR OLD.transaction_kind IS DISTINCT FROM 'SAVING')
      AND EXISTS (
        SELECT 1
        FROM public.transactions transaction_row
        WHERE transaction_row.id = NEW.id
          AND transaction_row.transaction_kind = 'SAVING'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.savings_logs log_row
        WHERE log_row.transaction_id = NEW.id
      )
    THEN
      RAISE EXCEPTION 'New SAVING transactions require a linked savings contribution in the same transaction';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.savings_logs log_row
    WHERE log_row.transaction_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Linked savings transactions cannot be deleted directly';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.type IS DISTINCT FROM OLD.type
    OR NEW.category_id IS DISTINCT FROM OLD.category_id
    OR NEW.subcategory_id IS DISTINCT FROM OLD.subcategory_id
    OR NEW.transaction_kind IS DISTINCT FROM OLD.transaction_kind
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.sumber_dana IS DISTINCT FROM OLD.sumber_dana
    OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  THEN
    RAISE EXCEPTION 'Linked savings transaction financial identity is immutable';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.enforce_linked_savings_transaction_immutability()
  OWNER TO postgres;

COMMENT ON FUNCTION public.enforce_linked_savings_transaction_immutability()
  IS 'Douit Phase 4.3.2 canonical savings linkage';

REVOKE ALL ON FUNCTION public.enforce_linked_savings_transaction_immutability()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_linked_savings_transaction_immutability_trigger
  ON public.transactions;
CREATE TRIGGER enforce_linked_savings_transaction_immutability_trigger
BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_linked_savings_transaction_immutability();

DROP TRIGGER IF EXISTS enforce_saving_transaction_linkage_commit_trigger
  ON public.transactions;
CREATE CONSTRAINT TRIGGER enforce_saving_transaction_linkage_commit_trigger
AFTER INSERT OR UPDATE ON public.transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_linked_savings_transaction_immutability();

-- Private implementation shared by the browser-safe and service-only wrappers.
CREATE OR REPLACE FUNCTION public.record_savings_contribution_internal(
  p_actor_user_id uuid,
  p_goal_id uuid,
  p_amount numeric,
  p_source_account_id uuid,
  p_recording_method text,
  p_evidence_level text,
  p_operation_key text,
  p_external_event_id text,
  p_notes text,
  p_transaction_source public.transaction_source,
  p_occurred_at timestamp with time zone,
  p_raw_email_body text
)
RETURNS TABLE (
  out_transaction_id uuid,
  out_savings_log_id uuid,
  out_goal_id uuid,
  out_amount numeric,
  out_current_amount numeric,
  out_status text,
  out_evidence_level text,
  out_replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  goal_row record;
  account_row record;
  existing_row record;
  canonical_category_id uuid;
  canonical_category_count bigint;
  resolved_source_name text;
  resolved_legacy_source text;
  created_transaction_id uuid;
  created_log_id uuid;
  updated_current_amount numeric;
  updated_status text;
  operation_date date;
BEGIN
  IF p_actor_user_id IS NULL OR p_goal_id IS NULL THEN
    RAISE EXCEPTION 'Savings actor and goal are required';
  END IF;

  IF p_amount IS NULL
    OR p_amount::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_amount <= 0
  THEN
    RAISE EXCEPTION 'Savings amount must be greater than zero';
  END IF;

  IF p_recording_method IS NULL
    OR p_recording_method NOT IN ('AUTO_EMAIL', 'MANUAL_WEB', 'MANUAL_WHATSAPP')
    OR p_evidence_level IS NULL
    OR p_evidence_level NOT IN ('USER_CONFIRMED', 'EXTERNAL_VERIFIED')
  THEN
    RAISE EXCEPTION 'Invalid savings recording method or evidence level';
  END IF;

  IF (p_recording_method = 'AUTO_EMAIL' AND (
        p_evidence_level <> 'EXTERNAL_VERIFIED'
        OR p_transaction_source <> 'AUTOMATIC_EMAIL'::public.transaction_source
        OR p_external_event_id IS NULL
      ))
    OR (p_recording_method = 'MANUAL_WEB' AND (
        p_evidence_level <> 'USER_CONFIRMED'
        OR p_transaction_source <> 'MANUAL_FORM'::public.transaction_source
        OR p_external_event_id IS NOT NULL
      ))
    OR (p_recording_method = 'MANUAL_WHATSAPP' AND (
        p_evidence_level <> 'USER_CONFIRMED'
        OR p_transaction_source <> 'MANUAL_CHAT'::public.transaction_source
        OR p_external_event_id IS NOT NULL
      ))
  THEN
    RAISE EXCEPTION 'Savings workflow/source/evidence contract mismatch';
  END IF;

  IF p_operation_key IS NULL
    OR length(p_operation_key) > 500
    OR p_operation_key !~ '^savings:(manual_web|fonnte|resend):[A-Za-z0-9._:-]+$'
  THEN
    RAISE EXCEPTION 'Savings operation key is missing or not namespaced';
  END IF;

  IF p_external_event_id IS NOT NULL AND (
    length(p_external_event_id) > 500
    OR p_external_event_id !~ '^savings:resend:[A-Za-z0-9._:-]+$'
  ) THEN
    RAISE EXCEPTION 'External event identity is invalid';
  END IF;

  SELECT id, user_id, title, target_amount, current_amount, storage_type, status,
         last_deposit_date, streak_count
  INTO goal_row
  FROM public.savings_goals
  WHERE id = p_goal_id
    AND user_id = p_actor_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Savings goal not found for actor';
  END IF;

  operation_date := (coalesce(p_occurred_at, pg_catalog.now())
    AT TIME ZONE 'Asia/Jakarta')::date;

  SELECT
    transaction_value.id AS transaction_id,
    log_value.id AS savings_log_id,
    log_value.goal_id,
    log_value.user_id,
    log_value.amount,
    log_value.recording_method,
    log_value.evidence_level,
    log_value.external_event_id,
    log_value.source_account_id
  INTO existing_row
  FROM public.transactions transaction_value
  LEFT JOIN public.savings_logs log_value
    ON log_value.transaction_id = transaction_value.id
  WHERE transaction_value.idempotency_key = p_operation_key;

  IF FOUND THEN
    IF existing_row.savings_log_id IS NULL
      OR existing_row.goal_id IS DISTINCT FROM p_goal_id
      OR existing_row.user_id IS DISTINCT FROM p_actor_user_id
      OR existing_row.amount IS DISTINCT FROM p_amount
      OR existing_row.recording_method IS DISTINCT FROM p_recording_method
      OR existing_row.source_account_id IS DISTINCT FROM p_source_account_id
      OR NOT (
        (
          existing_row.evidence_level IS NOT DISTINCT FROM p_evidence_level
          AND existing_row.external_event_id IS NOT DISTINCT FROM p_external_event_id
        )
        OR (
          p_recording_method IN ('MANUAL_WEB', 'MANUAL_WHATSAPP')
          AND p_evidence_level = 'USER_CONFIRMED'
          AND p_external_event_id IS NULL
          AND existing_row.evidence_level = 'EXTERNAL_VERIFIED'
          AND existing_row.external_event_id IS NOT NULL
        )
      )
    THEN
      RAISE EXCEPTION 'Savings operation key collides with a different operation';
    END IF;

    RETURN QUERY SELECT
      existing_row.transaction_id,
      existing_row.savings_log_id,
      p_goal_id,
      p_amount,
      goal_row.current_amount,
      goal_row.status::text,
      existing_row.evidence_level,
      TRUE;
    RETURN;
  END IF;

  IF goal_row.status::text <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Savings contribution requires an ACTIVE goal';
  END IF;

  -- Preserve the existing one-WhatsApp-deposit-per-goal-per-Jakarta-day rule
  -- under the same goal lock, so concurrent different events cannot bypass it.
  IF p_recording_method = 'MANUAL_WHATSAPP' AND EXISTS (
    SELECT 1
    FROM public.savings_logs log_row
    WHERE log_row.goal_id = p_goal_id
      AND log_row.user_id = p_actor_user_id
      AND (log_row.created_at AT TIME ZONE 'Asia/Jakarta')::date = operation_date
  ) THEN
    RAISE EXCEPTION 'WhatsApp savings contribution already exists for this goal today';
  END IF;

  IF goal_row.storage_type = 'TUNAI' THEN
    IF p_source_account_id IS NOT NULL THEN
      RAISE EXCEPTION 'TUNAI contributions cannot use a payment account row';
    END IF;
    resolved_source_name := 'Tunai';
  ELSIF goal_row.storage_type IN ('GOPAY_MERCHANT', 'BANK_TRANSFER') THEN
    IF p_source_account_id IS NULL THEN
      RAISE EXCEPTION 'QRIS and bank contributions require a source account';
    END IF;

    SELECT id, user_id, name
    INTO account_row
    FROM public.payment_accounts
    WHERE id = p_source_account_id
      AND user_id IS NOT NULL
      AND user_id = p_actor_user_id;

    IF NOT FOUND OR nullif(trim(account_row.name), '') IS NULL THEN
      RAISE EXCEPTION 'Source account is missing, ownerless, or foreign';
    END IF;
    resolved_source_name := account_row.name;
  ELSE
    RAISE EXCEPTION 'Unsupported savings storage type';
  END IF;

  SELECT count(*), (array_agg(category_row.id ORDER BY category_row.id))[1]
  INTO canonical_category_count, canonical_category_id
  FROM public.categories category_row
  WHERE category_row.name = 'Nabung'
    AND category_row.type::text = 'EXPENSE'
    AND category_row.is_system IS TRUE
    AND category_row.user_id IS NULL;

  IF canonical_category_count <> 1 OR canonical_category_id IS NULL THEN
    RAISE EXCEPTION 'Canonical system Nabung category is missing or ambiguous';
  END IF;

  resolved_legacy_source := CASE p_recording_method
    WHEN 'AUTO_EMAIL' THEN 'INBOUND_EMAIL'
    WHEN 'MANUAL_WEB' THEN 'MANUAL'
    WHEN 'MANUAL_WHATSAPP' THEN 'WHATSAPP_BOT'
  END;
  INSERT INTO public.transactions (
    user_id,
    amount,
    type,
    merchant,
    category_id,
    subcategory_id,
    transaction_kind,
    status,
    source,
    confidence_score,
    idempotency_key,
    raw_email_body,
    notes,
    sumber_dana,
    transaction_date
  ) VALUES (
    p_actor_user_id,
    p_amount,
    'EXPENSE'::public.transaction_type,
    goal_row.title,
    canonical_category_id,
    NULL,
    'SAVING',
    'APPROVED'::public.transaction_status,
    p_transaction_source,
    1.0,
    p_operation_key,
    p_raw_email_body,
    p_notes,
    resolved_source_name,
    coalesce(p_occurred_at, pg_catalog.now())
  )
  RETURNING id INTO created_transaction_id;

  INSERT INTO public.savings_logs (
    goal_id,
    user_id,
    amount,
    notes,
    source_type,
    transaction_id,
    recording_method,
    evidence_level,
    external_event_id,
    source_account_id,
    created_at
  ) VALUES (
    p_goal_id,
    p_actor_user_id,
    p_amount,
    p_notes,
    resolved_legacy_source,
    created_transaction_id,
    p_recording_method,
    p_evidence_level,
    p_external_event_id,
    p_source_account_id,
    coalesce(p_occurred_at, pg_catalog.now())
  )
  RETURNING id INTO created_log_id;

  UPDATE public.savings_goals
  SET
    current_amount = coalesce(current_amount, 0) + p_amount,
    streak_count = CASE
      WHEN last_deposit_date IS DISTINCT FROM operation_date
        THEN coalesce(streak_count, 0) + 1
      ELSE coalesce(streak_count, 0)
    END,
    last_deposit_date = CASE
      WHEN last_deposit_date IS NULL OR operation_date > last_deposit_date
        THEN operation_date
      ELSE last_deposit_date
    END,
    status = CASE
      WHEN coalesce(current_amount, 0) + p_amount >= target_amount
        THEN 'COMPLETED'
      ELSE status
    END,
    updated_at = pg_catalog.now()
  WHERE id = p_goal_id
    AND user_id = p_actor_user_id
  RETURNING current_amount, status::text
  INTO updated_current_amount, updated_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Savings goal update failed';
  END IF;

  RETURN QUERY SELECT
    created_transaction_id,
    created_log_id,
    p_goal_id,
    p_amount,
    updated_current_amount,
    updated_status,
    p_evidence_level,
    FALSE;
END
$function$;

ALTER FUNCTION public.record_savings_contribution_internal(
  uuid, uuid, numeric, uuid, text, text, text, text, text,
  public.transaction_source, timestamp with time zone, text
) OWNER TO postgres;

COMMENT ON FUNCTION public.record_savings_contribution_internal(
  uuid, uuid, numeric, uuid, text, text, text, text, text,
  public.transaction_source, timestamp with time zone, text
) IS 'Douit Phase 4.3.2 canonical savings linkage';

REVOKE ALL ON FUNCTION public.record_savings_contribution_internal(
  uuid, uuid, numeric, uuid, text, text, text, text, text,
  public.transaction_source, timestamp with time zone, text
) FROM PUBLIC, anon, authenticated, service_role;

-- Browser-safe entry point: identity is always auth.uid() and semantics are fixed.
CREATE OR REPLACE FUNCTION public.record_savings_contribution(
  p_goal_id uuid,
  p_amount numeric,
  p_source_account_id uuid,
  p_operation_key text,
  p_notes text DEFAULT NULL
)
RETURNS TABLE (
  out_transaction_id uuid,
  out_savings_log_id uuid,
  out_goal_id uuid,
  out_amount numeric,
  out_current_amount numeric,
  out_status text,
  out_evidence_level text,
  out_replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_user_id uuid;
BEGIN
  actor_user_id := auth.uid();
  IF actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_operation_key !~ '^savings:manual_web:[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'MANUAL_WEB operation key is invalid';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.record_savings_contribution_internal(
    actor_user_id,
    p_goal_id,
    p_amount,
    p_source_account_id,
    'MANUAL_WEB',
    'USER_CONFIRMED',
    p_operation_key,
    NULL,
    p_notes,
    'MANUAL_FORM'::public.transaction_source,
    pg_catalog.now(),
    NULL
  );
END
$function$;

ALTER FUNCTION public.record_savings_contribution(
  uuid, numeric, uuid, text, text
) OWNER TO postgres;

COMMENT ON FUNCTION public.record_savings_contribution(
  uuid, numeric, uuid, text, text
) IS 'Douit Phase 4.3.2 canonical savings linkage';

REVOKE ALL ON FUNCTION public.record_savings_contribution(
  uuid, numeric, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_savings_contribution(
  uuid, numeric, uuid, text, text
) TO authenticated;

-- Service-only entry point for deterministic Resend and explicit Fonnte flows.
CREATE OR REPLACE FUNCTION public.record_savings_contribution_as_service(
  p_actor_user_id uuid,
  p_goal_id uuid,
  p_amount numeric,
  p_source_account_id uuid,
  p_recording_method text,
  p_evidence_level text,
  p_operation_key text,
  p_external_event_id text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_occurred_at timestamp with time zone DEFAULT pg_catalog.now(),
  p_raw_email_body text DEFAULT NULL
)
RETURNS TABLE (
  out_transaction_id uuid,
  out_savings_log_id uuid,
  out_goal_id uuid,
  out_amount numeric,
  out_current_amount numeric,
  out_status text,
  out_evidence_level text,
  out_replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  transaction_source_value public.transaction_source;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  transaction_source_value := CASE p_recording_method
    WHEN 'AUTO_EMAIL' THEN 'AUTOMATIC_EMAIL'::public.transaction_source
    WHEN 'MANUAL_WHATSAPP' THEN 'MANUAL_CHAT'::public.transaction_source
    ELSE NULL
  END;

  IF transaction_source_value IS NULL THEN
    RAISE EXCEPTION 'Service workflow is not allowed';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.record_savings_contribution_internal(
    p_actor_user_id,
    p_goal_id,
    p_amount,
    p_source_account_id,
    p_recording_method,
    p_evidence_level,
    p_operation_key,
    p_external_event_id,
    p_notes,
    transaction_source_value,
    p_occurred_at,
    p_raw_email_body
  );
END
$function$;

ALTER FUNCTION public.record_savings_contribution_as_service(
  uuid, uuid, numeric, uuid, text, text, text, text, text,
  timestamp with time zone, text
) OWNER TO postgres;

COMMENT ON FUNCTION public.record_savings_contribution_as_service(
  uuid, uuid, numeric, uuid, text, text, text, text, text,
  timestamp with time zone, text
) IS 'Douit Phase 4.3.2 canonical savings linkage';

REVOKE ALL ON FUNCTION public.record_savings_contribution_as_service(
  uuid, uuid, numeric, uuid, text, text, text, text, text,
  timestamp with time zone, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_savings_contribution_as_service(
  uuid, uuid, numeric, uuid, text, text, text, text, text,
  timestamp with time zone, text
) TO service_role;

-- Service-only conservative evidence reconciliation. A candidate must match the
-- same actor, goal, exact amount, exact owned account identity, and precede the
-- authenticated Resend Receiving API timestamp by no more than 30 minutes. This
-- avoids the false upgrades possible with a whole Jakarta calendar day.
CREATE OR REPLACE FUNCTION public.reconcile_savings_contribution_evidence(
  p_actor_user_id uuid,
  p_goal_id uuid,
  p_amount numeric,
  p_source_account_id uuid,
  p_external_event_id text,
  p_notes text DEFAULT NULL,
  p_occurred_at timestamp with time zone DEFAULT pg_catalog.now(),
  p_raw_email_body text DEFAULT NULL
)
RETURNS TABLE (
  out_outcome text,
  out_transaction_id uuid,
  out_savings_log_id uuid,
  out_current_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  goal_row record;
  existing_row record;
  candidate_count bigint;
  candidate_log_id uuid;
  candidate_transaction_id uuid;
  goal_current_amount numeric;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  IF p_actor_user_id IS NULL OR p_goal_id IS NULL
    OR p_amount IS NULL
    OR p_amount::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_amount <= 0
    OR p_external_event_id IS NULL
    OR length(p_external_event_id) > 500
    OR p_external_event_id !~ '^savings:resend:[A-Za-z0-9._:-]+$'
    OR p_occurred_at IS NULL
  THEN
    RAISE EXCEPTION 'Invalid evidence reconciliation input';
  END IF;

  SELECT id, user_id, storage_type, current_amount
  INTO goal_row
  FROM public.savings_goals
  WHERE id = p_goal_id
    AND user_id = p_actor_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Savings goal not found for evidence actor';
  END IF;

  IF goal_row.storage_type NOT IN ('GOPAY_MERCHANT', 'BANK_TRANSFER')
    OR p_source_account_id IS NULL
  THEN
    RAISE EXCEPTION 'Automatic email evidence requires a non-cash source account';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_accounts account_row
    WHERE account_row.id = p_source_account_id
      AND account_row.user_id IS NOT NULL
      AND account_row.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Evidence source account is missing, ownerless, or foreign';
  END IF;

  SELECT log_row.id, log_row.transaction_id, log_row.goal_id, log_row.user_id,
         log_row.amount, log_row.source_account_id
  INTO existing_row
  FROM public.savings_logs log_row
  WHERE log_row.external_event_id = p_external_event_id;

  IF FOUND THEN
    IF existing_row.goal_id IS DISTINCT FROM p_goal_id
      OR existing_row.user_id IS DISTINCT FROM p_actor_user_id
      OR existing_row.amount IS DISTINCT FROM p_amount
      OR existing_row.source_account_id IS DISTINCT FROM p_source_account_id
    THEN
      RAISE EXCEPTION 'External event identity collides with another contribution';
    END IF;

    RETURN QUERY SELECT
      'REPLAYED', existing_row.transaction_id, existing_row.id,
      goal_row.current_amount;
    RETURN;
  END IF;

  SELECT
    count(*),
    (array_agg(log_row.id ORDER BY log_row.id))[1],
    (array_agg(log_row.transaction_id ORDER BY log_row.id))[1]
  INTO candidate_count, candidate_log_id, candidate_transaction_id
  FROM public.savings_logs log_row
  JOIN public.transactions transaction_row
    ON transaction_row.id = log_row.transaction_id
  WHERE log_row.user_id = p_actor_user_id
    AND log_row.goal_id = p_goal_id
    AND log_row.amount = p_amount
    AND log_row.source_account_id = p_source_account_id
    AND log_row.recording_method IN ('MANUAL_WEB', 'MANUAL_WHATSAPP')
    AND log_row.evidence_level = 'USER_CONFIRMED'
    AND log_row.external_event_id IS NULL
    AND transaction_row.transaction_date BETWEEN
      p_occurred_at - interval '30 minutes'
      AND p_occurred_at
    AND log_row.created_at BETWEEN
      p_occurred_at - interval '30 minutes'
      AND p_occurred_at;

  IF candidate_count = 0 THEN
    RETURN QUERY
    SELECT
      CASE WHEN contribution.out_replayed THEN 'REPLAYED' ELSE 'CREATED' END,
      contribution.out_transaction_id,
      contribution.out_savings_log_id,
      contribution.out_current_amount
    FROM public.record_savings_contribution_internal(
      p_actor_user_id,
      p_goal_id,
      p_amount,
      p_source_account_id,
      'AUTO_EMAIL',
      'EXTERNAL_VERIFIED',
      p_external_event_id,
      p_external_event_id,
      p_notes,
      'AUTOMATIC_EMAIL'::public.transaction_source,
      p_occurred_at,
      p_raw_email_body
    ) contribution;
    RETURN;
  ELSIF candidate_count > 1 THEN
    RETURN QUERY SELECT 'AMBIGUOUS', NULL::uuid, NULL::uuid,
      goal_row.current_amount;
    RETURN;
  END IF;

  UPDATE public.savings_logs
  SET evidence_level = 'EXTERNAL_VERIFIED',
      external_event_id = p_external_event_id
  WHERE id = candidate_log_id
    AND evidence_level = 'USER_CONFIRMED'
    AND external_event_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evidence candidate changed concurrently';
  END IF;

  SELECT current_amount INTO goal_current_amount
  FROM public.savings_goals
  WHERE id = p_goal_id;

  RETURN QUERY SELECT
    'UPGRADED', candidate_transaction_id, candidate_log_id,
    goal_current_amount;
END
$function$;

ALTER FUNCTION public.reconcile_savings_contribution_evidence(
  uuid, uuid, numeric, uuid, text, text, timestamp with time zone, text
) OWNER TO postgres;

COMMENT ON FUNCTION public.reconcile_savings_contribution_evidence(
  uuid, uuid, numeric, uuid, text, text, timestamp with time zone, text
) IS 'Douit Phase 4.3.2 canonical savings linkage';

REVOKE ALL ON FUNCTION public.reconcile_savings_contribution_evidence(
  uuid, uuid, numeric, uuid, text, text, timestamp with time zone, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_savings_contribution_evidence(
  uuid, uuid, numeric, uuid, text, text, timestamp with time zone, text
) TO service_role;

DO $phase4_3_2_function_contract$
DECLARE
  expected_oids oid[] := ARRAY[
    to_regprocedure('public.enforce_savings_log_linkage()')::oid,
    to_regprocedure('public.enforce_linked_savings_transaction_immutability()')::oid,
    to_regprocedure('public.record_savings_contribution_internal(uuid,uuid,numeric,uuid,text,text,text,text,text,public.transaction_source,timestamp with time zone,text)')::oid,
    to_regprocedure('public.record_savings_contribution(uuid,numeric,uuid,text,text)')::oid,
    to_regprocedure('public.record_savings_contribution_as_service(uuid,uuid,numeric,uuid,text,text,text,text,text,timestamp with time zone,text)')::oid,
    to_regprocedure('public.reconcile_savings_contribution_evidence(uuid,uuid,numeric,uuid,text,text,timestamp with time zone,text)')::oid
  ];
  actual_function_count bigint;
  named_function_count bigint;
BEGIN
  IF array_position(expected_oids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 4.3.2 canonical savings function signature is missing';
  END IF;

  SELECT count(*)
  INTO actual_function_count
  FROM pg_proc procedure_row
  JOIN pg_namespace namespace_row
    ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND procedure_row.proname IN (
      'enforce_savings_log_linkage',
      'enforce_linked_savings_transaction_immutability',
      'record_savings_contribution_internal',
      'record_savings_contribution',
      'record_savings_contribution_as_service',
      'reconcile_savings_contribution_evidence'
    )
    AND procedure_row.oid = ANY(expected_oids)
    AND procedure_row.prosecdef IS TRUE
    AND procedure_row.proowner = 'postgres'::regrole
    AND array_position(procedure_row.proconfig, 'search_path=""') IS NOT NULL
    AND obj_description(procedure_row.oid, 'pg_proc')
      = 'Douit Phase 4.3.2 canonical savings linkage';

  SELECT count(*)
  INTO named_function_count
  FROM pg_proc procedure_row
  JOIN pg_namespace namespace_row
    ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND procedure_row.proname IN (
      'enforce_savings_log_linkage',
      'enforce_linked_savings_transaction_immutability',
      'record_savings_contribution_internal',
      'record_savings_contribution',
      'record_savings_contribution_as_service',
      'reconcile_savings_contribution_evidence'
    );

  IF actual_function_count <> 6 OR named_function_count <> 6 THEN
    RAISE EXCEPTION 'Phase 4.3.2 canonical savings function contract is incomplete';
  END IF;
END
$phase4_3_2_function_contract$;

-- Fail closed if grants, ownership, or the removed custom-GUC mechanism leave
-- an API-facing path around the canonical wrappers.
DO $phase4_3_2_security_contract$
BEGIN
  IF has_function_privilege(
      'authenticated',
      'public.record_savings_contribution(uuid,numeric,uuid,text,text)',
      'EXECUTE'
    ) IS NOT TRUE
    OR has_function_privilege(
      'anon',
      'public.record_savings_contribution(uuid,numeric,uuid,text,text)',
      'EXECUTE'
    ) IS NOT FALSE
    OR has_function_privilege(
      'authenticated',
      'public.record_savings_contribution_as_service(uuid,uuid,numeric,uuid,text,text,text,text,text,timestamp with time zone,text)',
      'EXECUTE'
    ) IS NOT FALSE
    OR has_function_privilege(
      'service_role',
      'public.record_savings_contribution_as_service(uuid,uuid,numeric,uuid,text,text,text,text,text,timestamp with time zone,text)',
      'EXECUTE'
    ) IS NOT TRUE
    OR has_function_privilege(
      'authenticated',
      'public.reconcile_savings_contribution_evidence(uuid,uuid,numeric,uuid,text,text,timestamp with time zone,text)',
      'EXECUTE'
    ) IS NOT FALSE
    OR has_function_privilege(
      'service_role',
      'public.reconcile_savings_contribution_evidence(uuid,uuid,numeric,uuid,text,text,timestamp with time zone,text)',
      'EXECUTE'
    ) IS NOT TRUE
    OR has_function_privilege(
      'authenticated',
      'public.record_savings_contribution_internal(uuid,uuid,numeric,uuid,text,text,text,text,text,public.transaction_source,timestamp with time zone,text)',
      'EXECUTE'
    ) IS NOT FALSE
    OR has_function_privilege(
      'service_role',
      'public.record_savings_contribution_internal(uuid,uuid,numeric,uuid,text,text,text,text,text,public.transaction_source,timestamp with time zone,text)',
      'EXECUTE'
    ) IS NOT FALSE
    OR has_table_privilege('anon', 'public.savings_logs', 'INSERT') IS NOT FALSE
    OR has_table_privilege('anon', 'public.savings_logs', 'UPDATE') IS NOT FALSE
    OR has_table_privilege('anon', 'public.savings_logs', 'DELETE') IS NOT FALSE
    OR has_table_privilege('authenticated', 'public.savings_logs', 'INSERT') IS NOT FALSE
    OR has_table_privilege('authenticated', 'public.savings_logs', 'UPDATE') IS NOT FALSE
    OR has_table_privilege('authenticated', 'public.savings_logs', 'DELETE') IS NOT FALSE
    OR has_table_privilege('service_role', 'public.savings_logs', 'INSERT') IS NOT FALSE
    OR has_table_privilege('service_role', 'public.savings_logs', 'UPDATE') IS NOT FALSE
    OR has_table_privilege('service_role', 'public.savings_logs', 'DELETE') IS NOT FALSE
  THEN
    RAISE EXCEPTION 'Phase 4.3.2 canonical savings privilege contract is unsafe';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) role_row(role_name)
    CROSS JOIN (VALUES
      ('public.enforce_savings_log_linkage()'),
      ('public.enforce_linked_savings_transaction_immutability()'),
      ('public.record_savings_contribution_internal(uuid,uuid,numeric,uuid,text,text,text,text,text,public.transaction_source,timestamp with time zone,text)')
    ) internal_row(function_signature)
    WHERE has_function_privilege(
      role_row.role_name,
      internal_row.function_signature,
      'EXECUTE'
    )
  ) THEN
    RAISE EXCEPTION 'Phase 4.3.2 internal or trigger function is API-executable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure_row
    JOIN pg_namespace namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname IN (
        'enforce_savings_log_linkage',
        'enforce_linked_savings_transaction_immutability',
        'record_savings_contribution_internal',
        'record_savings_contribution',
        'record_savings_contribution_as_service',
        'reconcile_savings_contribution_evidence'
      )
      AND (
        procedure_row.prosrc LIKE '%douit.savings_rpc%'
        OR procedure_row.prosrc LIKE '%current_setting(%'
        OR procedure_row.prosrc LIKE '%set_config(%'
      )
  ) THEN
    RAISE EXCEPTION 'Phase 4.3.2 custom-GUC guard was not fully removed';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.transactions'::regclass
      AND trigger_row.tgname = 'enforce_saving_transaction_linkage_commit_trigger'
      AND trigger_row.tgisinternal IS FALSE
      AND trigger_row.tgenabled <> 'D'
      AND trigger_row.tgconstraint <> 0
      AND trigger_row.tgdeferrable IS TRUE
      AND trigger_row.tginitdeferred IS TRUE
  ) <> 1 THEN
    RAISE EXCEPTION 'Phase 4.3.2 deferred SAVING linkage trigger is missing or unsafe';
  END IF;
END
$phase4_3_2_security_contract$;

-- RLS remains enabled; this migration adds guarded RPCs and does not recreate or
-- loosen existing table policies.
DO $phase4_3_2_rls$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class table_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND table_row.relname IN (
        'savings_goals', 'savings_logs', 'transactions',
        'payment_accounts', 'categories'
      )
      AND table_row.relrowsecurity IS FALSE
  ) THEN
    RAISE EXCEPTION 'Phase 4.3.2 requires RLS to remain enabled';
  END IF;
END
$phase4_3_2_rls$;

-- Schema-only fingerprint guard: all legacy rows and old financial fields must
-- still exactly match the retained live audit JSON before commit.
DO $phase4_3_2_postcheck$
DECLARE
  log_row record;
  goal_row record;
  transaction_row record;
BEGIN
  SELECT count(*) AS row_count, coalesce(sum(amount), 0) AS amount_sum,
    md5(coalesce(string_agg(md5(concat_ws('|', id::text, goal_id::text,
      user_id::text, amount::text, coalesce(source_type, '<NULL>'),
      created_at::text)), '' ORDER BY id), '')) AS fingerprint
  INTO log_row FROM public.savings_logs;

  SELECT count(*) AS row_count, coalesce(sum(current_amount), 0) AS current_amount_sum,
    md5(coalesce(string_agg(md5(concat_ws('|', id::text, user_id::text,
      current_amount::text, status::text,
      coalesce(last_deposit_date::text, '<NULL>'))), '' ORDER BY id), '')) AS fingerprint
  INTO goal_row FROM public.savings_goals;

  SELECT count(*) AS row_count, coalesce(sum(amount), 0) AS amount_sum,
    md5(coalesce(string_agg(md5(concat_ws('|', id::text, amount::text,
      type::text, coalesce(category_id::text, '<NULL>'), status::text,
      coalesce(transaction_kind::text, '<NULL>'))), '' ORDER BY id), '')) AS fingerprint
  INTO transaction_row FROM public.transactions;

  IF log_row.row_count <> 8 OR log_row.amount_sum <> 20500::numeric
    OR log_row.fingerprint <> '204826ccb66ec48f8a27e124f8702c9c'
    OR goal_row.row_count <> 4 OR goal_row.current_amount_sum <> 20500::numeric
    OR goal_row.fingerprint <> '26576443d0d09f18f82e1fd1042d8145'
    OR transaction_row.row_count <> 170 OR transaction_row.amount_sum <> 6894758::numeric
    OR transaction_row.fingerprint <> 'bacd5ba5f91ee132e31465040d1a090e'
  THEN
    RAISE EXCEPTION 'Phase 4.3.2 migration changed historical financial data';
  END IF;
END
$phase4_3_2_postcheck$;

COMMIT;
