-- Phase 4.2A read-only verification. Run manually immediately AFTER the
-- migration and BEFORE creating test/application subcategory assignments.
-- This script does not mutate schema or data.

-- 1. Table and core columns. Expected: nine rows with the documented nullability.
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'subcategories'
ORDER BY ordinal_position;

-- 2. RLS must be enabled and exactly four canonical authenticated policies must exist.
SELECT c.relrowsecurity AS subcategories_rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'subcategories';

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'subcategories'
ORDER BY policyname;

WITH canonical_policy(policyname) AS (
  VALUES
    ('subcategories_select_own_or_system'),
    ('subcategories_insert_own_custom'),
    ('subcategories_update_own_custom'),
    ('subcategories_delete_own_custom')
), actual_policy AS (
  SELECT policyname
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'subcategories'
)
SELECT
  count(*) AS total_policy_count,
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
FROM actual_policy;

-- 3. Constraints and indexes. Confirm parent FK is immediate NO ACTION and the
-- transaction FK is ON DELETE SET NULL.
SELECT
  constraint_row.conname,
  constraint_row.contype,
  constraint_row.condeferrable,
  constraint_row.condeferred,
  pg_get_constraintdef(constraint_row.oid) AS definition
FROM pg_constraint constraint_row
WHERE constraint_row.conrelid IN (
  'public.subcategories'::regclass,
  'public.transactions'::regclass
)
  AND (
    constraint_row.conrelid = 'public.subcategories'::regclass
    OR constraint_row.conname = 'transactions_subcategory_id_fkey'
  )
ORDER BY constraint_row.conrelid::regclass::text, constraint_row.conname;

SELECT
  constraint_row.conname,
  constraint_row.confdeltype,
  constraint_row.condeferrable,
  constraint_row.condeferred,
  pg_get_constraintdef(constraint_row.oid) AS definition,
  CASE
    WHEN constraint_row.confrelid = 'public.categories'::regclass
      AND constraint_row.confdeltype = 'a'
      AND constraint_row.condeferrable IS FALSE
      AND constraint_row.condeferred IS FALSE
    THEN 'IMMEDIATE_ON_DELETE_NO_ACTION'
    ELSE 'INVESTIGATE'
  END AS verification_status
FROM pg_constraint constraint_row
WHERE constraint_row.conrelid = 'public.subcategories'::regclass
  AND constraint_row.conname = 'subcategories_parent_fkey'
  AND constraint_row.contype = 'f';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('subcategories', 'transactions')
  AND (
    tablename = 'subcategories'
    OR indexname = 'idx_transactions_subcategory_id'
  )
ORDER BY tablename, indexname;

-- 4. Ownership/system identity invariant. Every count must be zero.
SELECT
  count(*) FILTER (WHERE is_system IS TRUE AND user_id IS NOT NULL) AS system_with_owner,
  count(*) FILTER (WHERE is_system IS FALSE AND user_id IS NULL) AS custom_without_owner,
  count(*) FILTER (WHERE is_system IS TRUE AND system_key IS NULL) AS system_without_key,
  count(*) FILTER (WHERE is_system IS FALSE AND system_key IS NOT NULL) AS custom_with_key,
  count(*) FILTER (WHERE name <> btrim(name) OR name = '') AS invalid_name
FROM public.subcategories;

-- 5. Stable key and case-insensitive scoped-name duplicates. Expected: no rows.
SELECT system_key, count(*) AS row_count
FROM public.subcategories
WHERE is_system IS TRUE
GROUP BY system_key
HAVING count(*) > 1;

SELECT
  category_id,
  lower(name) AS normalized_name,
  count(*) AS row_count
FROM public.subcategories
WHERE is_system IS TRUE AND user_id IS NULL
GROUP BY category_id, lower(name)
HAVING count(*) > 1;

SELECT
  md5(user_id::text) AS owner_hash,
  category_id,
  lower(name) AS normalized_name,
  count(*) AS row_count
FROM public.subcategories
WHERE is_system IS FALSE AND user_id IS NOT NULL
GROUP BY user_id, category_id, lower(name)
HAVING count(*) > 1;

