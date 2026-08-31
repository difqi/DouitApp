export type FastPathField =
  | "transaction_time"
  | "amount"
  | "sumber_dana"
  | "transaction_date"
  | "category";

type DraftType = "INCOME" | "EXPENSE";

export type FastDraftPatch = {
  fields: FastPathField[];
  amount?: number;
  category?: string;
  sumberDana?: string;
  transactionDate?: string;
  transactionTime?: string;
};

type FastDraftEditOptions = {
  draftType: DraftType;
  now?: Date;
  allowBareAmount?: boolean;
  resolveSource: (source: string) => string | null;
  resolveCategory: (category: string, type: DraftType) => string | null;
};

export type FastDraftEditResult =
  | {
      kind: "patch";
      field: FastPathField;
      patch: FastDraftPatch;
      reply: string;
    }
  | {
      kind: "clarification";
      field: "sumber_dana" | "category";
      requestedValue: string;
    }
  | {
      kind: "bounded_clarification";
      field: "transaction_time";
      clarificationType: "time_daypart";
      baseHour: number;
      reply: string;
    }
  | { kind: "none" };

type StoredTimeDaypartClarification = {
  clarification: {
    type: "time_daypart";
    draft_id: string;
    base_hour: number;
  };
};

const MONTHS: Record<string, number> = {
  januari: 1,
  februari: 2,
  maret: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  agustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  desember: 12,
};

function normalizedMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function jakartaDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function isoDate(year: number, month: number, day: number): string | null {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function relativeJakartaDate(now: Date, dayOffset: number): string {
  const current = jakartaDateParts(now);
  const shifted = new Date(Date.UTC(current.year, current.month - 1, current.day + dayOffset));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function parseTime(message: string): string | null {
  const match = /^(?:(?:(?:ubah|ganti)\s+)?(?:jam\s+transaksi|jam(?:nya)?|waktu(?:nya)?|pukul)(?:\s+(?:jadi|ke))?|(?:jam(?:nya)?|waktu(?:nya)?)(?:\s+transaksi)?\s+(?:ubah|ganti)\s+(?:ke|jadi))\s+(?:jam\s+)?(\d{1,2})(?:[.:](\d{2}))?(?:\s+(pagi|siang|sore|malam))?(?:\s+aja)?[.!]?$/.exec(message);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const period = match[3];
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null;

  if (!period) {
    if (hour > 23) return null;
  } else {
    if (hour < 1 || hour > 12) return null;
    if (period === "pagi") {
      hour = hour === 12 ? 0 : hour;
    } else if (period === "siang") {
      if (hour === 11 || hour === 12) {
        // Already unambiguous in 24-hour time.
      } else if (hour >= 1 && hour <= 3) {
        hour += 12;
      } else {
        return null;
      }
    } else if (period === "sore") {
      if (hour < 3 || hour > 6) return null;
      hour += 12;
    } else if (period === "malam") {
      if (hour === 12) {
        hour = 0;
      } else if (hour >= 6 && hour <= 11) {
        hour += 12;
      } else {
        return null;
      }
    }
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseAmount(message: string, allowBareAmount: boolean): number | null {
  const explicit = /^(?:(?:ubah|ganti)\s+nominal(?:\s+transaksi)?\s+(?:ke|jadi)|(?:nominal(?:nya)?|jumlahnya)(?:\s+transaksi)?\s+(?:ubah|ganti)\s+(?:ke|jadi)|nominal(?:nya)?\s+(?:ke|jadi)|nominal\s+transaksi\s+(?:ke|jadi)|ubah\s+jadi|jadi|harusnya|nominal(?:nya)?)\s+(?:rp\s*)?(\d[\d.]*)(?:\s*(k|rb|ribu))?(?:\s+aja)?[.!]?$/.exec(message);
  const bare = allowBareAmount
    ? /^(?:rp\s*)?(\d[\d.]*)(?:\s*(k|rb|ribu))(?:\s+aja)[.!]?$/.exec(message)
    : null;
  const match = explicit || bare;
  if (!match) return null;

  const suffix = match[2];
  const rawNumber = match[1];
  if (suffix && rawNumber.includes(".")) return null;
  if (!suffix && rawNumber.includes(".") && !/^\d{1,3}(?:\.\d{3})+$/.test(rawNumber)) return null;

  const numeric = Number(rawNumber.replaceAll(".", ""));
  const amount = numeric * (suffix ? 1_000 : 1);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function parseSource(message: string): string | null {
  const match = /^(?:(?:ubah|ganti)\s+(?:rekening(?:nya)?|sumber\s+dana(?:nya)?)\s+(?:ke|jadi)|(?:rekening(?:nya)?|sumber\s+dana(?:nya)?)(?:\s+transaksi)?\s+(?:ubah|ganti)\s+(?:ke|jadi)|rekening(?:nya)?(?:\s+(?:ganti|ubah)(?:\s+ke)?|\s+(?:jadi|ke))?|sumber\s+dana(?:nya)?(?:\s+(?:ganti|ubah)(?:\s+ke)?|\s+(?:jadi|ke))?|pakai(?:\s+rekening)?|(?:ubah|ganti)\s+ke|dari)\s+(.+?)(?:\s+aja)?[.!]?$/.exec(message);
  return match?.[1]?.trim() || null;
}

function parseDate(message: string, now: Date): string | null {
  const relative = /^(?:(?:(?:ubah|ganti)\s+tanggal(?:nya)?(?:\s+transaksi)?(?:\s+(?:jadi|ke))?)|tanggal(?:nya)?(?:\s+transaksi)?(?:\s+(?:ubah|ganti)\s+(?:jadi|ke)|\s+(?:jadi|ke))?)?\s*(kemarin|hari ini)(?:\s+aja)?[.!]?$/.exec(message);
  if (relative) return relativeJakartaDate(now, relative[1] === "kemarin" ? -1 : 0);

  const absolute = /^(?:(?:ubah|ganti)\s+)?tanggal(?:nya)?(?:\s+transaksi)?(?:\s+(?:ubah|ganti)\s+(?:jadi|ke)|\s+(?:jadi|ke))?\s+(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\s+(\d{4}))?(?:\s+aja)?[.!]?$/.exec(message);
  if (!absolute) return null;
  const currentYear = jakartaDateParts(now).year;
  return isoDate(Number(absolute[3] || currentYear), MONTHS[absolute[2]], Number(absolute[1]));
}

function parseCategory(message: string): string | null {
  const match = /^(?:(?:ubah|ganti)\s+kategori(?:nya)?\s+(?:ke|jadi)|kategori(?:nya)?(?:\s+transaksi)?\s+(?:ubah|ganti)\s+(?:ke|jadi)|kategori(?:nya)?(?:\s+(?:jadi|ke))?|masuk\s+(?:ke\s+)?kategori)\s+(.+?)(?:\s+aja)?[.!]?$/.exec(message);
  return match?.[1]?.trim() || null;
}

function parseTimeDaypartClarificationRequest(message: string): number | null {
  const match = /^(?:tambah|tambahkan|ubah|ganti)\s+(?:jam(?:nya)?|jam\s+transaksi|waktu(?:nya)?)(?:\s+(?:jadi|ke))?\s+(\d{1,2})(?:[.:]00)?\s+siang(?:\s+aja)?[.!]?$/.exec(message);
  if (!match) return null;
  const baseHour = Number(match[1]);
  return baseHour >= 6 && baseHour <= 10 ? baseHour : null;
}

function parseTimeDaypartReply(message: string): "pagi" | "malam" | null {
  const match = /^(?:(?:oh\s+iya|maksudku|yang)\s*,?\s*)?(pagi|malam)[.!]?$/.exec(message);
  return match?.[1] as "pagi" | "malam" | undefined || null;
}

function isAmbiguousReference(value: string): boolean {
  return /^(?:yang\s+)?(?:itu|ini|tadi|kemarin|biasanya|seperti\s+biasa)$/.test(value.trim());
}

function hasAdditionalEditSignal(value: string): boolean {
  return /\d/.test(value)
    || /\b(?:dan|lalu|terus|untuk|nominal|tanggal|hari\s+ini|kemarin|jam|pukul|kategori|pakai|dari|seperti|biasanya)\b/.test(value);
}

function rupiah(amount: number): string {
  return `Rp${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(amount)}`;
}

function composePatchReply(patch: FastDraftPatch): string {
  if (patch.fields.length === 1) {
    switch (patch.fields[0]) {
      case "transaction_time":
        return `Siap, jamnya sudah aku ubah ke ${patch.transactionTime!.replace(":", ".")}.`;
      case "amount":
        return `Oke, nominalnya sekarang ${rupiah(patch.amount!)}.`;
      case "sumber_dana":
        return `Oke, sumber dananya aku ubah ke ${patch.sumberDana}.`;
      case "transaction_date":
        return "Siap, tanggalnya sudah aku sesuaikan.";
      case "category":
        return `Oke, kategorinya sekarang ${patch.category}.`;
    }
  }

  const fragments = patch.fields.map((field) => {
    switch (field) {
      case "amount":
        return `nominalnya sekarang ${rupiah(patch.amount!)}`;
      case "sumber_dana":
        return `sumber dananya aku ubah ke ${patch.sumberDana}`;
      case "transaction_time":
        return `jamnya ${patch.fields[0] === "sumber_dana" ? "ke " : ""}${patch.transactionTime!.replace(":", ".")}`;
      case "transaction_date":
        return "tanggalnya sudah aku sesuaikan";
      case "category":
        return `kategorinya sekarang ${patch.category}`;
    }
  });
  return `${patch.fields.includes("amount") ? "Oke" : "Siap"}, ${fragments.join(" dan ")}.`;
}

function parseClause(message: string, options: FastDraftEditOptions): FastDraftEditResult {
  const time = parseTime(message);
  if (time) {
    const patch: FastDraftPatch = { fields: ["transaction_time"], transactionTime: time };
    return { kind: "patch", field: "transaction_time", patch, reply: composePatchReply(patch) };
  }

  const amount = parseAmount(message, Boolean(options.allowBareAmount));
  if (amount) {
    const patch: FastDraftPatch = { fields: ["amount"], amount };
    return { kind: "patch", field: "amount", patch, reply: composePatchReply(patch) };
  }

  const sourceInput = parseSource(message);
  if (sourceInput) {
    if (isAmbiguousReference(sourceInput) || hasAdditionalEditSignal(sourceInput)) return { kind: "none" };
    const source = options.resolveSource(sourceInput);
    if (!source) return { kind: "clarification", field: "sumber_dana", requestedValue: sourceInput };
    const patch: FastDraftPatch = { fields: ["sumber_dana"], sumberDana: source };
    return { kind: "patch", field: "sumber_dana", patch, reply: composePatchReply(patch) };
  }

  const date = parseDate(message, options.now || new Date());
  if (date) {
    const patch: FastDraftPatch = { fields: ["transaction_date"], transactionDate: date };
    return { kind: "patch", field: "transaction_date", patch, reply: composePatchReply(patch) };
  }

  const categoryInput = parseCategory(message);
  if (categoryInput) {
    if (isAmbiguousReference(categoryInput) || hasAdditionalEditSignal(categoryInput)) return { kind: "none" };
    const category = options.resolveCategory(categoryInput, options.draftType);
    if (!category) return { kind: "clarification", field: "category", requestedValue: categoryInput };
    const patch: FastDraftPatch = { fields: ["category"], category };
    return { kind: "patch", field: "category", patch, reply: composePatchReply(patch) };
  }

  const ambiguousHour = parseTimeDaypartClarificationRequest(message);
  if (ambiguousHour !== null) {
    return {
      kind: "bounded_clarification",
      field: "transaction_time",
      clarificationType: "time_daypart",
      baseHour: ambiguousHour,
      reply: `Apakah yang kamu maksud jam ${ambiguousHour} pagi atau jam ${ambiguousHour} malam?`,
    };
  }

  return { kind: "none" };
}

/**
 * Recognizes only explicit edits against an already validated pending draft.
 * Multi-field edits are atomic: every clause must parse and target a unique field.
 */
export function parseDeterministicDraftEdit(
  rawMessage: string,
  options: FastDraftEditOptions,
): FastDraftEditResult {
  const message = normalizedMessage(rawMessage);
  const clauses = message.split(/\s+dan\s+/);
  if (clauses.length === 0 || clauses.length > 3 || clauses.some((clause) => !clause.trim())) {
    return { kind: "none" };
  }

  const parsedClauses = clauses.map((clause) => parseClause(clause.trim(), options));
  if (parsedClauses.some((result) => result.kind === "none")) return { kind: "none" };
  if (parsedClauses.length > 1 && parsedClauses.some((result) => result.kind === "bounded_clarification")) {
    return { kind: "none" };
  }
  if (parsedClauses.length > 1 && parsedClauses.some((result) => result.kind === "clarification")) {
    return { kind: "none" };
  }
  if (parsedClauses[0].kind === "clarification" || parsedClauses[0].kind === "bounded_clarification") {
    return parsedClauses[0];
  }

  const patchResults = parsedClauses.filter((result): result is Extract<FastDraftEditResult, { kind: "patch" }> =>
    result.kind === "patch",
  );
  const fields = patchResults.map((result) => result.field);
  if (new Set(fields).size !== fields.length) return { kind: "none" };

  const patch: FastDraftPatch = { fields };
  for (const result of patchResults) {
    const { fields: _fields, ...values } = result.patch;
    Object.assign(patch, values);
  }
  return {
    kind: "patch",
    field: fields[0],
    patch,
    reply: composePatchReply(patch),
  };
}

export function detectDeterministicDraftEditFields(
  rawMessage: string,
  options: { now?: Date; allowBareAmount?: boolean } = {},
): FastPathField[] | null {
  const result = parseDeterministicDraftEdit(rawMessage, {
    draftType: "EXPENSE",
    now: options.now,
    allowBareAmount: options.allowBareAmount,
    resolveSource: (source) => source,
    resolveCategory: (category) => category,
  });
  if (result.kind === "patch") return result.patch.fields;
  return result.kind === "bounded_clarification" ? [result.field] : null;
}

export function isTimeDaypartClarificationReply(rawMessage: string): boolean {
  return parseTimeDaypartReply(normalizedMessage(rawMessage)) !== null;
}

export function timeDaypartClarificationData(
  draftId: string,
  baseHour: number,
): StoredTimeDaypartClarification {
  return {
    clarification: {
      type: "time_daypart",
      draft_id: draftId,
      base_hour: baseHour,
    },
  };
}

/**
 * Resolves a short daypart answer only when the latest persisted assistant
 * message carries matching structured state for the eligible pending draft.
 */
export function resolveTimeDaypartClarification(
  rawMessage: string,
  storedDraftData: unknown,
  eligibleDraftId: string | null,
): FastDraftEditResult {
  const daypart = parseTimeDaypartReply(normalizedMessage(rawMessage));
  if (!daypart || !eligibleDraftId || !isRecord(storedDraftData)) return { kind: "none" };
  const clarification = storedDraftData.clarification;
  if (!isRecord(clarification)
    || clarification.type !== "time_daypart"
    || clarification.draft_id !== eligibleDraftId
    || typeof clarification.base_hour !== "number"
    || !Number.isInteger(clarification.base_hour)
    || clarification.base_hour < 6
    || clarification.base_hour > 10) {
    return { kind: "none" };
  }

  const resolvedHour = daypart === "pagi"
    ? clarification.base_hour
    : clarification.base_hour + 12;
  const transactionTime = `${String(resolvedHour).padStart(2, "0")}:00`;
  const patch: FastDraftPatch = { fields: ["transaction_time"], transactionTime };
  return {
    kind: "patch",
    field: "transaction_time",
    patch,
    reply: daypart === "pagi"
      ? `Siap, jamnya aku ubah ke ${transactionTime.replace(":", ".")}.`
      : `Oke, jamnya sekarang ${transactionTime.replace(":", ".")}.`,
  };
}
