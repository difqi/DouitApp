"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Download,
  Filter,
  MoreHorizontal,
  Plus,
  Search,
  CheckCircle2,
  CircleAlert,
  Bot,
  Wallet,
  CreditCard,
  Smartphone,
  TrendingUp
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { useDouit } from "../providers/DouitProvider";
import { mockTransactions } from "../../lib/mock-data";
import { Transaction } from "../../types";
import { triggerBudgetAlertCheck } from "@/app/actions/savings-alert";
import { BankLogo } from "@/app/components/BankLogo";
import { exportCsv } from "@/lib/report-export-utils";
import { CustomSelect } from "@/app/components/ui/CustomSelect";
import { CustomDatePicker } from "@/app/components/ui/CustomDatePicker";

const formatMoney = (value: number | string) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value));
const formatDate = (value: string) => new Date(value).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
const formatTime = (value: string) => new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).replace('.', ':') + " WIB";

export const shouldDisplayTransactionTime = (row: { source?: string; notes?: string | null; date?: string }) => {
  if (!row?.date) return false;
  if (row.source === 'MANUAL_FORM') return false;
  if (row.notes && row.notes.includes('[NO_TIME]')) return false;
  return true;
};

const getBankBadgeStyle = (bankName: string) => {
  const name = (bankName || 'Tunai').toLowerCase();
  
  if (name.includes('bri')) return 'bg-blue-50 text-blue-700 border-blue-200/80';
  if (name.includes('bca')) return 'bg-indigo-50 text-indigo-700 border-indigo-200/80';
  if (name.includes('bni')) return 'bg-orange-50 text-orange-700 border-orange-200/80';
  if (name.includes('bsi')) return 'bg-teal-50 text-teal-700 border-teal-200/80';
  if (name.includes('mandiri')) return 'bg-amber-50 text-amber-800 border-amber-200/80';
  if (name.includes('shopee') || name.includes('gopay') || name.includes('ovo') || name.includes('dana') || name.includes('linkaja') || name.includes('pay') || name.includes('e-wallet')) {
    return 'bg-purple-50 text-purple-700 border-purple-200/80';
  }
  if (name === 'tunai' || name === 'cash') return 'bg-slate-100 text-slate-700 border-slate-200';

  const colors = [
    'bg-pink-50 text-pink-700 border-pink-200/80',
    'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200/80',
    'bg-rose-50 text-rose-700 border-rose-200/80',
    'bg-cyan-50 text-cyan-700 border-cyan-200/80',
    'bg-sky-50 text-sky-700 border-sky-200/80',
    'bg-lime-50 text-lime-700 border-lime-200/80',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);
  return colors[hash % colors.length];
};

function WorkspaceHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="workspace-heading">
      <div><span className="workspace-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {actions && <div className="workspace-actions">{actions}</div>}
    </div>
  );
}

function Shell({ active, children }: { active: "dashboard" | "chat" | "transactions"; children: React.ReactNode }) {
  return <div className="workspace-page">{children}</div>;
}

import { createClient } from "@/lib/supabase/client";
import { isAccountMatch } from "../../utils/bankAliases";

let cachedWorkspaceTx: any[] = [];
let cachedCategories: {id: string, name: string}[] = [];
let cachedAccounts: any[] = [];
let cachedPrimaryAccount: any = null;

const toLocalYYYYMMDD = (d: Date) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getPresetDates = (preset: string) => {
  const today = new Date();
  
  if (preset === "Hari Ini") {
    const str = toLocalYYYYMMDD(today);
    return { start: str, end: str };
  } else if (preset === "Minggu Ini") {
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(today);
    startOfWeek.setDate(diff);
    return { start: toLocalYYYYMMDD(startOfWeek), end: toLocalYYYYMMDD(today) };
  } else if (preset === "Bulan Ini") {
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: toLocalYYYYMMDD(startOfMonth), end: toLocalYYYYMMDD(endOfMonth) };
  } else if (preset === "Tahun Ini") {
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const endOfYear = new Date(today.getFullYear(), 11, 31);
    return { start: toLocalYYYYMMDD(startOfYear), end: toLocalYYYYMMDD(endOfYear) };
  }
  return { start: "", end: "" };
};

