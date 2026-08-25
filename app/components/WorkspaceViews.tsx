"use client";

import {
  ArrowLeft,
  ArrowLeftRight,
  CalendarDays,
  BadgeDollarSign,
  BriefcaseBusiness,
  CarFront,
  ChevronRight,
  CircleDollarSign,
  Download,
  Filter,
  Gift,
  LayoutGrid,
  Mail,
  MonitorSmartphone,
  MoreHorizontal,
  PiggyBank,
  PencilLine,
  Plus,
  ReceiptText,
  Search,
  CheckCircle2,
  CircleAlert,
  Bot,
  ShoppingBag,
  Utensils,
  Wallet,
  CreditCard,
  Smartphone,
  Ticket,
  X
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
const formatDate = (value: string) => new Date(value).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
const formatTime = (value: string) => new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).replace('.', ':') + " WIB";
const formatTransactionDay = (value: string) => new Date(value).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
const cleanTransactionNotes = (notes?: string | null) => notes?.replace(/\[NO_TIME\]/g, '').replace(/\[UNMATCHED_BANK:[^\]]+\]/g, '').trim() || '';
const getTransactionSourceLabel = (source: Transaction['source']) => source === 'AUTOMATIC_EMAIL' ? 'Email Bank' : source === 'MANUAL_CHAT' ? 'AI Chat' : 'Manual';
const getTransactionDateTimeLabel = (row: Pick<Transaction, 'date' | 'source' | 'notes'>) => `${formatDate(row.date)}${shouldDisplayTransactionTime(row) ? ` · ${formatTime(row.date).replace(' WIB', '')}` : ''}`;

function CategoryIcon({ category, size = 12 }: { category: string; size?: number }) {
  const normalized = (category || '').toLocaleLowerCase('id-ID');
  if (normalized.includes('makanan') || normalized.includes('minuman')) return <Utensils size={size} />;
  if (normalized.includes('transport')) return <CarFront size={size} />;
  if (normalized.includes('belanja')) return <ShoppingBag size={size} />;
  if (normalized.includes('tagihan') || normalized.includes('biaya admin')) return <ReceiptText size={size} />;
  if (normalized.includes('barang digital')) return <MonitorSmartphone size={size} />;
  if (normalized.includes('hiburan')) return <Ticket size={size} />;
  if (normalized.includes('transfer')) return <ArrowLeftRight size={size} />;
  if (normalized.includes('jasa')) return <BriefcaseBusiness size={size} />;
  if (normalized.includes('gaji')) return <BadgeDollarSign size={size} />;
  if (normalized.includes('bonus')) return <Gift size={size} />;
  if (normalized.includes('nabung')) return <PiggyBank size={size} />;
  return <LayoutGrid size={size} />;
}

function TransactionSourceIcon({ source, size = 13 }: { source: Transaction['source']; size?: number }) {
  if (source === 'AUTOMATIC_EMAIL') return <Mail size={size} />;
  if (source === 'MANUAL_CHAT') return <Bot size={size} />;
  return <PencilLine size={size} />;
}

function TransactionBankLogo({ bankName, className = "" }: { bankName: string; className?: string }) {
  return (
    <div className={`transaction-logo-frame ${className}`}>
      <BankLogo bankName={bankName} className="transaction-logo-mark" />
    </div>
  );
}

type DisplayTransaction = Transaction & { sumber_dana?: string; category_id?: string };

const subscribeMobileViewport = (onStoreChange: () => void) => {
  const mediaQuery = window.matchMedia("(max-width: 760px)");
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
};

const getMobileViewportSnapshot = () => window.matchMedia("(max-width: 760px)").matches;
const getServerMobileViewportSnapshot = () => false;

