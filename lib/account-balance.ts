import { isAccountMatch } from "@/utils/bankAliases";

export type PaymentAccount = {
  id: string;
  user_id?: string;
  name: string;
  type: string;
  initial_balance: number | string | null;
  is_primary: boolean;
  created_at?: string;
};

export type AccountBalanceTransaction = {
  amount: number | string;
  type: "INCOME" | "EXPENSE";
  status?: string;
  sumber_dana?: string | null;
};

export function getAccountCurrentBalance(
  account: PaymentAccount,
  transactions: AccountBalanceTransaction[],
) {
  return transactions.reduce((balance, transaction) => {
    if (transaction.status && transaction.status !== "APPROVED") return balance;
    if (!isAccountMatch(account.name, transaction.sumber_dana || "")) return balance;

    const amount = Number(transaction.amount) || 0;
    return transaction.type === "INCOME" ? balance + amount : balance - amount;
  }, Number(account.initial_balance) || 0);
}

export function getTotalCurrentBalance(
  accounts: PaymentAccount[],
  transactions: AccountBalanceTransaction[],
) {
  return accounts.reduce(
    (total, account) => total + getAccountCurrentBalance(account, transactions),
    0,
  );
}
