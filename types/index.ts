export type TransactionStatus = 'APPROVED' | 'PENDING_APPROVAL' | 'IGNORED';
export type TransactionSource = 'AUTOMATIC_EMAIL' | 'MANUAL_CHAT' | 'MANUAL_FORM';
export type TransactionKind = 'ORDINARY' | 'TRANSFER' | 'SAVING' | 'FEE';

export type CategoryRecord = {
  id: string;
  user_id: string | null;
  name: string;
  type: string;
  is_system: boolean;
};

export type SubcategoryRecord = {
  id: string;
  category_id: string;
  user_id: string | null;
  name: string;
  is_system: boolean;
  system_key: string | null;
  icon_name: string | null;
  color_hex: string | null;
  created_at: string;
};

export type CategorySelection = {
  categoryId: string;
  subcategoryId: string | null;
};

export type CategoryWithSubcategories = {
  category: CategoryRecord;
  subcategories: SubcategoryRecord[];
};

export type TransactionDraftPreview = Record<string, unknown> & {
  category_id?: string | null;
  subcategory_id?: string | null;
  subcategory?: SubcategoryRecord | null;
};

export interface Transaction {
  id: string;
  amount: number;
  type: 'EXPENSE' | 'INCOME';
  merchant: string;
  category: string;
  category_id?: string | null;
  subcategory_id?: string | null;
  subcategory?: SubcategoryRecord | null;
  transaction_kind: TransactionKind | null;
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
