-- Phase 4.3.2 post-migration verification. Read-only.
-- Run manually only after the migration succeeds. No statement mutates data.

-- 1. Exact additive savings_logs columns. Expected compatible_column_count = 5.
SELECT
  count(*) AS compatible_column_count,
  CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'INVESTIGATE' END AS status
FROM (VALUES
  ('transaction_id', 'uuid'),
  ('recording_method', 'text'),
  ('evidence_level', 'text'),
  ('external_event_id', 'text'),
  ('source_account_id', 'uuid')
) expected(column_name, data_type)
JOIN information_schema.columns column_row
  ON column_row.table_schema = 'public'
 AND column_row.table_name = 'savings_logs'
 AND column_row.column_name = expected.column_name
 AND column_row.data_type = expected.data_type
 AND column_row.is_nullable = 'YES'
 AND column_row.column_default IS NULL;

WITH enum_audit AS (
  SELECT
    type_row.typname AS enum_name,
    array_agg(enum_row.enumlabel ORDER BY enum_row.enumlabel) AS values
  FROM pg_type type_row
  JOIN pg_namespace namespace_row ON namespace_row.oid = type_row.typnamespace
  JOIN pg_enum enum_row ON enum_row.enumtypid = type_row.oid
  WHERE namespace_row.nspname = 'public'
    AND type_row.typname IN (
      'transaction_type', 'transaction_status', 'transaction_source'
    )
  GROUP BY type_row.typname
)
SELECT
  enum_name,
  values,
  CASE
    WHEN enum_name = 'transaction_type'
      AND values = ARRAY['EXPENSE', 'INCOME']::text[] THEN 'PASS'
    WHEN enum_name = 'transaction_status'
      AND values = ARRAY['APPROVED', 'IGNORED', 'PENDING_APPROVAL']::text[] THEN 'PASS'
    WHEN enum_name = 'transaction_source'
      AND values = ARRAY['AUTOMATIC_EMAIL', 'MANUAL_CHAT', 'MANUAL_FORM']::text[] THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM enum_audit
ORDER BY enum_name;

-- 2. Check/FK inventory and conservative delete contract.
SELECT
  constraint_row.conname,
  constraint_row.contype,
  constraint_row.convalidated,
  CASE constraint_row.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
    ELSE NULL
  END AS on_delete,
  pg_get_constraintdef(constraint_row.oid, true) AS definition
FROM pg_constraint constraint_row
WHERE constraint_row.conrelid = 'public.savings_logs'::regclass
  AND constraint_row.conname IN (
    'savings_logs_recording_method_check',
    'savings_logs_evidence_level_check',
    'savings_logs_linked_metadata_check',
    'savings_logs_external_evidence_check',
    'savings_logs_transaction_id_fkey',
    'savings_logs_source_account_id_fkey',
    'savings_logs_goal_id_fkey'
  )
ORDER BY constraint_row.conname;

SELECT
  count(*) FILTER (
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confdeltype = 'r'
      AND target_table.relname = 'transactions'
  ) AS restricted_transaction_fk_count,
  count(*) FILTER (
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confdeltype = 'r'
      AND target_table.relname = 'payment_accounts'
  ) AS restricted_account_fk_count,
  count(*) FILTER (
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confdeltype = 'r'
      AND target_table.relname = 'savings_goals'
  ) AS restricted_goal_fk_count,
  CASE
    WHEN count(*) FILTER (
      WHERE constraint_row.contype = 'f'
        AND constraint_row.confdeltype = 'r'
        AND target_table.relname IN ('transactions', 'payment_accounts', 'savings_goals')
    ) = 3 THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM pg_constraint constraint_row
JOIN pg_class target_table ON target_table.oid = constraint_row.confrelid
WHERE constraint_row.conrelid = 'public.savings_logs'::regclass;

