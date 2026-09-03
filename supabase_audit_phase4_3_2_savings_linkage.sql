-- Phase 4.3.2 read-only live catalog and data-shape audit.
--
-- Run this entire file once in the Supabase SQL Editor. It returns exactly one
-- row and one JSONB column named phase_4_3_2_audit.
--
-- This script performs no INSERT, UPDATE, DELETE, DDL, RPC invocation,
-- persistent temporary mutation, or historical pairing. User identifiers,
-- account names, goal names, and transaction descriptions are intentionally
-- excluded from the output.

WITH
columns_audit AS (
  SELECT coalesce(
    jsonb_agg(to_jsonb(audit_row) ORDER BY audit_row.table_name, audit_row.ordinal_position),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      column_row.table_name,
      column_row.ordinal_position,
      column_row.column_name,
      column_row.data_type,
      column_row.udt_schema,
      column_row.udt_name,
      column_row.is_nullable,
      column_row.column_default,
      column_row.numeric_precision,
      column_row.numeric_scale,
      column_row.character_maximum_length
    FROM information_schema.columns column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name IN (
        'savings_goals',
        'savings_logs',
        'transactions',
        'payment_accounts',
        'categories'
      )
  ) audit_row
),
enums_audit AS (
  SELECT coalesce(
    jsonb_agg(
      to_jsonb(audit_row)
      ORDER BY audit_row.enum_schema, audit_row.enum_name, audit_row.enumsortorder
    ),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      namespace_row.nspname AS enum_schema,
      type_row.typname AS enum_name,
      enum_row.enumsortorder,
      enum_row.enumlabel
    FROM pg_type type_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = type_row.typnamespace
    JOIN pg_enum enum_row ON enum_row.enumtypid = type_row.oid
    WHERE namespace_row.nspname = 'public'
      AND type_row.typname IN (
        'transaction_type',
        'transaction_status',
        'transaction_source'
      )
  ) audit_row
),
constraints_audit AS (
  SELECT coalesce(
    jsonb_agg(
      to_jsonb(audit_row)
      ORDER BY audit_row.table_name, audit_row.constraint_type, audit_row.constraint_name
    ),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      source_table.relname AS table_name,
      constraint_row.conname AS constraint_name,
      constraint_row.contype AS constraint_type,
      target_table.relname AS referenced_table,
      CASE constraint_row.confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        ELSE NULL
      END AS on_delete,
      CASE constraint_row.confupdtype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        ELSE NULL
      END AS on_update,
      constraint_row.condeferrable,
      constraint_row.condeferred,
      constraint_row.convalidated,
      pg_get_constraintdef(constraint_row.oid, true) AS definition
    FROM pg_constraint constraint_row
    JOIN pg_class source_table ON source_table.oid = constraint_row.conrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = source_table.relnamespace
    LEFT JOIN pg_class target_table ON target_table.oid = constraint_row.confrelid
    WHERE namespace_row.nspname = 'public'
      AND source_table.relname IN (
        'savings_goals',
        'savings_logs',
        'transactions',
        'payment_accounts',
        'categories'
      )
  ) audit_row
),
indexes_audit AS (
  SELECT coalesce(
    jsonb_agg(to_jsonb(audit_row) ORDER BY audit_row.table_name, audit_row.index_name),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      table_row.relname AS table_name,
      index_row.relname AS index_name,
      index_meta.indisunique AS is_unique,
      index_meta.indisprimary AS is_primary,
      index_meta.indisvalid AS is_valid,
      pg_get_expr(index_meta.indpred, index_meta.indrelid) AS predicate,
      pg_get_indexdef(index_meta.indexrelid) AS definition
    FROM pg_index index_meta
    JOIN pg_class table_row ON table_row.oid = index_meta.indrelid
    JOIN pg_class index_row ON index_row.oid = index_meta.indexrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND table_row.relname IN (
        'savings_goals',
        'savings_logs',
        'transactions',
        'payment_accounts',
        'categories'
      )
  ) audit_row
),
triggers_audit AS (
  SELECT coalesce(
    jsonb_agg(to_jsonb(audit_row) ORDER BY audit_row.table_name, audit_row.trigger_name),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      table_row.relname AS table_name,
      trigger_row.tgname AS trigger_name,
      trigger_row.tgenabled AS enabled_mode,
      pg_get_triggerdef(trigger_row.oid, true) AS definition
    FROM pg_trigger trigger_row
    JOIN pg_class table_row ON table_row.oid = trigger_row.tgrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND table_row.relname IN (
        'savings_goals',
        'savings_logs',
        'transactions',
        'payment_accounts',
        'categories'
      )
      AND trigger_row.tgisinternal IS FALSE
  ) audit_row
),
rls_tables_audit AS (
  SELECT coalesce(
    jsonb_agg(to_jsonb(audit_row) ORDER BY audit_row.table_name),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      class_row.relname AS table_name,
      class_row.relrowsecurity AS rls_enabled,
      class_row.relforcerowsecurity AS rls_forced
    FROM pg_class class_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = class_row.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND class_row.relkind = 'r'
      AND class_row.relname IN (
        'savings_goals',
        'savings_logs',
        'transactions',
        'payment_accounts',
        'categories'
      )
  ) audit_row
),
rls_policies_audit AS (
  SELECT coalesce(
    jsonb_agg(to_jsonb(audit_row) ORDER BY audit_row.tablename, audit_row.policyname),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      policy_row.tablename,
      policy_row.policyname,
      policy_row.permissive,
      policy_row.roles,
      policy_row.cmd,
      policy_row.qual,
      policy_row.with_check
    FROM pg_policies policy_row
    WHERE policy_row.schemaname = 'public'
      AND policy_row.tablename IN (
        'savings_goals',
        'savings_logs',
        'transactions',
        'payment_accounts',
        'categories'
      )
  ) audit_row
),
table_grants_audit AS (
  SELECT coalesce(
    jsonb_agg(
      to_jsonb(audit_row)
      ORDER BY audit_row.table_name, audit_row.grantee, audit_row.privilege_type
    ),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      grant_row.grantee,
      grant_row.table_name,
      grant_row.privilege_type,
      grant_row.is_grantable
    FROM information_schema.role_table_grants grant_row
    WHERE grant_row.table_schema = 'public'
      AND grant_row.table_name IN (
        'savings_goals',
        'savings_logs',
        'transactions',
        'payment_accounts',
        'categories'
      )
      AND grant_row.grantee IN ('anon', 'authenticated', 'service_role')
  ) audit_row
),
functions_audit AS (
  SELECT coalesce(
    jsonb_agg(
      to_jsonb(audit_row)
      ORDER BY audit_row.function_name, audit_row.identity_arguments
    ),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      namespace_row.nspname AS function_schema,
      procedure_row.proname AS function_name,
      pg_get_function_identity_arguments(procedure_row.oid) AS identity_arguments,
      pg_get_function_result(procedure_row.oid) AS result_type,
      procedure_row.prosecdef AS security_definer,
      procedure_row.proconfig AS function_config,
      pg_get_userbyid(procedure_row.proowner) AS owner_name
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
  ) audit_row
),
function_grants_audit AS (
  SELECT coalesce(
    jsonb_agg(
      to_jsonb(audit_row)
      ORDER BY audit_row.routine_name, audit_row.grantee, audit_row.specific_name
    ),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      grant_row.grantee,
      grant_row.routine_name,
      grant_row.specific_name,
      grant_row.privilege_type,
      grant_row.is_grantable
    FROM information_schema.role_routine_grants grant_row
    WHERE grant_row.specific_schema = 'public'
      AND grant_row.routine_name IN (
        'enforce_savings_log_linkage',
        'enforce_linked_savings_transaction_immutability',
        'record_savings_contribution_internal',
        'record_savings_contribution',
        'record_savings_contribution_as_service',
        'reconcile_savings_contribution_evidence'
      )
  ) audit_row
),
storage_inventory_audit AS (
  SELECT coalesce(
    jsonb_agg(to_jsonb(audit_row) ORDER BY audit_row.storage_type),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      coalesce(goal_row.storage_type, '<NULL>') AS storage_type,
      count(*) AS goal_count
    FROM public.savings_goals goal_row
    GROUP BY coalesce(goal_row.storage_type, '<NULL>')
  ) audit_row
),
savings_log_source_inventory_audit AS (
  SELECT coalesce(
    jsonb_agg(to_jsonb(audit_row) ORDER BY audit_row.legacy_source_type),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      coalesce(log_row.source_type, '<NULL>') AS legacy_source_type,
      count(*) AS log_count
    FROM public.savings_logs log_row
    GROUP BY coalesce(log_row.source_type, '<NULL>')
  ) audit_row
),
payment_account_inventory_audit AS (
  SELECT coalesce(
    jsonb_agg(to_jsonb(audit_row) ORDER BY audit_row.account_type),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      coalesce(account_row.type, '<NULL>') AS account_type,
      count(*) AS account_count,
      count(*) FILTER (WHERE lower(trim(account_row.name)) = lower('Tunai'))
        AS exact_tunai_name_count
    FROM public.payment_accounts account_row
    GROUP BY coalesce(account_row.type, '<NULL>')
  ) audit_row
),
transaction_inventory_audit AS (
  SELECT to_jsonb(audit_row) AS value
  FROM (
    SELECT
      count(*) AS total_transactions,
      count(*) FILTER (WHERE sumber_dana IS NULL) AS null_source_count,
      count(*) FILTER (WHERE lower(trim(sumber_dana)) = lower('Tunai'))
        AS exact_tunai_source_count,
      count(*) FILTER (WHERE transaction_kind::text = 'SAVING')
        AS explicit_saving_count
    FROM public.transactions
  ) audit_row
),
canonical_nabung_audit AS (
  SELECT to_jsonb(audit_row) AS value
  FROM (
    SELECT
      count(*) FILTER (
        WHERE category_row.is_system IS TRUE
          AND category_row.user_id IS NULL
          AND category_row.type::text = 'EXPENSE'
      ) AS canonical_expense_nabung_count,
      count(*) FILTER (
        WHERE category_row.is_system IS FALSE
          AND category_row.user_id IS NOT NULL
      ) AS custom_nabung_count,
      count(*) FILTER (
        WHERE NOT (
          category_row.is_system IS TRUE
          AND category_row.user_id IS NULL
          AND category_row.type::text = 'EXPENSE'
        )
        AND NOT (
          category_row.is_system IS FALSE
          AND category_row.user_id IS NOT NULL
        )
      ) AS malformed_nabung_count
    FROM public.categories category_row
    WHERE lower(trim(category_row.name)) = lower('Nabung')
  ) audit_row
),
linkage_baseline_audit AS (
  SELECT coalesce(
    jsonb_agg(to_jsonb(audit_row) ORDER BY audit_row.ordinal_position),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      column_row.ordinal_position,
      column_row.column_name,
      column_row.data_type,
      column_row.udt_name,
      column_row.is_nullable,
      column_row.column_default
    FROM information_schema.columns column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = 'savings_logs'
      AND column_row.column_name IN (
        'transaction_id',
        'recording_method',
        'evidence_level',
        'idempotency_key',
        'external_event_id',
        'source_account_id'
      )
  ) audit_row
),
savings_logs_fingerprint_audit AS (
  SELECT to_jsonb(audit_row) AS value
  FROM (
    SELECT
      count(*) AS savings_log_count,
      coalesce(sum(amount), 0) AS savings_log_amount_sum,
      md5(coalesce(string_agg(
        md5(concat_ws('|', id::text, goal_id::text, user_id::text, amount::text,
          coalesce(source_type, '<NULL>'), created_at::text)),
        '' ORDER BY id
      ), '')) AS savings_log_fingerprint
    FROM public.savings_logs
  ) audit_row
),
savings_goals_fingerprint_audit AS (
  SELECT to_jsonb(audit_row) AS value
  FROM (
    SELECT
      count(*) AS savings_goal_count,
      coalesce(sum(current_amount), 0) AS current_amount_sum,
      md5(coalesce(string_agg(
        md5(concat_ws('|', id::text, user_id::text, current_amount::text,
          status::text, coalesce(last_deposit_date::text, '<NULL>'))),
        '' ORDER BY id
      ), '')) AS savings_goal_progress_fingerprint
    FROM public.savings_goals
  ) audit_row
),
transactions_fingerprint_audit AS (
  SELECT to_jsonb(audit_row) AS value
  FROM (
    SELECT
      count(*) AS transaction_count,
      coalesce(sum(amount), 0) AS transaction_amount_sum,
      md5(coalesce(string_agg(
        md5(concat_ws('|', id::text, amount::text, type::text,
          coalesce(category_id::text, '<NULL>'), status::text,
          coalesce(transaction_kind::text, '<NULL>'))),
        '' ORDER BY id
      ), '')) AS transaction_fingerprint
    FROM public.transactions
  ) audit_row
)
SELECT jsonb_build_object(
  'columns', columns_audit.value,
  'enums', enums_audit.value,
  'constraints', constraints_audit.value,
  'indexes', indexes_audit.value,
  'triggers', triggers_audit.value,
  'rls_tables', rls_tables_audit.value,
  'rls_policies', rls_policies_audit.value,
  'table_grants', table_grants_audit.value,
  'functions', functions_audit.value,
  'function_grants', function_grants_audit.value,
  'storage_inventory', storage_inventory_audit.value,
  'savings_log_source_inventory', savings_log_source_inventory_audit.value,
  'payment_account_inventory', payment_account_inventory_audit.value,
  'transaction_inventory', transaction_inventory_audit.value,
  'canonical_nabung', canonical_nabung_audit.value,
  'linkage_baseline', linkage_baseline_audit.value,
  'fingerprints', jsonb_build_object(
    'savings_logs', savings_logs_fingerprint_audit.value,
    'savings_goals', savings_goals_fingerprint_audit.value,
    'transactions', transactions_fingerprint_audit.value
  )
) AS phase_4_3_2_audit
FROM columns_audit
CROSS JOIN enums_audit
CROSS JOIN constraints_audit
CROSS JOIN indexes_audit
CROSS JOIN triggers_audit
CROSS JOIN rls_tables_audit
CROSS JOIN rls_policies_audit
CROSS JOIN table_grants_audit
CROSS JOIN functions_audit
CROSS JOIN function_grants_audit
CROSS JOIN storage_inventory_audit
CROSS JOIN savings_log_source_inventory_audit
CROSS JOIN payment_account_inventory_audit
CROSS JOIN transaction_inventory_audit
CROSS JOIN canonical_nabung_audit
CROSS JOIN linkage_baseline_audit
CROSS JOIN savings_logs_fingerprint_audit
CROSS JOIN savings_goals_fingerprint_audit
CROSS JOIN transactions_fingerprint_audit;
