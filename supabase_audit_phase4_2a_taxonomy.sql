-- Phase 4.2A optional read-only aggregate audit.
-- System taxonomy labels are non-sensitive. Custom parent/child names and user
-- identifiers are intentionally not returned.

SELECT
  CASE
    WHEN parent.is_system IS TRUE AND parent.user_id IS NULL THEN parent.name
    ELSE '[CUSTOM_PARENT]'
  END AS parent_category,
  count(*) FILTER (
    WHERE child.is_system IS TRUE AND child.user_id IS NULL
  ) AS system_subcategory_count,
  count(*) FILTER (
    WHERE child.is_system IS FALSE AND child.user_id IS NOT NULL
  ) AS custom_subcategory_count
FROM public.subcategories child
JOIN public.categories parent ON parent.id = child.category_id
GROUP BY
  CASE
    WHEN parent.is_system IS TRUE AND parent.user_id IS NULL THEN parent.name
    ELSE '[CUSTOM_PARENT]'
  END
ORDER BY parent_category;

SELECT
  count(*) AS total_subcategories,
  count(*) FILTER (
    WHERE is_system IS TRUE AND user_id IS NULL
  ) AS canonical_system_subcategories,
  count(*) FILTER (
    WHERE is_system IS FALSE AND user_id IS NOT NULL
  ) AS owned_custom_subcategories
FROM public.subcategories;