const getLocalStartOfDay = (dateStr: string) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(0, 0, 0, 0);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString();
};

const getLocalEndOfDay = (dateStr: string) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(23, 59, 59, 999);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString();
};

export function TransactionsView() {
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<Transaction & { category_id: string } | null>(null);
  const [kind, setKind] = useState("Semua");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [saveRule, setSaveRule] = useState(false);
  const [dateFilter, setDateFilter] = useState<{mode: string, preset: string, month: string, year: string, start: string, end: string}>({mode: "preset", preset: "Semua", month: "", year: "", start: "", end: ""});
  
  const [tempFilterMode, setTempFilterMode] = useState<string>("preset");
  const [tempPreset, setTempPreset] = useState("Semua");
  const [tempMonth, setTempMonth] = useState<string>("");
  const [tempYear, setTempYear] = useState<string>("");
  const [tempStart, setTempStart] = useState("");
  const [tempEnd, setTempEnd] = useState("");

  const [addType, setAddType] = useState("EXPENSE");
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addCategoryId, setAddCategoryId] = useState("");
  const [addSumberDana, setAddSumberDana] = useState("Tunai");

  const [editCategoryId, setEditCategoryId] = useState("");
  const [editSumberDana, setEditSumberDana] = useState("Tunai");
  
  const [rows, setRows] = useState<Transaction[]>(cachedWorkspaceTx);
  const [categories, setCategories] = useState<{id: string, name: string}[]>(cachedCategories);
  const [accounts, setAccounts] = useState<any[]>(cachedAccounts);
  const [primaryAccount, setPrimaryAccount] = useState<any>(cachedPrimaryAccount);
  const { user, business } = useDouit();

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    
    const fetchTransactions = async () => {
      const { data: accData } = await supabase.from('payment_accounts').select('*').eq('user_id', user.id);
      if (accData) {
        cachedAccounts = accData;
        cachedPrimaryAccount = accData.find(a => a.is_primary) || null;
        setAccounts(accData);
        setPrimaryAccount(cachedPrimaryAccount);
      }

      let query = supabase
        .from('transactions')
        .select(`
          id, amount, type, merchant, status, source, confidence_score, transaction_date, category_id, notes, sumber_dana,
          categories (name)
        `)
        .eq('user_id', user.id)
        .order('transaction_date', { ascending: false });
        
      if (dateFilter.start && dateFilter.end) {
        query = query
          .gte('transaction_date', getLocalStartOfDay(dateFilter.start))
          .lte('transaction_date', getLocalEndOfDay(dateFilter.end));
      }
      
      if (dateFilter.mode === "preset" && dateFilter.preset === "Semua") {
        query = query.limit(150);
      }
        
      const { data } = await query;
        
      if (data) {
        const mapped = data.map(d => ({
          ...d,
          date: d.transaction_date,
          notes: d.notes,
          category: (d.categories as any)?.name || 'Lain-lain',
          category_id: d.category_id,
          sumber_dana: d.sumber_dana || 'Tunai'
        })) as any as (Transaction & { category_id: string, sumber_dana: string })[];
        cachedWorkspaceTx = mapped as any;
        setRows(mapped);
      }
    };
    
    fetchTransactions();
    
    supabase.from('categories').select('id, name').or(`user_id.eq.${user.id},is_system.eq.true,user_id.is.null`).then(({data}) => {
      if (data) {
        cachedCategories = data;
        setCategories(data);
      }
    });
    
    const channel = supabase.channel('realtime_transactions_view')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` }, () => {
        fetchTransactions();
      })
      .subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, [user, dateFilter]);

  const filteredRows = rows.filter(row => {
    if (kind !== "Semua") {
      if (kind === "Pemasukan" && row.type !== "INCOME") return false;
      if (kind === "Pengeluaran" && row.type !== "EXPENSE") return false;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchMerchant = row.merchant?.toLowerCase().includes(q);
      const matchNotes = row.notes?.toLowerCase().includes(q);
      const matchCategory = (row as any).category?.toLowerCase().includes(q);
      const matchAmount = String(row.amount).includes(q);
      if (!matchMerchant && !matchNotes && !matchCategory && !matchAmount) return false;
    }

    return true;
  });

  let initBal = 0;
  let relevantRows = filteredRows.filter(row => row.status === 'APPROVED');
  
  if (primaryAccount) {
    relevantRows = relevantRows.filter((row: any) => isAccountMatch(primaryAccount.name, row.sumber_dana));
    initBal = Number(primaryAccount.initial_balance) || 0;
  } else {
    initBal = accounts.reduce((sum, a) => sum + (Number(a.initial_balance) || 0), 0);
  }

  const income = relevantRows.filter(row => row.type === "INCOME").reduce((sum, row) => sum + Number(row.amount), 0);
  const expense = relevantRows.filter(row => row.type === "EXPENSE").reduce((sum, row) => sum + Number(row.amount), 0);
  const net_balance = initBal + income - expense;

  async function createTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const data = new FormData(event.currentTarget);
    const supabase = createClient();
    
    const merchantName = String(data.get("name"));
    let categoryId = String(data.get("category_id"));
    let sumberDana = String(data.get("sumber_dana") || "Tunai");
    let notes = null;
    
    // Auto matching logic
    const { data: rule } = await supabase.from('merchant_rules').select('category_id, keyword, sumber_dana').eq('user_id', user.id).eq('merchant_name', merchantName).single();
    if (rule) {
      if (rule.category_id) categoryId = rule.category_id;
      if (rule.keyword) notes = rule.keyword;
      if (rule.sumber_dana) sumberDana = rule.sumber_dana;
    }
    
    const rawDate = String(data.get("date") || "");
    const todayStr = new Date().toISOString().slice(0, 10);
    const targetDate = rawDate || todayStr;
    const manualNotes = notes ? `${notes} [NO_TIME]` : '[NO_TIME]';
    
    const newTx = {
      user_id: user.id,
      amount: Number(data.get("amount")),
      type: String(data.get("type")) as 'INCOME' | 'EXPENSE',
      merchant: merchantName,
      category_id: categoryId,
      sumber_dana: sumberDana,
      notes: manualNotes,
      status: "APPROVED",
      source: "MANUAL_FORM",
      confidence_score: 1.0,
      transaction_date: `${targetDate}T00:00:00.000Z`
    };
    
    await supabase.from('transactions').insert(newTx);
    setAddOpen(false);
    if (newTx.type === 'EXPENSE' && user) {
      triggerBudgetAlertCheck(user.id).catch(console.error);
    }
  }

  async function approveTransaction(row: any) {
    if (!user) return;
    const supabase = createClient();
    
    // Update status to APPROVED
    await supabase.from('transactions').update({ status: 'APPROVED' }).eq('id', row.id);
    if (row.type === 'EXPENSE' && user) {
      triggerBudgetAlertCheck(user.id).catch(console.error);
    }
  }

  async function updateTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !editRow) return;
    const data = new FormData(event.currentTarget);
    const supabase = createClient();
    
    const newCategoryId = String(data.get("category_id"));
    const newSumberDana = String(data.get("sumber_dana") || "Tunai");
    const newNotes = String(data.get("notes") || "");
    const shouldSaveRule = data.get("save_rule") === "on";
    const shouldRetroactive = data.get("retroactive") === "on";
    
    await supabase.from('transactions').update({ 
      category_id: newCategoryId,
      sumber_dana: newSumberDana,
      notes: newNotes,
      status: 'APPROVED'
    }).eq('id', editRow.id);
    
    if (shouldSaveRule) {
      await supabase.from('merchant_rules').upsert({
        user_id: user.id,
        merchant_name: editRow.merchant,
        keyword: newNotes || null,
        category_id: newCategoryId,
        sumber_dana: newSumberDana
      }, { onConflict: 'user_id, merchant_name' });
      
      if (shouldRetroactive) {
        await supabase.from('transactions').update({
          category_id: newCategoryId,
          sumber_dana: newSumberDana,
          notes: newNotes,
          status: 'APPROVED'
        }).match({ user_id: user.id, merchant: editRow.merchant });
      }
    }
    
    setEditRow(null);
    setSaveRule(false);
  }

  const handleExportCSV = () => {
    if (!filteredRows || filteredRows.length === 0) {
      toast.warning("Tidak ada transaksi untuk diekspor.");
      return;
    }

    const formatCsvCell = (val: string | number | null | undefined): string => {
      if (val === null || val === undefined) return "";
      if (typeof val === "number") return String(val);
      const str = String(val).trim();
      // If string contains comma, quote, or newline, escape quotes and wrap in quotes
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const formatCsvDate = (dateVal: string | Date): string => {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return "";
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    };

    const headers = [
      "Tanggal",
      "Rekening",
      "Kategori",
      "Deskripsi / Merchant",
      "Tipe",
      "Nominal (Rp)"
    ];

    const rowsData = filteredRows.map(row => [
      formatCsvDate(row.date),
      (row as any).sumber_dana || "Tunai",
      (row as any).category || "Lain-lain",
      row.merchant || row.notes || "-",
      row.type === "INCOME" ? "Pemasukan" : "Pengeluaran",
      Number(row.amount) || 0
    ]);

    const csvContent = [
      headers.map(formatCsvCell).join(","),
      ...rowsData.map(r => r.map(formatCsvCell).join(","))
    ].join("\r\n");

    const todayStr = new Date().toISOString().split("T")[0];
    exportCsv(csvContent, `Transaksi-Douit-${todayStr}.csv`);
  };

  const openAddModal = () => {
    setAddOpen(true);
    if (!addCategoryId && categories.length > 0) {
      const validCats = categories.filter(c => c.name !== 'Nabung');
      if (validCats.length > 0) {
        setAddCategoryId(validCats[0].id);
      }
    }
  };

  const openEditModal = (row: any) => {
    setEditRow(row as any);
    setEditCategoryId(row.category_id || "");
    setEditSumberDana((row as any).sumber_dana || 'Tunai');
    setSaveRule(false);
  };

  const typeOptions = [
    { value: "EXPENSE", label: "Pengeluaran" },
    { value: "INCOME", label: "Pemasukan" }
  ];

  const categoryOptions = categories
    .filter(c => c.name !== 'Nabung')
    .map(c => ({ value: c.id, label: c.name }));

  const sumberDanaOptions = [
    { value: "Tunai", label: "Tunai" },
    { value: "Bank BCA", label: "Bank BCA" },
    { value: "Bank Mandiri", label: "Bank Mandiri" },
    { value: "Bank BRI", label: "Bank BRI" },
    { value: "Bank BNI", label: "Bank BNI" },
    { value: "GoPay", label: "GoPay" },
    { value: "OVO", label: "OVO" },
    { value: "Dana", label: "Dana" },
    { value: "ShopeePay", label: "ShopeePay" },
    { value: "Lainnya", label: "Lainnya" }
  ];

  const monthOptions = [
    { value: "", label: "Pilih Bulan" },
    ...["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"].map((m, i) => ({
      value: String(i),
      label: m
    }))
  ];

  const yearOptions = [
    { value: "", label: "Pilih Tahun" },
    ...[2024, 2025, 2026, 2027].map(y => ({
      value: String(y),
      label: String(y)
    }))
  ];

  return (
    <Shell active="transactions">
      <WorkspaceHeader 
        eyebrow="Arus kas" 
        title="Transaksi" 
        description="Pantau pemasukan dan pengeluaran Anda dari berbagai sumber." 
        actions={
          <>
            <button className="button secondary" onClick={handleExportCSV}><Download size={16} /> Ekspor CSV</button>
            <button className="button primary" onClick={openAddModal}><Plus size={16} /> Catat manual</button>
          </>
        } 
      />
      <section className="balance-card mb-6" style={{ minHeight: 'auto', padding: '16px 24px' }}>
        <div className="flex flex-row items-center justify-between gap-8 relative z-10 w-full">
          {/* LEFT COLUMN: Saldo Info */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 text-sm font-medium">Saldo Bersih</span>
              {primaryAccount ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {primaryAccount.type === 'bank' ? <CreditCard className="w-3 h-3" /> : primaryAccount.type === 'wallet' ? <Smartphone className="w-3 h-3" /> : <Wallet className="w-3 h-3" />}
                  {primaryAccount.name} (Utama)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Wallet className="w-3 h-3" /> Total Seluruh Rekening
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <h2 className="text-3xl font-bold text-white tracking-tight">{formatMoney(net_balance)}</h2>
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                <TrendingUp className="w-3 h-3" /> Data tercatat
              </span>
            </div>
          </div>

          {/* RIGHT COLUMN: Pemasukan & Pengeluaran Breakdown */}
          <div className="flex flex-col space-y-3 shrink-0">
            <div className="flex items-center gap-8 md:gap-12">
              {/* Pemasukan Metric */}
              <div className="flex flex-col space-y-1">
                <span className="flex items-center gap-1.5 text-gray-300 text-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Pemasukan
                </span>
                <span className="font-semibold text-white text-base">{formatMoney(income)}</span>
              </div>
              
              {/* Pengeluaran Metric */}
              <div className="flex flex-col space-y-1">
                <span className="flex items-center gap-1.5 text-gray-300 text-sm">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span> Pengeluaran
                </span>
                <span className="font-semibold text-white text-base">{formatMoney(expense)}</span>
              </div>
            </div>

            {/* Dual-Color Ratio Bar */}
            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden flex">
              <div className="h-full bg-emerald-500" style={{ width: `${income + expense ? (income / (income + expense)) * 100 : 0}%` }}></div>
              <div className="h-full bg-rose-500" style={{ width: `${income + expense ? (expense / (income + expense)) * 100 : 0}%` }}></div>
            </div>
          </div>
        </div>
      </section>
      
      <section className="workspace-card data-card">
        <div className="data-toolbar">
          <div className="filter-tabs">
            {["Semua", "Pemasukan", "Pengeluaran"].map(item => (
              <button key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>{item}</button>
            ))}
          </div>
          <label className="compact-search">
            <Search size={15} />
            <input 
              placeholder="Cari transaksi..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </label>
          <div className="relative inline-block">
            <button 
              className="compact-control hover:bg-slate-50 cursor-pointer" 
              onClick={() => {
                setTempFilterMode(dateFilter.mode);
                setTempPreset(dateFilter.preset);
                setTempMonth(dateFilter.month);
                setTempYear(dateFilter.year);
                setTempStart(dateFilter.start);
                setTempEnd(dateFilter.end);
                setFilterModalOpen(true);
              }}
            >
              <CalendarDays size={15} /> 
              {dateFilter.mode === "preset" 
                ? (dateFilter.preset === "Semua" ? "Semua Transaksi" : dateFilter.preset) 
                : (dateFilter.start && dateFilter.end ? `${new Date(dateFilter.start).toLocaleDateString("id-ID", {day: "numeric", month: "short"})} - ${new Date(dateFilter.end).toLocaleDateString("id-ID", {day: "numeric", month: "short"})}` : "Filter Khusus")}
            </button>
          </div>
        </div>
        
        <div className="w-full overflow-x-auto scrollbar-thin p-6">
          {dateFilter.mode === "preset" && dateFilter.preset === "Semua" && (
            <div className="mb-4 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-md py-1.5 px-3 inline-flex items-center gap-1.5">
              <CircleAlert size={14} /> Menampilkan 150 transaksi terakhir (Default). Gunakan filter tanggal untuk melihat lebih banyak.
            </div>
          )}
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase bg-gray-50 text-gray-700 border-b">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">Tanggal</th>
                <th className="px-4 py-3 whitespace-nowrap">Transaksi</th>
                <th className="px-4 py-3 whitespace-nowrap">Kategori</th>
                <th className="px-4 py-3 whitespace-nowrap">Sumber</th>
                <th className="px-4 py-3 whitespace-nowrap">Status</th>
                <th className="px-4 py-3 whitespace-nowrap text-right">Jumlah</th>
                <th className="px-4 py-3 whitespace-nowrap text-center"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => (
                <tr className="border-b last:border-b-0 hover:bg-gray-50/50" key={row.id}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-900">{formatDate(row.date)}</span>
                      {shouldDisplayTransactionTime(row) && (
                        <span className="text-xs text-gray-500 mt-0.5">{formatTime(row.date)}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-start gap-2">
                      <i className={row.type.toLowerCase() + " mt-0.5"}>
                        {row.type === "INCOME" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                      </i>
                      <div>
                        <span className="font-semibold text-gray-900 block">{row.merchant}</span>
                        {row.notes && (
                          <span
                            className="text-xs text-gray-500 block max-w-[200px] truncate"
                            title={row.notes.replace(/\[NO_TIME\]/g, '').replace(/\[UNMATCHED_BANK:[^\]]+\]/g, '').trim()}
                          >
                            {row.notes.replace(/\[NO_TIME\]/g, '').replace(/\[UNMATCHED_BANK:[^\]]+\]/g, '').trim()}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">{row.category}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex flex-col gap-1 items-start">
                      {(() => {
                        const sdRaw = (row as any).sumber_dana || 'Tunai';
                        return (
                          <div className="flex items-center gap-2">
                            <BankLogo bankName={sdRaw} className="w-10 h-6 rounded shrink-0 shadow-sm" />
                            <span className="font-medium text-gray-800 text-xs">{sdRaw}</span>
                          </div>
                        );
                      })()}
                      <span className="text-[11px] text-gray-500">
                        {row.source === 'AUTOMATIC_EMAIL' ? 'via Email Bank' : row.source === 'MANUAL_CHAT' ? 'via AI Chat' : 'via Manual'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.status === 'APPROVED' ? (
                      <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-medium"><CheckCircle2 size={12}/> Disetujui</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 px-2 py-1 rounded-full text-xs font-medium"><CircleAlert size={12}/> Menunggu</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right font-medium">
                    <span style={{ color: row.type === 'INCOME' ? '#16a34a' : 'inherit' }}>
                      {row.type === "INCOME" ? "+" : "−"}{formatMoney(row.amount)}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center text-gray-400">
                    {row.status === 'PENDING_APPROVAL' ? (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEditModal(row)} className="text-gray-400 hover:text-blue-600 cursor-pointer hover:bg-slate-100 p-1.5 rounded-lg transition-colors"><MoreHorizontal size={16} /></button>
                        <button onClick={() => approveTransaction(row)} className="button primary" style={{ padding: '4px 8px', fontSize: '12px' }}><CheckCircle2 size={14}/> Setujui</button>
                      </div>
                    ) : (
                      <button onClick={() => openEditModal(row)} className="text-gray-400 hover:text-blue-600 cursor-pointer hover:bg-slate-100 p-1.5 rounded-lg transition-colors"><MoreHorizontal size={16} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {addOpen && (
        <div className="modal-scrim" onClick={() => setAddOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-dialog relative w-full max-w-lg bg-white rounded-2xl md:rounded-3xl shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()} style={{ overflow: 'visible' }}>
            <div className="modal-header flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 rounded-t-2xl md:rounded-t-3xl">
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><CircleDollarSign size={19} /> Catat transaksi</h3>
            </div>
            <form onSubmit={createTransaction}>
              <div className="form-grid" style={{ padding: '24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Tipe</span>
                  <CustomSelect
                    name="type"
                    value={addType}
                    onChange={setAddType}
                    options={typeOptions}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Tanggal</span>
                  <CustomDatePicker
                    name="date"
                    value={addDate}
                    onChange={setAddDate}
                  />
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Nama transaksi / Merchant</span>
                  <input name="name" placeholder="Contoh: Beli Makan" required style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Jumlah (Rp)</span>
                  <input name="amount" type="number" min="1" placeholder="0" required style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Kategori</span>
                  <CustomSelect
                    name="category_id"
                    value={addCategoryId || (categoryOptions[0]?.value ?? "")}
                    onChange={setAddCategoryId}
                    options={categoryOptions}
                    placeholder="Pilih Kategori"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Sumber Dana</span>
                  <CustomSelect
                    name="sumber_dana"
                    value={addSumberDana}
                    onChange={setAddSumberDana}
                    options={sumberDanaOptions}
                    placeholder="Pilih Sumber Dana"
                  />
                </div>
              </div>
              <div className="modal-actions rounded-b-2xl md:rounded-b-3xl" style={{ padding: '16px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#f8fafc' }}>
                <button type="button" className="button secondary" onClick={() => setAddOpen(false)}>Batal</button>
                <button type="submit" className="button primary">Simpan transaksi</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editRow && (
        <div className="modal-scrim" onClick={() => setEditRow(null)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-dialog relative w-full max-w-md bg-white rounded-2xl md:rounded-3xl shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()} style={{ overflow: 'visible' }}>
            <div className="modal-header flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 rounded-t-2xl md:rounded-t-3xl">
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>Edit Transaksi</h3>
            </div>
            <form onSubmit={updateTransaction}>
              <div className="form-grid" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600 }}>{editRow.merchant}</p>
                  <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>{formatMoney(editRow.amount)}</p>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Kategori</span>
                  <CustomSelect
                    name="category_id"
                    value={editCategoryId}
                    onChange={setEditCategoryId}
                    options={categoryOptions}
                    placeholder="Pilih Kategori"
                  />
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Sumber Dana</span>
                  <CustomSelect
                    name="sumber_dana"
                    value={editSumberDana}
                    onChange={setEditSumberDana}
                    options={sumberDanaOptions}
                    placeholder="Pilih Sumber Dana"
                  />
                </div>
                
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Catatan / Keyword (opsional)</span>
                  <textarea name="notes" defaultValue={editRow.notes || ""} placeholder="Contoh: Bayar Netflix" rows={2} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc', resize: 'none' }} />
                </label>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                    <input type="checkbox" name="save_rule" checked={saveRule} onChange={e => setSaveRule(e.target.checked)} style={{ marginTop: '3px' }} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Gunakan kategori & keyword ini seterusnya</span>
                      <span style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Transaksi masa depan dari {editRow.merchant} akan otomatis dikategorikan seperti ini.</span>
                    </div>
                  </label>
                  
                  {saveRule && (
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', paddingLeft: '20px' }}>
                      <input type="checkbox" name="retroactive" style={{ marginTop: '3px' }} />
                      <span style={{ fontSize: '12px', fontWeight: 500, color: '#475569' }}>Terapkan juga ke semua transaksi {editRow.merchant} sebelumnya</span>
                    </label>
                  )}
                </div>
              </div>
              <div className="modal-actions rounded-b-2xl md:rounded-b-3xl" style={{ padding: '16px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#f8fafc' }}>
                <button type="button" className="button secondary" onClick={() => { setEditRow(null); setSaveRule(false); }}>Batal</button>
                <button type="submit" className="button primary">Simpan</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {filterModalOpen && (
        <div className="modal-scrim" onClick={() => setFilterModalOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-dialog relative w-full max-w-lg bg-white rounded-2xl md:rounded-3xl shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()} style={{ overflow: 'visible' }}>
            <div className="modal-header rounded-t-2xl md:rounded-t-3xl" style={{ padding: '20px 24px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 600 }}><Filter size={18} /> Filter Tanggal & Rentang Waktu</h3>
              <button onClick={() => setFilterModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
            </div>
            <div style={{ padding: '24px' }}>
              {/* Mode 1: Quick Preset */}
              <div style={{ marginBottom: '16px' }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569', display: 'block', marginBottom: '8px' }}>Pilih Cepat</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {["Semua", "Hari Ini", "Minggu Ini", "Bulan Ini", "Tahun Ini"].map(preset => (
                    <button 
                      key={preset}
                      type="button"
                      onClick={() => {
                        setTempFilterMode("preset");
                        setTempPreset(preset);
                      }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: 500,
                        border: tempFilterMode === "preset" && tempPreset === preset ? '1px solid #2563eb' : '1px solid #cbd5e1',
                        background: tempFilterMode === "preset" && tempPreset === preset ? '#eff6ff' : 'white',
                        color: tempFilterMode === "preset" && tempPreset === preset ? '#1d4ed8' : '#475569',
                        cursor: 'pointer'
                      }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Mode 2: Specific Month & Year */}
              <div style={{ marginBottom: '16px', padding: '16px', background: tempFilterMode === "monthYear" ? '#eff6ff' : '#f8fafc', borderRadius: '8px', border: tempFilterMode === "monthYear" ? '1px solid #2563eb' : '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: tempFilterMode === "monthYear" ? '#1d4ed8' : '#334155', display: 'block', marginBottom: '12px' }}>Pilih Bulan & Tahun Spesifik</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <CustomSelect
                    value={tempMonth}
                    onChange={(val) => {
                      setTempFilterMode("monthYear");
                      setTempMonth(val);
                    }}
                    options={monthOptions}
                    placeholder="Bulan"
                  />
                  <CustomSelect
                    value={tempYear}
                    onChange={(val) => {
                      setTempFilterMode("monthYear");
                      setTempYear(val);
                    }}
                    options={yearOptions}
                    placeholder="Tahun"
                  />
                </div>
              </div>
              
              {/* Mode 3: Custom Date Range */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', padding: '16px', background: tempFilterMode === "custom" ? '#eff6ff' : 'transparent', borderRadius: '8px', border: tempFilterMode === "custom" ? '1px solid #2563eb' : '1px solid transparent' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: tempFilterMode === "custom" ? '#1d4ed8' : '#475569' }}>Tanggal Mulai</span>
                  <CustomDatePicker
                    value={tempStart}
                    onChange={(newStart) => {
                      setTempFilterMode("custom");
                      let newEnd = tempEnd;
                      if (!newEnd || new Date(newEnd) < new Date(newStart)) {
                        newEnd = newStart;
                      }
                      setTempStart(newStart);
                      setTempEnd(newEnd);
                    }}
                    placeholder="dd/mm/yyyy"
                    position="top"
                    align="left"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: tempFilterMode === "custom" ? '#1d4ed8' : '#475569' }}>Tanggal Akhir</span>
                  <CustomDatePicker
                    value={tempEnd}
                    onChange={(newEnd) => {
                      setTempFilterMode("custom");
                      setTempEnd(newEnd);
                    }}
                    placeholder="dd/mm/yyyy"
                    position="top"
                    align="right"
                  />
                </div>
              </div>
            </div>
            
            <div className="modal-actions rounded-b-2xl md:rounded-b-3xl" style={{ padding: '16px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
              <button 
                type="button" 
                className="button text-button" 
                style={{ color: '#64748b', fontWeight: 500 }}
                onClick={() => {
                  setTempFilterMode("preset");
                  setTempPreset("Semua");
                  setTempMonth("");
                  setTempYear("");
                  setTempStart("");
                  setTempEnd("");
                }}
              >
                Reset
              </button>
              <button 
                type="button" 
                className="button primary"
                onClick={() => {
                  let finalStart = "";
                  let finalEnd = "";
                  if (tempFilterMode === "preset") {
                    if (tempPreset !== "Semua") {
                      const dates = getPresetDates(tempPreset);
                      finalStart = dates.start;
                      finalEnd = dates.end;
                    }
                  } else if (tempFilterMode === "monthYear") {
                    if (tempMonth !== "" && tempYear !== "") {
                      const y = parseInt(tempYear);
                      const m = parseInt(tempMonth);
                      finalStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
                      finalEnd = `${y}-${String(m + 1).padStart(2, '0')}-${new Date(y, m + 1, 0).getDate()}`;
                    }
                  } else {
                    finalStart = tempStart;
                    finalEnd = tempEnd;
                  }
                  
                  setDateFilter({ 
                    mode: tempFilterMode, 
                    preset: tempPreset, 
                    month: tempMonth, 
                    year: tempYear, 
                    start: finalStart, 
                    end: finalEnd 
                  });
                  setFilterModalOpen(false);
                }}
              >
                Terapkan Filter
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
