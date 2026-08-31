-- Phase 4.2A: Taxonomy Schema + RLS + Seed
-- MANUAL REVIEW + EXECUTION REQUIRED. Application code never runs this file.
-- Historical transaction mutation: NONE. Existing rows receive NULL subcategory_id.

BEGIN;

-- Remember whether this is the first application and prove that this migration
-- does not change the number of transaction rows.
CREATE TEMP TABLE phase4_2a_context ON COMMIT DROP AS
SELECT
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name = 'subcategory_id'
  ) AS subcategory_column_existed,
  count(*)::bigint AS transaction_count_before
FROM public.transactions;

-- Seed parents are resolved only as exact canonical system rows. Missing,
-- duplicate, renamed, owner-scoped, or type-incompatible parents abort the
-- migration instead of attaching children to an arbitrary row.
DO $$
DECLARE
  invalid_parents text;
BEGIN
  WITH expected(name, expected_type) AS (
    VALUES
      ('Makanan & Minuman', 'EXPENSE'),
      ('Transportasi', 'EXPENSE'),
      ('Barang Digital', 'EXPENSE'),
      ('Belanja', 'EXPENSE'),
      ('Tagihan', 'EXPENSE'),
      ('Jasa', 'EXPENSE')
  ), resolved AS (
    SELECT
      e.name,
      e.expected_type,
      count(c.id) AS row_count,
      bool_and(c.name = e.name AND upper(c.type::text) = e.expected_type) AS exact_match
    FROM expected e
    LEFT JOIN public.categories c
      ON lower(btrim(c.name)) = lower(e.name)
     AND c.is_system IS TRUE
     AND c.user_id IS NULL
    GROUP BY e.name, e.expected_type
  )
  SELECT string_agg(name, ', ' ORDER BY name)
  INTO invalid_parents
  FROM resolved
  WHERE row_count <> 1 OR exact_match IS NOT TRUE;

  IF invalid_parents IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 4.2A canonical seed parent preflight failed: %', invalid_parents;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.subcategories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL,
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  system_key TEXT NULL,
  icon_name TEXT NULL,
  color_hex TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subcategories_parent_fkey
    FOREIGN KEY (category_id)
    REFERENCES public.categories(id)
    ON DELETE NO ACTION,
  CONSTRAINT subcategories_name_not_blank_check
    CHECK (name = btrim(name) AND name <> ''),
  CONSTRAINT subcategories_ownership_check
    CHECK (
      (is_system IS TRUE AND user_id IS NULL)
      OR
      (is_system IS FALSE AND user_id IS NOT NULL)
    ),
  CONSTRAINT subcategories_system_key_check
    CHECK (
      (
        is_system IS TRUE
        AND system_key IS NOT NULL
        AND system_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
      )
      OR
      (is_system IS FALSE AND system_key IS NULL)
    )
);

-- Fail closed if a pre-existing object named subcategories does not expose the
-- Phase 4.2A core column contract. A mismatched table needs separate review.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subcategories'
      AND column_name = 'id' AND data_type = 'uuid' AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subcategories'
      AND column_name = 'category_id' AND data_type = 'uuid' AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subcategories'
      AND column_name = 'user_id' AND data_type = 'uuid' AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subcategories'
      AND column_name = 'name' AND data_type = 'text' AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subcategories'
      AND column_name = 'is_system' AND data_type = 'boolean' AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subcategories'
      AND column_name = 'system_key' AND data_type = 'text' AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subcategories'
      AND column_name = 'icon_name' AND data_type = 'text' AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subcategories'
      AND column_name = 'color_hex' AND data_type = 'text' AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subcategories'
      AND column_name = 'created_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Existing public.subcategories does not match the Phase 4.2A column contract';
  END IF;
END
$$;

DO $$
DECLARE
  required_constraint_count bigint;
  parent_fk_valid boolean;
  owner_fk_valid boolean;
