export const CHAT_HISTORY_WINDOW = 10;

export const MISSING_FIELDS = [
  "amount",
  "merchant",
  "type",
  "category",
  "sumber_dana",
  "transaction_date",
  "transaction_time",
  "transaction_details",
] as const;

export type MissingField = (typeof MISSING_FIELDS)[number];

export const CHAT_INTENT_CLASSES = [
  "NEW_TRANSACTION",
  "REQUIRED_CLARIFICATION",
  "OPTIONAL_ENRICHMENT",
  "UPDATE_PENDING_DRAFT",
  "NON_TRANSACTION",
] as const;

export type ChatIntentClass = (typeof CHAT_INTENT_CLASSES)[number];

export const DRAFT_PATCH_FIELDS = [
  "amount",
  "merchant",
  "type",
  "category",
  "sumber_dana",
  "transaction_date",
  "transaction_time",
  "notes",
  "admin_fee",
] as const;

export type DraftPatchField = (typeof DRAFT_PATCH_FIELDS)[number];

export type ValidatedDraftPatch = {
  fields: DraftPatchField[];
  amount?: number;
  merchant?: string;
  type?: "INCOME" | "EXPENSE";
  category?: string;
  sumberDana?: string;
  transactionDate?: string;
  transactionTime?: string | null;
  notes?: string | null;
  adminFee?: number | null;
};

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ModelContent = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

export type ValidatedTransactionDetails = {
  amount: number;
  merchant: string;
  type: "INCOME" | "EXPENSE";
  category: string;
  sumberDana: string | null;
  sourceWasExplicit: boolean;
  adminFee: number | null;
  notes: string | null;
  transactionDate: string | null;
  transactionTime: string | null;
};

export type ValidatedChatOutput = {
  intentClass: ChatIntentClass;
  isTransaction: boolean;
  needsClarification: boolean;
  missingFields: MissingField[];
  replyMessage: string;
  transactionDetails: ValidatedTransactionDetails | null;
  draftPatch: ValidatedDraftPatch | null;
};

export type ChatOutputValidation = {
  ok: boolean;
  failureClass: string | null;
  value: ValidatedChatOutput;
};

const GENERIC_CLARIFICATION =
  "Aku belum bisa memastikan detail transaksinya. Bisa ceritakan lagi transaksinya?";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isNullableString = (value: unknown): value is string | null | undefined =>
  value === null || value === undefined || typeof value === "string";

export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
export function isValidTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function getJakartaDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildTransactionTimestamp(
  transactionDate: string | null,
  transactionTime: string | null,
  now = new Date(),
): { timestamp: string; hasExplicitTime: boolean } {
  const targetDate = transactionDate || getJakartaDateKey(now);
  if (!isValidIsoDate(targetDate)) {
    throw new Error("Invalid transaction date");
  }

  if (transactionTime) {
    if (!isValidTime(transactionTime)) {
      throw new Error("Invalid transaction time");
    }
    return {
      timestamp: `${targetDate}T${transactionTime}:00+07:00`,
      hasExplicitTime: true,
    };
  }

  return {
    timestamp: `${targetDate}T00:00:00.000Z`,
    hasExplicitTime: false,
  };
}

export function buildModelContents(
  priorHistory: ChatHistoryMessage[],
  currentMessage: string,
): ModelContent[] {
  const priorWindow = priorHistory.slice(-(CHAT_HISTORY_WINDOW - 1));
  return [
    ...priorWindow.map((message) => ({
      role: message.role === "assistant" ? "model" as const : "user" as const,
      parts: [{ text: message.content }],
    })),
    // The current message is appended explicitly so DB insert/select timing cannot omit or duplicate it.
    { role: "user", parts: [{ text: currentMessage }] },
  ];
}

export function resolveKnownPaymentSource(
  source: string,
  accountNames: string[],
  isMatch: (accountName: string, sourceName: string) => boolean,
): string | null {
  const normalized = source.trim().toLocaleLowerCase("id-ID");
  if (normalized === "tunai" || normalized === "cash") return "Tunai";
  return accountNames.find((accountName) => isMatch(accountName, source))?.trim() || null;
}

function normalizeMissingFields(value: unknown): MissingField[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(MISSING_FIELDS);
  return [...new Set(value.filter((item): item is MissingField =>
    typeof item === "string" && allowed.has(item),
  ))];
}

function clarification(
  missingFields: MissingField[],
  message = GENERIC_CLARIFICATION,
  failureClass: string | null = null,
): ChatOutputValidation {
  return {
    ok: failureClass === null,
    failureClass,
    value: {
      isTransaction: true,
      intentClass: "REQUIRED_CLARIFICATION",
      needsClarification: true,
      missingFields: missingFields.length > 0 ? missingFields : ["transaction_details"],
      replyMessage: message,
      transactionDetails: null,
      draftPatch: null,
    },
  };
}

