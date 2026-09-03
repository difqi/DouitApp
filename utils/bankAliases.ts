export const BANK_ALIASES: Record<string, string[]> = {
  bsi: ['bsi', 'bank syariah indonesia', 'syariah indonesia', 'syariah mandiri'],
  bca: ['bca', 'bank central asia'],
  bri: ['bri', 'bank rakyat indonesia'],
  bni: ['bni', 'bank negara indonesia'],
  mandiri: ['mandiri', 'bank mandiri'],
  cimb: ['cimb', 'cimb niaga', 'bank cimb niaga'],
  permata: ['permata', 'bank permata'],
  gopay: ['gopay', 'go-pay'],
  shopeepay: ['shopeepay', 'shopee pay'],
  ovo: ['ovo'],
  dana: ['dana'],
};

export function getCanonicalBankKey(inputName: string): string {
  if (!inputName) return '';
  const normalized = inputName.toLowerCase().trim();

  for (const [canonicalKey, aliases] of Object.entries(BANK_ALIASES)) {
    if (aliases.some(alias => normalized.includes(alias))) {
      return canonicalKey;
    }
  }
  return normalized.replace(/^bank\s+/i, '');
}

export function isAccountMatch(accountName: string, transactionSource: string): boolean {
  if (!accountName || !transactionSource) return false;
  const key1 = getCanonicalBankKey(accountName);
  const key2 = getCanonicalBankKey(transactionSource);
  
  if (key1 && key2 && key1 === key2) return true;
  return accountName.toLowerCase().includes(transactionSource.toLowerCase()) || 
         transactionSource.toLowerCase().includes(accountName.toLowerCase());
}

function normalizeExactAccountReference(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("id-ID")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getExactAccountAliasKey(value: string): string | null {
  const normalized = normalizeExactAccountReference(value);
  const withoutGenericPrefix = normalized.replace(/^(?:rekening bank|rekening|bank)\s+/, "");
  const matches = Object.entries(BANK_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => {
      const normalizedAlias = normalizeExactAccountReference(alias);
      return normalized === normalizedAlias || withoutGenericPrefix === normalizedAlias;
    }))
    .map(([key]) => key);
  return matches.length === 1 ? matches[0] : null;
}

/** Conservative matching for trusted savings sources; never uses substring-only evidence. */
export function isDeterministicSavingsAccountMatch(
  accountName: string,
  sourceReference: string,
): boolean {
  const account = normalizeExactAccountReference(accountName);
  const source = normalizeExactAccountReference(sourceReference);
  if (!account || !source) return false;
  if (account === source) return true;

  const accountAlias = getExactAccountAliasKey(accountName);
  const sourceAlias = getExactAccountAliasKey(sourceReference);
  return accountAlias !== null && accountAlias === sourceAlias;
}

export function normalizeSumberDana(input: string): string {
  if (!input) return "Tunai";
  const normalized = input.toLowerCase();

  if (normalized.includes("bca")) return "Bank BCA";
  if (normalized.includes("mandiri")) return "Bank Mandiri";
  if (normalized.includes("bri")) return "Bank BRI";
  if (normalized.includes("bni")) return "Bank BNI";
  if (normalized.includes("bsi")) return "Bank BSI";
  if (normalized.includes("gopay") || normalized.includes("go-pay")) return "GoPay";
  if (normalized.includes("ovo")) return "OVO";
  if (normalized.includes("dana")) return "Dana";
  if (normalized.includes("shopeepay") || normalized.includes("shopee pay")) return "ShopeePay";

  return "Tunai";
}