BEGIN
  SELECT count(*)
  INTO required_constraint_count
  FROM pg_constraint
  WHERE conrelid = 'public.subcategories'::regclass
    AND conname = ANY (ARRAY[
      'subcategories_parent_fkey',
      'subcategories_user_id_fkey',
      'subcategories_name_not_blank_check',
      'subcategories_ownership_check',
      'subcategories_system_key_check'
    ]);

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.subcategories'::regclass
      AND conname = 'subcategories_parent_fkey'
      AND contype = 'f'
      AND confrelid = 'public.categories'::regclass
      AND confdeltype = 'a'
      AND condeferrable IS FALSE
      AND condeferred IS FALSE
  ) INTO parent_fk_valid;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.subcategories'::regclass
      AND conname = 'subcategories_user_id_fkey'
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
      AND confdeltype = 'c'
  ) INTO owner_fk_valid;

  IF required_constraint_count <> 5
    OR parent_fk_valid IS NOT TRUE
    OR owner_fk_valid IS NOT TRUE
  THEN
    RAISE EXCEPTION 'Existing public.subcategories does not match the Phase 4.2A constraint contract';
  END IF;
END
$$;

-- General parent lookup/FK support. The custom uniqueness index also supports
-- user-first reads, so a redundant standalone user_id index is unnecessary.
CREATE INDEX IF NOT EXISTS idx_subcategories_category_id
  ON public.subcategories(category_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subcategories_system_key
  ON public.subcategories(system_key)
  WHERE is_system IS TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_subcategories_system_parent_name_ci
  ON public.subcategories(category_id, lower(name))
  WHERE is_system IS TRUE AND user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_subcategories_custom_owner_parent_name_ci
  ON public.subcategories(user_id, category_id, lower(name))
  WHERE is_system IS FALSE AND user_id IS NOT NULL;

-- RLS protects authenticated clients. The trigger below independently protects
-- the parent ownership invariant for all writers, including service-role code.
ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  unknown_policy text;
BEGIN
  SELECT string_agg(policyname, ', ' ORDER BY policyname)
  INTO unknown_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'subcategories'
    AND policyname <> ALL (ARRAY[
      'subcategories_select_own_or_system',
      'subcategories_insert_own_custom',
      'subcategories_update_own_custom',
      'subcategories_delete_own_custom'
    ]);

  IF unknown_policy IS NOT NULL THEN
    RAISE EXCEPTION 'Unreviewed subcategories policies found: %', unknown_policy;
  END IF;
END
$$;

DROP POLICY IF EXISTS "subcategories_select_own_or_system" ON public.subcategories;
DROP POLICY IF EXISTS "subcategories_insert_own_custom" ON public.subcategories;
DROP POLICY IF EXISTS "subcategories_update_own_custom" ON public.subcategories;
DROP POLICY IF EXISTS "subcategories_delete_own_custom" ON public.subcategories;

CREATE POLICY "subcategories_select_own_or_system"
ON public.subcategories
FOR SELECT
TO authenticated
USING (
  (is_system IS TRUE AND user_id IS NULL)
  OR
  (is_system IS FALSE AND user_id = auth.uid())
);

CREATE POLICY "subcategories_insert_own_custom"
ON public.subcategories
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND is_system IS FALSE
  AND EXISTS (
    SELECT 1
    FROM public.categories parent
    WHERE parent.id = category_id
      AND (
        (parent.is_system IS TRUE AND parent.user_id IS NULL)
        OR
        (parent.is_system IS FALSE AND parent.user_id = auth.uid())
      )
  )
);

CREATE POLICY "subcategories_update_own_custom"
ON public.subcategories
FOR UPDATE
TO authenticated
USING (user_id = auth.uid() AND is_system IS FALSE)
WITH CHECK (
  user_id = auth.uid()
  AND is_system IS FALSE
  AND EXISTS (
    SELECT 1
    FROM public.categories parent
    WHERE parent.id = category_id
      AND (
        (parent.is_system IS TRUE AND parent.user_id IS NULL)
        OR
        (parent.is_system IS FALSE AND parent.user_id = auth.uid())
      )
  )
);

