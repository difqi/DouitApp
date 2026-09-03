"use client";

import { CircleDollarSign, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { triggerBudgetAlertCheck } from "@/app/actions/savings-alert";
import { BankLogo } from "@/app/components/BankLogo";
import { CategoryIcon } from "@/app/components/CategoryIcon";
import { CustomDatePicker } from "@/app/components/ui/CustomDatePicker";
import { CustomSelect } from "@/app/components/ui/CustomSelect";
import { SubcategorySelect } from "@/app/components/SubcategorySelect";
import { useDouit } from "@/app/providers/DouitProvider";
import { createClient } from "@/lib/supabase/client";
import {
  listSubcategoriesForParent,
  preserveSubcategoryForCategoryChange,
  validateSubcategoryAssignmentFromRows,
} from "@/lib/categories";
import {
  resolveNormalTransactionKind,
  shouldExposeCategoryInOrdinaryTransactionPicker,
} from "@/lib/transaction-semantics";
import type { CategoryRecord } from "@/types";

type TransactionCategory = CategoryRecord;

type TransactionCreateModalProps = {
  open: boolean;
  onClose: () => void;
  categories?: TransactionCategory[];
};

function TransactionSourceLogo({ bankName }: { bankName: string }) {
  return (
    <div className="transaction-logo-frame transaction-select-bank-logo">
      <BankLogo bankName={bankName} className="transaction-logo-mark" />
    </div>
  );
}

const typeOptions = [
  { value: "EXPENSE", label: "Pengeluaran" },
  { value: "INCOME", label: "Pemasukan" },
];

export const transactionSourceNames = [
  "Tunai",
  "Bank BCA",
  "Bank Mandiri",
  "Bank BRI",
  "Bank BNI",
  "GoPay",
  "OVO",
  "Dana",
  "ShopeePay",
  "Lainnya",
];

const sourceOptions = transactionSourceNames.map((source) => ({
  value: source,
  label: source,
  icon: <TransactionSourceLogo bankName={source} />,
}));

export function TransactionCreateModal({ open, onClose, categories: providedCategories }: TransactionCreateModalProps) {
  const { user } = useDouit();
  const [fetchedCategories, setFetchedCategories] = useState<TransactionCategory[]>([]);
  const [type, setType] = useState("EXPENSE");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [source, setSource] = useState("Tunai");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (!open || !user || providedCategories) return;
    const supabase = createClient();
    void supabase
      .from("categories")
      .select("id, user_id, name, type, is_system")
      .or(`user_id.eq.${user.id},and(is_system.eq.true,user_id.is.null)`)
      .then(({ data }) => {
        if (data) setFetchedCategories(data);
      });
  }, [open, providedCategories, user]);

  const categories = providedCategories ?? fetchedCategories;
  const categoryOptions = useMemo(() => categories
    .filter((category) =>
      category.type.toUpperCase() === type
      && shouldExposeCategoryInOrdinaryTransactionPicker(category),
    )
    .map((category) => ({
      value: category.id,
      label: category.name,
      icon: <CategoryIcon category={category.name} />,
    })), [categories, type]);

  useEffect(() => {
    if (!open || categoryOptions.length === 0) return;
    if (!categoryOptions.some((category) => category.value === categoryId)) {
      setSubcategoryId(null);
      setCategoryId(categoryOptions[0].value);
    }
  }, [categoryId, categoryOptions, open]);

  const handleCategoryChange = (nextCategoryId: string) => {
    setSubcategoryId((currentSubcategoryId) => preserveSubcategoryForCategoryChange({
      previousCategoryId: categoryId,
      nextCategoryId,
      subcategoryId: currentSubcategoryId,
    }));
    setCategoryId(nextCategoryId);
  };

  async function createTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    const data = new FormData(event.currentTarget);
    const supabase = createClient();
    const merchantName = String(data.get("name"));
    let selectedCategoryId = String(data.get("category_id"));
    let selectedSubcategoryId = String(data.get("subcategory_id") || "") || null;
    let selectedSource = String(data.get("sumber_dana") || "Tunai");
    let notes: string | null = null;
    const transactionType = String(data.get("type")) as "INCOME" | "EXPENSE";

    try {
      const { data: rule } = await supabase
        .from("merchant_rules")
        .select("category_id, keyword, sumber_dana")
        .eq("user_id", user.id)
        .eq("merchant_name", merchantName)
        .single();

      const ruleCategory = rule?.category_id
        ? categories.find((category) =>
            category.id === rule.category_id
            && category.type.toUpperCase() === transactionType
            && shouldExposeCategoryInOrdinaryTransactionPicker(category),
          )
        : null;

      if (rule && ruleCategory) {
        selectedSubcategoryId = preserveSubcategoryForCategoryChange({
          previousCategoryId: selectedCategoryId,
          nextCategoryId: ruleCategory.id,
          subcategoryId: selectedSubcategoryId,
        });
        selectedCategoryId = ruleCategory.id;
        if (rule.keyword) notes = rule.keyword;
        if (rule.sumber_dana) selectedSource = rule.sumber_dana;
      }

      const selectedCategory = categories.find((category) =>
        category.id === selectedCategoryId && category.type.toUpperCase() === transactionType,
      );
      if (!selectedCategory) {
        toast.error("Kategori tidak valid untuk tipe transaksi ini.");
        return;
      }

      const { data: safeCategory, error: categoryError } = await supabase
        .from("categories")
        .select("id, user_id, name, type, is_system")
        .eq("id", selectedCategoryId)
        .eq("type", transactionType)
        .or(`user_id.eq.${user.id},and(is_system.eq.true,user_id.is.null)`)
        .maybeSingle();
      if (categoryError || !safeCategory) {
        toast.error("Kategori tidak dapat digunakan.");
        return;
      }
      if (!shouldExposeCategoryInOrdinaryTransactionPicker(safeCategory)) {
        toast.error("Kategori ini hanya dapat digunakan melalui fitur Nabung.");
        return;
      }

      if (selectedSubcategoryId) {
        const subcategories = await listSubcategoriesForParent(
          supabase,
          selectedCategoryId,
          user.id,
        );
        const validation = validateSubcategoryAssignmentFromRows({
          subcategories,
          categories: [safeCategory as CategoryRecord],
          userId: user.id,
          categoryId: selectedCategoryId,
          subcategoryId: selectedSubcategoryId,
          type: transactionType,
        });
        if (validation.status !== "matched") {
          toast.error("Subkategori tidak valid untuk kategori yang dipilih.");
          return;
        }
      }

      const rawDate = String(data.get("date") || "");
      const targetDate = rawDate || new Date().toISOString().slice(0, 10);
      const transaction = {
        user_id: user.id,
        amount: Number(data.get("amount")),
        type: transactionType,
        merchant: merchantName,
        category_id: selectedCategoryId,
        subcategory_id: selectedSubcategoryId,
        transaction_kind: resolveNormalTransactionKind(safeCategory),
        sumber_dana: selectedSource,
        notes: notes ? `${notes} [NO_TIME]` : "[NO_TIME]",
        status: "APPROVED",
        source: "MANUAL_FORM",
        confidence_score: 1.0,
        transaction_date: `${targetDate}T00:00:00.000Z`,
      };

      const { error: insertError } = await supabase.from("transactions").insert(transaction);
      if (insertError) throw insertError;
      onClose();
      if (transaction.type === "EXPENSE") {
        triggerBudgetAlertCheck().catch(console.error);
      }
    } catch {
      toast.error("Transaksi belum dapat disimpan. Silakan coba lagi.");
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-scrim transaction-modal-scrim" onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="modal-dialog transaction-modal-dialog transaction-add-dialog relative w-full max-w-lg bg-white rounded-2xl md:rounded-3xl shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200" role="dialog" aria-modal="true" aria-labelledby="transaction-create-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header transaction-modal-header flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 rounded-t-2xl md:rounded-t-3xl">
          <h3 id="transaction-create-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}><CircleDollarSign size={19} /> Catat transaksi</h3>
          <button type="button" className="transaction-modal-close" onClick={onClose} aria-label="Tutup form catat transaksi"><X size={19} /></button>
        </div>
        <form className="transaction-modal-form" onSubmit={createTransaction}>
          <div className="form-grid transaction-modal-fields transaction-add-fields" style={{ padding: "24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div className="transaction-primary-field" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#475569" }}>Tipe</span>
              <CustomSelect name="type" value={type} onChange={setType} options={typeOptions} responsiveOverlay selectionTitle="Pilih tipe transaksi" />
            </div>
            <label className="transaction-primary-field" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#475569" }}>Jumlah (Rp)</span>
              <input name="amount" type="number" min="1" inputMode="numeric" placeholder="0" required style={{ padding: "8px", borderRadius: "6px", border: "1px solid #ccc" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", gridColumn: "span 2" }}>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#475569" }}>Nama transaksi / merchant</span>
              <input name="name" placeholder="Contoh: Beli Makan" required style={{ padding: "8px", borderRadius: "6px", border: "1px solid #ccc" }} />
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#475569" }}>Tanggal</span>
              <CustomDatePicker name="date" value={date} onChange={setDate} responsiveOverlay selectionTitle="Pilih tanggal transaksi" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#475569" }}>Kategori</span>
              <CustomSelect name="category_id" value={categoryId || (categoryOptions[0]?.value ?? "")} onChange={handleCategoryChange} options={categoryOptions} placeholder="Pilih Kategori" responsiveOverlay selectionTitle="Pilih kategori" />
            </div>
            <SubcategorySelect
              categoryId={categoryId}
              userId={user?.id || ""}
              value={subcategoryId}
              onChange={setSubcategoryId}
              disabled={isSubmitting}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#475569" }}>Sumber Dana</span>
              <CustomSelect name="sumber_dana" value={source} onChange={setSource} options={sourceOptions} placeholder="Pilih Sumber Dana" responsiveOverlay selectionTitle="Pilih sumber dana" />
            </div>
          </div>
          <div className="modal-actions transaction-modal-actions rounded-b-2xl md:rounded-b-3xl" style={{ padding: "16px 24px", borderTop: "1px solid #eee", display: "flex", justifyContent: "flex-end", gap: "12px", background: "#f8fafc" }}>
            <button type="button" className="button secondary" onClick={onClose}>Batal</button>
            <button type="submit" className="button primary" disabled={!user || categoryOptions.length === 0 || isSubmitting}>{isSubmitting ? "Menyimpan..." : "Simpan transaksi"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
