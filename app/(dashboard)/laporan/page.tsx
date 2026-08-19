"use client";

import {
  BarChart3,
  Bot,
  Calendar,
  ChevronDown,
  CreditCard,
  Download,
  Edit3,
  FileText,
  Filter,
  Layers,
  PieChart,
  Smartphone,
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
  const isOverbudget = totalExpense > totalIncome && totalIncome > 0;

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
  const pieColors = primaryMode === 'Pemasukan' ? ["#10b981", "#059669", "#34d399", "#6ee7b7", "#0ea5e9", "#0284c7", "#3b82f6"] :
                    primaryMode === 'Pengeluaran' ? ["#f43f5e", "#e11d48", "#fb923c", "#f97316", "#ef4444", "#f59e0b", "#d97706"] :
                    ["#6366f1", "#4f46e5", "#8b5cf6", "#a855f7", "#ec4899", "#d946ef", "#8b5cf6"];

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
    .map(([name, months]) => ({ name, months, total: months.reduce((a,b)=>a+b,0) }))
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
      return { name, currentVal, prevVal, yoy };
    })
    .filter(row => row.currentVal > 0)
    .sort((a,b) => b.currentVal - a.currentVal);

  const myBreakdownTotal = myBreakdownData.reduce((acc, row) => acc + row.currentVal, 0);

  let myCumValue = 0;
  const donutColors = ["#f43f5e", "#e11d48", "#fb923c", "#f97316", "#ef4444", "#f59e0b", "#d97706", "#6366f1", "#4f46e5", "#8b5cf6"];
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

  const annualDonutColors = ["#f43f5e", "#e11d48", "#fb923c", "#f97316", "#ef4444", "#f59e0b", "#d97706", "#6366f1", "#4f46e5", "#8b5cf6"];
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
      toast.error("Sesi Anda telah berakhir. Silakan login kembali untuk menyimpan anggaran.");
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

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
      
      {/* HEADER CONTROLS */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Laporan Keuangan</h1>
          <p className="text-gray-500 text-sm mt-1">Pantau arus kas dan tren pengeluaran Anda.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {activeTab === "Bulanan" && (
            <div className="flex items-center gap-2.5">
              <CustomSelect
                value={String(selectedMonth)}
                onChange={(val) => setSelectedMonth(Number(val))}
                options={monthNames.map((m, i) => ({ value: String(i), label: m }))}
                variant="dark-emerald"
                buttonClassName="min-w-[125px] px-3.5 py-2.5 gap-2.5"
              />
              <CustomSelect
                value={String(selectedYear)}
                onChange={(val) => setSelectedYear(Number(val))}
                options={[2024, 2025, 2026, 2027].map((y) => ({ value: String(y), label: String(y) }))}
                variant="dark-emerald"
                buttonClassName="min-w-[95px] px-3.5 py-2.5 gap-2"
              />
            </div>
          )}

          <div>
            <CustomSelect
              value={selectedAccount}
              onChange={setSelectedAccount}
              options={[
                { value: "Semua", label: "Semua Rekening" },
                ...accounts.map(acc => ({ value: acc.name, label: acc.name }))
              ]}
              placeholder="Semua Rekening"
              variant="dark-emerald"
              icon={<Filter className="w-4 h-4 text-emerald-300 shrink-0" />}
              buttonClassName="min-w-[170px] px-4 py-2.5 gap-3"
            />
          </div>

          {/* DYNAMIC CONTEXT-AWARE EXPORT DROPDOWN */}
          <div className="relative" ref={exportDropdownRef}>
            <button 
              onClick={() => setExportDropdownOpen(prev => !prev)}
              className="min-w-[110px] px-4 py-2.5 flex items-center justify-between gap-2.5 rounded-xl bg-gradient-to-r from-[#0F2A1D] to-[#163827] hover:from-[#133525] hover:to-[#1a4430] border border-white/10 text-white shadow-sm transition-all duration-150 group cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              aria-expanded={exportDropdownOpen}
              aria-haspopup="true"
            >
              <span className="flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-300 shrink-0" />
                <span className="text-sm font-medium text-white">Ekspor</span>
              </span>
              <ChevronDown className={`w-4 h-4 text-emerald-200/80 transition-transform duration-200 shrink-0 ${exportDropdownOpen ? 'rotate-180 text-lime-400' : ''}`} />
            </button>

            {exportDropdownOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
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
      <div className="bg-gray-100/80 p-1 rounded-xl inline-flex flex-wrap gap-1">
        <button 
          onClick={() => setActiveTab("Bulanan")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "Bulanan" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"}`}
        >
          <PieChart className="w-4 h-4" /> Laporan Bulanan
        </button>
        <button 
          onClick={() => setActiveTab("Tahunan")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "Tahunan" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"}`}
        >
          <BarChart3 className="w-4 h-4" /> Tren Tahunan
        </button>
        <button 
          onClick={() => setActiveTab("Makro")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "Makro" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"}`}
        >
          <Layers className="w-4 h-4" /> Tren Multi-Tahun
        </button>
      </div>

      {/* TAB 1: BULANAN */}
      {activeTab === "Bulanan" && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          
          {/* Top Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-2xl p-5 shadow-sm text-white flex flex-col justify-between">
              <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
              <span className="text-sm font-semibold text-[#A8C9B9] relative z-10">Total Pemasukan</span>
              {isLoading ? (
                <div className="h-8 w-36 bg-emerald-950/60 rounded-lg animate-pulse mt-2 relative z-10 border border-emerald-800/40" />
              ) : (
                <div className="mt-2 text-2xl font-bold tracking-tight text-lime-400 relative z-10">{formatMoney(totalIncome)}</div>
              )}
            </div>
            <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-2xl p-5 shadow-sm text-white flex flex-col justify-between">
              <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
              <span className="text-sm font-semibold text-[#A8C9B9] relative z-10">Total Pengeluaran</span>
              {isLoading ? (
                <div className="h-8 w-36 bg-emerald-950/60 rounded-lg animate-pulse mt-2 relative z-10 border border-emerald-800/40" />
              ) : (
                <div className="mt-2 text-2xl font-bold tracking-tight text-white relative z-10">{formatMoney(totalExpense)}</div>
              )}
            </div>
            <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-2xl p-5 shadow-sm text-white flex flex-col justify-between">
              <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
              <span className="text-sm font-semibold text-[#A8C9B9] relative z-10">Sisa Uang (Surplus)</span>
              {isLoading ? (
                <div className="h-8 w-36 bg-emerald-950/60 rounded-lg animate-pulse mt-2 relative z-10 border border-emerald-800/40" />
              ) : (
                <div className={`mt-2 text-2xl font-bold tracking-tight ${netSurplus < 0 ? 'text-rose-400' : 'text-lime-400'} relative z-10`}>
                  {netSurplus > 0 ? '+' : ''}{formatMoney(netSurplus)}
                </div>
              )}
            </div>
            <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-2xl p-5 shadow-sm text-white flex flex-col justify-center items-start">
              <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center justify-between w-full mb-2 relative z-10">
                <span className="text-sm font-semibold text-[#A8C9B9]">Status Alokasi</span>
                {!isLoading && totalBudgetedCount > 0 && (
                  <span className="text-[11px] text-[#A8C9B9]/70 font-normal">Dari {totalBudgetedCount} anggaran diatur</span>
                )}
              </div>
              <div className="w-full relative z-10">
                {isLoading ? (
                  <div className="h-6 w-28 bg-emerald-950/60 rounded-full animate-pulse mt-1 border border-emerald-800/40" />
                ) : totalBudgetedCount === 0 ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-800 text-gray-400 border border-gray-700">Belum diatur</span>
                ) : overbudgetCount > 0 ? (
                  <div className="flex flex-row gap-2">
                    <span className="bg-rose-950/60 text-rose-300 border border-rose-800/60 px-2.5 py-0.5 rounded-full text-xs font-medium">
                      {overbudgetCount} Overbudget
                    </span>
                    {hematCount > 0 && (
                      <span className="bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 px-2.5 py-0.5 rounded-full text-xs font-medium">
                        {hematCount} Hemat
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 px-2.5 py-0.5 rounded-full text-xs font-medium">
                    Semua Terkendali ({hematCount})
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Breakdown Section */}
          <div className="w-full">
            <div className="bg-[#FAF9F6] border border-slate-200/80 rounded-2xl shadow-sm p-6 w-full">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                <div className="flex flex-col gap-2">
                  <h3 className="font-semibold text-gray-900">Breakdown Transaksi</h3>
                  <div className="bg-gray-100 p-1 rounded-lg inline-flex">
                    <button onClick={() => setPrimaryMode("Pengeluaran")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${primaryMode === "Pengeluaran" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}>Pengeluaran</button>
                    <button onClick={() => setPrimaryMode("Pemasukan")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${primaryMode === "Pemasukan" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}>Pemasukan</button>
                    <button onClick={() => setPrimaryMode("Net")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${primaryMode === "Net" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}>Rekap Net</button>
                  </div>
                </div>
                <div className="bg-gray-100 p-1 rounded-lg inline-flex">
                  <button 
                    onClick={() => setBreakdownMode("Kategori")}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${breakdownMode === "Kategori" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
                  >
                    Per Kategori
                  </button>
                  <button 
                    onClick={() => setBreakdownMode("Merchant")}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${breakdownMode === "Merchant" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
                  >
                    Per Merchant & Keyword
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
                <div className="py-12 text-center text-gray-400 text-sm">Tidak ada transaksi di periode ini untuk mode yang dipilih.</div>
              ) : primaryMode === 'Net' ? (
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="py-2 px-3 text-sm font-semibold text-gray-600">Kategori / Merchant</th>
                        <th className="py-2 px-3 text-sm font-semibold text-emerald-600">Masuk (+)</th>
                        <th className="py-2 px-3 text-sm font-semibold text-rose-600">Keluar (-)</th>
                        <th className="py-2 px-3 text-sm font-semibold text-gray-800">Net Total (=)</th>
                        <th className="py-2 px-3 text-sm font-semibold text-gray-600">Alokasi Anggaran</th>
                        <th className="py-2 px-3 text-sm font-semibold text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeList.map(item => {
                         const isHemat = item.budget > 0 && item.expense <= item.budget;
                         const isOver = item.budget > 0 && item.expense > item.budget;
                         return (
                           <tr key={item.name} className="border-b border-gray-100 hover:bg-gray-50/50">
                             <td className="py-2 px-3 text-sm font-medium text-gray-900">{item.name}</td>
                             <td className="py-2 px-3 text-sm text-emerald-600">{formatMoney(item.income)}</td>
                             <td className="py-2 px-3 text-sm text-rose-600">{formatMoney(item.expense)}</td>
                             <td className={`py-2 px-3 text-sm font-bold ${item.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatMoney(item.net)}</td>
                             <td className="py-2 px-3 text-sm text-gray-600">
                               <button
                                 type="button"
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   openQuickEditBudget(item.name, breakdownMode === "Merchant");
                                 }}
                                 className={`group ${item.budget > 0 
                                   ? "inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer transition-all shadow-sm hover:scale-[1.02]"
                                   : "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-transparent hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:bg-emerald-500/20 text-xs font-medium text-gray-400 italic cursor-pointer transition-all duration-200"}`}
                                 title="Edit Alokasi Anggaran"
                                >
                                 <span className={item.budget > 0 ? "text-white dark:text-slate-100" : ""}>
                                   {item.budget > 0 ? formatMoney(item.budget) : "Belum diatur"}
                                 </span>
                                 <Edit3 className={`w-3.5 h-3.5 transition-colors ${item.budget > 0 ? "text-slate-300 group-hover:text-emerald-400" : "text-gray-400 group-hover:text-emerald-500"}`} />
                               </button>
                             </td>
                             <td className="py-2 px-3">
                               {isHemat && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">Hemat</span>}
                               {isOver && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-600 border border-rose-500/20">Overbudget</span>}
                               {!isHemat && !isOver && <span className="text-gray-400 text-xs">-</span>}
                             </td>
                           </tr>
                         )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col md:flex-row gap-8 items-start w-full">
                  {/* Left Column */}
                  <div className="w-full md:w-[35%] flex flex-col items-center gap-6">
                    {/* Interactive Donut Chart */}
                    <div className="relative w-48 h-48 shrink-0">
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
                    <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-xl p-4 w-full text-center">
                       <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
                       <h4 className="text-lime-400 font-semibold text-xs mb-1 flex items-center justify-center gap-1.5 relative z-10"><Bot className="w-3.5 h-3.5" /> Insight AI</h4>
                       <p className="text-[#A8C9B9] text-xs leading-relaxed relative z-10">
                         {activeList.length > 0 && chartSum > 0
                           ? `${breakdownMode === 'Kategori' ? 'Kategori' : 'Merchant'} ${activeList[0].name} mendominasi ${Math.round((Math.abs(getStatValue(activeList[0])) / chartSum) * 100)}% dari total.` 
                           : "Belum cukup data untuk analisis."}
                       </p>
                    </div>
                  </div>

                  {/* Right Column List items */}
                  <div className="w-full md:w-[65%] space-y-4">
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
                          <div key={item.name} className="space-y-1.5">
                            <div className="flex justify-between items-center text-sm">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }}></span>
                                <span className="font-medium text-gray-700">{item.name}</span>
                              </div>
                              <span className="font-semibold text-gray-900">{formatMoney(val)} <span className="text-gray-400 font-normal ml-1">({pct}%)</span></span>
                            </div>
                            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }}></div>
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
          <div className="bg-[#FAF9F6] border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-200/60">
              <h3 className="font-semibold text-gray-900">Rekap Kas & Saldo Rekening</h3>
            </div>
            <div className="overflow-x-auto">
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
          </div>
        </div>
      )}

      {/* TAB 2: TAHUNAN */}
      {activeTab === "Tahunan" && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-[#FAF9F6] border border-slate-200/80 rounded-2xl shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-6">Rekap Tahunan ({selectedYear})</h3>
            
            {/* Real Bar Chart for Yearly */}
            <div className="h-64 flex items-end justify-between gap-2 border-b border-gray-200 pb-2 px-2">
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
            
            <div className="mt-8 overflow-x-auto">
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
          </div>

          {/* Heatmap Matrix & Pie Chart */}
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="bg-[#FAF9F6] border border-slate-200/80 rounded-2xl shadow-sm p-6 lg:w-3/4 flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-semibold text-gray-900">Sebaran Pengeluaran Tahunan</h3>
                <div className="bg-gray-100 p-1 rounded-lg inline-flex">
                  <button onClick={() => setAnnualBreakdownMode("Kategori")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${annualBreakdownMode === "Kategori" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}>Per Kategori</button>
                  <button onClick={() => setAnnualBreakdownMode("Merchant")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${annualBreakdownMode === "Merchant" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}>Per Merchant</button>
                </div>
              </div>
              
              <div className="w-full overflow-x-auto">
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
                          <td className="p-2 border-b font-medium text-gray-800 sticky left-0 bg-white z-10 border-r border-gray-100">{row.name}</td>
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
            </div>

            <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-2xl shadow-sm p-6 lg:w-1/4 flex flex-col items-center justify-center">
              <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
              <h4 className="text-sm font-semibold text-[#A8C9B9] mb-6 text-center w-full relative z-10">Persentase Pengeluaran</h4>
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
                <div className="text-[#A8C9B9] text-sm relative z-10">Tidak ada data</div>
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
                          <span className="truncate text-[#A8C9B9]">{slice.item.name}</span>
                        </div>
                        <span className="font-bold text-white shrink-0">{slice.percentage}%</span>
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
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          
          {/* Top Multi-Year Summary Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-2xl p-5 shadow-sm text-white flex flex-col justify-between">
              <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
              <span className="text-sm font-semibold text-[#A8C9B9] relative z-10">Akumulasi Tabungan Lifetime</span>
              {isLoading ? (
                <div className="h-8 w-36 bg-emerald-950/60 rounded-lg animate-pulse mt-2 relative z-10 border border-emerald-800/40" />
              ) : (
                <div className={`mt-2 text-2xl font-bold tracking-tight ${lifetimeNet >= 0 ? 'text-lime-400' : 'text-rose-400'} relative z-10`}>
                  {lifetimeNet >= 0 ? '+' : ''}{formatMoney(lifetimeNet)}
                </div>
              )}
            </div>
            <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-2xl p-5 shadow-sm text-white flex flex-col justify-between">
              <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
              <span className="text-sm font-semibold text-[#A8C9B9] relative z-10">Rata-Rata Pengeluaran Tahunan</span>
              {isLoading ? (
                <div className="h-8 w-36 bg-emerald-950/60 rounded-lg animate-pulse mt-2 relative z-10 border border-emerald-800/40" />
              ) : (
                <div className="mt-2 text-2xl font-bold tracking-tight text-white relative z-10">{formatMoney(avgAnnualExpense)}</div>
              )}
            </div>
            <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-2xl p-5 shadow-sm text-white flex flex-col justify-between">
              <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
              <span className="text-sm font-semibold text-[#A8C9B9] relative z-10">Tahun Terhemat</span>
              {isLoading ? (
                <div className="h-8 w-36 bg-emerald-950/60 rounded-lg animate-pulse mt-2 relative z-10 border border-emerald-800/40" />
              ) : (
                <div className="mt-2 text-2xl font-bold tracking-tight text-white relative z-10">
                  {maxMargin !== -Infinity ? `${bestYear} ` : '-'}
                  {maxMargin !== -Infinity && <span className="text-sm font-medium text-lime-400">({(maxMargin * 100).toFixed(1)}%)</span>}
                </div>
              )}
            </div>
          </div>

          <div className="bg-[#FAF9F6] border border-slate-200/80 rounded-2xl shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-6">{macroChartTitle}</h3>
            
            <div className="h-[350px] w-full mt-6">
              {isLoading ? (
                <div className="w-full h-full flex items-end justify-between gap-3 px-6 pb-6 pt-12 animate-pulse bg-slate-50/50 rounded-xl">
                  {[40, 65, 55, 80, 70, 90, 85].map((h, i) => (
                    <div key={i} className="flex-1 bg-slate-200/80 rounded-t-md" style={{ height: `${h}%` }} />
                  ))}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={macroChartData}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
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
                      width={60}
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
            
            <div className="flex gap-6 justify-center mt-6 text-sm">
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

          <div className="bg-[#FAF9F6] border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
             <div className="p-5 border-b border-slate-200/60">
              <h3 className="font-semibold text-gray-900">Rekap Multi-Tahun</h3>
            </div>
            <div className="overflow-x-auto">
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
          </div>

          {/* Sebaran Pengeluaran Multi-Tahun Visual Breakdown */}
          <div className="bg-[#FAF9F6] border border-slate-200/80 rounded-2xl shadow-sm p-6 w-full">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold text-gray-900">Sebaran Pengeluaran Multi-Tahun</h3>
                <div className="w-36">
                  <CustomSelect 
                    value={String(safeMultiYearSelected)} 
                    onChange={val => setMultiYearSelectedYear(Number(val))}
                    options={activeYears.map(y => ({ value: String(y), label: `Tahun ${y}` }))}
                  />
                </div>
              </div>
              <div className="bg-gray-100 p-1 rounded-lg inline-flex shrink-0">
                <button 
                  onClick={() => setMultiYearBreakdownMode("Kategori")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${multiYearBreakdownMode === "Kategori" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
                >
                  Per Kategori
                </button>
                <button 
                  onClick={() => setMultiYearBreakdownMode("Merchant")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${multiYearBreakdownMode === "Merchant" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
                >
                  Per Merchant & Keyword
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
              <div className="py-12 text-center text-gray-400 text-sm">Tidak ada transaksi pengeluaran di tahun {safeMultiYearSelected}.</div>
            ) : (
              <div className="flex flex-col md:flex-row gap-8 items-start w-full">
                {/* Left Column */}
                <div className="w-full md:w-[35%] flex flex-col items-center gap-6">
                  {/* Interactive Donut Chart */}
                  <div className="relative w-48 h-48 shrink-0">
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
                  <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-xl p-4 w-full text-center">
                     <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
                     <h4 className="text-lime-400 font-semibold text-xs mb-1 flex items-center justify-center gap-1.5 relative z-10"><Bot className="w-3.5 h-3.5" /> Insight AI</h4>
                     <p className="text-[#A8C9B9] text-xs leading-relaxed relative z-10">
                       {myBreakdownData.length > 0
                         ? `${multiYearBreakdownMode === 'Kategori' ? 'Kategori' : 'Merchant'} ${myBreakdownData[0].name} mendominasi ${Math.round((myBreakdownData[0].currentVal / myBreakdownTotal) * 100)}% dari total pengeluaran tahun ${safeMultiYearSelected}.` 
                         : "Belum cukup data untuk analisis."}
                     </p>
                  </div>
                </div>

                {/* Right Column List items */}
                <div className="w-full md:w-[65%] space-y-4">
                  {myBreakdownData.map((item, i) => {
                    const pct = myBreakdownTotal > 0 ? ((item.currentVal / myBreakdownTotal) * 100).toFixed(1) : "0";
                    const color = mySvgPaths[i]?.color || "#cbd5e1";
                    
                    let yoyBadge = null;
                    if (item.prevVal === null) {
                      yoyBadge = <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-semibold rounded">{safeMultiYearSelected}</span>;
                    } else if (item.prevVal === 0 && item.currentVal > 0) {
                      yoyBadge = <span className="px-2 py-0.5 bg-rose-50 text-rose-600 border border-rose-100 text-[10px] font-semibold rounded">+100% vs {prevYear}</span>;
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
                      <div key={item.name} className="space-y-1.5">
                        <div className="flex justify-between items-center text-sm">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }}></span>
                            <span className="font-medium text-gray-700">{item.name}</span>
                            {yoyBadge}
                          </div>
                          <span className="font-semibold text-gray-900">{formatMoney(item.currentVal)} <span className="text-gray-400 font-normal ml-1">({pct}%)</span></span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }}></div>
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
        <div className="modal-scrim" onClick={() => setEditBudgetModalOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '12px', width: '100%', maxWidth: '400px', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div className="modal-header" style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', fontWeight: 600 }}>Alokasi Anggaran</h3>
            </div>
            <form onSubmit={handleSaveBudget}>
              <div className="form-grid" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ fontSize: '14px', color: '#475569' }}>{editingType === 'merchant' ? 'Merchant' : 'Kategori'}: <strong className="text-gray-900">{editingCatName}</strong></div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Setel Anggaran Bulanan (Rp)</span>
                  <input type="number" value={editingBudget === "0" ? "" : editingBudget} onChange={e => setEditingBudget(e.target.value)} placeholder="Contoh: 1500000" style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                </label>
              </div>
              <div className="modal-actions" style={{ padding: '16px 20px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#f8fafc' }}>
                <button type="button" disabled={isSavingBudget} className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50" onClick={() => setEditBudgetModalOpen(false)}>Batal</button>
                <button type="submit" disabled={isSavingBudget} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">{isSavingBudget ? "Menyimpan..." : "Simpan Anggaran"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
