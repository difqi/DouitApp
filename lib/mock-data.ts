import { DashboardSummary, Transaction } from "../types";

export const mockSummary: DashboardSummary = {
  income: 15000000,
  expense: 4500000,
  net_balance: 10500000,
};

export const mockTransactions: Transaction[] = [
  {
    id: "tx-1",
    amount: 50000,
    type: "EXPENSE",
    merchant: "BYMOONSTORE",
    category: "Lain-lain",
    status: "PENDING_APPROVAL",
    source: "AUTOMATIC_EMAIL",
    confidence_score: 0.65,
    date: new Date().toISOString(),
  },
  {
    id: "tx-2",
    amount: 150000,
    type: "EXPENSE",
    merchant: "PERTAMINA",
    category: "Transportasi",
    status: "APPROVED",
    source: "AUTOMATIC_EMAIL",
    confidence_score: 0.95,
    date: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "tx-3",
    amount: 5000,
    type: "EXPENSE",
    merchant: "Parkir",
    category: "Transportasi",
    status: "APPROVED",
    source: "MANUAL_CHAT",
    confidence_score: 1.0,
    date: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: "tx-4",
    amount: 3000000,
    type: "INCOME",
    merchant: "PT Perusahaan",
    category: "Gaji",
    status: "APPROVED",
    source: "AUTOMATIC_EMAIL",
    confidence_score: 0.99,
    date: new Date(Date.now() - 5 * 86400000).toISOString(),
  }
];