function TransactionDetailSections({ row }: { row: DisplayTransaction }) {
  return (
    <div className="transaction-detail-content">
      <section className="transaction-detail-summary" aria-labelledby="transaction-summary-heading">
        <span className="transaction-detail-section-label" id="transaction-summary-heading">Ringkasan</span>
        <div className="transaction-detail-summary-main">
          <TransactionBankLogo bankName={row.sumber_dana || 'Tunai'} className="transaction-detail-logo" />
          <div className="transaction-detail-primary-copy">
            <h3>{row.merchant}</h3>
            <div className="transaction-detail-meta">
              <span className="transaction-detail-type">{row.type === 'INCOME' ? 'Pemasukan' : 'Pengeluaran'}</span>
              {row.status === 'APPROVED' ? (
                <span className="transaction-status approved"><CheckCircle2 size={12}/> Disetujui</span>
              ) : (
                <span className="transaction-status pending"><CircleAlert size={12}/> Menunggu persetujuan</span>
              )}
            </div>
          </div>
          <strong className={`transaction-detail-amount ${row.type === 'INCOME' ? 'income' : 'expense'}`}>{row.type === 'INCOME' ? '+' : '−'}{formatMoney(row.amount)}</strong>
        </div>
      </section>

      <section className="transaction-detail-section" aria-labelledby="transaction-information-heading">
        <h3 id="transaction-information-heading">Informasi transaksi</h3>
        <dl className="transaction-detail-list">
          <div><dt><CalendarDays size={14} />Tanggal & waktu</dt><dd>{getTransactionDateTimeLabel(row)}</dd></div>
          <div><dt><CategoryIcon category={row.category} size={13} />Kategori</dt><dd>{row.category}</dd></div>
          <div><dt><Wallet size={14} />Rekening</dt><dd>{row.sumber_dana || 'Tunai'}</dd></div>
          <div><dt><TransactionSourceIcon source={row.source} />Sumber pencatatan</dt><dd>{getTransactionSourceLabel(row.source)}</dd></div>
        </dl>
      </section>

      <section className="transaction-detail-section transaction-detail-additional" aria-labelledby="transaction-additional-heading">
        <h3 id="transaction-additional-heading">Detail tambahan</h3>
        {cleanTransactionNotes(row.notes) ? <p>{cleanTransactionNotes(row.notes)}</p> : <p className="empty">Tidak ada catatan tambahan.</p>}
      </section>
    </div>
  );
}

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
  return <div className={`workspace-page ${active}-workspace-page`}>{children}</div>;
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
  const [detailRow, setDetailRow] = useState<DisplayTransaction | null>(null);
  const isMobileViewport = useSyncExternalStore(
    subscribeMobileViewport,
    getMobileViewportSnapshot,
    getServerMobileViewportSnapshot,
  );
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
  const [isLoading, setIsLoading] = useState(cachedWorkspaceTx.length === 0);
  const [loadError, setLoadError] = useState(false);
  const [categories, setCategories] = useState<{id: string, name: string}[]>(cachedCategories);
  const [accounts, setAccounts] = useState<any[]>(cachedAccounts);
  const [primaryAccount, setPrimaryAccount] = useState<any>(cachedPrimaryAccount);
  const { user, business } = useDouit();
  const listScrollPositionRef = useRef(0);
  const advancedOptionRef = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    if (!saveRule) return;
    const frame = window.requestAnimationFrame(() => {
      advancedOptionRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [saveRule]);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    
    const fetchTransactions = async () => {
      setIsLoading(true);
      setLoadError(false);
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
        
      const { data, error } = await query;
        
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
      setLoadError(Boolean(error));
      setIsLoading(false);
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

  const restoreTransactionListPosition = () => {
    if (!isMobileViewport) return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: listScrollPositionRef.current, behavior: "auto" });
    });
  };

  const openTransactionDetail = (row: DisplayTransaction) => {
    if (isMobileViewport) listScrollPositionRef.current = window.scrollY;
    setDetailRow(row);
  };

  const closeTransactionDetail = () => {
    setDetailRow(null);
    restoreTransactionListPosition();
  };

  const typeOptions = [
    { value: "EXPENSE", label: "Pengeluaran" },
    { value: "INCOME", label: "Pemasukan" }
  ];

  const categoryOptions = categories
    .filter(c => c.name !== 'Nabung')
    .map(c => ({ value: c.id, label: c.name, icon: <CategoryIcon category={c.name} /> }));

  const sumberDanaOptions = [
    { value: "Tunai", label: "Tunai", icon: <TransactionBankLogo bankName="Tunai" className="transaction-select-bank-logo" /> },
    { value: "Bank BCA", label: "Bank BCA", icon: <TransactionBankLogo bankName="Bank BCA" className="transaction-select-bank-logo" /> },
    { value: "Bank Mandiri", label: "Bank Mandiri", icon: <TransactionBankLogo bankName="Bank Mandiri" className="transaction-select-bank-logo" /> },
    { value: "Bank BRI", label: "Bank BRI", icon: <TransactionBankLogo bankName="Bank BRI" className="transaction-select-bank-logo" /> },
    { value: "Bank BNI", label: "Bank BNI", icon: <TransactionBankLogo bankName="Bank BNI" className="transaction-select-bank-logo" /> },
    { value: "GoPay", label: "GoPay", icon: <TransactionBankLogo bankName="GoPay" className="transaction-select-bank-logo" /> },
    { value: "OVO", label: "OVO", icon: <TransactionBankLogo bankName="OVO" className="transaction-select-bank-logo" /> },
    { value: "Dana", label: "Dana", icon: <TransactionBankLogo bankName="Dana" className="transaction-select-bank-logo" /> },
    { value: "ShopeePay", label: "ShopeePay", icon: <TransactionBankLogo bankName="ShopeePay" className="transaction-select-bank-logo" /> },
    { value: "Lainnya", label: "Lainnya", icon: <TransactionBankLogo bankName="Lainnya" className="transaction-select-bank-logo" /> }
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

  const isDefaultDateFilter = dateFilter.mode === "preset" && dateFilter.preset === "Semua";
  const activeDateFilterLabel = isDefaultDateFilter
    ? ""
    : dateFilter.mode === "preset"
      ? dateFilter.preset
      : dateFilter.mode === "monthYear" && dateFilter.month !== "" && dateFilter.year
        ? `${monthOptions.find(option => option.value === dateFilter.month)?.label || "Bulan"} ${dateFilter.year}`
        : dateFilter.start && dateFilter.end
          ? `${new Date(dateFilter.start).toLocaleDateString("id-ID", {day: "numeric", month: "short"})} – ${new Date(dateFilter.end).toLocaleDateString("id-ID", {day: "numeric", month: "short", year: "numeric"})}`
          : "Periode khusus";
  const groupedMobileRows = filteredRows.reduce<{ label: string; rows: Transaction[] }[]>((groups, row) => {
    const label = formatTransactionDay(row.date);
    const currentGroup = groups[groups.length - 1];
    if (currentGroup?.label === label) currentGroup.rows.push(row);
    else groups.push({ label, rows: [row] });
    return groups;
  }, []);
  const emptyStateMessage = searchQuery
    ? `Tidak ada transaksi yang cocok dengan “${searchQuery}”.`
    : !isDefaultDateFilter
      ? "Tidak ada transaksi pada periode ini."
      : kind !== "Semua"
        ? `Belum ada transaksi ${kind.toLowerCase()}.`
        : "Belum ada transaksi. Catat transaksi pertamamu untuk memulai.";
  const emptyStateHint = searchQuery || !isDefaultDateFilter || kind !== "Semua"
    ? "Ubah pencarian atau filter untuk melihat transaksi lain."
    : "Gunakan tombol Catat transaksi untuk menambahkan aktivitas keuangan.";

  if (detailRow && isMobileViewport) {
    return (
      <main className="transaction-mobile-detail-page">
        <header className="transaction-mobile-detail-header">
          <button type="button" className="transaction-detail-back" onClick={closeTransactionDetail}><ArrowLeft size={18} /> Transaksi</button>
        </header>
        <TransactionDetailSections row={detailRow} />
        <footer className="transaction-detail-actions transaction-mobile-detail-actions">
          <button
            type="button"
            className="button secondary transaction-detail-edit-button"
            onClick={() => {
              const row = detailRow;
              setDetailRow(null);
              restoreTransactionListPosition();
              openEditModal(row);
            }}
          >
            <PencilLine size={16} /> Edit transaksi
          </button>
          {detailRow.status === 'PENDING_APPROVAL' && (
            <button
              type="button"
              className="button primary"
              onClick={() => {
                void approveTransaction(detailRow);
                setDetailRow(null);
                restoreTransactionListPosition();
              }}
            >
              <CheckCircle2 size={16} /> Setujui
            </button>
          )}
        </footer>
      </main>
    );
  }

  return (
    <Shell active="transactions">
      <WorkspaceHeader 
        eyebrow="Aktivitas keuangan"
        title="Transaksi" 
        description="Pantau semua pemasukan dan pengeluaranmu di satu tempat."
        actions={
          <>
            <button className="button primary transactions-add-button" onClick={openAddModal}><Plus size={16} /> Catat transaksi</button>
            <button className="button secondary transactions-export-button" onClick={handleExportCSV} aria-label="Ekspor transaksi ke CSV"><Download size={16} /> <span>Ekspor CSV</span></button>
          </>
        } 
      />
      <section className="balance-card transactions-balance-card" aria-label="Ringkasan saldo transaksi">
        <div className="transactions-balance-main">
          <span className="transactions-balance-label">Saldo Bersih</span>
          <h2>{formatMoney(net_balance)}</h2>
          <span className="transactions-account-context">
            {primaryAccount ? (
              <>{primaryAccount.type === 'bank' ? <CreditCard /> : primaryAccount.type === 'wallet' ? <Smartphone /> : <Wallet />} {primaryAccount.name} · Rekening utama</>
            ) : (
              <><Wallet /> Total seluruh rekening</>
            )}
          </span>
        </div>
        <div className="transactions-balance-breakdown">
          <div className="transactions-balance-metrics">
            <div><span><i className="income-dot" />Pemasukan</span><strong>{formatMoney(income)}</strong></div>
            <div><span><i className="expense-dot" />Pengeluaran</span><strong>{formatMoney(expense)}</strong></div>
          </div>
          <div className="transactions-comparison-bar" aria-label="Perbandingan pemasukan dan pengeluaran">
            <i className="income-bar" style={{ width: `${income + expense ? (income / (income + expense)) * 100 : 0}%` }} />
            <i className="expense-bar" style={{ width: `${income + expense ? (expense / (income + expense)) * 100 : 0}%` }} />
          </div>
        </div>
      </section>
      
      <section className="workspace-card data-card transactions-data-card">
        <div className="data-toolbar transactions-toolbar">
          <div className="filter-tabs transactions-type-filter" role="group" aria-label="Filter tipe transaksi">
            {["Semua", "Pemasukan", "Pengeluaran"].map(item => (
              <button key={item} type="button" aria-pressed={kind === item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>{item}</button>
            ))}
          </div>
          <label className="compact-search transactions-search">
            <Search size={15} />
            <input 
              placeholder="Cari transaksi..." 
              aria-label="Cari transaksi"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={`compact-control transactions-filter-button ${activeDateFilterLabel ? "active" : ""}`}
            aria-label={activeDateFilterLabel ? `Ubah filter tanggal: ${activeDateFilterLabel}` : "Filter tanggal"}
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
            <span>{activeDateFilterLabel || "Periode"}</span>
          </button>
        </div>
        {activeDateFilterLabel && (
          <div className="transactions-active-filter">
            <span>{activeDateFilterLabel}</span>
            <button type="button" aria-label={`Hapus filter ${activeDateFilterLabel}`} onClick={() => setDateFilter({mode: "preset", preset: "Semua", month: "", year: "", start: "", end: ""})}><X size={13} /></button>
          </div>
        )}

        <div className="transactions-list-area">
          {isDefaultDateFilter && (
            <div className="transactions-limit-info">
              <CircleAlert size={14} /> <span>150 transaksi terbaru ditampilkan. Gunakan filter periode untuk melihat lainnya.</span>
            </div>
          )}
          {isLoading && rows.length === 0 ? (
            <div className="transactions-state" role="status">Memuat transaksi…</div>
          ) : loadError && rows.length === 0 ? (
            <div className="transactions-state" role="alert"><strong>Transaksi belum dapat dimuat.</strong><span>Coba muat ulang halaman beberapa saat lagi.</span></div>
          ) : filteredRows.length === 0 ? (
            <div className="transactions-state"><strong>{emptyStateMessage}</strong><span>{emptyStateHint}</span></div>
          ) : (
            <>
          <table className="transactions-desktop-table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Transaksi</th>
                <th>Kategori</th>
                <th>Rekening & sumber</th>
                <th>Status</th>
                <th className="amount-column">Jumlah</th>
                <th><span className="sr-only">Aksi</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => (
                <tr key={row.id}>
                  <td className="transaction-date-cell">
                    <div>
                      <span>{formatDate(row.date)}</span>
                      {shouldDisplayTransactionTime(row) && (
                        <small>{formatTime(row.date)}</small>
                      )}
                    </div>
                  </td>
                  <td className="transaction-name-cell">
                    <div className="transaction-name-wrap">
                      <i className="transaction-direction transaction-category-mark">
                        <CategoryIcon category={row.category} />
                      </i>
                      <div className="transaction-copy">
                        <strong>{row.merchant}</strong>
                        {cleanTransactionNotes(row.notes) && (
                          <small title={cleanTransactionNotes(row.notes)}>{cleanTransactionNotes(row.notes)}</small>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="transaction-category-cell"><span><CategoryIcon category={row.category} />{row.category}</span></td>
                  <td className="transaction-account-cell">
                    <div>
                      <TransactionBankLogo bankName={(row as any).sumber_dana || 'Tunai'} className="transaction-bank-logo" />
                      <span><strong>{(row as any).sumber_dana || 'Tunai'}</strong><small>via {getTransactionSourceLabel(row.source)}</small></span>
                    </div>
                  </td>
                  <td className="transaction-status-cell">
                    {row.status === 'APPROVED' ? (
                      <span className="transaction-status approved"><CheckCircle2 size={12}/> Disetujui</span>
                    ) : (
                      <span className="transaction-status pending"><CircleAlert size={12}/> Menunggu</span>
                    )}
                  </td>
                  <td className={`transaction-amount ${row.type === "INCOME" ? "income" : "expense"}`}>
                    {row.type === "INCOME" ? "+" : "−"}{formatMoney(row.amount)}
                  </td>
                  <td className="transaction-actions-cell">
                    {row.status === 'PENDING_APPROVAL' ? (
                      <div>
                        <button type="button" onClick={() => openEditModal(row)} className="transaction-menu-button" aria-label={`Edit transaksi ${row.merchant}`}><MoreHorizontal size={17} /></button>
                        <button type="button" onClick={() => approveTransaction(row)} className="transaction-approve-button"><CheckCircle2 size={14}/> Setujui</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => openEditModal(row)} className="transaction-menu-button" aria-label={`Edit transaksi ${row.merchant}`}><MoreHorizontal size={17} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="transactions-mobile-feed">
            {groupedMobileRows.map(group => (
              <section className="transaction-day-group" key={group.label} aria-labelledby={`transaction-day-${group.rows[0].id}`}>
                <h3 id={`transaction-day-${group.rows[0].id}`}>{group.label}</h3>
                <div>
                  {group.rows.map(row => (
                    <button type="button" className="transaction-feed-item" key={row.id} onClick={() => openTransactionDetail(row)} aria-label={`Lihat detail transaksi ${row.merchant}`}>
                      <TransactionBankLogo bankName={(row as any).sumber_dana || 'Tunai'} className="transaction-feed-logo" />
                      <span className="transaction-feed-copy">
                        <strong>{row.merchant}</strong>
                        <small>{getTransactionDateTimeLabel(row)}</small>
                      </span>
                      <span className={`transaction-feed-amount ${row.type === "INCOME" ? "income" : "expense"}`}>{row.type === "INCOME" ? "+" : "−"}{formatMoney(row.amount)}</span>
                      <ChevronRight className="transaction-feed-chevron" size={18} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
            </>
          )}
        </div>
      </section>

      {detailRow && !isMobileViewport && (
        <div className="modal-scrim transaction-detail-scrim" onClick={closeTransactionDetail}>
          <section className="transaction-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="transaction-detail-title" onClick={event => event.stopPropagation()}>
            <header className="transaction-detail-header">
              <div className="transaction-detail-heading">
                <span>Detail transaksi</span>
                <h2 id="transaction-detail-title">Informasi lengkap</h2>
              </div>
              <button type="button" className="transaction-modal-close" onClick={closeTransactionDetail} aria-label="Tutup detail transaksi"><X size={19} /></button>
            </header>
            <TransactionDetailSections row={detailRow} />
            <footer className="transaction-detail-actions">
              <button type="button" className="button secondary" onClick={() => { const row = detailRow; setDetailRow(null); openEditModal(row); }}><PencilLine size={16} /> Edit transaksi</button>
              {detailRow.status === 'PENDING_APPROVAL' && (
                <button type="button" className="button primary" onClick={() => { void approveTransaction(detailRow); setDetailRow(null); }}><CheckCircle2 size={16} /> Setujui</button>
              )}
            </footer>
          </section>
        </div>
      )}

      {addOpen && (
        <div className="modal-scrim transaction-modal-scrim" onClick={() => setAddOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-dialog transaction-modal-dialog transaction-add-dialog relative w-full max-w-lg bg-white rounded-2xl md:rounded-3xl shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="modal-header transaction-modal-header flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 rounded-t-2xl md:rounded-t-3xl">
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><CircleDollarSign size={19} /> Catat transaksi</h3>
              <button type="button" className="transaction-modal-close" onClick={() => setAddOpen(false)} aria-label="Tutup form catat transaksi"><X size={19} /></button>
            </div>
            <form className="transaction-modal-form" onSubmit={createTransaction}>
              <div className="form-grid transaction-modal-fields transaction-add-fields" style={{ padding: '24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="transaction-primary-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Tipe</span>
                  <CustomSelect
                    name="type"
                    value={addType}
                    onChange={setAddType}
                    options={typeOptions}
                    responsiveOverlay
                    selectionTitle="Pilih tipe transaksi"
                  />
                </div>
                <label className="transaction-primary-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Jumlah (Rp)</span>
                  <input name="amount" type="number" min="1" inputMode="numeric" placeholder="0" required style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Nama transaksi / merchant</span>
                  <input name="name" placeholder="Contoh: Beli Makan" required style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Tanggal</span>
                  <CustomDatePicker name="date" value={addDate} onChange={setAddDate} responsiveOverlay selectionTitle="Pilih tanggal transaksi" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Kategori</span>
                  <CustomSelect
                    name="category_id"
                    value={addCategoryId || (categoryOptions[0]?.value ?? "")}
                    onChange={setAddCategoryId}
                    options={categoryOptions}
                    placeholder="Pilih Kategori"
                    responsiveOverlay
                    selectionTitle="Pilih kategori"
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
                    responsiveOverlay
                    selectionTitle="Pilih sumber dana"
                  />
                </div>
              </div>
              <div className="modal-actions transaction-modal-actions rounded-b-2xl md:rounded-b-3xl" style={{ padding: '16px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#f8fafc' }}>
                <button type="button" className="button secondary" onClick={() => setAddOpen(false)}>Batal</button>
                <button type="submit" className="button primary">Simpan transaksi</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editRow && (
        <div className="modal-scrim transaction-modal-scrim" onClick={() => setEditRow(null)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-dialog transaction-modal-dialog transaction-edit-dialog relative w-full max-w-md bg-white rounded-2xl md:rounded-3xl shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="modal-header transaction-modal-header flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 rounded-t-2xl md:rounded-t-3xl">
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><PencilLine size={18} /> Edit transaksi</h3>
              <button type="button" className="transaction-modal-close" onClick={() => { setEditRow(null); setSaveRule(false); }} aria-label="Tutup form edit transaksi"><X size={19} /></button>
            </div>
            <form className="transaction-modal-form" onSubmit={updateTransaction}>
              <div className="form-grid transaction-modal-fields transaction-edit-fields" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <section className="transaction-edit-summary" aria-label="Ringkasan transaksi yang diedit">
                  <span>Ringkasan</span>
                  <div>
                    <div>
                      <p>{editRow.merchant}</p>
                      <small>{editRow.type === 'INCOME' ? 'Pemasukan' : 'Pengeluaran'} · {getTransactionDateTimeLabel(editRow)}</small>
                    </div>
                    <strong className={editRow.type === 'INCOME' ? 'income' : 'expense'}>{editRow.type === 'INCOME' ? '+' : '−'}{formatMoney(editRow.amount)}</strong>
                  </div>
                </section>
                <span className="transaction-edit-section-label">Informasi yang dapat diubah</span>
                <div className="transaction-edit-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span className="transaction-edit-field-heading" style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}><CategoryIcon category={(categories.find(category => category.id === editCategoryId)?.name || editRow.category)} />Kategori</span>
                  <CustomSelect
                    name="category_id"
                    value={editCategoryId}
                    onChange={setEditCategoryId}
                    options={categoryOptions}
                    placeholder="Pilih Kategori"
                    responsiveOverlay
                    selectionTitle="Pilih kategori"
                  />
                </div>
                
                <div className="transaction-edit-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Sumber Dana</span>
                  <CustomSelect
                    name="sumber_dana"
                    value={editSumberDana}
                    onChange={setEditSumberDana}
                    options={sumberDanaOptions}
                    placeholder="Pilih Sumber Dana"
                    responsiveOverlay
                    selectionTitle="Pilih sumber dana"
                  />
                </div>
                
                <label className="transaction-edit-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Catatan / kata kunci (opsional)</span>
                  <textarea name="notes" defaultValue={editRow.notes || ""} placeholder="Contoh: Bayar Netflix" rows={2} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc', resize: 'none' }} />
                </label>

                <div className="transaction-rule-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                    <input className="transaction-rule-checkbox" type="checkbox" name="save_rule" checked={saveRule} onChange={e => setSaveRule(e.target.checked)} style={{ marginTop: '3px' }} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Gunakan kategori & keyword ini seterusnya</span>
                      <span style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Transaksi masa depan dari {editRow.merchant} akan otomatis dikategorikan seperti ini.</span>
                    </div>
                  </label>
                  
                  {saveRule && (
                    <label ref={advancedOptionRef} className="transaction-rule-secondary" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', paddingLeft: '20px' }}>
                      <input className="transaction-rule-checkbox" type="checkbox" name="retroactive" style={{ marginTop: '3px' }} />
                      <span style={{ fontSize: '12px', fontWeight: 500, color: '#475569' }}>Terapkan juga ke semua transaksi {editRow.merchant} sebelumnya</span>
                    </label>
                  )}
                </div>
              </div>
              <div className="modal-actions transaction-modal-actions rounded-b-2xl md:rounded-b-3xl" style={{ padding: '16px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#f8fafc' }}>
                <button type="button" className="button secondary" onClick={() => { setEditRow(null); setSaveRule(false); }}>Batal</button>
                <button type="submit" className="button primary">Simpan perubahan</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {filterModalOpen && (
        <div className="modal-scrim transaction-modal-scrim" onClick={() => setFilterModalOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-dialog transaction-modal-dialog transaction-filter-dialog relative w-full max-w-lg bg-white rounded-2xl md:rounded-3xl shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="modal-header transaction-modal-header rounded-t-2xl md:rounded-t-3xl" style={{ padding: '20px 24px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 600 }}><Filter size={18} /> Filter periode</h3>
              <button type="button" className="transaction-modal-close" onClick={() => setFilterModalOpen(false)} aria-label="Tutup filter"><X size={19} /></button>
            </div>
            <div className="transaction-filter-content" style={{ padding: '24px' }}>
              {/* Mode 1: Quick Preset */}
              <div className="transaction-filter-section transaction-filter-presets" style={{ marginBottom: '16px' }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569', display: 'block', marginBottom: '8px' }}>Cepat</span>
                <div className="transaction-filter-preset-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {["Semua", "Hari Ini", "Minggu Ini", "Bulan Ini", "Tahun Ini"].map(preset => (
                    <button 
                      key={preset}
                      type="button"
                      onClick={() => {
                        setTempFilterMode("preset");
                        setTempPreset(preset);
                      }}
                      className={tempFilterMode === "preset" && tempPreset === preset ? "active" : ""}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Mode 2: Specific Month & Year */}
              <div className={`transaction-filter-section ${tempFilterMode === "monthYear" ? "active" : ""}`} style={{ marginBottom: '16px', padding: '16px', background: tempFilterMode === "monthYear" ? '#eff6ff' : '#f8fafc', borderRadius: '8px', border: tempFilterMode === "monthYear" ? '1px solid #2563eb' : '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: tempFilterMode === "monthYear" ? '#1d4ed8' : '#334155', display: 'block', marginBottom: '12px' }}>Bulan tertentu</span>
                <div className="transaction-filter-field-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <CustomSelect
                    value={tempMonth}
                    onChange={(val) => {
                      setTempFilterMode("monthYear");
                      setTempMonth(val);
                    }}
                    options={monthOptions}
                    placeholder="Bulan"
                    responsiveOverlay
                    selectionTitle="Pilih bulan"
                  />
                  <CustomSelect
                    value={tempYear}
                    onChange={(val) => {
                      setTempFilterMode("monthYear");
                      setTempYear(val);
                    }}
                    options={yearOptions}
                    placeholder="Tahun"
                    responsiveOverlay
                    selectionTitle="Pilih tahun"
                  />
                </div>
              </div>
              
              {/* Mode 3: Custom Date Range */}
              <div className={`transaction-filter-section transaction-filter-range ${tempFilterMode === "custom" ? "active" : ""}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', padding: '16px', background: tempFilterMode === "custom" ? '#eff6ff' : 'transparent', borderRadius: '8px', border: tempFilterMode === "custom" ? '1px solid #2563eb' : '1px solid transparent' }}>
                <strong className="transaction-filter-section-title">Rentang khusus</strong>
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
                    responsiveOverlay
                    selectionTitle="Pilih tanggal mulai"
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
                    responsiveOverlay
                    selectionTitle="Pilih tanggal akhir"
                  />
                </div>
              </div>
            </div>
            
            <div className="modal-actions transaction-modal-actions transaction-filter-actions rounded-b-2xl md:rounded-b-3xl" style={{ padding: '16px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
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
