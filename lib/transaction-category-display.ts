const DEFAULT_CATEGORY_NAME = "Lain-lain";

function normalizeDisplayPart(value?: string | null): string {
  return value?.trim().replace(/\s+/g, " ") || "";
}

export function formatTransactionCategoryLabel(
  categoryName?: string | null,
  subcategoryName?: string | null,
): string {
  const parent = normalizeDisplayPart(categoryName) || DEFAULT_CATEGORY_NAME;
  const child = normalizeDisplayPart(subcategoryName);
  return child ? `${parent} · ${child}` : parent;
}
