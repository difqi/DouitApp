# Phase 4.1B — Category Security & Canonical Baseline

This document records the code contract established before Phase 4.2. It does not
authorize or perform historical data remediation.

## Category and security contract

The current canonical category fields are `id`, `user_id`, `name`, `type`,
`icon_name`, `color_hex`, `is_system`, and `created_at`. `budget_limit` remains a
legacy column and must not be used by active category-budget code.

- A system category has `is_system = true` and `user_id IS NULL`.
- A custom category has `is_system = false` and `user_id = authenticated user`.
- Anonymous callers do not need category access in current source.
- Authenticated reads are limited to canonical system rows and the caller's custom
  rows. Authenticated writes are limited to the caller's custom rows.
- Admin/service-role resolution applies the same system/owner scope in code because
  service-role clients bypass RLS.
- Ordinary category assignment requires an exact case-insensitive name or ID and a
  matching transaction type. There is no fuzzy match.
- For a general same-name match, one compatible owner row takes precedence over one
  compatible system row. Duplicates inside the preferred scope are ambiguous.
- Special categories always resolve only a unique `is_system = true`, `user_id IS
  NULL` row.

`Lain-lain`, `Nabung`, `Biaya Admin`, and `Transfer` are centralized as temporary
display-name compatibility constants. Their names are not permanent semantic IDs;
a reviewed `system_key` design remains future work.

The live `is_system` default is currently unsafe for implicit custom inserts. Phase
4.1B leaves the database default unchanged because migration/seed dependencies are
not fully verified. The category creation path explicitly sends `is_system: false`,
and RLS rejects client attempts to create system rows.

## Budget contract

`category_budgets` is the canonical active category-budget table, keyed by
`(user_id, category_id)`. Settings and reports read/write this relation only.
`categories.budget_limit` and `user_category_budgets` remain untouched legacy
representations. Merchant budgets in `user_merchant_rules` remain a separate legacy
reporting concern and are not category classification evidence.

## Transfer semantic recommendation

Confirmed source evidence:

- The default-category migration renamed the system category `Gaji` to `Transfer`
  without changing its `INCOME` type.
- Current source has no transaction creation flow that models an internal transfer
  as two linked legs.
- Reports exclude display names `Pindah Saldo` and `Transfer Antar Rekening`, but do
  not exclude the live display name `Transfer` consistently.
- Phase 4.1A found 12 approved `EXPENSE` rows and 3 `INCOME` rows using the system
  `Transfer` category.

Therefore the existing `Transfer` category is not reliable evidence of an internal
transfer. Its present schema meaning is only an `INCOME` category inherited from
`Gaji`; the 12 expense rows are historical mismatches whose economic meaning cannot
be inferred from category alone.

Recommendation: keep all rows and the category type unchanged for now. Before a
future `transaction_kind` migration, review the 15 rows using safe account/source,
pairing, and user-confirmed evidence. A future design should represent internal
transfer explicitly and link both account legs; ordinary `INCOME`/`EXPENSE`, saving
deposits, and internal transfers must not be inferred from category display names.

## Approved NULL-category remediation plan

Phase 4.1A found three approved rows with `category_id IS NULL`. Source alone does
not contain their live provenance, so none can be declared deterministically mapped
in Phase 4.1B. `supabase_audit_phase4_1b_data.sql` returns only aggregated source,
type, date range, and presence-of-hint metadata. Review outcomes are:

1. deterministically map only when trusted source evidence identifies one unique,
   type-compatible owner/system category;
2. otherwise request user/manual review; or
3. retain historical NULL when evidence is insufficient.

No fallback or backfill is authorized by this plan.

## Merchant bridge contract

Temporary precedence remains:

1. a valid, owner-scoped `merchant_rules` operational rule;
2. `user_merchant_rules` only where existing reporting/fallback behavior already
   requires it;
3. current Gemini/category resolution.

An operational rule's text `category_id` must resolve to an accessible category and
match transaction type before use. An unresolved, foreign, ambiguous, or wrong-type
reference is ignored rather than trusted. Converting the column to UUID/FK is not
safe until live values are reviewed.

`normalizeMerchantKey` is comparison-only: NFKC, trim, Indonesian lowercase,
conservative separator-to-space conversion, and whitespace collapse. It does not
perform fuzzy matching, remove meaningful tokens, mutate transaction merchant text,
or merge rows. The read-only audit SQL reports hashed duplicate/overlap groups and
category, keyword, source, and budget disagreement flags without printing merchant
or user identities.

No merchant row is migrated or merged in Phase 4.1B.

## Known remaining risks and gates

- Category deletion still uses a non-atomic transaction reassignment followed by a
  category delete. Both operations are owner-scoped and fallback is system-scoped,
  but an RPC/transaction is future work.
- The category RLS migration intentionally aborts if production has an unreviewed
  policy name. Review that live policy before changing the allowlist.
- The database default for `categories.is_system` remains `true` until all system
  seeds and external writers are verified.
- Resend and Fonnte webhook authenticity, cron's optional-secret behavior, and the
  full live policy/index/migration catalog remain separate security work.
- Phase 4.2 is safe only after the manual RLS migration succeeds, verification SQL
  and authenticated/anon API checks pass, special system rows are unique, and the
  ownership-invariant query returns zero exceptions.