-- 6. Parent ownership. Every count must be zero; no user UUID is displayed.
SELECT
  count(*) FILTER (
    WHERE child.is_system IS TRUE
      AND NOT (parent.is_system IS TRUE AND parent.user_id IS NULL)
  ) AS invalid_system_parent,
  count(*) FILTER (
    WHERE child.is_system IS FALSE
      AND NOT (
        (parent.is_system IS TRUE AND parent.user_id IS NULL)
        OR
        (parent.is_system IS FALSE AND parent.user_id = child.user_id)
      )
  ) AS invalid_custom_parent
FROM public.subcategories child
JOIN public.categories parent ON parent.id = child.category_id;

-- 7. Exact seed inventory. Expected: 25 MATCH rows and no MISSING/DRIFT rows.
WITH expected(system_key, parent_name, subcategory_name) AS (
  VALUES
    ('expense_food_dining_out', 'Makanan & Minuman', 'Makan di Luar'),
    ('expense_food_groceries', 'Makanan & Minuman', 'Bahan Makanan'),
    ('expense_food_snacks', 'Makanan & Minuman', 'Cemilan'),
    ('expense_food_coffee_drinks', 'Makanan & Minuman', 'Kopi & Minuman'),
    ('expense_transport_fuel', 'Transportasi', 'Bensin'),
    ('expense_transport_ride_hailing', 'Transportasi', 'Ojek Online'),
    ('expense_transport_parking_tolls', 'Transportasi', 'Parkir & Tol'),
    ('expense_transport_public', 'Transportasi', 'Transportasi Publik'),
    ('expense_transport_vehicle_maintenance', 'Transportasi', 'Perawatan Kendaraan'),
    ('expense_digital_software_apps', 'Barang Digital', 'Aplikasi & Software'),
    ('expense_digital_games_content', 'Barang Digital', 'Game & Konten Digital'),
    ('expense_digital_cloud_storage', 'Barang Digital', 'Penyimpanan Cloud'),
    ('expense_shopping_daily_needs', 'Belanja', 'Kebutuhan Harian'),
    ('expense_shopping_clothing_accessories', 'Belanja', 'Pakaian & Aksesori'),
    ('expense_shopping_electronics', 'Belanja', 'Elektronik'),
    ('expense_shopping_personal_care', 'Belanja', 'Perawatan Diri'),
    ('expense_bills_electricity', 'Tagihan', 'Listrik'),
    ('expense_bills_water', 'Tagihan', 'Air'),
    ('expense_bills_internet', 'Tagihan', 'Internet'),
    ('expense_bills_mobile_data', 'Tagihan', 'Pulsa & Data'),
    ('expense_bills_rent_dues', 'Tagihan', 'Sewa & Iuran'),
    ('expense_services_household', 'Jasa', 'Rumah Tangga'),
    ('expense_services_repairs', 'Jasa', 'Perbaikan & Servis'),
    ('expense_services_professional', 'Jasa', 'Jasa Profesional'),
    ('expense_services_delivery', 'Jasa', 'Pengiriman & Kurir')
)
SELECT
  expected.parent_name,
  expected.subcategory_name,
  expected.system_key,
  CASE
    WHEN child.id IS NULL THEN 'MISSING'
    WHEN parent.name <> expected.parent_name
      OR child.name <> expected.subcategory_name
      OR parent.is_system IS NOT TRUE
      OR parent.user_id IS NOT NULL
      OR child.is_system IS NOT TRUE
      OR child.user_id IS NOT NULL
    THEN 'DRIFT'
    ELSE 'MATCH'
  END AS verification_status
FROM expected
LEFT JOIN public.subcategories child
  ON child.system_key = expected.system_key
 AND child.is_system IS TRUE
LEFT JOIN public.categories parent ON parent.id = child.category_id
ORDER BY expected.parent_name, expected.subcategory_name;

