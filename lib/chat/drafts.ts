import {
  buildTransactionTimestamp,
  isValidIsoDate,
  isValidTime,
  type MissingField,
  type ValidatedDraftPatch,
} from "@/lib/chat/validation";
import type { TransactionDraftPreview } from "@/types";

type DraftType = "INCOME" | "EXPENSE";

export type DraftPreview = TransactionDraftPreview & {
  amount: number;
  type: DraftType;
  merchant: string;
  category_id: string;
  subcategory_id: string | null;
  category: string;
  sumber_dana: string;
  status: "pending";
  notes: string | null;
  admin_fee: number | null;
  transaction_date: string;
  transaction_time: string | null;
};

export type PendingDraftCandidate = {
  messageId: string;
  draftId: string;
  persistedStatus: string | null;
  preview: DraftPreview;
};

type DraftRow = {
  id?: unknown;
  action_draft_id?: unknown;
  draft_data?: unknown;
};

type PatchResolution = {
  resolveSource: (source: string) => string | null;
  resolveCategory: (category: string, type: DraftType) => { id: string; name: string } | null;
};

export type DraftPatchResult =
  | { ok: true; preview: DraftPreview }
  | { ok: false; missingField: MissingField; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function optionalTime(raw: Record<string, unknown>, notes: string | null): string | null {
  if (typeof raw.transaction_time === "string" && isValidTime(raw.transaction_time)) {
    return raw.transaction_time;
  }
  if (notes?.includes("[NO_TIME]")) return null;
  if (typeof raw.transaction_date !== "string") return null;
  const match = /T(\d{2}:\d{2}):\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(raw.transaction_date);
  return match && isValidTime(match[1]) ? match[1] : null;
}

export function parsePendingDraftCandidate(row: DraftRow): PendingDraftCandidate | null {
  if (typeof row.id !== "string" || typeof row.action_draft_id !== "string" || !isRecord(row.draft_data)) {
    return null;
  }

  const raw = row.draft_data;
  const persistedStatus = typeof raw.status === "string" ? raw.status : null;
  // Uppercase APPROVED is the legacy preview transaction status, not an approved draft lifecycle.
  if (persistedStatus !== null && persistedStatus !== "pending" && persistedStatus !== "APPROVED") {
    return null;
  }
  if (typeof raw.amount !== "number" || !Number.isFinite(raw.amount) || raw.amount <= 0) return null;
  if (raw.type !== "INCOME" && raw.type !== "EXPENSE") return null;
  if (typeof raw.merchant !== "string" || !raw.merchant.trim()) return null;
  if (typeof raw.category_id !== "string" || !raw.category_id) return null;
  if (typeof raw.category !== "string" || !raw.category.trim()) return null;
  if (typeof raw.sumber_dana !== "string" || !raw.sumber_dana.trim()) return null;
  if (typeof raw.transaction_date !== "string" || !isValidIsoDate(raw.transaction_date.slice(0, 10))) return null;

  const adminFee = raw.admin_fee;
  if (adminFee !== null && adminFee !== undefined
    && (typeof adminFee !== "number" || !Number.isFinite(adminFee) || adminFee < 0)) return null;
  const notes = typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.trim() : null;

  return {
    messageId: row.id,
    draftId: row.action_draft_id,
    persistedStatus,
    preview: {
      ...raw,
      amount: raw.amount,
      type: raw.type,
      merchant: raw.merchant.trim(),
      category_id: raw.category_id,
      subcategory_id: typeof raw.subcategory_id === "string" ? raw.subcategory_id : null,
      category: raw.category.trim(),
      sumber_dana: raw.sumber_dana.trim(),
      status: "pending",
      notes,
      admin_fee: typeof adminFee === "number" ? adminFee : null,
      transaction_date: raw.transaction_date,
      transaction_time: optionalTime(raw, notes),
    },
  };
}

function notesWithTimeState(notes: string | null, hasTime: boolean): string | null {
  const cleaned = (notes || "").replace(/\s*\[NO_TIME\]/g, "").trim();
  if (hasTime) return cleaned || null;
  return cleaned ? `${cleaned} [NO_TIME]` : "[NO_TIME]";
}

export function applyDraftPatch(
  existing: DraftPreview,
  patch: ValidatedDraftPatch,
  resolution: PatchResolution,
  now = new Date(),
): DraftPatchResult {
  if (patch.fields.includes("amount")
    && (typeof patch.amount !== "number" || !Number.isFinite(patch.amount) || patch.amount <= 0)) {
    return {
      ok: false,
      missingField: "amount",
      message: "Nominalnya belum valid. Mau diubah menjadi berapa?",
    };
  }
  if (patch.fields.includes("transaction_date")
    && (typeof patch.transactionDate !== "string" || !isValidIsoDate(patch.transactionDate))) {
    return {
      ok: false,
      missingField: "transaction_date",
      message: "Tanggalnya belum valid. Transaksinya terjadi kapan?",
    };
  }
  if (patch.fields.includes("transaction_time")
    && patch.transactionTime !== null
    && (typeof patch.transactionTime !== "string" || !isValidTime(patch.transactionTime))) {
    return {
      ok: false,
      missingField: "transaction_time",
      message: "Jamnya belum valid. Mau diubah ke jam berapa?",
    };
  }

  const nextType = patch.fields.includes("type") ? patch.type! : existing.type;
  const nextCategoryName = patch.fields.includes("category") ? patch.category! : existing.category;
  const category = patch.fields.includes("category") || patch.fields.includes("type")
    ? resolution.resolveCategory(nextCategoryName, nextType)
    : { id: existing.category_id, name: existing.category };
  if (!category) {
    return {
      ok: false,
      missingField: "category",
      message: "Kategori itu belum cocok dengan jenis transaksinya. Mau pakai kategori yang mana?",
    };
  }

  const source = patch.fields.includes("sumber_dana")
    ? resolution.resolveSource(patch.sumberDana!)
    : existing.sumber_dana;
  if (!source) {
    return {
      ok: false,
      missingField: "sumber_dana",
      message: "Aku belum menemukan sumber dana itu di Dompet kamu. Mau pakai yang mana?",
    };
  }

  const date = patch.fields.includes("transaction_date")
    ? patch.transactionDate!
    : existing.transaction_date.slice(0, 10);
  const time = patch.fields.includes("transaction_time")
    ? patch.transactionTime ?? null
    : existing.transaction_time;
  const timestamp = buildTransactionTimestamp(date, time, now);
  const baseNotes = patch.fields.includes("notes") ? patch.notes ?? null : existing.notes;

  return {
    ok: true,
    preview: {
      ...existing,
      amount: patch.fields.includes("amount") ? patch.amount! : existing.amount,
      merchant: patch.fields.includes("merchant") ? patch.merchant! : existing.merchant,
      type: nextType,
      category_id: category.id,
      subcategory_id: category.id === existing.category_id ? existing.subcategory_id : null,
      category: category.name,
      sumber_dana: source,
      status: "pending",
      notes: notesWithTimeState(baseNotes, timestamp.hasExplicitTime),
      admin_fee: patch.fields.includes("admin_fee") ? patch.adminFee ?? null : existing.admin_fee,
      transaction_date: timestamp.timestamp,
      transaction_time: time,
    },
  };
}

export function pendingDraftModelContext(candidate: PendingDraftCandidate): Record<string, unknown> {
  return {
    amount: candidate.preview.amount,
    merchant: candidate.preview.merchant,
    type: candidate.preview.type,
    category: candidate.preview.category,
    sumber_dana: candidate.preview.sumber_dana,
    transaction_date: candidate.preview.transaction_date.slice(0, 10),
    transaction_time: candidate.preview.transaction_time,
    admin_fee: candidate.preview.admin_fee,
  };
}