CREATE POLICY "subcategories_delete_own_custom"
ON public.subcategories
FOR DELETE
TO authenticated
USING (user_id = auth.uid() AND is_system IS FALSE);

CREATE OR REPLACE FUNCTION public.enforce_subcategory_parent_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_system IS TRUE THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.categories parent
      WHERE parent.id = NEW.category_id
        AND parent.is_system IS TRUE
        AND parent.user_id IS NULL
    ) THEN
      RAISE EXCEPTION 'System subcategory requires a canonical system parent'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.categories parent
      WHERE parent.id = NEW.category_id
        AND (
          (parent.is_system IS TRUE AND parent.user_id IS NULL)
          OR
          (parent.is_system IS FALSE AND parent.user_id = NEW.user_id)
        )
    ) THEN
      RAISE EXCEPTION 'Custom subcategory parent is not accessible to its owner'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_subcategory_parent_ownership() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_subcategories_parent_ownership ON public.subcategories;
CREATE TRIGGER trg_subcategories_parent_ownership
BEFORE INSERT OR UPDATE OF category_id, user_id, is_system
ON public.subcategories
FOR EACH ROW
EXECUTE FUNCTION public.enforce_subcategory_parent_ownership();

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS subcategory_id UUID NULL;

DO $$
DECLARE
  transaction_subcategory_attnum smallint;
  subcategory_id_attnum smallint;
  subcategory_fk_count bigint;
  compatible_fk_count bigint;
BEGIN
  SELECT attnum
  INTO transaction_subcategory_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.transactions'::regclass
    AND attname = 'subcategory_id'
    AND attisdropped IS FALSE;

  SELECT attnum
  INTO subcategory_id_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.subcategories'::regclass
    AND attname = 'id'
    AND attisdropped IS FALSE;

  IF transaction_subcategory_attnum IS NULL OR subcategory_id_attnum IS NULL THEN
    RAISE EXCEPTION 'Phase 4.2A FK inventory could not resolve required columns';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE constraint_row.conkey = ARRAY[transaction_subcategory_attnum]::smallint[]
        AND constraint_row.confrelid = 'public.subcategories'::regclass
        AND constraint_row.confkey = ARRAY[subcategory_id_attnum]::smallint[]
        AND constraint_row.confdeltype = 'n'
    )
  INTO subcategory_fk_count, compatible_fk_count
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.transactions'::regclass
    AND constraint_row.contype = 'f'
    AND transaction_subcategory_attnum = ANY (constraint_row.conkey);

  IF subcategory_fk_count > 1 THEN
    RAISE EXCEPTION
      'Multiple foreign keys involve transactions.subcategory_id (count=%)',
      subcategory_fk_count;
  END IF;

  IF subcategory_fk_count = 1 AND compatible_fk_count <> 1 THEN
    RAISE EXCEPTION
      'Existing transactions.subcategory_id foreign key has an incompatible target or delete action';
  END IF;

  IF subcategory_fk_count = 0 THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_subcategory_id_fkey
      FOREIGN KEY (subcategory_id)
      REFERENCES public.subcategories(id)
      ON DELETE SET NULL;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE constraint_row.conkey = ARRAY[transaction_subcategory_attnum]::smallint[]
        AND constraint_row.confrelid = 'public.subcategories'::regclass
        AND constraint_row.confkey = ARRAY[subcategory_id_attnum]::smallint[]
        AND constraint_row.confdeltype = 'n'
    )
  INTO subcategory_fk_count, compatible_fk_count
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.transactions'::regclass
    AND constraint_row.contype = 'f'
    AND transaction_subcategory_attnum = ANY (constraint_row.conkey);

  IF subcategory_fk_count <> 1 OR compatible_fk_count <> 1 THEN
    RAISE EXCEPTION
      'Phase 4.2A requires exactly one compatible transactions.subcategory_id foreign key';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_transactions_subcategory_id
  ON public.transactions(subcategory_id)
  WHERE subcategory_id IS NOT NULL;