WITH expected(system_key) AS (
  VALUES
    ('expense_food_dining_out'), ('expense_food_groceries'),
    ('expense_food_snacks'), ('expense_food_coffee_drinks'),
    ('expense_transport_fuel'), ('expense_transport_ride_hailing'),
    ('expense_transport_parking_tolls'), ('expense_transport_public'),
    ('expense_transport_vehicle_maintenance'), ('expense_digital_software_apps'),
    ('expense_digital_games_content'), ('expense_digital_cloud_storage'),
    ('expense_shopping_daily_needs'), ('expense_shopping_clothing_accessories'),
    ('expense_shopping_electronics'), ('expense_shopping_personal_care'),
    ('expense_bills_electricity'), ('expense_bills_water'),
    ('expense_bills_internet'), ('expense_bills_mobile_data'),
    ('expense_bills_rent_dues'), ('expense_services_household'),
    ('expense_services_repairs'), ('expense_services_professional'),
    ('expense_services_delivery')
)
SELECT
  count(child.id) AS canonical_seed_count,
  CASE WHEN count(child.id) = 25 THEN 'EXPECTED_25' ELSE 'INVESTIGATE' END AS verification_status
FROM expected
LEFT JOIN public.subcategories child
  ON child.system_key = expected.system_key
 AND child.is_system IS TRUE
 AND child.user_id IS NULL;

-- 8. Transaction column and FK. subcategory_id must be nullable.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'transactions'
  AND column_name = 'subcategory_id';

WITH attribute_number AS (
  SELECT
    (SELECT attnum FROM pg_attribute
     WHERE attrelid = 'public.transactions'::regclass
       AND attname = 'subcategory_id'
       AND attisdropped IS FALSE) AS transaction_subcategory_attnum,
    (SELECT attnum FROM pg_attribute
     WHERE attrelid = 'public.subcategories'::regclass
       AND attname = 'id'
       AND attisdropped IS FALSE) AS subcategory_id_attnum
)
SELECT
  constraint_row.conname,
  constraint_row.confrelid::regclass AS referenced_table,
  constraint_row.confdeltype,
  pg_get_constraintdef(constraint_row.oid) AS definition,
  CASE
    WHEN constraint_row.conkey = ARRAY[attribute_number.transaction_subcategory_attnum]::smallint[]
      AND constraint_row.confrelid = 'public.subcategories'::regclass
      AND constraint_row.confkey = ARRAY[attribute_number.subcategory_id_attnum]::smallint[]
      AND constraint_row.confdeltype = 'n'
    THEN 'COMPATIBLE_ON_DELETE_SET_NULL'
    ELSE 'INCOMPATIBLE'
  END AS verification_status
FROM pg_constraint constraint_row
CROSS JOIN attribute_number
WHERE constraint_row.conrelid = 'public.transactions'::regclass
  AND constraint_row.contype = 'f'
  AND attribute_number.transaction_subcategory_attnum = ANY (constraint_row.conkey)
ORDER BY constraint_row.conname;

WITH attribute_number AS (
  SELECT
    (SELECT attnum FROM pg_attribute
     WHERE attrelid = 'public.transactions'::regclass
       AND attname = 'subcategory_id'
       AND attisdropped IS FALSE) AS transaction_subcategory_attnum,
    (SELECT attnum FROM pg_attribute
     WHERE attrelid = 'public.subcategories'::regclass
       AND attname = 'id'
       AND attisdropped IS FALSE) AS subcategory_id_attnum
), inventory AS (
  SELECT
    constraint_row.*,
    attribute_number.transaction_subcategory_attnum,
    attribute_number.subcategory_id_attnum
  FROM pg_constraint constraint_row
  CROSS JOIN attribute_number
  WHERE constraint_row.conrelid = 'public.transactions'::regclass
    AND constraint_row.contype = 'f'
    AND attribute_number.transaction_subcategory_attnum = ANY (constraint_row.conkey)
)
SELECT
  count(*) AS subcategory_fk_count,
  count(*) FILTER (
    WHERE conkey = ARRAY[transaction_subcategory_attnum]::smallint[]
      AND confrelid = 'public.subcategories'::regclass
      AND confkey = ARRAY[subcategory_id_attnum]::smallint[]
      AND confdeltype = 'n'
  ) AS compatible_fk_count,
  CASE
    WHEN count(*) = 1
      AND count(*) FILTER (
        WHERE conkey = ARRAY[transaction_subcategory_attnum]::smallint[]
          AND confrelid = 'public.subcategories'::regclass
          AND confkey = ARRAY[subcategory_id_attnum]::smallint[]
          AND confdeltype = 'n'
      ) = 1
    THEN 'EXACTLY_ONE_COMPATIBLE_FK'
    ELSE 'INVESTIGATE'
  END AS verification_status
