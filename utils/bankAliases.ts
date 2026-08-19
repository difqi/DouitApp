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