-- This trigger is dormant for the compatibility default (NULL). For future
-- non-NULL assignments it enforces parent-child equality, inherited type, and
-- system/owner scope even when a service-role client bypasses RLS.
CREATE OR REPLACE FUNCTION public.enforce_transaction_subcategory_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  child_category_id uuid;
  child_user_id uuid;
  child_is_system boolean;
  parent_type text;
BEGIN
  IF NEW.subcategory_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT child.category_id, child.user_id, child.is_system, parent.type::text
  INTO child_category_id, child_user_id, child_is_system, parent_type
  FROM public.subcategories child
  JOIN public.categories parent ON parent.id = child.category_id
  WHERE child.id = NEW.subcategory_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction subcategory does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.category_id IS NULL OR child_category_id <> NEW.category_id THEN
    RAISE EXCEPTION 'Transaction category and subcategory parent do not match'
      USING ERRCODE = '23514';
  END IF;

  IF upper(parent_type) <> upper(NEW.type::text) THEN
    RAISE EXCEPTION 'Transaction type and subcategory parent type do not match'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (child_is_system IS TRUE AND child_user_id IS NULL)
    OR
    (child_is_system IS FALSE AND child_user_id = NEW.user_id)
  ) THEN
    RAISE EXCEPTION 'Transaction cannot use a foreign custom subcategory'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_transaction_subcategory_consistency() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_transactions_subcategory_consistency ON public.transactions;
CREATE TRIGGER trg_transactions_subcategory_consistency
BEFORE INSERT OR UPDATE OF subcategory_id, category_id, type, user_id
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_transaction_subcategory_consistency();

CREATE TEMP TABLE phase4_2a_seed (
  system_key text PRIMARY KEY,
  parent_name text NOT NULL,
  name text NOT NULL
) ON COMMIT DROP;

INSERT INTO phase4_2a_seed (system_key, parent_name, name)
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
    ('expense_services_delivery', 'Jasa', 'Pengiriman & Kurir');

-- Existing canonical keys must already describe the exact intended identity.
-- A system row occupying an expected parent/name slot with another key is also
-- drift. Do not silently move, rename, or otherwise repair live taxonomy rows.
DO $$
DECLARE
  drifted_identity text;
BEGIN
  WITH canonical_parent AS (
    SELECT category_row.id, category_row.name
    FROM public.categories category_row
    WHERE category_row.is_system IS TRUE
      AND category_row.user_id IS NULL
  ), drift AS (
    SELECT seed.system_key || ':key' AS identity
    FROM phase4_2a_seed seed
    JOIN canonical_parent parent ON parent.name = seed.parent_name
    JOIN public.subcategories child ON child.system_key = seed.system_key
    WHERE child.category_id IS DISTINCT FROM parent.id
      OR child.name IS DISTINCT FROM seed.name
      OR child.is_system IS DISTINCT FROM TRUE
      OR child.user_id IS NOT NULL

    UNION

    SELECT seed.system_key || ':parent_name' AS identity
    FROM phase4_2a_seed seed
    JOIN canonical_parent parent ON parent.name = seed.parent_name
    JOIN public.subcategories child
      ON child.category_id = parent.id
     AND lower(child.name) = lower(seed.name)
     AND child.is_system IS TRUE
     AND child.user_id IS NULL
    WHERE child.system_key IS DISTINCT FROM seed.system_key
  )
  SELECT string_agg(identity, ', ' ORDER BY identity)
  INTO drifted_identity
  FROM drift;

  IF drifted_identity IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 4.2A canonical subcategory seed drift found: %', drifted_identity;
  END IF;
END
$$;

WITH canonical_parent AS (
  SELECT c.id, c.name
  FROM public.categories c
  WHERE c.is_system IS TRUE
    AND c.user_id IS NULL
)
INSERT INTO public.subcategories (
  category_id,
  user_id,
  name,
  is_system,
  system_key,
  icon_name,
  color_hex
)
SELECT
  parent.id,
  NULL,
  seed.name,
  TRUE,
  seed.system_key,
  NULL,
  NULL