function missingFieldMessage(fields: MissingField[]): string {
  if (fields.includes("amount")) {
    return "Berapa nominalnya?";
  }
  if (fields.includes("merchant")) {
    return "Transaksi ini untuk apa atau di merchant mana? Tolong sebutkan keperluannya.";
  }
  if (fields.includes("sumber_dana")) {
    return "Kamu mau pakai rekening, dompet, atau tunai?";
  }
  if (fields.includes("transaction_date")) {
    return "Transaksinya terjadi kapan?";
  }
  if (fields.includes("transaction_time")) {
    return "Jamnya berapa?";
  }
  if (fields.includes("type")) {
    return "Ini pemasukan atau pengeluaran? Tolong pilih salah satunya.";
  }
  if (fields.includes("category")) {
    return "Kategori transaksinya belum bisa dipastikan. Tolong jelaskan sedikit lagi keperluannya.";
  }
  return GENERIC_CLARIFICATION;
}

function parseIntentClass(value: unknown): ChatIntentClass | null {
  return typeof value === "string" && (CHAT_INTENT_CLASSES as readonly string[]).includes(value)
    ? value as ChatIntentClass
    : null;
}

function parseDraftPatch(parsed: Record<string, unknown>): { value: ValidatedDraftPatch | null; invalidField: MissingField | null } {
  if (!Array.isArray(parsed.patch_fields) || !isRecord(parsed.draft_patch)) {
    return { value: null, invalidField: "transaction_details" };
  }

  const allowedFields = new Set<string>(DRAFT_PATCH_FIELDS);
  const fields = [...new Set(parsed.patch_fields.filter((field): field is DraftPatchField =>
    typeof field === "string" && allowedFields.has(field),
  ))];
  if (fields.length === 0 || fields.length !== parsed.patch_fields.length) {
    return { value: null, invalidField: "transaction_details" };
  }

  const raw = parsed.draft_patch;
  const patch: ValidatedDraftPatch = { fields };
  for (const field of fields) {
    switch (field) {
      case "amount":
        if (typeof raw.amount !== "number" || !Number.isFinite(raw.amount) || raw.amount <= 0) {
          return { value: null, invalidField: "amount" };
        }
        patch.amount = raw.amount;
        break;
      case "merchant":
        if (!isNonEmptyString(raw.merchant)) return { value: null, invalidField: "merchant" };
        patch.merchant = raw.merchant.trim();
        break;
      case "type":
        if (raw.type !== "INCOME" && raw.type !== "EXPENSE") return { value: null, invalidField: "type" };
        patch.type = raw.type;
        break;
      case "category":
        if (!isNonEmptyString(raw.category)) return { value: null, invalidField: "category" };
        patch.category = raw.category.trim();
        break;
      case "sumber_dana":
        if (!isNonEmptyString(raw.sumber_dana)) return { value: null, invalidField: "sumber_dana" };
        patch.sumberDana = raw.sumber_dana.trim();
        break;
      case "transaction_date":
        if (!isNonEmptyString(raw.transaction_date) || !isValidIsoDate(raw.transaction_date)) {
          return { value: null, invalidField: "transaction_date" };
        }
        patch.transactionDate = raw.transaction_date;
        break;
      case "transaction_time":
        if (raw.transaction_time !== null
          && (!isNonEmptyString(raw.transaction_time) || !isValidTime(raw.transaction_time))) {
          return { value: null, invalidField: "transaction_time" };
        }
        patch.transactionTime = raw.transaction_time as string | null;
        break;
      case "notes":
        if (raw.notes !== null && typeof raw.notes !== "string") {
          return { value: null, invalidField: "transaction_details" };
        }
        patch.notes = typeof raw.notes === "string" ? raw.notes.trim() || null : null;
        break;
      case "admin_fee":
        if (raw.admin_fee !== null
          && (typeof raw.admin_fee !== "number" || !Number.isFinite(raw.admin_fee) || raw.admin_fee < 0)) {
          return { value: null, invalidField: "transaction_details" };
        }
        patch.adminFee = raw.admin_fee as number | null;
        break;
    }
  }

  return { value: patch, invalidField: null };
}

