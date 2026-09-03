export const SAVINGS_STORAGE_TYPES = [
  "GOPAY_MERCHANT",
  "BANK_TRANSFER",
  "TUNAI",
] as const;

export type SavingsStorageType = typeof SAVINGS_STORAGE_TYPES[number];

export const SAVINGS_RECORDING_METHODS = [
  "AUTO_EMAIL",
  "MANUAL_WEB",
  "MANUAL_WHATSAPP",
] as const;

export type SavingsRecordingMethod = typeof SAVINGS_RECORDING_METHODS[number];

export const SAVINGS_EVIDENCE_LEVELS = [
  "USER_CONFIRMED",
  "EXTERNAL_VERIFIED",
] as const;

// Resend's receiving API timestamp is the strongest non-AI timestamp currently
// available for an inbound bank email. Keep automatic evidence upgrades narrow:
// a wider/different window must be an explicit reviewed product change.
export const SAVINGS_EMAIL_EVIDENCE_WINDOW_MINUTES = 30;

export type SavingsEvidenceLevel = typeof SAVINGS_EVIDENCE_LEVELS[number];

export type SavingsSourceAccount = {
  id: string;
  user_id: string | null;
  name: string;
  type?: string | null;
};

export type SavingsContributionResult = {
  out_transaction_id: string;
  out_savings_log_id: string;
  out_goal_id: string;
  out_amount: number;
  out_current_amount: number;
  out_status: string;
  out_evidence_level: SavingsEvidenceLevel;
  out_replayed: boolean;
};

export type SavingsEvidenceReconciliationResult = {
  out_outcome: "CREATED" | "AMBIGUOUS" | "UPGRADED" | "REPLAYED";
  out_transaction_id: string | null;
  out_savings_log_id: string | null;
  out_current_amount: number;
};

export function isSavingsStorageType(value: unknown): value is SavingsStorageType {
  return typeof value === "string"
    && (SAVINGS_STORAGE_TYPES as readonly string[]).includes(value);
}

export function savingsStorageRequiresAccount(storageType: SavingsStorageType): boolean {
  return storageType === "GOPAY_MERCHANT" || storageType === "BANK_TRANSFER";
}

export function getOwnedSavingsSourceAccounts(
  accounts: SavingsSourceAccount[],
  actorUserId: string,
): SavingsSourceAccount[] {
  return accounts.filter((account) =>
    account.user_id !== null
    && account.user_id === actorUserId
    && account.id.trim() !== ""
    && account.name.trim() !== "",
  );
}

export function resolveSavingsSource({
  storageType,
  actorUserId,
  sourceAccountId,
  accounts,
}: {
  storageType: SavingsStorageType;
  actorUserId: string;
  sourceAccountId?: string | null;
  accounts: SavingsSourceAccount[];
}):
  | { status: "valid"; sourceAccountId: string | null; sourceName: string }
  | { status: "source_account_required" | "source_account_forbidden" | "invalid_source_account" } {
  if (storageType === "TUNAI") {
    if (sourceAccountId) return { status: "source_account_forbidden" };
    return { status: "valid", sourceAccountId: null, sourceName: "Tunai" };
  }

  if (!sourceAccountId) return { status: "source_account_required" };
  const ownedAccount = getOwnedSavingsSourceAccounts(accounts, actorUserId).find(
    (account) => account.id === sourceAccountId,
  );
  if (!ownedAccount) return { status: "invalid_source_account" };
  return {
    status: "valid",
    sourceAccountId: ownedAccount.id,
    sourceName: ownedAccount.name,
  };
}

export function findUniqueOwnedSavingsAccount({
  accounts,
  actorUserId,
  matches,
}: {
  accounts: SavingsSourceAccount[];
  actorUserId: string;
  matches: (account: SavingsSourceAccount) => boolean;
}): SavingsSourceAccount | null {
  const matched = getOwnedSavingsSourceAccounts(accounts, actorUserId).filter(matches);
  return matched.length === 1 ? matched[0] : null;
}

const STABLE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export function buildSavingsOperationKey({
  namespace,
  stableId,
}: {
  namespace: "manual_web" | "fonnte" | "resend";
  stableId: unknown;
}): string | null {
  if (typeof stableId !== "string") return null;
  const normalized = stableId.trim();
  if (!normalized || !STABLE_ID_PATTERN.test(normalized)) return null;
  const operationKey = `savings:${namespace}:${normalized}`;
  return operationKey.length <= 500 ? operationKey : null;
}

export function parseProviderReceivedAt(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function isWithinSavingsEmailEvidenceWindow({
  contributionAt,
  emailReceivedAt,
}: {
  contributionAt: string | Date;
  emailReceivedAt: string | Date;
}): boolean {
  const contributionTimestamp = new Date(contributionAt).getTime();
  const emailTimestamp = new Date(emailReceivedAt).getTime();
  if (!Number.isFinite(contributionTimestamp) || !Number.isFinite(emailTimestamp)) {
    return false;
  }

  return contributionTimestamp <= emailTimestamp
    && emailTimestamp - contributionTimestamp
      <= SAVINGS_EMAIL_EVIDENCE_WINDOW_MINUTES * 60_000;
}

export function getSingleRpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) || null;
  if (data && typeof data === "object") return data as T;
  return null;
}

export function buildManualWebSavingsRpcArgs({
  goalId,
  amount,
  sourceAccountId,
  operationKey,
  notes,
}: {
  goalId: string;
  amount: number;
  sourceAccountId: string | null;
  operationKey: string;
  notes?: string | null;
}) {
  return {
    p_goal_id: goalId,
    p_amount: amount,
    p_source_account_id: sourceAccountId,
    p_operation_key: operationKey,
    p_notes: notes || null,
  };
}