FROM phase4_2a_seed seed
JOIN canonical_parent parent ON parent.name = seed.parent_name
ON CONFLICT (system_key) WHERE is_system IS TRUE
DO NOTHING;

DO $$
DECLARE
  canonical_policy_count bigint;
  seeded_count bigint;
  transaction_count_after bigint;
  column_existed boolean;
  transaction_count_before bigint;
  invalid_transaction_subcategory_count bigint;
  transaction_subcategory_attnum smallint;
  subcategory_id_attnum smallint;
  subcategory_fk_count bigint;
  compatible_fk_count bigint;
BEGIN
  SELECT count(*)
  INTO canonical_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'subcategories'
    AND policyname = ANY (ARRAY[
      'subcategories_select_own_or_system',
      'subcategories_insert_own_custom',
      'subcategories_update_own_custom',
      'subcategories_delete_own_custom'
    ]);

  IF canonical_policy_count <> 4 OR (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'subcategories'
  ) <> 4 THEN
    RAISE EXCEPTION 'Phase 4.2A requires exactly four canonical subcategory policies';
  END IF;

  SELECT count(*)
  INTO seeded_count
  FROM phase4_2a_seed seed
  JOIN public.categories parent
    ON parent.name = seed.parent_name
   AND parent.is_system IS TRUE
   AND parent.user_id IS NULL
  JOIN public.subcategories child
    ON child.system_key = seed.system_key
   AND child.category_id = parent.id
   AND child.name = seed.name
   AND child.is_system IS TRUE
   AND child.user_id IS NULL;

  IF seeded_count <> 25 THEN
    RAISE EXCEPTION 'Phase 4.2A expected 25 canonical system seeds, found %', seeded_count;
  END IF;

  SELECT attnum
  INTO transaction_subcategory_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.transactions'::regclass
    AND attname = 'subcategory_id'
    AND attisdropped IS FALSE;

  SELECT attnum
  INTO subcategory_id_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.subcategories'::regclass
    AND attname = 'id'
    AND attisdropped IS FALSE;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE constraint_row.conkey = ARRAY[transaction_subcategory_attnum]::smallint[]
        AND constraint_row.confrelid = 'public.subcategories'::regclass
        AND constraint_row.confkey = ARRAY[subcategory_id_attnum]::smallint[]
        AND constraint_row.confdeltype = 'n'
    )
  INTO subcategory_fk_count, compatible_fk_count
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.transactions'::regclass
    AND constraint_row.contype = 'f'
    AND transaction_subcategory_attnum = ANY (constraint_row.conkey);

  IF subcategory_fk_count <> 1 OR compatible_fk_count <> 1 THEN
    RAISE EXCEPTION 'transactions.subcategory_id must have exactly one compatible ON DELETE SET NULL foreign key';
  END IF;

  SELECT subcategory_column_existed, phase4_2a_context.transaction_count_before
  INTO column_existed, transaction_count_before
  FROM phase4_2a_context;
  SELECT count(*) INTO transaction_count_after FROM public.transactions;

  IF transaction_count_after <> transaction_count_before THEN
    RAISE EXCEPTION 'Phase 4.2A transaction row count changed unexpectedly';
  END IF;

  IF column_existed IS FALSE THEN
    SELECT count(*) INTO invalid_transaction_subcategory_count
    FROM public.transactions
    WHERE subcategory_id IS NOT NULL;

    IF invalid_transaction_subcategory_count <> 0 THEN
      RAISE EXCEPTION 'Existing transactions must start with NULL subcategory_id';
    END IF;
  END IF;
END
$$;

COMMIT;

-- Intentionally unchanged:
-- * all existing transaction values (including the 12 type mismatches and the
--   3 approved NULL-category rows from the verified Phase 4.1B baseline)
-- * categories and their four canonical policies
-- * category_budgets and all report/budget behavior
-- * merchant_rules and user_merchant_rules
-- * chat, Resend, Fonnte, and manual transaction payloads (NULL remains valid)
