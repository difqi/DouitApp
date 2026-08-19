"use client";

import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CircleAlert,
  MoreHorizontal,
  Plus,
  TrendingUp,
  WalletCards,
  CheckCircle2,
  CreditCard,
  Smartphone,
  Wallet
} from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import { useDouit } from "../providers/DouitProvider";
import { mockSummary, mockTransactions } from "../../lib/mock-data";
import { DashboardSummary, Transaction } from "../../types";
import { MiniSparkline } from "../components/MiniSparkline";

import { createClient } from "@/lib/supabase/client";
import { isAccountMatch } from "../../utils/bankAliases";
const money = (value: number | string) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value));
const shortMoney = (value: number) => new Intl.NumberFormat("id-ID", { notation: "compact", style: "currency", currency: "IDR", maximumFractionDigits: 1 }).format(value);
const formatDate = (value: string) => new Date(value).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
const formatTime = (value: string) => new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).replace('.', ':') + " WIB";

const chartSets = {
  "Bulan ini": [34, 51, 43, 67, 55, 82, 70, 88, 63, 91, 74, 96],
  "3 bulan": [52, 44, 61, 48, 72, 58, 80, 69, 75, 86, 82, 92],
};

const sparklineSets = {
  income: {
    "Bulan ini": [14, 22, 18, 30, 26, 38, 34, 48],
    "3 bulan": [18, 25, 22, 34, 30, 44, 40, 56],
  },
  expense: {
    "Bulan ini": [20, 28, 24, 42, 36, 52, 44, 58],
    "3 bulan": [24, 32, 30, 48, 42, 60, 54, 68],
  },
};

