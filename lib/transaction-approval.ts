import type { TransactionStatus } from "@/types";

export const TRANSACTION_APPROVAL_DECISIONS = ["APPROVE", "REJECT"] as const;

export type TransactionApprovalDecision = typeof TRANSACTION_APPROVAL_DECISIONS[number];

export type TransactionApprovalOutcome =
  | "UPDATED"
  | "ALREADY_APPROVED"
  | "ALREADY_REJECTED"
  | "INVALID_TRANSITION"
  | "NOT_FOUND";

export type TransactionApprovalResult = {
  out_transaction_id: string;
  out_previous_status: TransactionStatus | null;
  out_current_status: TransactionStatus | null;
  out_transaction_type: "EXPENSE" | "INCOME" | null;
  out_outcome: TransactionApprovalOutcome;
};

const TRANSACTION_STATUSES: readonly TransactionStatus[] = [
  "PENDING_APPROVAL",
  "APPROVED",
  "IGNORED",
];

const TRANSACTION_APPROVAL_OUTCOMES: readonly TransactionApprovalOutcome[] = [
  "UPDATED",
  "ALREADY_APPROVED",
  "ALREADY_REJECTED",
  "INVALID_TRANSITION",
  "NOT_FOUND",
];

function isTransactionStatus(value: unknown): value is TransactionStatus {
  return typeof value === "string"
    && (TRANSACTION_STATUSES as readonly string[]).includes(value);
}

export function buildTransactionApprovalRpcArgs({
  transactionId,
  expectedStatus,
  decision,
}: {
  transactionId: string;
  expectedStatus: TransactionStatus;
  decision: TransactionApprovalDecision;
}) {
  return {
    p_transaction_id: transactionId,
    p_expected_status: expectedStatus,
    p_decision: decision,
  };
}

export function getTransactionApprovalResult(data: unknown): TransactionApprovalResult | null {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== "object") return null;

  const row = value as Record<string, unknown>;
  if (typeof row.out_transaction_id !== "string"
    || typeof row.out_outcome !== "string"
    || !(TRANSACTION_APPROVAL_OUTCOMES as readonly string[]).includes(row.out_outcome)
    || (row.out_previous_status !== null && !isTransactionStatus(row.out_previous_status))
    || (row.out_current_status !== null && !isTransactionStatus(row.out_current_status))
    || (row.out_transaction_type !== null
      && row.out_transaction_type !== "EXPENSE"
      && row.out_transaction_type !== "INCOME")) {
    return null;
  }

  return row as TransactionApprovalResult;
}

export function shouldTriggerBudgetAlertForApproval(
  result: TransactionApprovalResult,
): boolean {
  return result.out_outcome === "UPDATED"
    && result.out_current_status === "APPROVED"
    && result.out_transaction_type === "EXPENSE";
}