export function parseAndValidateChatOutput(rawText: string): ChatOutputValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return clarification(["transaction_details"], GENERIC_CLARIFICATION, "malformed_json");
  }

  if (!isRecord(parsed) || typeof parsed.is_transaction !== "boolean") {
    return clarification(["transaction_details"], GENERIC_CLARIFICATION, "invalid_envelope");
  }

  const intentClass = parseIntentClass(parsed.intent_class);
  if (!intentClass) {
    return clarification(["transaction_details"], GENERIC_CLARIFICATION, "invalid_intent_class");
  }

  if (typeof parsed.needs_clarification !== "boolean") {
    return clarification(["transaction_details"], GENERIC_CLARIFICATION, "invalid_clarification_flag");
  }

  if (!isNonEmptyString(parsed.reply_message)) {
    return clarification(["transaction_details"], GENERIC_CLARIFICATION, "invalid_reply");
  }

  if (!parsed.is_transaction) {
    if (parsed.needs_clarification || intentClass !== "NON_TRANSACTION") {
      return clarification(["transaction_details"], GENERIC_CLARIFICATION, "invalid_non_transaction_outcome");
    }
    return {
      ok: true,
      failureClass: null,
      value: {
        isTransaction: false,
        intentClass,
        needsClarification: false,
        missingFields: [],
        replyMessage: parsed.reply_message.trim(),
        transactionDetails: null,
        draftPatch: null,
      },
    };
  }

  const requestedMissingFields = normalizeMissingFields(parsed.missing_fields);
  if (parsed.needs_clarification) {
    const clarificationMessage = isNonEmptyString(parsed.clarification_message)
      ? parsed.clarification_message.trim()
      : parsed.reply_message.trim();
    return clarification(
      requestedMissingFields,
      clarificationMessage || missingFieldMessage(requestedMissingFields),
    );
  }

  if (intentClass === "OPTIONAL_ENRICHMENT" || intentClass === "UPDATE_PENDING_DRAFT") {
    const patch = parseDraftPatch(parsed);
    if (!patch.value) {
      return clarification(
        [patch.invalidField || "transaction_details"],
        missingFieldMessage([patch.invalidField || "transaction_details"]),
        "invalid_draft_patch",
      );
    }
    return {
      ok: true,
      failureClass: null,
      value: {
        intentClass,
        isTransaction: true,
        needsClarification: false,
        missingFields: [],
        replyMessage: parsed.reply_message.trim(),
        transactionDetails: null,
        draftPatch: patch.value,
      },
    };
  }

  if (intentClass !== "NEW_TRANSACTION") {
    return clarification(["transaction_details"], GENERIC_CLARIFICATION, "invalid_transaction_intent");
  }

  if (!isRecord(parsed.transaction_details)) {
    return clarification(["transaction_details"], GENERIC_CLARIFICATION, "missing_transaction_details");
  }

  const details = parsed.transaction_details;
  const invalidFields: MissingField[] = [];

  if (typeof details.amount !== "number" || !Number.isFinite(details.amount) || details.amount <= 0) {
    invalidFields.push("amount");
  }
  if (!isNonEmptyString(details.merchant)) invalidFields.push("merchant");
  if (details.type !== "INCOME" && details.type !== "EXPENSE") invalidFields.push("type");
  if (!isNonEmptyString(details.category)) invalidFields.push("category");
  if (typeof details.source_was_explicit !== "boolean") invalidFields.push("sumber_dana");
  if (details.source_was_explicit === true && !isNonEmptyString(details.sumber_dana)) {
    invalidFields.push("sumber_dana");
  }
  if (details.source_was_explicit === false && !isNullableString(details.sumber_dana)) {
    invalidFields.push("sumber_dana");
  }

  const adminFee = details.admin_fee;
  if (adminFee !== null && adminFee !== undefined
    && (typeof adminFee !== "number" || !Number.isFinite(adminFee) || adminFee < 0)) {
    invalidFields.push("transaction_details");
  }

  const transactionDate = details.transaction_date;
  if (!isNullableString(transactionDate)
    || (typeof transactionDate === "string" && !isValidIsoDate(transactionDate))) {
    invalidFields.push("transaction_date");
  }

  const transactionTime = details.transaction_time;
  if (!isNullableString(transactionTime)
    || (typeof transactionTime === "string" && !isValidTime(transactionTime))) {
    invalidFields.push("transaction_time");
  }

  if (!isNullableString(details.notes)) invalidFields.push("transaction_details");

  const uniqueInvalidFields = [...new Set(invalidFields)];
  if (uniqueInvalidFields.length > 0) {
    return clarification(
      uniqueInvalidFields,
      missingFieldMessage(uniqueInvalidFields),
      "invalid_transaction_details",
    );
  }

  return {
    ok: true,
    failureClass: null,
    value: {
      isTransaction: true,
      intentClass,
      needsClarification: false,
      missingFields: [],
      replyMessage: parsed.reply_message.trim(),
      transactionDetails: {
        amount: details.amount as number,
        merchant: (details.merchant as string).trim(),
        type: details.type as "INCOME" | "EXPENSE",
        category: (details.category as string).trim(),
        sumberDana: isNonEmptyString(details.sumber_dana) ? details.sumber_dana.trim() : null,
        sourceWasExplicit: details.source_was_explicit as boolean,
        adminFee: typeof adminFee === "number" ? adminFee : null,
        notes: typeof details.notes === "string" && details.notes.trim() ? details.notes.trim() : null,
        transactionDate: typeof transactionDate === "string" ? transactionDate : null,
        transactionTime: typeof transactionTime === "string" ? transactionTime : null,
      },
      draftPatch: null,
    },
  };
}