SELECT
  count(*) FILTER (
    WHERE convalidated IS TRUE
      AND conname = 'savings_logs_recording_method_check'
      AND pg_get_constraintdef(oid, true) LIKE '%AUTO_EMAIL%'
      AND pg_get_constraintdef(oid, true) LIKE '%MANUAL_WEB%'
      AND pg_get_constraintdef(oid, true) LIKE '%MANUAL_WHATSAPP%'
  ) AS recording_method_check_count,
  count(*) FILTER (
    WHERE convalidated IS TRUE
      AND conname = 'savings_logs_evidence_level_check'
      AND pg_get_constraintdef(oid, true) LIKE '%USER_CONFIRMED%'
      AND pg_get_constraintdef(oid, true) LIKE '%EXTERNAL_VERIFIED%'
  ) AS evidence_level_check_count,
  count(*) FILTER (
    WHERE convalidated IS TRUE
      AND conname IN (
        'savings_logs_linked_metadata_check',
        'savings_logs_external_evidence_check'
      )
  ) AS metadata_check_count,
  CASE
    WHEN count(*) FILTER (
      WHERE convalidated IS TRUE
        AND conname IN (
          'savings_logs_recording_method_check',
          'savings_logs_evidence_level_check',
          'savings_logs_linked_metadata_check',
          'savings_logs_external_evidence_check'
        )
    ) = 4 THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM pg_constraint
WHERE conrelid = 'public.savings_logs'::regclass;

-- 3. Unique/lookup index contract.
SELECT
  index_table.relname AS index_name,
  index_meta.indisunique AS is_unique,
  index_meta.indisvalid AS is_valid,
  pg_get_expr(index_meta.indpred, index_meta.indrelid) AS predicate,
  pg_get_indexdef(index_meta.indexrelid) AS definition
FROM pg_index index_meta
JOIN pg_class index_table ON index_table.oid = index_meta.indexrelid
WHERE index_meta.indrelid = 'public.savings_logs'::regclass
  AND index_table.relname IN (
    'savings_logs_transaction_id_unique',
    'savings_logs_external_event_id_unique',
    'savings_logs_source_account_id_idx'
  )
ORDER BY index_table.relname;

SELECT
  count(*) AS expected_index_count,
  count(*) FILTER (WHERE index_meta.indisvalid IS TRUE) AS valid_index_count,
  count(*) FILTER (WHERE index_meta.indisunique IS TRUE) AS unique_index_count,
  count(*) FILTER (
    WHERE pg_get_expr(index_meta.indpred, index_meta.indrelid) IS NOT NULL
  ) AS partial_index_count,
  CASE
    WHEN count(*) = 3
      AND count(*) FILTER (WHERE index_meta.indisvalid IS TRUE) = 3
      AND count(*) FILTER (WHERE index_meta.indisunique IS TRUE) = 2
      AND count(*) FILTER (
        WHERE pg_get_expr(index_meta.indpred, index_meta.indrelid) IS NOT NULL
      ) = 3
    THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM pg_index index_meta
JOIN pg_class index_table ON index_table.oid = index_meta.indexrelid
WHERE index_meta.indrelid = 'public.savings_logs'::regclass
  AND index_table.relname IN (
    'savings_logs_transaction_id_unique',
    'savings_logs_external_event_id_unique',
    'savings_logs_source_account_id_idx'
  );

SELECT
  count(*) AS transaction_idempotency_unique_index_count,
  CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'INVESTIGATE' END AS status
FROM pg_index index_meta
JOIN pg_attribute attribute_row
  ON attribute_row.attrelid = index_meta.indrelid
 AND attribute_row.attnum = ANY(index_meta.indkey)
WHERE index_meta.indrelid = 'public.transactions'::regclass
  AND index_meta.indisunique IS TRUE
  AND index_meta.indisvalid IS TRUE
  AND index_meta.indnkeyatts = 1
  AND index_meta.indkey::smallint[] = ARRAY[attribute_row.attnum]::smallint[]
  AND attribute_row.attname = 'idempotency_key';

SELECT
  constraint_row.conname,
  constraint_row.convalidated,
  pg_get_constraintdef(constraint_row.oid, true) AS definition,
  CASE
    WHEN constraint_row.contype = 'c'
      AND constraint_row.convalidated IS TRUE
      AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%ORDINARY%'
      AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%TRANSFER%'
      AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%SAVING%'
      AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%FEE%'
    THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM pg_constraint constraint_row
WHERE constraint_row.conrelid = 'public.transactions'::regclass
  AND constraint_row.conname = 'transactions_transaction_kind_check';

-- 4. Direct-write trigger exists and is enabled.
SELECT
  trigger_row.tgname,
  trigger_row.tgenabled,
  pg_get_triggerdef(trigger_row.oid, true) AS definition,
  CASE WHEN trigger_row.tgenabled <> 'D' THEN 'PASS' ELSE 'INVESTIGATE' END AS status
