"use client";

import {
  BarChart3,
  Bot,
  Calendar,
  ChevronDown,
  Download,
  Edit3,
  FileText,
  Filter,
  Layers,
  PieChart,
  Table,
  TrendingUp,
  Wallet
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDouit } from "@/app/providers/DouitProvider";
import { createClient } from "@/lib/supabase/client";
import { isAccountMatch } from "@/utils/bankAliases";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { BankLogo } from "@/app/components/BankLogo";
import {
  exportMonthlyPdf,
  exportMonthlyExcel,
  exportAnnualPdf,
  exportAnnualExcel,
  exportMultiYearPdf,
  exportMultiYearExcel
} from "@/lib/report-export-utils";
import { CustomSelect } from "@/app/components/ui/CustomSelect";

const formatMoney = (value: number | string) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value));

const getBudgetPresentation = (expense: number, budget: number) => {
  if (budget <= 0) {
    return {
      label: "Belum diatur",
      detail: "Atur batas bulanan",
      percentage: 0,
      progressWidth: 0,
      textClass: "text-slate-500",
      barClass: "bg-slate-300",
      badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
    };
  }

  const percentage = (expense / budget) * 100;
  const isOver = percentage > 100;
  const isNear = percentage >= 75 && !isOver;
  const detail = isOver
    ? "Melebihi " + formatMoney(expense - budget)
    : "Tersisa " + formatMoney(Math.max(budget - expense, 0));

  return {
    label: isOver ? "Melewati batas" : isNear ? "Mendekati batas" : "Aman",
    detail,
    percentage,
    progressWidth: Math.min(percentage, 100),
    textClass: isOver ? "text-rose-700" : isNear ? "text-amber-700" : "text-emerald-700",
    barClass: isOver ? "bg-rose-500" : isNear ? "bg-amber-500" : "bg-emerald-600",
    badgeClass: isOver
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : isNear
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
};

// Module-level in-memory cache for instant cross-tab navigation
let cachedLaporanAccounts: any[] = [];
let cachedLaporanCategories: any[] = [];
let cachedLaporanMerchantRules: any[] = [];
let cachedLaporanTransactions: any[] = [];
let hasLoadedLaporanOnce = false;

export default function LaporanPage() {
  const [activeTab, setActiveTab] = useState("Bulanan");
  const [breakdownMode, setBreakdownMode] = useState("Kategori");
  const [annualBreakdownMode, setAnnualBreakdownMode] = useState("Kategori");
  const [multiYearBreakdownMode, setMultiYearBreakdownMode] = useState("Kategori");
  const [multiYearSelectedYear, setMultiYearSelectedYear] = useState<number>(new Date().getFullYear());
  const [primaryMode, setPrimaryMode] = useState<"Pengeluaran" | "Pemasukan" | "Net">("Pengeluaran");
  
  const [editBudgetModalOpen, setEditBudgetModalOpen] = useState(false);
  const [editingCatName, setEditingCatName] = useState("");
  const [editingBudget, setEditingBudget] = useState("");
  
  const { user, business, membership } = useDouit();
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  const [transactions, setTransactions] = useState<any[]>(cachedLaporanTransactions);
  const [accounts, setAccounts] = useState<any[]>(cachedLaporanAccounts);
  const [categories, setCategories] = useState<any[]>(cachedLaporanCategories);
  const [merchantRules, setMerchantRules] = useState<any[]>(cachedLaporanMerchantRules);
  const [isLoading, setIsLoading] = useState<boolean>(!hasLoadedLaporanOnce);
  const [editingType, setEditingType] = useState<"category" | "merchant">("category");
  const [isSavingBudget, setIsSavingBudget] = useState(false);
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);
  const [myHoveredSlice, setMyHoveredSlice] = useState<string | null>(null);
  
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedAccount, setSelectedAccount] = useState("Semua");

  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      if (!hasLoadedLaporanOnce) {
        setIsLoading(true);
      }
      const supabase = createClient();
      
      try {
        const [accRes, catRes, mrRes, txRes] = await Promise.all([
          supabase.from('payment_accounts').select('*').eq('user_id', user.id),
          supabase.from('categories').select('id, name, type, is_system, budget_limit, user_id, category_budgets(amount)').or(`user_id.eq.${user.id},is_system.eq.true,user_id.is.null`),
          supabase.from('user_merchant_rules').select('*').eq('user_id', user.id),
          supabase.from('transactions').select(`*, categories(name)`).eq('user_id', user.id).eq('status', 'APPROVED')
        ]);

        if (accRes.data) {
          cachedLaporanAccounts = accRes.data;
          setAccounts(accRes.data);
        }
        if (catRes.data) {
          const formattedCats = catRes.data.map((c: any) => ({
            ...c,
            budget_limit: c.category_budgets && c.category_budgets.length > 0 ? c.category_budgets[0].amount : (c.budget_limit || 0)
          }));
          cachedLaporanCategories = formattedCats;
          setCategories(formattedCats);
        }
        if (mrRes.data) {
          cachedLaporanMerchantRules = mrRes.data;
          setMerchantRules(mrRes.data);
        }
        if (txRes.data) {
          cachedLaporanTransactions = txRes.data;
          setTransactions(txRes.data);
        }
        hasLoadedLaporanOnce = true;
      } catch (err) {
        console.error("Error loading laporan data:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [user]);

  // Calculations for Tab 1
  const filteredTx = transactions.filter((tx) => {
    const txDate = new Date(tx.transaction_date);
    const matchesMonth = txDate.getMonth() === selectedMonth;
    const matchesYear = txDate.getFullYear() === selectedYear;
    const matchesAccount = selectedAccount === "Semua" || isAccountMatch(selectedAccount, tx.sumber_dana);
    return matchesMonth && matchesYear && matchesAccount;
  });

  const totalIncome = filteredTx.filter(t => t.type === 'INCOME').reduce((acc, t) => acc + Number(t.amount), 0);
  const totalExpense = filteredTx.filter(t => t.type === 'EXPENSE').reduce((acc, t) => acc + Number(t.amount), 0);
  const netSurplus = totalIncome - totalExpense;

  // Breakdown Calculations
  const categoryStats: Record<string, { name: string; income: number; expense: number; net: number; count: number; budget: number }> = {};
  const merchantStats: Record<string, { name: string; income: number; expense: number; net: number; count: number; budget: number }> = {};
  
  filteredTx.forEach(t => {
    const isIncome = t.type === 'INCOME';
    const amount = Number(t.amount);
    
    // Category Stats
    const catName = (t.categories as any)?.name || 'Lain-lain';
    if (!categoryStats[catName]) {
      let dbCat = categories.find(c => c.name.toLowerCase() === catName.toLowerCase() && c.user_id === user?.id);
      if (!dbCat) dbCat = categories.find(c => c.name.toLowerCase() === catName.toLowerCase());
      
      const limit = dbCat?.budget_limit || 0;
      categoryStats[catName] = { name: catName, income: 0, expense: 0, net: 0, count: 0, budget: limit };
    }
    if (isIncome) {
       categoryStats[catName].income += amount;
       categoryStats[catName].net += amount;
    } else {
       categoryStats[catName].expense += amount;
       categoryStats[catName].net -= amount;
    }
    categoryStats[catName].count += 1;
    
    // Merchant Stats
    const merchantName = (t.merchant || 'Unknown').trim();
    const key = merchantName.toLowerCase();
    
    if (!merchantStats[key]) {
      const dbRule = merchantRules.find(r => r.merchant_pattern.toLowerCase() === key);
      merchantStats[key] = { name: merchantName, income: 0, expense: 0, net: 0, count: 0, budget: dbRule?.budget_limit || 0 };
    }
    if (isIncome) {
       merchantStats[key].income += amount;
       merchantStats[key].net += amount;
    } else {
       merchantStats[key].expense += amount;
       merchantStats[key].net -= amount;
    }
    merchantStats[key].count += 1;
  });

  const getStatValue = (stat: any) => {
    if (primaryMode === 'Pengeluaran') return stat.expense;
    if (primaryMode === 'Pemasukan') return stat.income;
    return stat.net;
  };

  const sortedCategories = Object.values(categoryStats)
    .filter(stat => primaryMode === 'Net' ? true : getStatValue(stat) > 0)
    .sort((a, b) => getStatValue(b) - getStatValue(a));
  
  const sortedMerchants = Object.values(merchantStats)
    .filter(stat => stat.count >= 2 && (primaryMode === 'Net' ? true : getStatValue(stat) > 0))
    .sort((a, b) => getStatValue(b) - getStatValue(a))
    .slice(0, 10);

  let totalBudgetedCount = 0;
  let overbudgetCount = 0;
  let hematCount = 0;
  
  const allStats = [...Object.values(categoryStats), ...Object.values(merchantStats)];
  allStats.forEach(stat => {
    if (stat.budget > 0) {
      totalBudgetedCount++;
      if (stat.expense > stat.budget) {
        overbudgetCount++;
      } else {
        hematCount++;
      }
    }
  });

  // Generate Conic Gradient for Pie Chart
  const activeList = breakdownMode === "Kategori" ? sortedCategories : sortedMerchants;
  const pieColors = primaryMode === 'Pemasukan'
    ? ["#16825d", "#2f9871", "#54aa88", "#78b99c", "#9bc8b0", "#3f7f70", "#6f9f8b"]
    : primaryMode === 'Pengeluaran'
    ? ["#16825d", "#4f8f78", "#7aa58f", "#d78b27", "#c7a97c", "#7b8f86", "#ec6b56"]
    : ["#16825d", "#4b7f70", "#769b8c", "#d78b27", "#8a8175", "#4b7bec", "#ec6b56"];

  const chartSum = activeList.reduce((acc, item) => acc + Math.abs(getStatValue(item)), 0);

  // --- ANNUAL TAB CALCULATIONS ---
  const annualTx = transactions.filter((tx) => {
    const txDate = new Date(tx.transaction_date);
    const matchesYear = txDate.getFullYear() === selectedYear;
    const matchesAccount = selectedAccount === "Semua" || isAccountMatch(selectedAccount, tx.sumber_dana);
    return matchesYear && matchesAccount;
  });

  const isInternalTransfer = (catName: string) => {
    const name = catName.toLowerCase();
    return name === 'pindah saldo' || name === 'transfer antar rekening';
  };

  const annualStats = Array.from({ length: 12 }, (_, i) => ({ month: i, income: 0, expense: 0, net: 0 }));
  const annualCategoryStats: Record<string, number[]> = {};
  const annualMerchantStats: Record<string, number[]> = {};
  const annualMerchantCounts: Record<string, number> = {};

  annualTx.forEach(t => {
    const txDate = new Date(t.transaction_date);
    const m = txDate.getMonth();
    const amount = Number(t.amount);
    const catName = (t.categories as any)?.name || 'Lain-lain';
    const isTransfer = isInternalTransfer(catName);

    if (t.type === 'INCOME' && !isTransfer) {
      annualStats[m].income += amount;
      annualStats[m].net += amount;
    } else if (t.type === 'EXPENSE' && !isTransfer) {
      annualStats[m].expense += amount;
      annualStats[m].net -= amount;
      
      if (!annualCategoryStats[catName]) annualCategoryStats[catName] = Array(12).fill(0);
      annualCategoryStats[catName][m] += amount;

      const merchantName = (t.merchant || 'Unknown').trim();
      const mKey = merchantName.toLowerCase();
      if (!annualMerchantStats[mKey]) {
        annualMerchantStats[mKey] = Array(12).fill(0);
        annualMerchantCounts[mKey] = 0;
      }
      annualMerchantStats[mKey][m] += amount;
      annualMerchantCounts[mKey] += 1;
    }
  });

  const maxAnnualIncome = Math.max(...annualStats.map(s => s.income), 1);
  const maxAnnualExpense = Math.max(...annualStats.map(s => s.expense), 1);
  const annualChartMax = Math.max(maxAnnualIncome, maxAnnualExpense, 1);
  
  const heatmapDataRaw = annualBreakdownMode === "Kategori" 
    ? Object.entries(annualCategoryStats)
    : Object.entries(annualMerchantStats).filter(([name]) => annualMerchantCounts[name] >= 2);

  const heatmapData = heatmapDataRaw
    .map(([name, months]) => ({
      name,
      months,
      total: months.reduce((a,b)=>a+b,0),
      count: annualBreakdownMode === "Merchant" ? annualMerchantCounts[name] || 0 : null,
    }))
    .filter(row => row.total > 0)
    .sort((a,b) => b.total - a.total)
    .slice(0, annualBreakdownMode === "Merchant" ? 20 : undefined);

  const heatmapMonthlyTotals = Array(12).fill(0);
  heatmapData.forEach(row => {
    row.months.forEach((val, i) => { heatmapMonthlyTotals[i] += val; });
  });
  const heatmapGrandTotal = heatmapMonthlyTotals.reduce((a,b) => a+b, 0);
  const maxHeatmapValue = Math.max(...heatmapData.flatMap(r => r.months), 1);

  // --- MULTI-YEAR CALCULATIONS ---
  const multiYearTx = transactions.filter(t => selectedAccount === "Semua" || isAccountMatch(selectedAccount, t.sumber_dana));

  let rawYears = Array.from(new Set(multiYearTx.map(t => new Date(t.transaction_date).getFullYear())));
  if (rawYears.length === 0) rawYears = [new Date().getFullYear()];
  const activeYears = rawYears.sort((a, b) => a - b);

  let lifetimeIncome = 0;
  let lifetimeExpense = 0;
  
  const multiYearStats: Record<number, { income: number, expense: number, net: number }> = {};
  activeYears.forEach(y => multiYearStats[y] = { income: 0, expense: 0, net: 0 });

  const multiYearCategoryStats: Record<string, number[]> = {};
  const multiYearMerchantStats: Record<string, number[]> = {};
  const multiYearMerchantCounts: Record<string, number> = {};

  multiYearTx.forEach(t => {
    const y = new Date(t.transaction_date).getFullYear();
    if (!multiYearStats[y]) return;
    
    const amount = Number(t.amount);
    const catName = (t.categories as any)?.name || 'Lain-lain';
    const isTransfer = isInternalTransfer(catName);

    if (t.type === 'INCOME' && !isTransfer) {
      multiYearStats[y].income += amount;
      lifetimeIncome += amount;
    } else if (t.type === 'EXPENSE' && !isTransfer && t.is_internal_transfer !== true) {
      multiYearStats[y].expense += amount;
      lifetimeExpense += amount;
      
      if (!multiYearCategoryStats[catName]) multiYearCategoryStats[catName] = Array(activeYears.length).fill(0);
      const yearIdx = activeYears.indexOf(y);
      multiYearCategoryStats[catName][yearIdx] += amount;

      const merchantName = (t.merchant || 'Unknown').trim();
      const mKey = merchantName.toLowerCase();
      if (!multiYearMerchantStats[mKey]) {
        multiYearMerchantStats[mKey] = Array(activeYears.length).fill(0);
        multiYearMerchantCounts[mKey] = 0;
      }
      multiYearMerchantStats[mKey][yearIdx] += amount;
      multiYearMerchantCounts[mKey] += 1;
    }
  });

  let bestYear = activeYears[0];
  let maxMargin = -Infinity;
  activeYears.forEach(y => {
    multiYearStats[y].net = multiYearStats[y].income - multiYearStats[y].expense;
    const margin = multiYearStats[y].income > 0 ? (multiYearStats[y].income - multiYearStats[y].expense) / multiYearStats[y].income : -Infinity;
    if (margin > maxMargin) {
      maxMargin = margin;
      bestYear = y;
    }
  });

  const lifetimeNet = lifetimeIncome - lifetimeExpense;
  const avgAnnualExpense = lifetimeExpense / (activeYears.length || 1);

  // --- MAKRO CHART DATA (Area/Line) ---
  const isSingleYear = activeYears.length === 1;
  const singleYear = activeYears[0];
  
  const macroChartData = isSingleYear
    ? Array.from({ length: 12 }, (_, i) => {
        const monthTx = multiYearTx.filter(t => {
          const d = new Date(t.transaction_date);
          return d.getFullYear() === singleYear && d.getMonth() === i;
        });
        
        const income = monthTx.filter(t => t.type === 'INCOME' && !isInternalTransfer((t.categories as any)?.name || '')).reduce((sum, t) => sum + Number(t.amount), 0);
        const expense = monthTx.filter(t => t.type === 'EXPENSE' && !isInternalTransfer((t.categories as any)?.name || '') && t.is_internal_transfer !== true).reduce((sum, t) => sum + Number(t.amount), 0);
        
        return {
          name: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"][i],
          Pemasukan: income,
          Pengeluaran: expense,
          Net: income - expense,
          margin: income > 0 ? ((income - expense) / income) * 100 : 0
        };
      })
    : activeYears.map(y => {
        const stat = multiYearStats[y];
        return {
          name: y.toString(),
          Pemasukan: stat.income,
          Pengeluaran: stat.expense,
          Net: stat.net,
          margin: stat.income > 0 ? (stat.net / stat.income) * 100 : 0
        };
      });

  const macroChartTitle = isSingleYear 
    ? `Tren Pertumbuhan Tabungan (${singleYear})`
    : `Pertumbuhan Kekayaan Multi-Tahun (${activeYears[0]} - ${activeYears[activeYears.length - 1]})`;

  const safeMultiYearSelected = activeYears.includes(multiYearSelectedYear) ? multiYearSelectedYear : activeYears[activeYears.length - 1];
  const selIdx = activeYears.indexOf(safeMultiYearSelected);
  const prevIdx = selIdx > 0 ? selIdx - 1 : -1;
  const prevYear = prevIdx !== -1 ? activeYears[prevIdx] : null;

  const myBreakdownRaw = multiYearBreakdownMode === "Kategori" 
    ? Object.entries(multiYearCategoryStats)
    : Object.entries(multiYearMerchantStats).filter(([name]) => multiYearMerchantCounts[name] >= 2);

  const myBreakdownData = myBreakdownRaw
    .map(([name, yearsData]) => {
      const currentVal = yearsData[selIdx] || 0;
      const prevVal = prevIdx !== -1 ? (yearsData[prevIdx] || 0) : null;
      let yoy = null;
      if (prevVal !== null && prevVal > 0) {
        yoy = ((currentVal - prevVal) / prevVal) * 100;
      } else if (prevVal !== null && prevVal === 0 && currentVal > 0) {
        yoy = Infinity;
      }
      return {
        name,
        currentVal,
        prevVal,
        yoy,
        count: multiYearBreakdownMode === "Merchant" ? multiYearMerchantCounts[name] || 0 : null,
      };
    })
    .filter(row => row.currentVal > 0)
    .sort((a,b) => b.currentVal - a.currentVal);

  const myBreakdownTotal = myBreakdownData.reduce((acc, row) => acc + row.currentVal, 0);

  let myCumValue = 0;
  const donutColors = ["#16825d", "#4f8f78", "#7aa58f", "#d78b27", "#c7a97c", "#7b8f86", "#ec6b56", "#4b7bec", "#7866d8", "#8a8175"];
  const mySvgPaths = myBreakdownData.map((item, i) => {
    const val = item.currentVal;
    const startAngle = myBreakdownTotal > 0 ? (myCumValue / myBreakdownTotal) * 360 : 0;
    myCumValue += val;
    const circumference = 2 * Math.PI * 80;
    const strokeDasharray = myBreakdownTotal > 0 ? `${(val / myBreakdownTotal) * circumference} ${circumference}` : `0 ${circumference}`;
    const strokeDashoffset = -((startAngle / 360) * circumference);
    return {
      item,
      color: donutColors[i % donutColors.length],
      strokeDasharray,
      strokeDashoffset,
      percentage: myBreakdownTotal > 0 ? ((val / myBreakdownTotal) * 100).toFixed(1) : "0"
    };
  });

  const formatCompact = (val: number) => {
    if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
    if (val >= 1000) return Math.round(val / 1000) + 'k';
    return val.toString();
  };

  const annualDonutColors = ["#16825d", "#4f8f78", "#7aa58f", "#d78b27", "#c7a97c", "#7b8f86", "#ec6b56", "#4b7bec", "#7866d8", "#8a8175"];
  let annualCumulativeValue = 0;
  const annualSvgPaths = heatmapData.map((item, i) => {
    const val = item.total;
    const startAngle = heatmapGrandTotal > 0 ? (annualCumulativeValue / heatmapGrandTotal) * 360 : 0;
    annualCumulativeValue += val;
    const circumference = 2 * Math.PI * 80;
    const strokeDasharray = heatmapGrandTotal > 0 ? `${(val / heatmapGrandTotal) * circumference} ${circumference}` : `0 ${circumference}`;
    const strokeDashoffset = -((startAngle / 360) * circumference);
    return {
      item, color: annualDonutColors[i % annualDonutColors.length],
      strokeDasharray, strokeDashoffset,
      percentage: heatmapGrandTotal > 0 ? ((val / heatmapGrandTotal) * 100).toFixed(1) : "0"
    };
  });

  const svgRadius = 80;
  const strokeWidth = 32;
  let cumulativeValue = 0;
  const svgPaths = activeList.map((item, i) => {
    const val = Math.abs(getStatValue(item));
    const startAngle = chartSum > 0 ? (cumulativeValue / chartSum) * 360 : 0;
    cumulativeValue += val;
    
    const circumference = 2 * Math.PI * svgRadius;
    const strokeDasharray = chartSum > 0 ? `${(val / chartSum) * circumference} ${circumference}` : `0 ${circumference}`;
    const strokeDashoffset = -((startAngle / 360) * circumference);
    
    return {
      item,
      color: pieColors[i % pieColors.length],
      strokeDasharray,
      strokeDashoffset,
      percentage: chartSum > 0 ? ((val / chartSum) * 100).toFixed(1) : "0",
      value: val
    };
  });
  
  const activeHoveredSlice = hoveredSlice ? svgPaths.find(s => s.item.name === hoveredSlice) : null;
  
  const openQuickEditBudget = (name: string, isMerchant: boolean = false) => {
    if (isMerchant) {
      const mr = merchantRules.find(r => r.merchant_pattern.toLowerCase() === name.toLowerCase());
      setEditingCatName(name);
      setEditingBudget(mr?.budget_limit ? mr.budget_limit.toString() : "");
      setEditingType("merchant");
      setEditBudgetModalOpen(true);
    } else {
      let dbCat = categories.find(c => c.name.toLowerCase() === name.toLowerCase() && c.user_id === user?.id);
      if (!dbCat) dbCat = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
      
      if (dbCat) {
        setEditingCatName(dbCat.name);
        setEditingBudget(dbCat.budget_limit ? dbCat.budget_limit.toString() : "");
      } else {
        setEditingCatName(name);
        setEditingBudget("");
      }
      setEditingType("category");
      setEditBudgetModalOpen(true);
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingBudget(true);
    const supabase = createClient();
    
    // Auth Session Validation
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      toast.error("Sesimu telah berakhir. Silakan masuk kembali untuk menyimpan anggaran.");
      setIsSavingBudget(false);
      return;
    }
    
    const newBudget = Number(String(editingBudget).replace(/[^0-9]/g, '')) || 0;
    const activeUserId = session.user.id;
    
    try {
      if (editingType === "category") {
        const targetCat = categories.find(c => c.name.toLowerCase() === editingCatName.toLowerCase());
        if (!targetCat) throw new Error("Kategori tidak ditemukan");

        const { error } = await supabase.from('category_budgets').upsert({
          user_id: activeUserId,
          category_id: targetCat.id,
          amount: newBudget
        }, { onConflict: 'user_id, category_id' });
        
        if (error) throw error;
        
        // Re-fetch to ensure sync and close modal
        const { data: catData } = await supabase.from('categories').select('id, name, type, is_system, budget_limit, user_id, category_budgets(amount)').or(`user_id.eq.${activeUserId},is_system.eq.true,user_id.is.null`);
        if (catData) {
          const formatted = catData.map((c: any) => ({
            ...c,
            budget_limit: c.category_budgets && c.category_budgets.length > 0 ? c.category_budgets[0].amount : (c.budget_limit || 0)
          }));
          cachedLaporanCategories = formatted;
          setCategories(formatted);
        }
        toast.success("Anggaran kategori berhasil disimpan!");
        setEditBudgetModalOpen(false);
      } else {
        const { error } = await supabase.from('user_merchant_rules').upsert({
          user_id: activeUserId,
          merchant_pattern: editingCatName,
          budget_limit: newBudget
        }, { onConflict: 'user_id, merchant_pattern' });
        
        if (error) throw error;
        
        setMerchantRules(rules => {
          const exists = rules.find(r => r.merchant_pattern.toLowerCase() === editingCatName.toLowerCase());
          let updated;
          if (exists) {
            updated = rules.map(r => r.id === exists.id ? { ...r, budget_limit: newBudget } : r);
          } else {
            updated = [...rules, { merchant_pattern: editingCatName, budget_limit: newBudget }];
          }
          cachedLaporanMerchantRules = updated;
          return updated;
        });
        toast.success("Anggaran merchant berhasil disimpan!");
        setEditBudgetModalOpen(false);
      }
    } catch (err: any) {
      toast.error("Gagal menyimpan anggaran: " + (err.message || "Unknown error"));
    } finally {
      setIsSavingBudget(false);
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setExportDropdownOpen(false);
      }
    }
    if (exportDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [exportDropdownOpen]);

  const monthNames = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];

  const handleExportPdf = () => {
    setExportDropdownOpen(false);
    const profileBusinessName = business?.name || membership?.display_name || "aarmo Finance";
    const profileUserName = membership?.display_name || user?.email || "User";
    const accountLabel = selectedAccount === "Semua" ? "Semua Rekening" : selectedAccount;

    if (activeTab === "Bulanan") {
      const allocationStatusText =
        totalBudgetedCount === 0
          ? "Belum diatur"
          : overbudgetCount > 0
          ? `${overbudgetCount} Overbudget, ${hematCount} Hemat`
          : `Semua Terkendali (${hematCount})`;

      const formattedCategories = sortedCategories.map(c => ({
        name: c.name,
        income: c.income,
        expense: c.expense,
        net: c.net,
        count: c.count,
        budget: c.budget,
        percentage: chartSum > 0 ? ((Math.abs(getStatValue(c)) / chartSum) * 100).toFixed(1) : "0",
      }));

      const formattedAccounts = accounts.map(acc => {
        const accIn = filteredTx.filter(t => t.type === 'INCOME' && isAccountMatch(acc.name, t.sumber_dana)).reduce((sum, t) => sum + Number(t.amount), 0);
        const accOut = filteredTx.filter(t => t.type === 'EXPENSE' && isAccountMatch(acc.name, t.sumber_dana)).reduce((sum, t) => sum + Number(t.amount), 0);
        const initBal = Number(acc.initial_balance) || 0;
        return {
          name: acc.name,
          isPrimary: acc.is_primary,
          initialBalance: initBal,
          income: accIn,
          expense: accOut,
          finalBalance: initBal + accIn - accOut,
        };
      });

      const insightText = activeList.length > 0 && chartSum > 0
        ? `${breakdownMode === 'Kategori' ? 'Kategori' : 'Merchant'} ${activeList[0].name} mendominasi ${Math.round((Math.abs(getStatValue(activeList[0])) / chartSum) * 100)}% dari total.`
        : "Belum cukup data untuk analisis.";

      exportMonthlyPdf({
        businessName: profileBusinessName,
        userName: profileUserName,
        periodLabel: `${monthNames[selectedMonth]} ${selectedYear}`,
        monthName: monthNames[selectedMonth],
        year: selectedYear,
        accountFilter: accountLabel,
        totalIncome,
        totalExpense,
        netSurplus,
        allocationStatus: allocationStatusText,
        categories: formattedCategories,
        accounts: formattedAccounts,
        aiInsight: insightText,
      });
    } else if (activeTab === "Tahunan") {
      const formattedAnnualStats = annualStats.map((s, i) => ({
        ...s,
        monthName: monthNames[i],
      }));

      const formattedHeatmap = heatmapData.map(h => ({
        name: h.name,
        months: h.months,
        total: h.total,
        percentage: heatmapGrandTotal > 0 ? ((h.total / heatmapGrandTotal) * 100).toFixed(1) : "0",
      }));

      const topCats = formattedHeatmap.slice(0, 3).map(h => ({
        name: h.name,
        total: h.total,
        percentage: h.percentage,
      }));

      exportAnnualPdf({
        businessName: profileBusinessName,
        userName: profileUserName,
        year: selectedYear,
        accountFilter: accountLabel,
        annualStats: formattedAnnualStats,
        totalIncome: annualStats.reduce((sum, s) => sum + s.income, 0),
        totalExpense: annualStats.reduce((sum, s) => sum + s.expense, 0),
        totalNet: annualStats.reduce((sum, s) => sum + s.net, 0),
        heatmapData: formattedHeatmap,
        topCategories: topCats,
      });
    } else if (activeTab === "Makro") {
      const yearRangeStr = activeYears.length === 1 ? `${activeYears[0]}` : `${activeYears[0]} - ${activeYears[activeYears.length - 1]}`;
      const yearlyStatsArr = activeYears.map(y => {
        const s = multiYearStats[y] || { income: 0, expense: 0, net: 0 };
        return {
          year: y,
          income: s.income,
          expense: s.expense,
          net: s.net,
          marginPct: s.income > 0 ? (s.net / s.income) * 100 : 0,
        };
      });

      const selectedYearCats = myBreakdownData.map(item => ({
        name: item.name,
        currentVal: item.currentVal,
        prevVal: item.prevVal,
        yoyPct: item.yoy,
        percentage: myBreakdownTotal > 0 ? ((item.currentVal / myBreakdownTotal) * 100).toFixed(1) : "0",
      }));

      const myInsightText = myBreakdownData.length > 0
        ? `${multiYearBreakdownMode === 'Kategori' ? 'Kategori' : 'Merchant'} ${myBreakdownData[0].name} mendominasi ${Math.round((myBreakdownData[0].currentVal / myBreakdownTotal) * 100)}% dari total pengeluaran tahun ${safeMultiYearSelected}.`
        : "Belum cukup data untuk analisis.";

      exportMultiYearPdf({
        businessName: profileBusinessName,
        userName: profileUserName,
        yearRangeLabel: yearRangeStr,
        accountFilter: accountLabel,
        lifetimeNet,
        avgAnnualExpense,
        bestYear,
        bestYearMargin: maxMargin,
        yearlyStats: yearlyStatsArr,
        selectedYear: safeMultiYearSelected,
        selectedYearCategories: selectedYearCats,
        selectedYearTotal: myBreakdownTotal,
        aiInsight: myInsightText,
      });
    }
  };

  const handleExportExcel = () => {
    setExportDropdownOpen(false);
    const profileBusinessName = business?.name || membership?.display_name || "aarmo Finance";
    const profileUserName = membership?.display_name || user?.email || "User";
    const accountLabel = selectedAccount === "Semua" ? "Semua Rekening" : selectedAccount;

    if (activeTab === "Bulanan") {
      const allocationStatusText =
        totalBudgetedCount === 0
          ? "Belum diatur"
          : overbudgetCount > 0
          ? `${overbudgetCount} Overbudget, ${hematCount} Hemat`
          : `Semua Terkendali (${hematCount})`;

      const formattedCategories = sortedCategories.map(c => ({
        name: c.name,
        income: c.income,
        expense: c.expense,
        net: c.net,
        count: c.count,
        budget: c.budget,
        percentage: chartSum > 0 ? ((Math.abs(getStatValue(c)) / chartSum) * 100).toFixed(1) : "0",
      }));

      const formattedAccounts = accounts.map(acc => {
        const accIn = filteredTx.filter(t => t.type === 'INCOME' && isAccountMatch(acc.name, t.sumber_dana)).reduce((sum, t) => sum + Number(t.amount), 0);
        const accOut = filteredTx.filter(t => t.type === 'EXPENSE' && isAccountMatch(acc.name, t.sumber_dana)).reduce((sum, t) => sum + Number(t.amount), 0);
        const initBal = Number(acc.initial_balance) || 0;
        return {
          name: acc.name,
          isPrimary: acc.is_primary,
          initialBalance: initBal,
          income: accIn,
          expense: accOut,
          finalBalance: initBal + accIn - accOut,
        };
      });

      const insightText = activeList.length > 0 && chartSum > 0
        ? `${breakdownMode === 'Kategori' ? 'Kategori' : 'Merchant'} ${activeList[0].name} mendominasi ${Math.round((Math.abs(getStatValue(activeList[0])) / chartSum) * 100)}% dari total.`
        : "Belum cukup data untuk analisis.";

      exportMonthlyExcel({
        businessName: profileBusinessName,
        userName: profileUserName,
        periodLabel: `${monthNames[selectedMonth]} ${selectedYear}`,
        monthName: monthNames[selectedMonth],
        year: selectedYear,
        accountFilter: accountLabel,
        totalIncome,
        totalExpense,
        netSurplus,
        allocationStatus: allocationStatusText,
        categories: formattedCategories,
        accounts: formattedAccounts,
        aiInsight: insightText,
      });
    } else if (activeTab === "Tahunan") {
      const formattedAnnualStats = annualStats.map((s, i) => ({
        ...s,
        monthName: monthNames[i],
      }));

      const formattedHeatmap = heatmapData.map(h => ({
        name: h.name,
        months: h.months,
        total: h.total,
        percentage: heatmapGrandTotal > 0 ? ((h.total / heatmapGrandTotal) * 100).toFixed(1) : "0",
      }));

      const topCats = formattedHeatmap.slice(0, 3).map(h => ({
        name: h.name,
        total: h.total,
        percentage: h.percentage,
      }));

      exportAnnualExcel({
        businessName: profileBusinessName,
        userName: profileUserName,
        year: selectedYear,
        accountFilter: accountLabel,
        annualStats: formattedAnnualStats,
        totalIncome: annualStats.reduce((sum, s) => sum + s.income, 0),
        totalExpense: annualStats.reduce((sum, s) => sum + s.expense, 0),
        totalNet: annualStats.reduce((sum, s) => sum + s.net, 0),
        heatmapData: formattedHeatmap,
        topCategories: topCats,
      });
    } else if (activeTab === "Makro") {
      const yearRangeStr = activeYears.length === 1 ? `${activeYears[0]}` : `${activeYears[0]} - ${activeYears[activeYears.length - 1]}`;
      const yearlyStatsArr = activeYears.map(y => {
        const s = multiYearStats[y] || { income: 0, expense: 0, net: 0 };
        return {
          year: y,
          income: s.income,
          expense: s.expense,
          net: s.net,
          marginPct: s.income > 0 ? (s.net / s.income) * 100 : 0,
        };
      });

      const selectedYearCats = myBreakdownData.map(item => ({
        name: item.name,
        currentVal: item.currentVal,
        prevVal: item.prevVal,
        yoyPct: item.yoy,
        percentage: myBreakdownTotal > 0 ? ((item.currentVal / myBreakdownTotal) * 100).toFixed(1) : "0",
      }));

      const myInsightText = myBreakdownData.length > 0
        ? `${multiYearBreakdownMode === 'Kategori' ? 'Kategori' : 'Merchant'} ${myBreakdownData[0].name} mendominasi ${Math.round((myBreakdownData[0].currentVal / myBreakdownTotal) * 100)}% dari total pengeluaran tahun ${safeMultiYearSelected}.`
        : "Belum cukup data untuk analisis.";

      exportMultiYearExcel({
        businessName: profileBusinessName,
        userName: profileUserName,
        yearRangeLabel: yearRangeStr,
        accountFilter: accountLabel,
        lifetimeNet,
        avgAnnualExpense,
        bestYear,
        bestYearMargin: maxMargin,
        yearlyStats: yearlyStatsArr,
        selectedYear: safeMultiYearSelected,
        selectedYearCategories: selectedYearCats,
        selectedYearTotal: myBreakdownTotal,
        aiInsight: myInsightText,
      });
    }
  };

  // Presentation-only summaries and insights derived from existing report data.
  const annualTotalIncome = annualStats.reduce((sum, stat) => sum + stat.income, 0);
  const annualTotalExpense = annualStats.reduce((sum, stat) => sum + stat.expense, 0);
  const annualTotalNet = annualTotalIncome - annualTotalExpense;
  const annualActiveMonths = annualStats.filter((stat) => stat.income > 0 || stat.expense > 0).length;
  const annualPeakExpense = annualStats.reduce(
    (peak, stat, index) => stat.expense > peak.value ? { value: stat.expense, index } : peak,
    { value: 0, index: 0 }
  );
  const topExpenseCategory = Object.values(categoryStats)
    .filter((stat) => stat.expense > 0)
    .sort((a, b) => b.expense - a.expense)[0];
  const topExpenseMerchant = Object.values(merchantStats)
    .filter((stat) => stat.count >= 2 && stat.expense > 0)
    .sort((a, b) => b.expense - a.expense)[0];
  const annualTopExpenseCategory = Object.entries(annualCategoryStats)
    .map(([name, months]) => ({ name, total: months.reduce((sum, value) => sum + value, 0) }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total)[0];

  const reportPeriodLabel = activeTab === "Bulanan"
    ? `${monthNames[selectedMonth]} ${selectedYear}`
    : activeTab === "Tahunan"
    ? `Tahun ${selectedYear}`
    : activeYears.length === 1
    ? `Tahun ${activeYears[0]}`
    : `${activeYears[0]}–${activeYears[activeYears.length - 1]}`;
  const reportIncome = activeTab === "Bulanan" ? totalIncome : activeTab === "Tahunan" ? annualTotalIncome : lifetimeIncome;
  const reportExpense = activeTab === "Bulanan" ? totalExpense : activeTab === "Tahunan" ? annualTotalExpense : lifetimeExpense;
  const reportNet = activeTab === "Bulanan" ? netSurplus : activeTab === "Tahunan" ? annualTotalNet : lifetimeNet;
  const hasReportData = activeTab === "Bulanan" ? filteredTx.length > 0 : activeTab === "Tahunan" ? annualTx.length > 0 : multiYearTx.length > 0;

  const allocationStatus = totalBudgetedCount === 0
    ? "Belum diatur"
    : overbudgetCount > 0
    ? `${overbudgetCount} melewati batas`
    : `${hematCount} terkendali`;

  let primaryInsight = "Belum ada transaksi pada periode ini. Tambahkan transaksi untuk mulai melihat pola keuanganmu.";
  let supportingInsight = "Semua data detail tetap tersedia di bagian analisis di bawah.";

  if (hasReportData) {
    if (reportNet < 0) {
      primaryInsight = `Pengeluaran ${reportPeriodLabel.toLowerCase()} lebih tinggi ${formatMoney(Math.abs(reportNet))} dari pemasukan.`;
    } else if (reportNet > 0) {
      primaryInsight = `Kamu mencatat surplus ${formatMoney(reportNet)} pada ${reportPeriodLabel.toLowerCase()}.`;
    } else {
      primaryInsight = `Pemasukan dan pengeluaran pada ${reportPeriodLabel.toLowerCase()} sedang seimbang.`;
    }

    if (activeTab === "Bulanan") {
      const focus = breakdownMode === "Merchant" ? topExpenseMerchant : topExpenseCategory;
      supportingInsight = focus
        ? `${breakdownMode === "Merchant" ? "Merchant" : "Kategori"} ${focus.name} menjadi pengeluaran terbesar, senilai ${formatMoney(focus.expense)}.`
        : "Belum ada pengeluaran yang cukup untuk membentuk breakdown periode ini.";
    } else if (activeTab === "Tahunan") {
      supportingInsight = annualTopExpenseCategory
        ? `${annualTopExpenseCategory.name} menjadi kategori pengeluaran terbesar tahun ini, senilai ${formatMoney(annualTopExpenseCategory.total)}.`
        : "Belum ada pengeluaran yang cukup untuk membentuk breakdown tahunan.";
    } else {
      supportingInsight = myBreakdownData[0]
        ? `${multiYearBreakdownMode === "Kategori" ? "Kategori" : "Merchant"} ${myBreakdownData[0].name} paling dominan pada ${safeMultiYearSelected}, senilai ${formatMoney(myBreakdownData[0].currentVal)}.`
        : "Belum ada pengeluaran yang cukup untuk membentuk breakdown multi-tahun.";
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-5 md:p-6 lg:p-8 space-y-5 md:space-y-6 overflow-x-hidden">
      
      {/* HEADER CONTROLS */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Analisis keuangan</p>
          <h1 className="text-[1.65rem] md:text-3xl font-bold text-gray-900 tracking-[-0.04em] leading-tight">Laporan Keuangan</h1>
          <p className="text-gray-500 text-sm mt-1.5">Pahami arus kas, kebiasaan, dan kesehatan keuanganmu.</p>
        </div>
        <div className="shrink-0">
          {/* DYNAMIC CONTEXT-AWARE EXPORT DROPDOWN */}
          <div className="relative" ref={exportDropdownRef}>
            <button 
              type="button"
              onClick={() => setExportDropdownOpen(prev => !prev)}
              className="min-h-11 px-3 sm:px-4 flex items-center justify-between gap-2 rounded-xl bg-white hover:bg-emerald-50 border border-slate-200 text-slate-700 shadow-sm transition-colors group cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              aria-expanded={exportDropdownOpen}
              aria-haspopup="true"
              aria-label="Buka pilihan ekspor laporan"
            >
              <span className="flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="hidden sm:inline text-sm font-semibold">Ekspor</span>
              </span>
              <ChevronDown className={`hidden sm:block w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${exportDropdownOpen ? 'rotate-180 text-emerald-700' : ''}`} />
            </button>

            {exportDropdownOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 p-2 z-50 animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none">
                <div className="px-3 py-2 border-b border-gray-100 mb-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Pilihan Format Ekspor</span>
                  <p className="text-xs text-gray-600 font-medium mt-0.5">
                    {activeTab === "Bulanan" ? `Laporan Bulanan (${monthNames[selectedMonth]} ${selectedYear})` :
                     activeTab === "Tahunan" ? `Laporan Tahunan (${selectedYear})` :
                     `Laporan Multi-Tahun (${activeYears.length === 1 ? activeYears[0] : `${activeYears[0]} - ${activeYears[activeYears.length - 1]}`})`}
                  </p>
                </div>
                <div className="space-y-1">
                  <button
                    onClick={handleExportPdf}
                    className="w-full flex items-start gap-3 px-3 py-2.5 text-left text-sm font-medium text-gray-700 hover:text-emerald-700 hover:bg-emerald-50/70 rounded-xl transition-colors group cursor-pointer"
                  >
                    <div className="p-2 rounded-lg bg-emerald-100/70 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white transition-colors shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 text-xs group-hover:text-emerald-800">Unduh Dokumen PDF (.pdf)</div>
                      <div className="text-[11px] text-gray-500 font-normal mt-0.5">Format siap cetak, tabel & executive KPI</div>
                    </div>
                  </button>

                  <button
                    onClick={handleExportExcel}
                    className="w-full flex items-start gap-3 px-3 py-2.5 text-left text-sm font-medium text-gray-700 hover:text-emerald-700 hover:bg-emerald-50/70 rounded-xl transition-colors group cursor-pointer"
                  >
                    <div className="p-2 rounded-lg bg-emerald-100/70 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white transition-colors shrink-0">
                      <Table className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 text-xs group-hover:text-emerald-800">Unduh Spreadsheet Excel (.xlsx / .csv)</div>
                      <div className="text-[11px] text-gray-500 font-normal mt-0.5">Format spreadsheet & rekap multi-sheet</div>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TAB NAVIGATION */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="bg-slate-200/60 p-1 rounded-xl inline-flex min-w-max gap-1" role="tablist" aria-label="Mode laporan">
          <button type="button" role="tab" aria-selected={activeTab === "Bulanan"} onClick={() => setActiveTab("Bulanan")} className={`min-h-11 sm:min-h-10 flex items-center gap-2 px-3.5 md:px-4 rounded-lg text-sm font-semibold transition-colors ${activeTab === "Bulanan" ? "bg-white text-emerald-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            <PieChart className="w-4 h-4" /> Bulanan
          </button>
          <button type="button" role="tab" aria-selected={activeTab === "Tahunan"} onClick={() => setActiveTab("Tahunan")} className={`min-h-11 sm:min-h-10 flex items-center gap-2 px-3.5 md:px-4 rounded-lg text-sm font-semibold transition-colors ${activeTab === "Tahunan" ? "bg-white text-emerald-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            <BarChart3 className="w-4 h-4" /> Tahunan
          </button>
          <button type="button" role="tab" aria-selected={activeTab === "Makro"} onClick={() => setActiveTab("Makro")} className={`min-h-11 sm:min-h-10 flex items-center gap-2 px-3.5 md:px-4 rounded-lg text-sm font-semibold transition-colors ${activeTab === "Makro" ? "bg-white text-emerald-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            <Layers className="w-4 h-4" /> Multi-Tahun
          </button>
        </div>
      </div>

      {/* PERIOD AND ACCOUNT FILTERS */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-3.5 md:p-4 shadow-sm" aria-label="Filter laporan">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Periode aktif</p>
              <p className="truncate text-sm font-bold text-slate-900">{reportPeriodLabel}</p>
              <p className="truncate text-xs text-slate-500">{selectedAccount === "Semua" ? "Semua rekening" : selectedAccount}</p>
            </div>
          </div>

          <div className={`grid gap-2.5 ${activeTab === "Bulanan" ? "grid-cols-2 lg:grid-cols-[150px_105px_190px]" : activeTab === "Tahunan" ? "grid-cols-2 lg:grid-cols-[110px_190px]" : "grid-cols-1 lg:grid-cols-[190px]"}`}>
            {activeTab === "Bulanan" && (
              <CustomSelect
                label="Bulan"
                value={String(selectedMonth)}
                onChange={(val) => setSelectedMonth(Number(val))}
                options={monthNames.map((m, i) => ({ value: String(i), label: m }))}
                buttonClassName="min-h-11 px-3"
              />
            )}
            {(activeTab === "Bulanan" || activeTab === "Tahunan") && (
              <CustomSelect
                label="Tahun"
                value={String(selectedYear)}
                onChange={(val) => setSelectedYear(Number(val))}
                options={[2024, 2025, 2026, 2027].map((y) => ({ value: String(y), label: String(y) }))}
                buttonClassName="min-h-11 px-3"
              />
            )}
            <CustomSelect
              label="Rekening"
              value={selectedAccount}
              onChange={setSelectedAccount}
              options={[
                { value: "Semua", label: "Semua Rekening" },
                ...accounts.map(acc => ({ value: acc.name, label: acc.name }))
              ]}
              placeholder="Semua Rekening"
              icon={<Filter className="w-4 h-4 text-emerald-700 shrink-0" />}
              className={activeTab === "Bulanan" ? "col-span-2 lg:col-span-1" : ""}
              buttonClassName="min-h-11 px-3"
            />
          </div>
        </div>
      </section>

      {/* SHARED FINANCIAL SUMMARY */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-2 md:p-3 shadow-sm" aria-labelledby="financial-summary-heading">
        <h2 id="financial-summary-heading" className="sr-only">Ringkasan finansial {reportPeriodLabel}</h2>
        <div className="grid lg:grid-cols-[1.05fr_1.45fr] gap-2.5 md:gap-3">
          <div className="relative min-h-[150px] overflow-hidden rounded-xl bg-[#173128] p-5 text-white md:p-6">
            <div className="absolute -bottom-20 -right-12 h-52 w-52 rounded-full bg-lime-300/10 blur-3xl" />
            <div className="relative flex h-full flex-col justify-between gap-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.11em] text-emerald-100/65">{activeTab === "Makro" ? "Akumulasi tabungan lifetime" : reportNet < 0 ? "Defisit periode ini" : "Surplus periode ini"}</p>
                  <p className="mt-1 text-xs text-emerald-100/50">{reportPeriodLabel}</p>
                </div>
                <Wallet className="h-5 w-5 text-lime-300" />
              </div>
              {isLoading ? (
                <div className="h-9 w-44 animate-pulse rounded-lg bg-white/10" />
              ) : (
                <p className={`break-words text-[1.7rem] md:text-3xl font-bold tracking-[-0.045em] tabular-nums ${reportNet < 0 ? "text-rose-300" : "text-lime-300"}`}>
                  {reportNet > 0 ? "+" : ""}{formatMoney(reportNet)}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-slate-200/80">
            <div className="bg-white p-3.5 md:p-5">
              <p className="text-[11px] md:text-xs font-semibold text-slate-500">Pemasukan</p>
              <p className="mt-1.5 break-words text-sm md:text-xl font-bold tracking-tight text-emerald-700 tabular-nums">{isLoading ? "—" : formatMoney(reportIncome)}</p>
              <p className="mt-1 text-[10px] md:text-xs text-slate-400">Total periode</p>
            </div>
            <div className="bg-white p-3.5 md:p-5">
              <p className="text-[11px] md:text-xs font-semibold text-slate-500">Pengeluaran</p>
              <p className="mt-1.5 break-words text-sm md:text-xl font-bold tracking-tight text-slate-900 tabular-nums">{isLoading ? "—" : formatMoney(reportExpense)}</p>
              <p className="mt-1 text-[10px] md:text-xs text-slate-400">Total periode</p>
            </div>
            {activeTab === "Bulanan" ? (
              <>
                <div className="bg-white p-3.5 md:p-5">
                  <p className="text-[11px] md:text-xs font-semibold text-slate-500">Status alokasi</p>
                  <p className={`mt-1.5 text-sm md:text-base font-bold ${overbudgetCount > 0 ? "text-rose-700" : totalBudgetedCount > 0 ? "text-emerald-700" : "text-slate-600"}`}>{isLoading ? "—" : allocationStatus}</p>
                  <p className="mt-1 text-[10px] md:text-xs text-slate-400">Kondisi anggaran</p>
                </div>
                <div className="bg-white p-3.5 md:p-5">
                  <p className="text-[11px] md:text-xs font-semibold text-slate-500">Anggaran dipantau</p>
                  <p className="mt-1.5 text-sm md:text-xl font-bold text-slate-900 tabular-nums">{isLoading ? "—" : totalBudgetedCount}</p>
                  <p className="mt-1 text-[10px] md:text-xs text-slate-400">Kategori & merchant</p>
                </div>
              </>
            ) : activeTab === "Tahunan" ? (
              <>
                <div className="bg-white p-3.5 md:p-5">
                  <p className="text-[11px] md:text-xs font-semibold text-slate-500">Bulan tercatat</p>
                  <p className="mt-1.5 text-sm md:text-xl font-bold text-slate-900 tabular-nums">{isLoading ? "—" : `${annualActiveMonths} bulan`}</p>
                  <p className="mt-1 text-[10px] md:text-xs text-slate-400">Memiliki transaksi</p>
                </div>
                <div className="bg-white p-3.5 md:p-5">
                  <p className="text-[11px] md:text-xs font-semibold text-slate-500">Pengeluaran tertinggi</p>
                  <p className="mt-1.5 text-sm md:text-base font-bold text-slate-900">{annualPeakExpense.value > 0 ? monthNames[annualPeakExpense.index] : "—"}</p>
                  <p className="mt-1 text-[10px] md:text-xs text-slate-400">{annualPeakExpense.value > 0 ? formatMoney(annualPeakExpense.value) : "Belum ada data"}</p>
                </div>
              </>
            ) : (
              <>
                <div className="bg-white p-3.5 md:p-5">
                  <p className="text-[11px] md:text-xs font-semibold text-slate-500">Rata-rata pengeluaran tahunan</p>
                  <p className="mt-1.5 break-words text-sm md:text-lg font-bold text-slate-900 tabular-nums">{isLoading ? "—" : formatMoney(avgAnnualExpense)}</p>
                  <p className="mt-1 text-[10px] md:text-xs text-slate-400">Sepanjang periode</p>
                </div>
                <div className="bg-white p-3.5 md:p-5">
                  <p className="text-[11px] md:text-xs font-semibold text-slate-500">Tahun terhemat</p>
                  <p className="mt-1.5 text-sm md:text-xl font-bold text-slate-900">{isLoading || maxMargin === -Infinity ? "—" : bestYear}</p>
                  <p className="mt-1 text-[10px] md:text-xs text-slate-400">{maxMargin === -Infinity ? "Belum ada margin" : `${(maxMargin * 100).toFixed(1)}% margin`}</p>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className={`flex items-start gap-3 rounded-2xl border p-4 md:p-5 ${hasReportData && reportNet < 0 ? "border-rose-200 bg-rose-50/70" : "border-emerald-200/80 bg-[#F1F7F2]"}`} aria-labelledby="primary-insight-heading">
        <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${hasReportData && reportNet < 0 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-800"}`}>
          <Bot className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <h2 id="primary-insight-heading" className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">Insight utama</h2>
          <p className="mt-1 text-sm md:text-base font-semibold leading-relaxed text-slate-900">{primaryInsight}</p>
          <p className="mt-1 text-xs md:text-sm leading-relaxed text-slate-600">{supportingInsight}</p>
        </div>
      </section>

      {/* TAB 1: BULANAN */}
      {activeTab === "Bulanan" && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 motion-reduce:animate-none">
          {/* Breakdown Section */}
          <div className="w-full">
            <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-4 md:p-6 w-full">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-6 gap-4">
                <div className="w-full lg:w-auto">
                  <h3 className="text-base md:text-lg font-bold tracking-tight text-gray-900">Rincian transaksi</h3>
                  <p className="mt-1 text-xs md:text-sm text-slate-500">Lihat kontribusi, frekuensi, dan kondisi anggaran setiap kelompok.</p>
                  <div className="mt-3 grid grid-cols-3 bg-slate-100 p-1 rounded-xl">
                    <button type="button" onClick={() => setPrimaryMode("Pengeluaran")} className={`min-h-11 sm:min-h-9 px-2 md:px-3 text-xs font-semibold rounded-lg transition-colors ${primaryMode === "Pengeluaran" ? "bg-white text-emerald-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>Pengeluaran</button>
                    <button type="button" onClick={() => setPrimaryMode("Pemasukan")} className={`min-h-11 sm:min-h-9 px-2 md:px-3 text-xs font-semibold rounded-lg transition-colors ${primaryMode === "Pemasukan" ? "bg-white text-emerald-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>Pemasukan</button>
                    <button type="button" onClick={() => setPrimaryMode("Net")} className={`min-h-11 sm:min-h-9 px-2 md:px-3 text-xs font-semibold rounded-lg transition-colors ${primaryMode === "Net" ? "bg-white text-emerald-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>Saldo Bersih</button>
                  </div>
                </div>
                <div className="grid w-full grid-cols-2 bg-slate-100 p-1 rounded-xl lg:w-auto">
                  <button 
                    type="button"
                    onClick={() => setBreakdownMode("Kategori")}
                    className={`min-h-11 sm:min-h-9 px-3 text-xs font-semibold rounded-lg transition-colors ${breakdownMode === "Kategori" ? "bg-white text-emerald-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                  >
                    Kategori
                  </button>
                  <button 
                    type="button"
                    onClick={() => setBreakdownMode("Merchant")}
                    className={`min-h-11 sm:min-h-9 px-3 text-xs font-semibold rounded-lg transition-colors ${breakdownMode === "Merchant" ? "bg-white text-emerald-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                  >
                    Merchant
                  </button>
                </div>
              </div>
              
              {isLoading ? (
                <div className="flex flex-col md:flex-row gap-8 items-center md:items-start w-full py-4 animate-pulse">
                  <div className="w-full md:w-[35%] flex flex-col items-center gap-6">
                    <div className="w-48 h-48 rounded-full border-[14px] border-slate-200 bg-slate-100/50 flex items-center justify-center">
                      <div className="w-24 h-24 rounded-full bg-white shadow-inner" />
                    </div>
                    <div className="h-16 w-full bg-emerald-950/20 rounded-xl border border-emerald-900/10" />
                  </div>
                  <div className="w-full md:w-[65%] space-y-4">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="space-y-2">
                        <div className="flex justify-between">
                          <div className="h-4 w-28 bg-slate-200 rounded" />
                          <div className="h-4 w-20 bg-slate-200 rounded" />
                        </div>
                        <div className="w-full h-2 bg-slate-200/60 rounded-full" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : chartSum === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center">
                  <PieChart className="mx-auto h-7 w-7 text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada data untuk ditampilkan</p>
                  <p className="mt-1 text-xs text-slate-500">Tidak ada transaksi pada periode dan mode yang dipilih.</p>
                </div>
              ) : primaryMode === 'Net' ? (
                <>
                  <div className="hidden lg:block overflow-x-auto w-full">
                    <table className="w-full min-w-[980px] text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500">
                          <th className="py-3 px-3 font-semibold">Kategori / Merchant</th>
                          <th className="py-3 px-3 font-semibold text-emerald-700">Masuk (+)</th>
                          <th className="py-3 px-3 font-semibold text-rose-700">Keluar (-)</th>
                          <th className="py-3 px-3 font-semibold text-slate-700">Net total (=)</th>
                          <th className="py-3 px-3 font-semibold">Alokasi anggaran</th>
                          <th className="py-3 px-3 font-semibold">Kondisi pemakaian</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeList.map(item => {
                          const budgetState = getBudgetPresentation(item.expense, item.budget);
                          return (
                            <tr key={item.name} className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
                              <td className="py-3.5 px-3">
                                <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                                <p className="mt-0.5 text-[11px] text-slate-400">{item.count} transaksi</p>
                              </td>
                              <td className="py-3.5 px-3 text-sm font-medium text-emerald-700 tabular-nums">{formatMoney(item.income)}</td>
                              <td className="py-3.5 px-3 text-sm font-medium text-rose-700 tabular-nums">{formatMoney(item.expense)}</td>
                              <td className={`py-3.5 px-3 text-sm font-bold tabular-nums ${item.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatMoney(item.net)}</td>
                              <td className="py-3.5 px-3">
                                <button type="button" onClick={() => openQuickEditBudget(item.name, breakdownMode === "Merchant")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 transition-colors" title="Edit alokasi anggaran">
                                  {item.budget > 0 ? formatMoney(item.budget) : "Atur anggaran"}
                                  <Edit3 className="h-3.5 w-3.5 text-slate-400" />
                                </button>
                              </td>
                              <td className="py-3.5 px-3 min-w-[185px]">
                                <div className="flex items-center justify-between gap-2">
                                  <span className={`text-xs font-bold ${budgetState.textClass}`}>{budgetState.label}</span>
                                  {item.budget > 0 && <span className="text-[11px] font-semibold text-slate-500 tabular-nums">{budgetState.percentage.toFixed(0)}%</span>}
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-label={`${budgetState.percentage.toFixed(0)} persen anggaran terpakai`}>
                                  <div className={`h-full rounded-full ${budgetState.barClass}`} style={{ width: `${budgetState.progressWidth}%` }} />
                                </div>
                                <p className="mt-1 text-[10px] text-slate-500">{budgetState.detail}</p>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-3 lg:hidden">
                    {activeList.map((item, index) => {
                      const budgetState = getBudgetPresentation(item.expense, item.budget);
                      return (
                        <article key={item.name} className="rounded-xl border border-slate-200 bg-[#FCFCF9] p-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">#{index + 1} · {item.count} transaksi</p>
                              <h4 className="mt-1 truncate text-sm font-bold text-slate-900">{item.name}</h4>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold ${budgetState.badgeClass}`}>{budgetState.label}</span>
                          </div>
                          <dl className="mt-3 grid grid-cols-3 gap-2 border-y border-slate-100 py-3">
                            <div><dt className="text-[10px] text-slate-400">Masuk</dt><dd className="mt-1 break-words text-xs font-bold text-emerald-700 tabular-nums">{formatMoney(item.income)}</dd></div>
                            <div><dt className="text-[10px] text-slate-400">Keluar</dt><dd className="mt-1 break-words text-xs font-bold text-rose-700 tabular-nums">{formatMoney(item.expense)}</dd></div>
                            <div><dt className="text-[10px] text-slate-400">Net</dt><dd className={`mt-1 break-words text-xs font-bold tabular-nums ${item.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatMoney(item.net)}</dd></div>
                          </dl>
                          <div className="mt-3">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className={`font-semibold ${budgetState.textClass}`}>{budgetState.detail}</span>
                              {item.budget > 0 && <span className="font-bold text-slate-600 tabular-nums">{budgetState.percentage.toFixed(0)}%</span>}
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div className={`h-full rounded-full ${budgetState.barClass}`} style={{ width: `${budgetState.progressWidth}%` }} />
                            </div>
                            <button type="button" onClick={() => openQuickEditBudget(item.name, breakdownMode === "Merchant")} className="mt-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-xs font-semibold text-emerald-700">
                              <Edit3 className="h-3.5 w-3.5" /> {item.budget > 0 ? `Anggaran ${formatMoney(item.budget)}` : "Atur anggaran"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex flex-col sm:flex-row gap-5 md:gap-8 items-start w-full">
                  {/* Left Column */}
                  <div className="w-full sm:w-[35%] flex flex-col items-center gap-5">
                    {/* Interactive Donut Chart */}
                    <div className="relative hidden sm:block w-44 h-44 lg:w-48 lg:h-48 shrink-0" aria-label={`Diagram kontribusi ${breakdownMode.toLowerCase()}`}>
                      <svg viewBox="0 0 200 200" className="w-full h-full transform -rotate-90">
                        {svgPaths.map((slice) => (
                          <circle
                            key={slice.item.name}
                            cx="100"
                            cy="100"
                            r={svgRadius}
                            fill="transparent"
                            stroke={slice.color}
                            strokeWidth={hoveredSlice === slice.item.name ? strokeWidth + 6 : strokeWidth}
                            strokeDasharray={slice.strokeDasharray}
                            strokeDashoffset={slice.strokeDashoffset}
                            className="transition-all duration-300 cursor-pointer"
                            onMouseEnter={() => setHoveredSlice(slice.item.name)}
                            onMouseLeave={() => setHoveredSlice(null)}
                          />
                        ))}
                      </svg>
                      <div 
                        className="absolute inset-0 m-auto bg-white rounded-full flex items-center justify-center flex-col shadow-inner z-20 text-center px-2 pointer-events-auto" 
                        style={{ width: '110px', height: '110px' }}
                        onMouseEnter={() => setHoveredSlice(null)}
                        onMouseMove={(e) => {
                          e.stopPropagation();
                          setHoveredSlice(null);
                        }}
                      >
                        {activeHoveredSlice ? (
                          <>
                            <span className="text-[11px] font-bold truncate w-full" style={{ color: activeHoveredSlice.color }}>
                              {activeHoveredSlice.item.name}
                            </span>
                            <span className="text-[10px] font-semibold text-gray-700 mt-1">
                              {formatMoney(activeHoveredSlice.value)} ({activeHoveredSlice.percentage}%)
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-gray-500 font-medium">Total</span>
                            <span className="text-sm font-bold text-gray-900">{formatMoney(chartSum)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Insight Box */}
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3.5 w-full text-left">
                       <h4 className="text-emerald-800 font-bold text-[11px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Sorotan breakdown</h4>
                       <p className="text-slate-600 text-xs leading-relaxed">
                         {activeList.length > 0 && chartSum > 0
                           ? `${breakdownMode === 'Kategori' ? 'Kategori' : 'Merchant'} ${activeList[0].name} berkontribusi ${Math.round((Math.abs(getStatValue(activeList[0])) / chartSum) * 100)}% dari total ${primaryMode.toLowerCase()}.`
                           : "Belum cukup data untuk analisis."}
                       </p>
                    </div>
                  </div>

                  {/* Right Column List items */}
                  <div className="w-full sm:w-[65%] space-y-2.5">
                    {activeList.length === 0 && breakdownMode === "Merchant" ? (
                      <div className="py-8 text-center text-gray-500 text-sm border border-dashed border-gray-200 rounded-lg">
                        Belum ada transaksi berulang (minimal 2x) pada bulan ini.
                      </div>
                    ) : (
                      activeList.map((item, i) => {
                        const val = getStatValue(item);
                        const pct = chartSum > 0 ? ((Math.abs(val) / chartSum) * 100).toFixed(1) : "0";
                        const color = pieColors[i % pieColors.length];

                        return (
                          <div key={item.name} className={`rounded-xl border p-3 ${i === 0 ? "border-emerald-200 bg-emerald-50/40" : "border-slate-100 bg-[#FCFCF9]"}`}>
                            <div className="flex items-start justify-between gap-3 text-sm">
                              <div className="flex min-w-0 items-start gap-2.5">
                                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white border border-slate-200 text-[10px] font-bold text-slate-500">{i + 1}</span>
                                <div className="min-w-0">
                                  <p className="truncate font-semibold text-slate-800">{item.name}</p>
                                  <p className="mt-0.5 text-[10px] text-slate-400">{item.count} transaksi · {pct}% kontribusi</p>
                                </div>
                              </div>
                              <span className="max-w-[48%] break-words text-right font-bold text-slate-900 tabular-nums">{formatMoney(val)}</span>
                            </div>
                            <div className="mt-2.5 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden" aria-label={`${pct} persen dari total`}>
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Rekap Sisa Uang Per Rekening Table */}
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 md:p-5 border-b border-slate-200/60">
              <h3 className="text-base md:text-lg font-bold tracking-tight text-gray-900">Rekap kas & saldo rekening</h3>
              <p className="mt-1 text-xs md:text-sm text-slate-500">Pergerakan saldo awal, uang masuk, uang keluar, dan saldo akhir.</p>
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-gray-50 text-gray-500 border-b">
                  <tr>
                    <th className="px-5 py-3 font-medium">Rekening</th>
                    <th className="px-5 py-3 font-medium text-right">Saldo Awal</th>
                    <th className="px-5 py-3 font-medium text-right text-emerald-600">Masuk (+)</th>
                    <th className="px-5 py-3 font-medium text-right text-rose-600">Keluar (-)</th>
                    <th className="px-5 py-3 font-medium text-right">Saldo Akhir (=)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {isLoading ? (
                    [1, 2, 3].map(i => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-5 py-4"><div className="h-5 w-32 bg-slate-200 rounded" /></td>
                        <td className="px-5 py-4 text-right"><div className="h-5 w-24 bg-slate-200 rounded ml-auto" /></td>
                        <td className="px-5 py-4 text-right"><div className="h-5 w-20 bg-slate-200 rounded ml-auto" /></td>
                        <td className="px-5 py-4 text-right"><div className="h-5 w-20 bg-slate-200 rounded ml-auto" /></td>
                        <td className="px-5 py-4 text-right"><div className="h-5 w-24 bg-slate-200 rounded ml-auto" /></td>
                      </tr>
                    ))
                  ) : (
                    accounts.map(acc => {
                      const accIn = filteredTx.filter(t => t.type === 'INCOME' && isAccountMatch(acc.name, t.sumber_dana)).reduce((sum, t) => sum + Number(t.amount), 0);
                      const accOut = filteredTx.filter(t => t.type === 'EXPENSE' && isAccountMatch(acc.name, t.sumber_dana)).reduce((sum, t) => sum + Number(t.amount), 0);
                      const initBal = Number(acc.initial_balance) || 0;
                      const finalBal = initBal + accIn - accOut;
                      
                      return (
                        <tr key={acc.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2">
                              <BankLogo bankName={acc.name} className="h-7 px-2 min-w-[42px] max-w-[64px] flex items-center justify-center rounded-lg shrink-0 overflow-hidden shadow-sm" />
                              <span className="font-medium text-gray-900">{acc.name} {acc.is_primary && <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded ml-1 text-gray-500 uppercase">Utama</span>}</span>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-right text-gray-600">{formatMoney(initBal)}</td>
                          <td className="px-5 py-4 text-right text-emerald-600 font-medium">+{formatMoney(accIn)}</td>
                          <td className="px-5 py-4 text-right text-rose-600 font-medium">-{formatMoney(accOut)}</td>
                          <td className="px-5 py-4 text-right font-bold text-gray-900">{formatMoney(finalBal)}</td>
                        </tr>
                      );
                    })
                  )}
                  {!isLoading && accounts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-gray-400">Belum ada data rekening.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <details className="group md:hidden">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-emerald-800 [&::-webkit-details-marker]:hidden">
                Lihat rincian {accounts.length} rekening
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-3 border-t border-slate-100 p-3">
                {isLoading ? (
                  [1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl bg-slate-100" />)
                ) : accounts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">Belum ada data rekening.</div>
                ) : (
                  accounts.map((acc) => {
                    const accIn = filteredTx.filter(t => t.type === 'INCOME' && isAccountMatch(acc.name, t.sumber_dana)).reduce((sum, t) => sum + Number(t.amount), 0);
                    const accOut = filteredTx.filter(t => t.type === 'EXPENSE' && isAccountMatch(acc.name, t.sumber_dana)).reduce((sum, t) => sum + Number(t.amount), 0);
                    const initBal = Number(acc.initial_balance) || 0;
                    const finalBal = initBal + accIn - accOut;

                    return (
                      <article key={acc.id} className="rounded-xl border border-slate-200 bg-[#FCFCF9] p-3.5">
                        <div className="flex items-center gap-2.5">
                          <BankLogo bankName={acc.name} className="h-8 min-w-[46px] max-w-[68px] shrink-0 overflow-hidden rounded-lg px-2 shadow-sm" />
                          <div className="min-w-0">
                            <h4 className="truncate text-sm font-bold text-slate-900">{acc.name}</h4>
                            <p className="text-[10px] uppercase tracking-wider text-slate-400">{acc.is_primary ? "Rekening utama" : "Rekening"}</p>
                          </div>
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                          <div><dt className="text-[10px] text-slate-400">Saldo awal</dt><dd className="mt-1 break-words text-xs font-semibold text-slate-700 tabular-nums">{formatMoney(initBal)}</dd></div>
                          <div><dt className="text-[10px] text-slate-400">Saldo akhir</dt><dd className="mt-1 break-words text-xs font-bold text-slate-900 tabular-nums">{formatMoney(finalBal)}</dd></div>
                          <div><dt className="text-[10px] text-slate-400">Masuk</dt><dd className="mt-1 break-words text-xs font-semibold text-emerald-700 tabular-nums">+{formatMoney(accIn)}</dd></div>
                          <div><dt className="text-[10px] text-slate-400">Keluar</dt><dd className="mt-1 break-words text-xs font-semibold text-rose-700 tabular-nums">-{formatMoney(accOut)}</dd></div>
                        </dl>
                      </article>
                    );
                  })
                )}
              </div>
            </details>
          </div>
        </div>
      )}

      {/* TAB 2: TAHUNAN */}
      {activeTab === "Tahunan" && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 motion-reduce:animate-none">
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-4 md:p-6">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-base md:text-lg font-bold tracking-tight text-gray-900">Arus kas bulanan {selectedYear}</h3>
                <p className="mt-1 text-xs md:text-sm text-slate-500">Bandingkan pemasukan, pengeluaran, dan pendapatan bersih setiap bulan.</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Pemasukan</span>
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> Pengeluaran</span>
              </div>
            </div>
            
            {/* Real Bar Chart for Yearly */}
            {!isLoading && annualActiveMonths === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-12 text-center">
                <BarChart3 className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada arus kas tahun ini</p>
                <p className="mt-1 text-xs text-slate-500">Chart akan muncul setelah ada transaksi pada {selectedYear}.</p>
              </div>
            ) : (
            <div className="h-56 md:h-64 flex items-end justify-between gap-1 md:gap-2 border-b border-slate-200 pb-2 px-0 md:px-2" aria-label={`Chart pemasukan dan pengeluaran bulanan ${selectedYear}`}>
              {["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"].map((month, i) => {
                const stat = annualStats[i];
                const inHeight = annualChartMax > 0 ? (stat.income / annualChartMax) * 100 : 0; 
                const outHeight = annualChartMax > 0 ? (stat.expense / annualChartMax) * 100 : 0;
                return (
                  <div key={month} className="flex flex-col items-center gap-1 group flex-1">
                    <div className="w-full max-w-[24px] flex gap-0.5 items-end h-48 relative">
                      {isLoading ? (
                        <div className="w-full bg-slate-200/70 rounded-t-sm animate-pulse" style={{ height: `${20 + ((i * 17) % 60)}%` }} />
                      ) : (
                        <>
                          <div className="w-1/2 bg-emerald-400 rounded-t-sm transition-all hover:bg-emerald-500 relative" style={{ height: `${inHeight}%` }}>
                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 text-[10px] bg-gray-800 text-white px-2 py-1 rounded pointer-events-none whitespace-nowrap z-10 transition-opacity">
                              Masuk: {formatMoney(stat.income)}
                            </div>
                          </div>
                          <div className="w-1/2 bg-rose-400 rounded-t-sm transition-all hover:bg-rose-500 relative" style={{ height: `${outHeight}%` }}>
                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 text-[10px] bg-gray-800 text-white px-2 py-1 rounded pointer-events-none whitespace-nowrap z-10 transition-opacity">
                              Keluar: {formatMoney(stat.expense)}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 font-medium">{month}</span>
                  </div>
                )
              })}
            </div>
            )}
            
            <div className="mt-8 hidden md:block overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-gray-50 text-gray-500 border-b">
                  <tr>
                    <th className="px-4 py-3 font-medium">Bulan</th>
                    <th className="px-4 py-3 font-medium text-right text-emerald-600">Pemasukan</th>
                    <th className="px-4 py-3 font-medium text-right text-rose-600">Pengeluaran</th>
                    <th className="px-4 py-3 font-medium text-right">Pendapatan Bersih</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {isLoading ? (
                    [0, 1, 2, 3, 4, 5].map((i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-200 rounded" /></td>
                        <td className="px-4 py-3 text-right"><div className="h-4 w-24 bg-slate-200 rounded ml-auto" /></td>
                        <td className="px-4 py-3 text-right"><div className="h-4 w-24 bg-slate-200 rounded ml-auto" /></td>
                        <td className="px-4 py-3 text-right"><div className="h-4 w-24 bg-slate-200 rounded ml-auto" /></td>
                      </tr>
                    ))
                  ) : (
                    ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"].map((month, i) => {
                      const stat = annualStats[i];
                      return (
                        <tr key={month} className="hover:bg-gray-50/50">
                          <td className="px-4 py-3 font-medium text-gray-900">{month}</td>
                          <td className="px-4 py-3 text-right">{formatMoney(stat.income)}</td>
                          <td className="px-4 py-3 text-right">{formatMoney(stat.expense)}</td>
                          <td className={`px-4 py-3 text-right font-semibold ${stat.net < 0 ? 'text-rose-600' : 'text-gray-900'}`}>{formatMoney(stat.net)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <details className="group mt-5 md:hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-semibold text-emerald-800 [&::-webkit-details-marker]:hidden">
                Rincian angka per bulan
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-3">
                {annualStats.map((stat, index) => (
                  <div key={monthNames[index]} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900">{monthNames[index]}</p>
                      <p className={`text-xs font-bold tabular-nums ${stat.net < 0 ? "text-rose-700" : "text-emerald-700"}`}>{stat.net > 0 ? "+" : ""}{formatMoney(stat.net)}</p>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <p className="text-slate-500">Masuk <strong className="block mt-0.5 break-words text-emerald-700 tabular-nums">{formatMoney(stat.income)}</strong></p>
                      <p className="text-slate-500">Keluar <strong className="block mt-0.5 break-words text-rose-700 tabular-nums">{formatMoney(stat.expense)}</strong></p>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>

          {/* Heatmap Matrix & Pie Chart */}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(220px,1fr)]">
            <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-4 md:p-6 min-w-0">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-6 gap-4">
                <div>
                  <h3 className="text-base md:text-lg font-bold tracking-tight text-gray-900">Sebaran pengeluaran tahunan</h3>
                  <p className="mt-1 text-xs md:text-sm text-slate-500">Kontribusi tiap kelompok dan pola pengeluaran dari bulan ke bulan.</p>
                </div>
                <div className="grid w-full grid-cols-2 bg-slate-100 p-1 rounded-xl sm:w-auto">
                  <button type="button" onClick={() => setAnnualBreakdownMode("Kategori")} className={`min-h-11 sm:min-h-9 px-3 text-xs font-semibold rounded-lg transition-colors ${annualBreakdownMode === "Kategori" ? "bg-white text-emerald-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>Kategori</button>
                  <button type="button" onClick={() => setAnnualBreakdownMode("Merchant")} className={`min-h-11 sm:min-h-9 px-3 text-xs font-semibold rounded-lg transition-colors ${annualBreakdownMode === "Merchant" ? "bg-white text-emerald-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>Merchant</button>
                </div>
              </div>
              
              <div className="hidden lg:block w-full overflow-x-auto">
                <table className="w-full text-xs text-left min-w-[900px] border-collapse">
                  <thead>
                    <tr>
                      <th className="p-2 border-b font-medium text-gray-500 w-32 sticky left-0 bg-white z-10">Kategori / Merchant</th>
                      {["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"].map(m => (
                        <th key={m} className="p-2 border-b font-medium text-gray-500 text-center w-16">{m}</th>
                      ))}
                      <th className="p-2 border-b font-semibold text-gray-700 text-right w-24 bg-gray-50">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      [1, 2, 3, 4].map(i => (
                        <tr key={i} className="animate-pulse">
                          <td className="p-2 border-b"><div className="h-4 w-24 bg-slate-200 rounded" /></td>
                          {Array(12).fill(0).map((_, idx) => (
                            <td key={idx} className="p-2 border-b text-center"><div className="h-3 w-6 bg-slate-100 rounded mx-auto" /></td>
                          ))}
                          <td className="p-2 border-b text-right"><div className="h-4 w-16 bg-slate-200 rounded ml-auto" /></td>
                        </tr>
                      ))
                    ) : heatmapData.length === 0 ? (
                      <tr><td colSpan={14} className="py-8 text-center text-gray-400">Belum ada pengeluaran di tahun ini.</td></tr>
                    ) : (
                      heatmapData.map((row) => (
                        <tr key={row.name}>
                          <td className="p-2 border-b font-medium text-gray-800 sticky left-0 bg-white z-10 border-r border-gray-100">
                            <span className="block">{row.name}</span>
                            {row.count !== null && <span className="mt-0.5 block text-[9px] font-normal text-slate-400">{row.count} transaksi</span>}
                          </td>
                          {row.months.map((val, i) => {
                            const ratio = maxHeatmapValue > 0 ? val / maxHeatmapValue : 0;
                            let bgClass = 'bg-transparent text-gray-400';
                            if (ratio > 0.6) bgClass = 'bg-rose-200 font-semibold text-rose-900';
                            else if (ratio > 0.3) bgClass = 'bg-rose-100 font-medium text-rose-800';
                            else if (ratio > 0) bgClass = 'bg-rose-50 text-slate-700';

                            return (
                              <td key={i} className={`p-2 border-b text-center border-l border-white ${bgClass}`}>
                                <span className="text-[10px]">{val > 0 ? formatCompact(val) : '-'}</span>
                              </td>
                            )
                          })}
                          <td className="p-2 border-b font-bold text-gray-900 text-right bg-gray-50 border-l border-gray-100">{formatMoney(row.total)}</td>
                        </tr>
                      ))
                    )}
                    {!isLoading && heatmapData.length > 0 && (
                      <tr className="bg-gray-100">
                        <td className="p-2 font-bold text-gray-900 sticky left-0 bg-gray-100 z-10 border-r border-gray-200 border-t border-gray-300">Total Bulanan</td>
                        {heatmapMonthlyTotals.map((val, i) => (
                          <td key={i} className="p-2 text-center font-semibold text-gray-800 border-l border-white border-t border-gray-300">
                            <span className="text-[10px]">{val > 0 ? formatCompact(val) : '-'}</span>
                          </td>
                        ))}
                        <td className="p-2 font-black text-rose-700 text-right bg-gray-200 border-l border-white border-t border-gray-300">{formatMoney(heatmapGrandTotal)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2.5 lg:hidden">
                {isLoading ? (
                  [1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-slate-100" />)
                ) : heatmapData.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center">
                    <p className="text-sm font-semibold text-slate-700">Belum ada pengeluaran tahun ini</p>
                    <p className="mt-1 text-xs text-slate-500">Breakdown akan muncul setelah ada transaksi pengeluaran.</p>
                  </div>
                ) : (
                  heatmapData.map((row, index) => {
                    const percentage = heatmapGrandTotal > 0 ? (row.total / heatmapGrandTotal) * 100 : 0;
                    return (
                      <details key={row.name} className="group rounded-xl border border-slate-200 bg-[#FCFCF9]">
                        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white border border-slate-200 text-[10px] font-bold text-slate-500">{index + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-slate-900">{row.name}</span>
                            <span className="mt-0.5 block text-[10px] text-slate-400">{percentage.toFixed(1)}% dari pengeluaran{row.count !== null ? ` · ${row.count} transaksi` : ""}</span>
                          </span>
                          <span className="max-w-[42%] break-words text-right text-xs font-bold text-slate-900 tabular-nums">{formatMoney(row.total)}</span>
                          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-px border-t border-slate-200 bg-slate-200">
                          {row.months.map((value, monthIndex) => (
                            <div key={monthNames[monthIndex]} className="bg-white p-2.5">
                              <p className="text-[10px] text-slate-400">{monthNames[monthIndex].slice(0, 3)}</p>
                              <p className="mt-1 break-words text-[11px] font-semibold text-slate-700 tabular-nums">{value > 0 ? formatMoney(value) : "—"}</p>
                            </div>
                          ))}
                        </div>
                      </details>
                    );
                  })
                )}
              </div>
            </div>

            <div className="relative hidden overflow-hidden bg-[#F1F7F2] border border-emerald-100 rounded-2xl shadow-sm p-6 lg:flex flex-col items-center justify-center">
              <h4 className="text-sm font-bold text-emerald-950 mb-6 text-center w-full">Persentase pengeluaran</h4>
              {isLoading ? (
                <div className="w-full flex flex-col items-center animate-pulse relative z-10">
                  <div className="w-48 h-48 rounded-full border-[14px] border-emerald-950/60 bg-emerald-950/40 mb-6" />
                  <div className="w-full space-y-2">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-4 w-full bg-emerald-950/50 rounded" />
                    ))}
                  </div>
                </div>
              ) : heatmapData.length === 0 ? (
                <div className="text-slate-500 text-sm">Tidak ada data</div>
              ) : (
                <div className="relative z-10 w-full flex flex-col items-center">
                  <div className="relative w-48 h-48 shrink-0 mb-6">
                    <svg viewBox="0 0 200 200" className="w-full h-full transform -rotate-90">
                      {annualSvgPaths.map((slice) => (
                        <circle
                          key={slice.item.name}
                          cx="100"
                          cy="100"
                          r={svgRadius}
                          fill="transparent"
                          stroke={slice.color}
                          strokeWidth={strokeWidth}
                          strokeDasharray={slice.strokeDasharray}
                          strokeDashoffset={slice.strokeDashoffset}
                          className="transition-all duration-300 hover:opacity-80 cursor-pointer"
                        />
                      ))}
                    </svg>
                  </div>
                  <div className="w-full space-y-2 max-h-[300px] overflow-y-auto pr-2">
                    {annualSvgPaths.slice(0, 10).map(slice => (
                      <div key={slice.item.name} className="flex justify-between items-center text-xs">
                        <div className="flex items-center gap-1.5 truncate pr-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: slice.color }}></span>
                          <span className="truncate text-slate-600">{slice.item.name}</span>
                        </div>
                        <span className="font-bold text-emerald-900 shrink-0">{slice.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MAKRO MULTI-TAHUN */}
      {activeTab === "Makro" && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 motion-reduce:animate-none">
          
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-4 md:p-6">
            <div>
              <h3 className="text-base md:text-lg font-bold tracking-tight text-gray-900">{macroChartTitle}</h3>
              <p className="mt-1 text-xs md:text-sm text-slate-500">Pergerakan pemasukan, pengeluaran, dan tabungan bersih sepanjang periode.</p>
            </div>
            
            <div className="h-[290px] md:h-[350px] w-full mt-5 md:mt-6">
              {isLoading ? (
                <div className="w-full h-full flex items-end justify-between gap-3 px-6 pb-6 pt-12 animate-pulse bg-slate-50/50 rounded-xl">
                  {[40, 65, 55, 80, 70, 90, 85].map((h, i) => (
                    <div key={i} className="flex-1 bg-slate-200/80 rounded-t-md" style={{ height: `${h}%` }} />
                  ))}
                </div>
              ) : !hasReportData ? (
                <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-5 text-center">
                  <div>
                    <TrendingUp className="mx-auto h-7 w-7 text-slate-300" />
                    <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada tren untuk ditampilkan</p>
                    <p className="mt-1 text-xs text-slate-500">Chart akan muncul setelah ada transaksi pada rekening yang dipilih.</p>
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={macroChartData}
                    margin={{ top: 10, right: 4, left: -8, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorPemasukan" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorPengeluaran" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#64748b', fontSize: 12 }}
                      dy={10}
                    />
                    <YAxis 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#64748b', fontSize: 12 }}
                      tickFormatter={(value) => {
                        if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(0) + 'M';
                        if (Math.abs(value) >= 1000) return (value / 1000).toFixed(0) + 'k';
                        return value.toString();
                      }}
                      width={54}
                    />
                    <RechartsTooltip 
                      content={({ active, payload, label }: any) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-white p-3 border border-gray-100 shadow-xl rounded-xl flex flex-col gap-2 min-w-[200px]">
                              <p className="font-semibold text-gray-900 border-b border-gray-100 pb-2 mb-1">{label}</p>
                              {payload.map((entry: any, index: number) => (
                                <div key={index} className="flex justify-between items-center text-sm gap-4">
                                  <span className="flex items-center gap-1.5 font-medium text-gray-600">
                                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }}></span>
                                    {entry.name}
                                  </span>
                                  <span className={`font-semibold ${entry.name === 'Net' ? (entry.value >= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-gray-900'}`}>
                                    {formatMoney(entry.value)}
                                  </span>
                                </div>
                              ))}
                              {payload[0]?.payload?.margin !== undefined && (
                                <div className="flex justify-between items-center text-xs mt-1 pt-2 border-t border-gray-100">
                                  <span className="text-gray-500 font-medium">Savings Margin</span>
                                  <span className="font-bold text-emerald-600">{payload[0].payload.margin.toFixed(1)}%</span>
                                </div>
                              )}
                            </div>
                          );
                        }
                        return null;
                      }} 
                    />
                    
                    <Area 
                      type="monotone" 
                      dataKey="Pemasukan" 
                      stroke="#10b981" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorPemasukan)" 
                      activeDot={{ r: 6, strokeWidth: 0, fill: '#10b981' }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="Pengeluaran" 
                      stroke="#f43f5e" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorPengeluaran)" 
                      activeDot={{ r: 6, strokeWidth: 0, fill: '#f43f5e' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="Net"
                      stroke="#0ea5e9"
                      strokeWidth={3}
                      dot={{ r: 4, fill: '#0ea5e9', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 6, strokeWidth: 0, fill: '#0ea5e9' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
            
            <div className="flex flex-wrap gap-x-5 gap-y-2 justify-center mt-5 text-xs md:text-sm">
               <div className="flex items-center gap-2">
                 <div className="w-3 h-3 rounded-full bg-emerald-500"></div> 
                 <span className="text-gray-600 font-medium">Pemasukan</span>
               </div>
               <div className="flex items-center gap-2">
                 <div className="w-3 h-3 rounded-full bg-rose-500"></div> 
                 <span className="text-gray-600 font-medium">Pengeluaran</span>
               </div>
               <div className="flex items-center gap-2">
                 <div className="w-3 h-3 rounded-full bg-sky-500"></div> 
                 <span className="text-gray-600 font-medium">Tabungan Bersih (Net)</span>
               </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
             <div className="p-4 md:p-5 border-b border-slate-200/60">
              <h3 className="text-base md:text-lg font-bold tracking-tight text-gray-900">Rekap multi-tahun</h3>
              <p className="mt-1 text-xs md:text-sm text-slate-500">Perbandingan pemasukan, pengeluaran, net, dan margin tabungan tiap tahun.</p>
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-gray-50 text-gray-500 border-b">
                  <tr>
                    <th className="px-5 py-3 font-medium">Tahun</th>
                    <th className="px-5 py-3 font-medium text-right text-emerald-600">Pemasukan</th>
                    <th className="px-5 py-3 font-medium text-right text-rose-600">Pengeluaran</th>
                    <th className="px-5 py-3 font-medium text-right">Pendapatan Bersih</th>
                    <th className="px-5 py-3 font-medium text-right">Margin Tabungan (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {isLoading ? (
                    [1, 2, 3].map((i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-5 py-4"><div className="h-5 w-16 bg-slate-200 rounded" /></td>
                        <td className="px-5 py-4 text-right"><div className="h-5 w-28 bg-slate-200 rounded ml-auto" /></td>
                        <td className="px-5 py-4 text-right"><div className="h-5 w-28 bg-slate-200 rounded ml-auto" /></td>
                        <td className="px-5 py-4 text-right"><div className="h-5 w-28 bg-slate-200 rounded ml-auto" /></td>
                        <td className="px-5 py-4 text-right"><div className="h-5 w-16 bg-slate-200 rounded ml-auto" /></td>
                      </tr>
                    ))
                  ) : (
                    activeYears.map((year) => {
                      const stat = multiYearStats[year];
                      const margin = stat.income > 0 ? ((stat.income - stat.expense) / stat.income) * 100 : 0;
                      return (
                        <tr key={year} className="hover:bg-gray-50/50">
                          <td className="px-5 py-4 font-bold text-gray-900">{year}</td>
                          <td className="px-5 py-4 text-right">{formatMoney(stat.income)}</td>
                          <td className="px-5 py-4 text-right">{formatMoney(stat.expense)}</td>
                          <td className={`px-5 py-4 text-right font-semibold ${stat.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{stat.net >= 0 ? '+' : ''}{formatMoney(stat.net)}</td>
                          <td className="px-5 py-4 text-right text-gray-600">{stat.income > 0 ? margin.toFixed(1) + '%' : '-'}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            <details className="group md:hidden">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-emerald-800 [&::-webkit-details-marker]:hidden">
                Lihat rincian {activeYears.length} tahun
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-3 border-t border-slate-100 p-3">
                {activeYears.map((year) => {
                  const stat = multiYearStats[year];
                  const margin = stat.income > 0 ? (stat.net / stat.income) * 100 : null;
                  return (
                    <article key={year} className="rounded-xl border border-slate-200 bg-[#FCFCF9] p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-base font-bold text-slate-900">{year}</h4>
                        <span className={`text-sm font-bold tabular-nums ${stat.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{stat.net > 0 ? "+" : ""}{formatMoney(stat.net)}</span>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                        <div><dt className="text-[10px] text-slate-400">Pemasukan</dt><dd className="mt-1 break-words text-xs font-semibold text-emerald-700 tabular-nums">{formatMoney(stat.income)}</dd></div>
                        <div><dt className="text-[10px] text-slate-400">Pengeluaran</dt><dd className="mt-1 break-words text-xs font-semibold text-rose-700 tabular-nums">{formatMoney(stat.expense)}</dd></div>
                        <div className="col-span-2"><dt className="text-[10px] text-slate-400">Margin tabungan</dt><dd className="mt-1 text-xs font-bold text-slate-700 tabular-nums">{margin === null ? "Belum tersedia" : `${margin.toFixed(1)}%`}</dd></div>
                      </dl>
                    </article>
                  );
                })}
              </div>
            </details>
          </div>

          {/* Sebaran Pengeluaran Multi-Tahun Visual Breakdown */}
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-4 md:p-6 w-full">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-6 gap-4">
              <div className="w-full lg:w-auto">
                <h3 className="text-base md:text-lg font-bold tracking-tight text-gray-900">Sebaran pengeluaran multi-tahun</h3>
                <p className="mt-1 text-xs md:text-sm text-slate-500">Ranking pengeluaran dan perubahannya dibanding tahun sebelumnya.</p>
                <div className="mt-3 w-full sm:w-40">
                  <CustomSelect 
                    value={String(safeMultiYearSelected)} 
                    onChange={val => setMultiYearSelectedYear(Number(val))}
                    options={activeYears.map(y => ({ value: String(y), label: `Tahun ${y}` }))}
                    buttonClassName="min-h-11"
                  />
                </div>
              </div>
              <div className="grid w-full grid-cols-2 bg-slate-100 p-1 rounded-xl lg:w-auto">
                <button 
                  type="button"
                  onClick={() => setMultiYearBreakdownMode("Kategori")}
                  className={`min-h-11 sm:min-h-9 px-3 text-xs font-semibold rounded-lg transition-colors ${multiYearBreakdownMode === "Kategori" ? "bg-white text-emerald-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  Kategori
                </button>
                <button 
                  type="button"
                  onClick={() => setMultiYearBreakdownMode("Merchant")}
                  className={`min-h-11 sm:min-h-9 px-3 text-xs font-semibold rounded-lg transition-colors ${multiYearBreakdownMode === "Merchant" ? "bg-white text-emerald-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  Merchant
                </button>
              </div>
            </div>
            
            {isLoading ? (
              <div className="flex flex-col md:flex-row gap-8 items-center md:items-start w-full py-4 animate-pulse">
                <div className="w-full md:w-[35%] flex flex-col items-center gap-6">
                  <div className="w-48 h-48 rounded-full border-[14px] border-slate-200 bg-slate-100/50 flex items-center justify-center">
                    <div className="w-24 h-24 rounded-full bg-white shadow-inner" />
                  </div>
                  <div className="h-16 w-full bg-emerald-950/20 rounded-xl border border-emerald-900/10" />
                </div>
                <div className="w-full md:w-[65%] space-y-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="space-y-2">
                      <div className="flex justify-between">
                        <div className="h-4 w-28 bg-slate-200 rounded" />
                        <div className="h-4 w-20 bg-slate-200 rounded" />
                      </div>
                      <div className="w-full h-2 bg-slate-200/60 rounded-full" />
                    </div>
                  ))}
                </div>
              </div>
            ) : myBreakdownTotal === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center">
                <PieChart className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada pengeluaran pada {safeMultiYearSelected}</p>
                <p className="mt-1 text-xs text-slate-500">Pilih tahun lain atau tambahkan transaksi untuk melihat breakdown.</p>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-5 md:gap-8 items-start w-full">
                {/* Left Column */}
                <div className="w-full sm:w-[35%] flex flex-col items-center gap-5">
                  {/* Interactive Donut Chart */}
                  <div className="relative hidden sm:block w-44 h-44 lg:w-48 lg:h-48 shrink-0" aria-label={`Diagram pengeluaran ${multiYearBreakdownMode.toLowerCase()} tahun ${safeMultiYearSelected}`}>
                    <svg viewBox="0 0 200 200" className="w-full h-full transform -rotate-90">
                      {mySvgPaths.map((slice) => (
                        <circle
                          key={slice.item.name}
                          cx="100"
                          cy="100"
                          r={svgRadius}
                          fill="transparent"
                          stroke={slice.color}
                          strokeWidth={myHoveredSlice === slice.item.name ? strokeWidth + 6 : strokeWidth}
                          strokeDasharray={slice.strokeDasharray}
                          strokeDashoffset={slice.strokeDashoffset}
                          className="transition-all duration-300 cursor-pointer"
                          onMouseEnter={() => setMyHoveredSlice(slice.item.name)}
                          onMouseLeave={() => setMyHoveredSlice(null)}
                        />
                      ))}
                    </svg>
                    <div 
                      className="absolute inset-0 m-auto bg-white rounded-full flex items-center justify-center flex-col shadow-inner z-20 text-center px-2 pointer-events-auto" 
                      style={{ width: '110px', height: '110px' }}
                      onMouseEnter={() => setMyHoveredSlice(null)}
                      onMouseMove={(e) => {
                        e.stopPropagation();
                        setMyHoveredSlice(null);
                      }}
                    >
                      {(() => {
                        const activeMyHoveredSlice = myHoveredSlice ? mySvgPaths.find(s => s.item.name === myHoveredSlice) : null;
                        if (activeMyHoveredSlice) {
                          return (
                            <>
                              <span className="text-[11px] font-bold truncate w-full" style={{ color: activeMyHoveredSlice.color }}>
                                {activeMyHoveredSlice.item.name}
                              </span>
                              <span className="text-[10px] font-semibold text-gray-700 mt-1">
                                {formatMoney(activeMyHoveredSlice.item.currentVal)} ({activeMyHoveredSlice.percentage}%)
                              </span>
                            </>
                          );
                        }
                        return (
                          <>
                            <span className="text-xs text-gray-500 font-medium">Total</span>
                            <span className="text-sm font-bold text-gray-900">{formatMoney(myBreakdownTotal)}</span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  {/* Insight Box */}
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3.5 w-full text-left">
                     <h4 className="text-emerald-800 font-bold text-[11px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Sorotan breakdown</h4>
                     <p className="text-slate-600 text-xs leading-relaxed">
                       {myBreakdownData.length > 0
                         ? `${multiYearBreakdownMode === 'Kategori' ? 'Kategori' : 'Merchant'} ${myBreakdownData[0].name} berkontribusi ${Math.round((myBreakdownData[0].currentVal / myBreakdownTotal) * 100)}% dari pengeluaran ${safeMultiYearSelected}.`
                         : "Belum cukup data untuk analisis."}
                     </p>
                  </div>
                </div>

                {/* Right Column List items */}
                <div className="w-full sm:w-[65%] space-y-2.5">
                  {myBreakdownData.map((item, i) => {
                    const pct = myBreakdownTotal > 0 ? ((item.currentVal / myBreakdownTotal) * 100).toFixed(1) : "0";
                    const color = mySvgPaths[i]?.color || "#cbd5e1";
                    
                    let yoyBadge = null;
                    if (item.prevVal === null) {
                      yoyBadge = <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Tahun pertama</span>;
                    } else if (item.prevVal === 0 && item.currentVal > 0) {
                      yoyBadge = <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Baru di {safeMultiYearSelected}</span>;
                    } else if (item.yoy !== null) {
                      const isIncrease = item.yoy > 0;
                      const isDecrease = item.yoy < 0;
                      const sign = isIncrease ? '+' : '';
                      if (isIncrease) {
                         yoyBadge = <span className="px-2 py-0.5 bg-rose-50 text-rose-600 border border-rose-100 text-[10px] font-semibold rounded">{sign}{Math.round(item.yoy)}% vs {prevYear}</span>;
                      } else if (isDecrease) {
                         yoyBadge = <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-100 text-[10px] font-semibold rounded">{Math.round(item.yoy)}% vs {prevYear}</span>;
                      } else {
                         yoyBadge = <span className="px-2 py-0.5 bg-gray-50 text-gray-600 border border-gray-200 text-[10px] font-semibold rounded">0% vs {prevYear}</span>;
                      }
                    }

                    return (
                      <div key={item.name} className={`rounded-xl border p-3 ${i === 0 ? "border-emerald-200 bg-emerald-50/40" : "border-slate-100 bg-[#FCFCF9]"}`}>
                        <div className="flex justify-between items-start gap-3 text-sm">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-[10px] font-bold text-slate-500">{i + 1}</span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-800">{item.name}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px] text-slate-400">{pct}% kontribusi{item.count !== null ? ` · ${item.count} transaksi` : ""}</span>
                                {yoyBadge}
                              </div>
                            </div>
                          </div>
                          <span className="max-w-[44%] break-words text-right font-bold text-slate-900 tabular-nums">{formatMoney(item.currentVal)}</span>
                        </div>
                        <div className="mt-2.5 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden" aria-label={`${pct} persen dari pengeluaran`}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* QUICK EDIT BUDGET MODAL */}
      {editBudgetModalOpen && (
        <div className="modal-scrim p-4" onClick={() => setEditBudgetModalOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="budget-modal-title" onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '12px', width: '100%', maxWidth: '400px', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div className="modal-header" style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
              <h3 id="budget-modal-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', fontWeight: 600 }}>Alokasi Anggaran</h3>
            </div>
            <form onSubmit={handleSaveBudget}>
              <div className="form-grid" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ fontSize: '14px', color: '#475569' }}>{editingType === 'merchant' ? 'Merchant' : 'Kategori'}: <strong className="text-gray-900">{editingCatName}</strong></div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Setel Anggaran Bulanan (Rp)</span>
                  <input type="number" inputMode="numeric" value={editingBudget === "0" ? "" : editingBudget} onChange={e => setEditingBudget(e.target.value)} placeholder="Contoh: 1500000" className="focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-600" style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                </label>
              </div>
              <div className="modal-actions" style={{ padding: '16px 20px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#f8fafc' }}>
                <button type="button" disabled={isSavingBudget} className="min-h-11 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50" onClick={() => setEditBudgetModalOpen(false)}>Batal</button>
                <button type="submit" disabled={isSavingBudget} className="min-h-11 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">{isSavingBudget ? "Menyimpan..." : "Simpan Anggaran"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
