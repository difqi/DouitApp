/**
 * Comparison-only merchant normalization. Historical display strings must remain
 * untouched; this intentionally avoids fuzzy or token-dropping behavior.
 */
export function normalizeMerchantKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("id-ID")
    .replace(/[.,:;|/\\_-]+/g, " ")
    .replace(/\s+/g, " ");
}