FROM pg_trigger trigger_row
WHERE trigger_row.tgrelid = 'public.savings_logs'::regclass
  AND trigger_row.tgname = 'enforce_savings_log_linkage_trigger'
  AND trigger_row.tgisinternal IS FALSE;

SELECT
  trigger_row.tgname,
  trigger_row.tgenabled,
  pg_get_triggerdef(trigger_row.oid, true) AS definition,
  CASE WHEN trigger_row.tgenabled <> 'D' THEN 'PASS' ELSE 'INVESTIGATE' END AS status
FROM pg_trigger trigger_row
WHERE trigger_row.tgrelid = 'public.transactions'::regclass
  AND trigger_row.tgname = 'enforce_linked_savings_transaction_immutability_trigger'
  AND trigger_row.tgisinternal IS FALSE;

SELECT
  count(*) AS deferred_transaction_linkage_trigger_count,
  count(*) FILTER (
    WHERE trigger_row.tgenabled <> 'D'
      AND trigger_row.tgconstraint <> 0
      AND trigger_row.tgdeferrable IS TRUE
      AND trigger_row.tginitdeferred IS TRUE
      AND pg_get_triggerdef(trigger_row.oid, true)
        ~ 'AFTER INSERT OR UPDATE ON (public\.)?transactions'
  ) AS valid_deferred_transaction_linkage_trigger_count,
  CASE
    WHEN count(*) = 1
      AND count(*) FILTER (
        WHERE trigger_row.tgenabled <> 'D'
          AND trigger_row.tgconstraint <> 0
          AND trigger_row.tgdeferrable IS TRUE
          AND trigger_row.tginitdeferred IS TRUE
          AND pg_get_triggerdef(trigger_row.oid, true)
            ~ 'AFTER INSERT OR UPDATE ON (public\.)?transactions'
      ) = 1
    THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM pg_trigger trigger_row
WHERE trigger_row.tgrelid = 'public.transactions'::regclass
  AND trigger_row.tgname = 'enforce_saving_transaction_linkage_commit_trigger'
  AND trigger_row.tgisinternal IS FALSE;

-- 5. Exact function signatures, SECURITY DEFINER, and empty search_path.
SELECT
  procedure_row.proname,
  pg_get_function_identity_arguments(procedure_row.oid) AS identity_arguments,
  pg_get_function_result(procedure_row.oid) AS result_type,
  procedure_row.prosecdef AS security_definer,
  pg_get_userbyid(procedure_row.proowner) AS function_owner,
  procedure_row.proconfig AS function_config,
  CASE
    WHEN procedure_row.prosecdef IS TRUE
      AND pg_get_userbyid(procedure_row.proowner) = 'postgres'
      AND array_position(procedure_row.proconfig, 'search_path=""') IS NOT NULL
      AND obj_description(procedure_row.oid, 'pg_proc')
        = 'Douit Phase 4.3.2 canonical savings linkage'
    THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM pg_proc procedure_row
JOIN pg_namespace namespace_row ON namespace_row.oid = procedure_row.pronamespace
WHERE namespace_row.nspname = 'public'
  AND procedure_row.proname IN (
    'enforce_savings_log_linkage',
    'enforce_linked_savings_transaction_immutability',
    'record_savings_contribution_internal',
    'record_savings_contribution',
    'record_savings_contribution_as_service',
    'reconcile_savings_contribution_evidence'
  )
ORDER BY procedure_row.proname, identity_arguments;