FROM inventory;

-- 9. Run immediately after migration, before manual write tests. Expected: zero.
SELECT
  count(*) AS non_null_transaction_subcategory_count,
  CASE WHEN count(*) = 0 THEN 'NO_BACKFILL_CONFIRMED' ELSE 'INVESTIGATE' END AS verification_status
FROM public.transactions
WHERE subcategory_id IS NOT NULL;

-- 10. Parent-child/type/owner consistency. Every count must be zero.
SELECT
  count(*) FILTER (WHERE child.category_id <> transaction_row.category_id) AS parent_child_mismatches,
  count(*) FILTER (
    WHERE upper(parent.type::text) <> upper(transaction_row.type::text)
  ) AS inherited_type_mismatches,
  count(*) FILTER (
    WHERE NOT (
      (child.is_system IS TRUE AND child.user_id IS NULL)
      OR
      (child.is_system IS FALSE AND child.user_id = transaction_row.user_id)
    )
  ) AS foreign_custom_subcategory_assignments
FROM public.transactions transaction_row
JOIN public.subcategories child ON child.id = transaction_row.subcategory_id
JOIN public.categories parent ON parent.id = child.category_id;

-- 11. Current row count is reported, not hardcoded. Compare with the immediately
-- pre-migration count captured during manual rollout review.
SELECT count(*) AS current_transaction_count
FROM public.transactions;

-- 12. Phase 4.1B anomaly baselines. Migration 4.2A does not modify either set;
-- investigate differences while accounting for concurrent live transactions.
SELECT
  count(*) AS transaction_category_type_mismatches,
  CASE WHEN count(*) = 12 THEN 'MATCHES_PHASE_4_1B_BASELINE'
       ELSE 'BASELINE_CHANGED_OR_CONCURRENT_DATA_INVESTIGATE'
  END AS verification_status
FROM public.transactions transaction_row
JOIN public.categories category_row ON category_row.id = transaction_row.category_id
WHERE upper(transaction_row.type::text) <> upper(category_row.type::text);

SELECT
  count(*) AS approved_null_category_count,
  CASE WHEN count(*) = 3 THEN 'MATCHES_PHASE_4_1B_BASELINE'
       ELSE 'BASELINE_CHANGED_OR_CONCURRENT_DATA_INVESTIGATE'
  END AS verification_status
FROM public.transactions
WHERE status::text = 'APPROVED' AND category_id IS NULL;

-- 13. Enforcement triggers must exist, expose the intended event/column scope,
-- and be enabled.
SELECT
  trigger_row.tgname AS trigger_name,
  trigger_row.tgenabled,
  pg_get_triggerdef(trigger_row.oid) AS definition
FROM pg_trigger trigger_row
WHERE trigger_row.tgrelid IN (
    'public.subcategories'::regclass,
    'public.transactions'::regclass
  )
  AND trigger_row.tgisinternal IS FALSE
  AND trigger_row.tgname IN (
    'trg_subcategories_parent_ownership',
    'trg_transactions_subcategory_consistency'
  )
ORDER BY trigger_row.tgname;

-- 14. Both trigger functions must be SECURITY DEFINER and pin an empty
-- search_path through pg_proc.proconfig.
WITH expected(proname) AS (
  VALUES
    ('enforce_subcategory_parent_ownership'),
    ('enforce_transaction_subcategory_consistency')
), function_inventory AS (
  SELECT
    function_row.oid,
    function_row.proname,
    function_row.prosecdef,
    function_row.proconfig,
    function_row.prorettype
  FROM pg_proc function_row
  JOIN pg_namespace namespace_row ON namespace_row.oid = function_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND function_row.pronargs = 0
)
SELECT
  expected.proname,
  function_inventory.oid IS NOT NULL AS function_exists,
  function_inventory.prosecdef AS security_definer,
  function_inventory.proconfig,
  CASE
    WHEN function_inventory.oid IS NOT NULL
      AND function_inventory.prorettype = 'trigger'::regtype
      AND function_inventory.prosecdef IS TRUE
      AND EXISTS (
        SELECT 1
        FROM unnest(coalesce(function_inventory.proconfig, ARRAY[]::text[])) setting
        WHERE setting IN ('search_path=""', 'search_path=')
      )
    THEN 'SECURITY_DEFINER_EMPTY_SEARCH_PATH'
    ELSE 'INVESTIGATE'
  END AS verification_status