let cachedDashboardTx: Transaction[] = [];
let cachedAccounts: any[] = [];
let cachedPrimaryAccount: any = null;

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<any[]>(cachedAccounts);
  const [primaryAccount, setPrimaryAccount] = useState<any>(cachedPrimaryAccount);
  const [period, setPeriod] = useState<keyof typeof chartSets>("Bulan ini");
  const [transactions, setTransactions] = useState<Transaction[]>(cachedDashboardTx);
  const { user, business, membership } = useDouit();

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

      const { data, error } = await supabase
        .from('transactions')
        .select(`
          id, amount, type, merchant, status, source, confidence_score, transaction_date, sumber_dana,
          categories (name)
        `)
        .eq('user_id', user.id)
        .order('transaction_date', { ascending: false });
        
      if (data) {
        const mapped = data.map(d => ({
          ...d,
          date: d.transaction_date,
          category: (d.categories as any)?.name || 'Lain-lain',
          sumber_dana: d.sumber_dana || 'Tunai'
        })) as any as Transaction[];
        cachedDashboardTx = mapped;
        setTransactions(mapped);
      }
    };
    
    fetchTransactions();
    
    const channel = supabase.channel('realtime_transactions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` }, () => {
        fetchTransactions();
      })
      .subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const summary = React.useMemo(() => {
    let relevantTxs = transactions.filter(t => t.status === 'APPROVED');
    let initBal = 0;
    
    if (primaryAccount) {
      relevantTxs = relevantTxs.filter(t => isAccountMatch(primaryAccount.name, (t as any).sumber_dana));
      initBal = Number(primaryAccount.initial_balance) || 0;
    } else {
      initBal = accounts.reduce((sum, a) => sum + (Number(a.initial_balance) || 0), 0);
    }

    const incomeTxs = relevantTxs.filter(t => t.type === 'INCOME');
    const expenseTxs = relevantTxs.filter(t => t.type === 'EXPENSE');
    const income = incomeTxs.reduce((sum, t) => sum + Number(t.amount), 0);
    const expense = expenseTxs.reduce((sum, t) => sum + Number(t.amount), 0);
    return {
      income,
      expense,
      incomeCount: incomeTxs.length,
      expenseCount: expenseTxs.length,
      net_balance: initBal + income - expense
    };
  }, [transactions, primaryAccount, accounts]);

  const pendingTransactions = transactions.filter(t => t.status === 'PENDING_APPROVAL');

  return (
    <div className="workspace-page">
      <div className="page-heading dashboard-heading">
        <div>
          <div className="eyebrow"><CalendarDays size={14} /> {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          <h1>Selamat datang, {membership?.display_name?.split(" ")[0] ?? "User"}.</h1>
          <p>Berikut ringkasan keuangan {business?.name} hari ini.</p>
        </div>
        <div className="heading-actions">
          <Link href="/transactions" className="button primary"><Plus size={17} /> Catat manual</Link>
        </div>
      </div>

      {pendingTransactions.length > 0 && (
        <section className="pending-action-center" style={{ marginBottom: '24px', padding: '16px', borderRadius: '12px', background: '#fffbeb', border: '1px solid #fcd34d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: '#fef3c7', color: '#d97706', padding: '8px', borderRadius: '50%' }}>
              <CircleAlert size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#92400e', margin: 0 }}>Tindakan Diperlukan</h3>
              <p style={{ fontSize: '13px', color: '#b45309', margin: 0 }}>AI mendeteksi {pendingTransactions.length} transaksi yang perlu persetujuan Anda.</p>
            </div>
          </div>
          <Link href="/transactions" className="button secondary" style={{ background: 'white', borderColor: '#fcd34d', color: '#d97706' }}>Lihat antrean <ArrowRight size={15} /></Link>
        </section>
      )}

      <section className="metric-grid" aria-label="Ringkasan keuangan">
        <article className="balance-card" style={{ gridColumn: 'span 2' }}>
          <div className="balance-topline flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="balance-label flex items-center gap-1.5"><Wallet size={16} /> Saldo bersih saat ini</span>
              {primaryAccount ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {primaryAccount.type === 'bank' ? <CreditCard className="w-3 h-3" /> : primaryAccount.type === 'wallet' ? <Smartphone className="w-3 h-3" /> : <Wallet className="w-3 h-3" />}
                  {primaryAccount.name} (Utama)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Wallet className="w-3 h-3" /> Total Rekening
                </span>
              )}
            </div>
            <div className="segmented-control" aria-label="Periode grafik">
              {(Object.keys(chartSets) as (keyof typeof chartSets)[]).map((item) => (
                <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>
              ))}
            </div>
          </div>
          <div className="balance-body">
            <div>
              <p className="balance-amount">{shortMoney(summary.net_balance)}</p>
              <div className="positive-change"><TrendingUp size={15} /> <span>saldo bersih bulan ini</span></div>
            </div>
            <div className="bar-chart" aria-label="Grafik pengeluaran">
              {chartSets[period].map((height, index) => (
                <div key={index} className="bar-track"><span style={{ height: `${height}%` }} /></div>
              ))}
            </div>
          </div>
          <div className="balance-footer">
            <span><i className="legend-dot income" /> Pemasukan <b>{shortMoney(summary.income)}</b></span>
            <span><i className="legend-dot expense" /> Pengeluaran <b>{shortMoney(summary.expense)}</b></span>
          </div>
        </article>

        {/* Redesigned Total Pemasukan Card */}
        <article className="flex flex-col justify-between h-full min-h-[184px] p-5 bg-white rounded-2xl border border-slate-100/80 shadow-sm relative overflow-hidden transition-all duration-200 hover:shadow-md">
          {/* Top Row: Icon + Trend Pill */}
          <div className="flex items-center justify-between">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100/80 shadow-xs">
              <ArrowDownLeft className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
              <ArrowUpRight className="w-3 h-3 text-emerald-600" />
              <span>+0% bln ini</span>
            </div>
          </div>

          {/* Middle Row: Sparkline Mini-Chart */}
          <div className="my-2 w-full">
            <MiniSparkline
              data={sparklineSets.income[period]}
              color="emerald"
              className="w-full h-12"
            />
          </div>

          {/* Bottom Row: Metrics & Typography */}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
              TOTAL PEMASUKAN
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1 tracking-tight">
              {shortMoney(summary.income)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span>{summary.incomeCount} transaksi {period === "Bulan ini" ? "bulan ini" : "3 bulan"}</span>
            </div>
          </div>
        </article>

        {/* Redesigned Total Pengeluaran Card */}
        <article className="flex flex-col justify-between h-full min-h-[184px] p-5 bg-white rounded-2xl border border-slate-100/80 shadow-sm relative overflow-hidden transition-all duration-200 hover:shadow-md">
          {/* Top Row: Icon + Trend Pill */}
          <div className="flex items-center justify-between">
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100/80 shadow-xs">
              <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100">
              <ArrowUpRight className="w-3 h-3 text-rose-600" />
              <span>+0% bln ini</span>
            </div>
          </div>

          {/* Middle Row: Sparkline Mini-Chart */}
          <div className="my-2 w-full">
            <MiniSparkline
              data={sparklineSets.expense[period]}
              color="rose"
              className="w-full h-12"
            />
          </div>

          {/* Bottom Row: Metrics & Typography */}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
              TOTAL PENGELUARAN
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1 tracking-tight">
              {shortMoney(summary.expense)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              <span>{summary.expenseCount} transaksi {period === "Bulan ini" ? "bulan ini" : "3 bulan"}</span>
            </div>
          </div>
        </article>
      </section>

      <div className="dashboard-columns" style={{ display: 'block' }}>
        <section className="panel invoice-panel">
          <div className="panel-header">
            <div>
              <h2>Transaksi Terbaru</h2>
              <p>Riwayat transaksi otomatis dan manual</p>
            </div>
            <Link href="/transactions" className="text-button">Lihat semua <ArrowRight size={15} /></Link>
          </div>
          <div className="w-full overflow-x-auto scrollbar-thin p-6">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-gray-50 text-gray-700 border-b">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">Transaksi</th>
                  <th className="px-4 py-3 whitespace-nowrap">Tanggal</th>
                  <th className="px-4 py-3 whitespace-nowrap text-right">Jumlah</th>
                  <th className="px-4 py-3 whitespace-nowrap">Kategori</th>
                  <th className="px-4 py-3 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-center text-gray-500">Belum ada transaksi.</td></tr>}
                {transactions.slice(0, 5).map((tx) => (
                  <tr key={tx.id} className="border-b last:border-b-0 hover:bg-gray-50/50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-semibold text-gray-900">{tx.merchant}</span>
                        <span className="text-xs text-gray-500">{tx.source === 'AUTOMATIC_EMAIL' ? 'Via Email' : 'Via Chat'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">{formatDate(tx.date)}</span>
                        {(!tx.date.includes('T00:00:00')) && (
                          <span className="text-xs text-gray-500 mt-0.5">{formatTime(tx.date)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-medium">
                      <span style={{ color: tx.type === 'INCOME' ? '#16a34a' : 'inherit' }}>
                        {tx.type === 'INCOME' ? '+' : '-'}{money(tx.amount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{tx.category}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {tx.status === 'APPROVED' ? (
                        <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-medium"><CheckCircle2 size={12}/> Disetujui</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 px-2 py-1 rounded-full text-xs font-medium"><CircleAlert size={12}/> Menunggu</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