WITH expected(signature) AS (VALUES
  ('public.enforce_savings_log_linkage()'),
  ('public.enforce_linked_savings_transaction_immutability()'),
  ('public.record_savings_contribution_internal(uuid,uuid,numeric,uuid,text,text,text,text,text,public.transaction_source,timestamp with time zone,text)'),
  ('public.record_savings_contribution(uuid,numeric,uuid,text,text)'),
  ('public.record_savings_contribution_as_service(uuid,uuid,numeric,uuid,text,text,text,text,text,timestamp with time zone,text)'),
  ('public.reconcile_savings_contribution_evidence(uuid,uuid,numeric,uuid,text,text,timestamp with time zone,text)')
), signature_audit AS (
  SELECT
    count(*) AS expected_signature_count,
    count(to_regprocedure(expected.signature)) AS existing_signature_count
  FROM expected
), name_audit AS (
  SELECT count(*) AS named_function_count
  FROM pg_proc procedure_row
  JOIN pg_namespace namespace_row ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND procedure_row.proname IN (
      'enforce_savings_log_linkage',
      'enforce_linked_savings_transaction_immutability',
      'record_savings_contribution_internal',
      'record_savings_contribution',
      'record_savings_contribution_as_service',
      'reconcile_savings_contribution_evidence'
    )
)
SELECT
  signature_audit.expected_signature_count,
  signature_audit.existing_signature_count,
  name_audit.named_function_count,
  CASE
    WHEN signature_audit.expected_signature_count = 6
      AND signature_audit.existing_signature_count = 6
      AND name_audit.named_function_count = 6
      THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM signature_audit
CROSS JOIN name_audit;

-- 6. Execute grants: browser RPC only for authenticated; integration RPCs only
-- for service_role; internal/trigger functions remain unavailable directly.
WITH grant_audit AS (
SELECT
  has_function_privilege(
    'authenticated',
    'public.record_savings_contribution(uuid,numeric,uuid,text,text)',
    'EXECUTE'
  ) AS authenticated_browser_execute,
  has_function_privilege(
    'anon',
    'public.record_savings_contribution(uuid,numeric,uuid,text,text)',
    'EXECUTE'
  ) AS anon_browser_execute,
  has_function_privilege(
    'authenticated',
    'public.record_savings_contribution_as_service(uuid,uuid,numeric,uuid,text,text,text,text,text,timestamp with time zone,text)',
    'EXECUTE'
  ) AS authenticated_service_execute,
  has_function_privilege(
    'service_role',
    'public.record_savings_contribution_as_service(uuid,uuid,numeric,uuid,text,text,text,text,text,timestamp with time zone,text)',
    'EXECUTE'
  ) AS service_wrapper_execute,
  has_function_privilege(
    'authenticated',
    'public.reconcile_savings_contribution_evidence(uuid,uuid,numeric,uuid,text,text,timestamp with time zone,text)',
    'EXECUTE'
  ) AS authenticated_reconcile_execute,
  has_function_privilege(
    'service_role',
    'public.reconcile_savings_contribution_evidence(uuid,uuid,numeric,uuid,text,text,timestamp with time zone,text)',
    'EXECUTE'
  ) AS service_reconcile_execute,
  has_function_privilege(
    'anon',
    'public.record_savings_contribution_as_service(uuid,uuid,numeric,uuid,text,text,text,text,text,timestamp with time zone,text)',
    'EXECUTE'
  ) AS anon_service_execute,
  has_function_privilege(
    'anon',
    'public.reconcile_savings_contribution_evidence(uuid,uuid,numeric,uuid,text,text,timestamp with time zone,text)',
    'EXECUTE'
  ) AS anon_reconcile_execute,
  has_function_privilege(
    'authenticated',
    'public.record_savings_contribution_internal(uuid,uuid,numeric,uuid,text,text,text,text,text,public.transaction_source,timestamp with time zone,text)',
    'EXECUTE'
  ) AS authenticated_internal_execute,
  has_function_privilege(
    'service_role',
    'public.record_savings_contribution_internal(uuid,uuid,numeric,uuid,text,text,text,text,text,public.transaction_source,timestamp with time zone,text)',
    'EXECUTE'
  ) AS service_internal_execute,
  has_function_privilege(
    'authenticated',
    'public.enforce_savings_log_linkage()',
    'EXECUTE'
  ) AS authenticated_log_trigger_execute,
  has_function_privilege(
    'authenticated',
    'public.enforce_linked_savings_transaction_immutability()',
    'EXECUTE'
  ) AS authenticated_transaction_trigger_execute,
  has_function_privilege(
    'anon',
    'public.record_savings_contribution_internal(uuid,uuid,numeric,uuid,text,text,text,text,text,public.transaction_source,timestamp with time zone,text)',
    'EXECUTE'
  ) AS anon_internal_execute,
  has_function_privilege(
    'anon',
    'public.enforce_savings_log_linkage()',
    'EXECUTE'
  ) AS anon_log_trigger_execute,
  has_function_privilege(
    'anon',
    'public.enforce_linked_savings_transaction_immutability()',
    'EXECUTE'
  ) AS anon_transaction_trigger_execute,
  has_function_privilege(
    'service_role',
    'public.enforce_savings_log_linkage()',
    'EXECUTE'
  ) AS service_log_trigger_execute,
  has_function_privilege(
    'service_role',
    'public.enforce_linked_savings_transaction_immutability()',
    'EXECUTE'
  ) AS service_transaction_trigger_execute
)
SELECT
  grant_audit.*,
  CASE
    WHEN authenticated_browser_execute IS TRUE
      AND anon_browser_execute IS FALSE
      AND authenticated_service_execute IS FALSE
      AND service_wrapper_execute IS TRUE
      AND authenticated_reconcile_execute IS FALSE
      AND service_reconcile_execute IS TRUE
      AND anon_service_execute IS FALSE
      AND anon_reconcile_execute IS FALSE
      AND authenticated_internal_execute IS FALSE
      AND service_internal_execute IS FALSE
      AND authenticated_log_trigger_execute IS FALSE
      AND authenticated_transaction_trigger_execute IS FALSE
      AND anon_internal_execute IS FALSE
      AND anon_log_trigger_execute IS FALSE
      AND anon_transaction_trigger_execute IS FALSE
      AND service_log_trigger_execute IS FALSE
      AND service_transaction_trigger_execute IS FALSE
    THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM grant_audit;

