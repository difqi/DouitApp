import type { MissingField } from "@/lib/chat/validation";

export type ChatReplyLifecycle = "pending_confirmation" | "draft_updated" | "clarification" | "conversation";

type ComposeChatReplyInput = {
  lifecycle: ChatReplyLifecycle;
  proposedReply: string;
  userMessage: string;
  missingFields?: MissingField[];
};

const MISSING_FIELD_PRIORITY: MissingField[] = [
  "amount",
  "merchant",
  "type",
  "sumber_dana",
  "transaction_date",
  "transaction_time",
  "category",
  "transaction_details",
];

function normalizeCopy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasSavedClaim(value: string): boolean {
  return /\b(?:berhasil|selesai)\b/i.test(value)
    || /\b(?:sudah|telah)\b.{0,35}\b(?:catat|mencatat|dicatat|tercatat|disimpan|diproses|tersimpan)\b/i.test(value)
    || /\b(?:catat|mencatat|dicatat|tercatat|disimpan|diproses|tersimpan)\b.{0,20}\b(?:berhasil|selesai)\b/i.test(value);
}

function soundsTechnical(value: string): boolean {
  return /\b(?:invalid|required|validation|schema|json|http|field|error code|pengguna|anda|kami)\b/i.test(value)
    || /\b(?:mohon|silakan) masukkan\b/i.test(value)
    || /\bberdasarkan informasi yang diberikan\b/i.test(value);
}

function soundsAiGenerated(value: string): boolean {
  return /\b(?:sudah aku tangkap|belum kebaca|transaksinya sudah aku siapkan|aku mendeteksi|aku memahami input|informasi belum lengkap)\b/i.test(value)
    || /^kebaca[.!]?$/i.test(value.trim());
}

function isUsableModelCopy(value: string, maxLength: number): boolean {
  return Boolean(value)
    && value.length <= maxLength
    && !hasSavedClaim(value)
    && !soundsTechnical(value)
    && !soundsAiGenerated(value)
    && !/[—;]/.test(value);
}

function primaryMissingField(fields: MissingField[]): MissingField {
  return MISSING_FIELD_PRIORITY.find((field) => fields.includes(field)) || "transaction_details";
}

function clarificationFallback(field: MissingField): string {
  switch (field) {
    case "amount":
      return "Berapa nominalnya?";
    case "merchant":
      return "Ini transaksi untuk apa atau di merchant mana?";
    case "type":
      return "Ini pemasukan atau pengeluaran?";
    case "sumber_dana":
      return "Kamu mau pakai rekening, dompet, atau tunai?";
    case "transaction_date":
      return "Transaksinya terjadi kapan?";
    case "transaction_time":
      return "Jamnya berapa?";
    case "category":
      return "Kategorinya belum bisa aku pastikan. Transaksi ini untuk keperluan apa?";
    default:
      return "Detailnya belum cukup jelas. Bisa ceritakan lagi transaksinya?";
  }
}

/**
 * Composes presentation copy only. Financial fields and lifecycle decisions are
 * already validated by the caller and are intentionally absent from this API.
 */
export function composeChatReply({
  lifecycle,
  proposedReply,
  userMessage,
  missingFields = [],
}: ComposeChatReplyInput): string {
  const proposed = normalizeCopy(proposedReply);

  if (lifecycle === "pending_confirmation") {
    if (isUsableModelCopy(proposed, 180)) return proposed;
    return "Siap, cek detailnya ya.";
  }

  if (lifecycle === "draft_updated") {
    if (isUsableModelCopy(proposed, 160)) return proposed;
    return "Oke, sudah aku ubah. Cek lagi ya.";
  }

  if (lifecycle === "clarification") {
    const primaryField = primaryMissingField(missingFields);
    if (missingFields.length <= 1 && isUsableModelCopy(proposed, 240)) return proposed;
    return clarificationFallback(primaryField);
  }

  return proposed || "Aku belum menangkap maksudnya. Bisa ceritakan sedikit lagi?";
}