FROM expected
LEFT JOIN function_inventory USING (proname)
ORDER BY expected.proname;

-- Manual API verification (use anon/session clients, never SQL Editor's
-- privileged role). Use disposable custom rows and clean them up afterward.
-- A. No session: SELECT subcategories; expected zero rows.
-- B. User A SELECT: expected 25 system rows + only A custom rows.
-- C. User B SELECT: expected 25 system rows, no A custom rows.
-- D. User A INSERT {user_id: A, is_system: false} under a system parent: succeeds.
-- E. User A INSERT under A's custom category: succeeds.
-- F. User A INSERT under B's custom category: rejected.
-- G. User A INSERT with user_id B or is_system true: rejected.
-- H. User A UPDATE/DELETE a system row: rejected.
-- I. User B UPDATE/DELETE A's custom row: rejected.
-- J. User A assigns an owned/system child whose parent equals transaction.category_id: succeeds.
-- K. User A assigns a child from another parent or B-owned child: rejected.

-- 15. FINAL SUMMARY. This must remain the last result set in this file.
-- Run immediately after the migration and before runtime assignment tests.
WITH
expected_policy(policyname) AS (
  VALUES
    ('subcategories_select_own_or_system'),
    ('subcategories_insert_own_custom'),
    ('subcategories_update_own_custom'),
    ('subcategories_delete_own_custom')
),
policy_summary AS (
  SELECT
    count(*) AS total_policy_count,
    count(*) FILTER (
      WHERE policyname IN (SELECT policyname FROM expected_policy)
    ) AS canonical_policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'subcategories'
),
table_summary AS (
  SELECT
    to_regclass('public.subcategories') IS NOT NULL AS subcategories_table_exists,
    coalesce((
      SELECT class_row.relrowsecurity
      FROM pg_class class_row
      JOIN pg_namespace namespace_row ON namespace_row.oid = class_row.relnamespace
      WHERE namespace_row.nspname = 'public'
        AND class_row.relname = 'subcategories'
    ), FALSE) AS subcategories_rls_enabled
),
ownership_summary AS (
  SELECT count(*) FILTER (
    WHERE (is_system IS TRUE AND user_id IS NOT NULL)
      OR (is_system IS FALSE AND user_id IS NULL)
  ) AS ownership_violation_count
  FROM public.subcategories
),
expected_seed(system_key, parent_name, subcategory_name) AS (
  VALUES
    ('expense_food_dining_out', 'Makanan & Minuman', 'Makan di Luar'),
    ('expense_food_groceries', 'Makanan & Minuman', 'Bahan Makanan'),
    ('expense_food_snacks', 'Makanan & Minuman', 'Cemilan'),
    ('expense_food_coffee_drinks', 'Makanan & Minuman', 'Kopi & Minuman'),
    ('expense_transport_fuel', 'Transportasi', 'Bensin'),
    ('expense_transport_ride_hailing', 'Transportasi', 'Ojek Online'),
    ('expense_transport_parking_tolls', 'Transportasi', 'Parkir & Tol'),
    ('expense_transport_public', 'Transportasi', 'Transportasi Publik'),
    ('expense_transport_vehicle_maintenance', 'Transportasi', 'Perawatan Kendaraan'),
    ('expense_digital_software_apps', 'Barang Digital', 'Aplikasi & Software'),
    ('expense_digital_games_content', 'Barang Digital', 'Game & Konten Digital'),
    ('expense_digital_cloud_storage', 'Barang Digital', 'Penyimpanan Cloud'),
    ('expense_shopping_daily_needs', 'Belanja', 'Kebutuhan Harian'),
    ('expense_shopping_clothing_accessories', 'Belanja', 'Pakaian & Aksesori'),
    ('expense_shopping_electronics', 'Belanja', 'Elektronik'),
    ('expense_shopping_personal_care', 'Belanja', 'Perawatan Diri'),
    ('expense_bills_electricity', 'Tagihan', 'Listrik'),
    ('expense_bills_water', 'Tagihan', 'Air'),
    ('expense_bills_internet', 'Tagihan', 'Internet'),
    ('expense_bills_mobile_data', 'Tagihan', 'Pulsa & Data'),
    ('expense_bills_rent_dues', 'Tagihan', 'Sewa & Iuran'),
    ('expense_services_household', 'Jasa', 'Rumah Tangga'),
    ('expense_services_repairs', 'Jasa', 'Perbaikan & Servis'),
    ('expense_services_professional', 'Jasa', 'Jasa Profesional'),
    ('expense_services_delivery', 'Jasa', 'Pengiriman & Kurir')
),
seed_summary AS (
  SELECT count(child.id) AS system_seed_count
  FROM expected_seed expected
  LEFT JOIN public.categories parent
    ON parent.name = expected.parent_name
   AND parent.is_system IS TRUE
   AND parent.user_id IS NULL
  LEFT JOIN public.subcategories child
    ON child.system_key = expected.system_key
   AND child.category_id = parent.id
   AND child.name = expected.subcategory_name
   AND child.is_system IS TRUE
   AND child.user_id IS NULL
),
duplicate_system_key_summary AS (
  SELECT count(*) AS duplicate_system_key_count
  FROM (
    SELECT system_key
    FROM public.subcategories
    WHERE is_system IS TRUE
    GROUP BY system_key
    HAVING count(*) > 1
  ) duplicate_group
),
duplicate_system_name_summary AS (
  SELECT count(*) AS duplicate_system_name_count
  FROM (
    SELECT category_id, lower(name)
    FROM public.subcategories
    WHERE is_system IS TRUE AND user_id IS NULL
    GROUP BY category_id, lower(name)
    HAVING count(*) > 1
  ) duplicate_group
),
parent_ownership_summary AS (
  SELECT count(*) FILTER (
    WHERE parent.id IS NULL
      OR (
        child.is_system IS TRUE
        AND NOT (parent.is_system IS TRUE AND parent.user_id IS NULL)
      )
      OR (
        child.is_system IS FALSE
        AND NOT (
          (parent.is_system IS TRUE AND parent.user_id IS NULL)
          OR (parent.is_system IS FALSE AND parent.user_id = child.user_id)
        )
      )
  ) AS invalid_parent_ownership_count
  FROM public.subcategories child
  LEFT JOIN public.categories parent ON parent.id = child.category_id
),
transaction_column_summary AS (
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name = 'subcategory_id'
      AND data_type = 'uuid'
      AND is_nullable = 'YES'
  ) AS transactions_subcategory_column_exists
),
attribute_number AS (
  SELECT
    (SELECT attnum FROM pg_attribute
     WHERE attrelid = 'public.transactions'::regclass
       AND attname = 'subcategory_id'
       AND attisdropped IS FALSE) AS transaction_subcategory_attnum,
    (SELECT attnum FROM pg_attribute
     WHERE attrelid = 'public.subcategories'::regclass
       AND attname = 'id'
       AND attisdropped IS FALSE) AS subcategory_id_attnum,
    (SELECT attnum FROM pg_attribute
     WHERE attrelid = 'public.subcategories'::regclass
       AND attname = 'category_id'
       AND attisdropped IS FALSE) AS subcategory_category_attnum,
    (SELECT attnum FROM pg_attribute
     WHERE attrelid = 'public.categories'::regclass
       AND attname = 'id'
       AND attisdropped IS FALSE) AS category_id_attnum,
    (SELECT attnum FROM pg_attribute
     WHERE attrelid = 'public.transactions'::regclass
       AND attname = 'category_id'
       AND attisdropped IS FALSE) AS transaction_category_attnum,
    (SELECT attnum FROM pg_attribute
     WHERE attrelid = 'public.transactions'::regclass
       AND attname = 'type'
       AND attisdropped IS FALSE) AS transaction_type_attnum,
    (SELECT attnum FROM pg_attribute
     WHERE attrelid = 'public.transactions'::regclass
       AND attname = 'user_id'
       AND attisdropped IS FALSE) AS transaction_user_attnum
),
transaction_fk_inventory AS (
  SELECT
    constraint_row.*,
    attribute_number.transaction_subcategory_attnum,
    attribute_number.subcategory_id_attnum
  FROM pg_constraint constraint_row
  CROSS JOIN attribute_number
  WHERE constraint_row.conrelid = 'public.transactions'::regclass
    AND constraint_row.contype = 'f'
    AND attribute_number.transaction_subcategory_attnum = ANY (constraint_row.conkey)
),
transaction_fk_summary AS (
  SELECT
    count(*) AS transaction_subcategory_fk_count,
    count(*) FILTER (
      WHERE conkey = ARRAY[transaction_subcategory_attnum]::smallint[]
        AND confrelid = 'public.subcategories'::regclass
        AND confkey = ARRAY[subcategory_id_attnum]::smallint[]
        AND confdeltype = 'n'
    ) AS compatible_transaction_fk_count
  FROM transaction_fk_inventory
),
parent_fk_summary AS (
  SELECT (
    count(*) = 1
    AND count(*) FILTER (
      WHERE constraint_row.conkey = ARRAY[attribute_number.subcategory_category_attnum]::smallint[]
        AND constraint_row.confrelid = 'public.categories'::regclass
        AND constraint_row.confkey = ARRAY[attribute_number.category_id_attnum]::smallint[]
        AND constraint_row.confdeltype = 'a'
        AND constraint_row.condeferrable IS FALSE
        AND constraint_row.condeferred IS FALSE
    ) = 1
  ) AS parent_fk_valid
  FROM pg_constraint constraint_row
  CROSS JOIN attribute_number
  WHERE constraint_row.conrelid = 'public.subcategories'::regclass
    AND constraint_row.contype = 'f'
    AND attribute_number.subcategory_category_attnum = ANY (constraint_row.conkey)
),
transaction_trigger_summary AS (
  SELECT (
    count(*) = 1
    AND count(*) FILTER (
      WHERE trigger_row.tgenabled IN ('O', 'A')
        AND (trigger_row.tgtype::integer & 1) = 1
        AND (trigger_row.tgtype::integer & 2) = 2
        AND (trigger_row.tgtype::integer & 4) = 4
        AND (trigger_row.tgtype::integer & 8) = 0
        AND (trigger_row.tgtype::integer & 16) = 16
        AND (trigger_row.tgtype::integer & 32) = 0
        AND (trigger_row.tgtype::integer & 64) = 0
        AND cardinality(trigger_row.tgattr::smallint[]) = 4
        AND attribute_number.transaction_subcategory_attnum = ANY (trigger_row.tgattr::smallint[])
        AND attribute_number.transaction_category_attnum = ANY (trigger_row.tgattr::smallint[])
        AND attribute_number.transaction_type_attnum = ANY (trigger_row.tgattr::smallint[])
        AND attribute_number.transaction_user_attnum = ANY (trigger_row.tgattr::smallint[])
        AND trigger_row.tgfoid = to_regprocedure('public.enforce_transaction_subcategory_consistency()')
    ) = 1
  ) AS transaction_trigger_valid
  FROM pg_trigger trigger_row
  CROSS JOIN attribute_number
  WHERE trigger_row.tgrelid = 'public.transactions'::regclass
    AND trigger_row.tgisinternal IS FALSE
    AND trigger_row.tgname = 'trg_transactions_subcategory_consistency'
),
expected_function(proname) AS (
  VALUES
    ('enforce_subcategory_parent_ownership'),
    ('enforce_transaction_subcategory_consistency')
),
function_inventory AS (
  SELECT
    expected_function.proname AS expected_proname,
    function_row.oid,
    function_row.prosecdef,
    function_row.proconfig,
    function_row.prorettype
  FROM expected_function
  LEFT JOIN pg_namespace namespace_row ON namespace_row.nspname = 'public'
  LEFT JOIN pg_proc function_row
    ON function_row.pronamespace = namespace_row.oid
   AND function_row.proname = expected_function.proname
   AND function_row.pronargs = 0
),
function_security_summary AS (
  SELECT count(*) FILTER (
    WHERE oid IS NOT NULL
      AND prorettype = 'trigger'::regtype
      AND prosecdef IS TRUE
      AND EXISTS (
        SELECT 1
        FROM unnest(coalesce(proconfig, ARRAY[]::text[])) setting
        WHERE setting IN ('search_path=""', 'search_path=')
      )
  ) = 2 AS trigger_functions_security_valid
  FROM function_inventory
),
transaction_taxonomy_summary AS (
  SELECT
    count(*) FILTER (
      WHERE transaction_row.subcategory_id IS NOT NULL
    ) AS existing_non_null_subcategory_count,
    count(*) FILTER (
      WHERE transaction_row.subcategory_id IS NOT NULL
        AND child.category_id IS DISTINCT FROM transaction_row.category_id
    ) AS parent_child_mismatch_count
  FROM public.transactions transaction_row
  LEFT JOIN public.subcategories child ON child.id = transaction_row.subcategory_id
),
historical_baseline_summary AS (
  SELECT
    (SELECT count(*)
     FROM public.transactions transaction_row
     JOIN public.categories category_row ON category_row.id = transaction_row.category_id
     WHERE upper(transaction_row.type::text) <> upper(category_row.type::text)
    ) AS transaction_category_type_mismatch_count,
    (SELECT count(*)
     FROM public.transactions
     WHERE status::text = 'APPROVED' AND category_id IS NULL
    ) AS approved_null_category_count
),
summary AS (
  SELECT
    table_summary.subcategories_table_exists,
    table_summary.subcategories_rls_enabled,
    policy_summary.total_policy_count,
    policy_summary.canonical_policy_count,
    ownership_summary.ownership_violation_count,
    seed_summary.system_seed_count,
    duplicate_system_key_summary.duplicate_system_key_count,
    duplicate_system_name_summary.duplicate_system_name_count,
    parent_ownership_summary.invalid_parent_ownership_count,
    transaction_column_summary.transactions_subcategory_column_exists,
    transaction_fk_summary.transaction_subcategory_fk_count,
    transaction_fk_summary.compatible_transaction_fk_count,
    parent_fk_summary.parent_fk_valid,
    transaction_trigger_summary.transaction_trigger_valid,
    function_security_summary.trigger_functions_security_valid,
    transaction_taxonomy_summary.existing_non_null_subcategory_count,
    transaction_taxonomy_summary.parent_child_mismatch_count,
    historical_baseline_summary.transaction_category_type_mismatch_count,
    historical_baseline_summary.approved_null_category_count
  FROM table_summary
  CROSS JOIN policy_summary
  CROSS JOIN ownership_summary
  CROSS JOIN seed_summary
  CROSS JOIN duplicate_system_key_summary
  CROSS JOIN duplicate_system_name_summary
  CROSS JOIN parent_ownership_summary
  CROSS JOIN transaction_column_summary
  CROSS JOIN transaction_fk_summary
  CROSS JOIN parent_fk_summary
  CROSS JOIN transaction_trigger_summary
  CROSS JOIN function_security_summary
  CROSS JOIN transaction_taxonomy_summary
  CROSS JOIN historical_baseline_summary
)
SELECT
  summary.*,
  CASE
    WHEN subcategories_table_exists IS TRUE
      AND subcategories_rls_enabled IS TRUE
      AND total_policy_count = 4
      AND canonical_policy_count = 4
      AND ownership_violation_count = 0
      AND system_seed_count = 25
      AND duplicate_system_key_count = 0
      AND duplicate_system_name_count = 0
      AND invalid_parent_ownership_count = 0
      AND transactions_subcategory_column_exists IS TRUE
      AND transaction_subcategory_fk_count = 1
      AND compatible_transaction_fk_count = 1
      AND parent_fk_valid IS TRUE
      AND transaction_trigger_valid IS TRUE
      AND trigger_functions_security_valid IS TRUE
      AND existing_non_null_subcategory_count = 0
      AND parent_child_mismatch_count = 0
      AND transaction_category_type_mismatch_count = 12
      AND approved_null_category_count = 3
    THEN 'PASS'
    ELSE 'INVESTIGATE'
  END AS overall_status
FROM summary;