-- API-facing roles cannot construct or mutate savings_logs directly. The
-- authenticated wrapper still works as SECURITY DEFINER; reads remain under RLS.
WITH table_grant_audit AS (
  SELECT
    has_table_privilege('anon', 'public.savings_logs', 'INSERT') AS anon_log_insert,
    has_table_privilege('anon', 'public.savings_logs', 'UPDATE') AS anon_log_update,
    has_table_privilege('anon', 'public.savings_logs', 'DELETE') AS anon_log_delete,
    has_table_privilege('authenticated', 'public.savings_logs', 'INSERT') AS authenticated_log_insert,
    has_table_privilege('authenticated', 'public.savings_logs', 'UPDATE') AS authenticated_log_update,
    has_table_privilege('authenticated', 'public.savings_logs', 'DELETE') AS authenticated_log_delete,
    has_table_privilege('service_role', 'public.savings_logs', 'INSERT') AS service_log_insert,
    has_table_privilege('service_role', 'public.savings_logs', 'UPDATE') AS service_log_update,
    has_table_privilege('service_role', 'public.savings_logs', 'DELETE') AS service_log_delete
)
SELECT
  table_grant_audit.*,
  CASE
    WHEN anon_log_insert IS FALSE
      AND anon_log_update IS FALSE
      AND anon_log_delete IS FALSE
      AND authenticated_log_insert IS FALSE
      AND authenticated_log_update IS FALSE
      AND authenticated_log_delete IS FALSE
      AND service_log_insert IS FALSE
      AND service_log_update IS FALSE
      AND service_log_delete IS FALSE
    THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM table_grant_audit;

-- The final design intentionally has no caller-controlled custom-GUC bypass.
SELECT
  count(*) FILTER (
    WHERE procedure_row.prosrc LIKE '%douit.savings_rpc%'
       OR procedure_row.prosrc LIKE '%current_setting(%'
       OR procedure_row.prosrc LIKE '%set_config(%'
  ) AS guc_guard_reference_count,
  CASE
    WHEN count(*) FILTER (
      WHERE procedure_row.prosrc LIKE '%douit.savings_rpc%'
         OR procedure_row.prosrc LIKE '%current_setting(%'
         OR procedure_row.prosrc LIKE '%set_config(%'
    ) = 0 THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM pg_proc procedure_row
JOIN pg_namespace namespace_row ON namespace_row.oid = procedure_row.pronamespace
WHERE namespace_row.nspname = 'public'
  AND procedure_row.proname IN (
    'enforce_savings_log_linkage',
    'enforce_linked_savings_transaction_immutability',
    'record_savings_contribution_internal',
    'record_savings_contribution',
    'record_savings_contribution_as_service',
    'reconcile_savings_contribution_evidence'
  );

-- 7. RLS remains enabled and policy inventory remains visible.
SELECT
  class_row.relname AS table_name,
  class_row.relrowsecurity AS rls_enabled,
  count(policy_row.policyname) AS policy_count,
  CASE
    WHEN class_row.relrowsecurity IS TRUE AND count(policy_row.policyname) > 0
      THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM pg_class class_row
