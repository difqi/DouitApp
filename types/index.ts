export type TransactionStatus = 'APPROVED' | 'PENDING_APPROVAL' | 'IGNORED';
export type TransactionSource = 'AUTOMATIC_EMAIL' | 'MANUAL_CHAT' | 'MANUAL_FORM';

export interface Transaction {
  id: string;
  amount: number;
  type: 'EXPENSE' | 'INCOME';
  merchant: string;
  category: string;
  status: TransactionStatus;
  source: TransactionSource;
  confidence_score: number;
  notes?: string | null;
  date: string;
}

export interface DashboardSummary {
  income: number;
  expense: number;
  net_balance: number;
}