JOIN pg_namespace namespace_row ON namespace_row.oid = class_row.relnamespace
LEFT JOIN pg_policies policy_row
  ON policy_row.schemaname = namespace_row.nspname
 AND policy_row.tablename = class_row.relname
WHERE namespace_row.nspname = 'public'
  AND class_row.relname IN (
    'savings_goals', 'savings_logs', 'transactions',
    'payment_accounts', 'categories'
  )
GROUP BY class_row.relname, class_row.relrowsecurity
ORDER BY class_row.relname;

-- 8. No historical linkage or metadata backfill. Expected every count = 0.
SELECT
  count(*) FILTER (WHERE transaction_id IS NOT NULL) AS linked_rows,
  count(*) FILTER (WHERE recording_method IS NOT NULL) AS recording_method_rows,
  count(*) FILTER (WHERE evidence_level IS NOT NULL) AS evidence_level_rows,
  count(*) FILTER (WHERE external_event_id IS NOT NULL) AS external_event_rows,
  count(*) FILTER (WHERE source_account_id IS NOT NULL) AS source_account_rows,
  CASE
    WHEN count(*) FILTER (
      WHERE transaction_id IS NOT NULL
         OR recording_method IS NOT NULL
         OR evidence_level IS NOT NULL
         OR external_event_id IS NOT NULL
         OR source_account_id IS NOT NULL
    ) = 0 THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS status
FROM public.savings_logs;

-- 9. Exact retained historical fingerprints. Every row must report PASS.
SELECT
  'savings_logs' AS domain,
  count(*) AS row_count,
  coalesce(sum(amount), 0) AS amount_sum,
  md5(coalesce(string_agg(
    md5(concat_ws('|', id::text, goal_id::text, user_id::text, amount::text,
      coalesce(source_type, '<NULL>'), created_at::text)),
    '' ORDER BY id
  ), '')) AS fingerprint,
  CASE
    WHEN count(*) = 8
      AND coalesce(sum(amount), 0) = 20500::numeric
      AND md5(coalesce(string_agg(
        md5(concat_ws('|', id::text, goal_id::text, user_id::text, amount::text,
          coalesce(source_type, '<NULL>'), created_at::text)),
        '' ORDER BY id
      ), '')) = '204826ccb66ec48f8a27e124f8702c9c'
    THEN 'PASS' ELSE 'FAIL'
  END AS status
FROM public.savings_logs
UNION ALL
SELECT
  'savings_goals',
  count(*),
  coalesce(sum(current_amount), 0),
  md5(coalesce(string_agg(
    md5(concat_ws('|', id::text, user_id::text, current_amount::text,
      status::text, coalesce(last_deposit_date::text, '<NULL>'))),
    '' ORDER BY id
  ), '')),
  CASE
    WHEN count(*) = 4
      AND coalesce(sum(current_amount), 0) = 20500::numeric
      AND md5(coalesce(string_agg(
        md5(concat_ws('|', id::text, user_id::text, current_amount::text,
          status::text, coalesce(last_deposit_date::text, '<NULL>'))),
        '' ORDER BY id
      ), '')) = '26576443d0d09f18f82e1fd1042d8145'
    THEN 'PASS' ELSE 'FAIL'
  END
FROM public.savings_goals
UNION ALL
SELECT
  'transactions',
  count(*),
  coalesce(sum(amount), 0),
  md5(coalesce(string_agg(
    md5(concat_ws('|', id::text, amount::text, type::text,
      coalesce(category_id::text, '<NULL>'), status::text,
      coalesce(transaction_kind::text, '<NULL>'))),
    '' ORDER BY id
  ), '')),
  CASE
    WHEN count(*) = 170
      AND coalesce(sum(amount), 0) = 6894758::numeric
      AND md5(coalesce(string_agg(
        md5(concat_ws('|', id::text, amount::text, type::text,
          coalesce(category_id::text, '<NULL>'), status::text,
          coalesce(transaction_kind::text, '<NULL>'))),
        '' ORDER BY id
      ), '')) = 'bacd5ba5f91ee132e31465040d1a090e'
    THEN 'PASS' ELSE 'FAIL'
  END
FROM public.transactions;
