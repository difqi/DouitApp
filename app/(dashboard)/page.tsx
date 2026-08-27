"use client";

import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CircleAlert,
  Minus,
  Plus,
  TrendingUp,
  CheckCircle2,
  CreditCard,
  Smartphone,
  Wallet
} from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import { useDouit } from "../providers/DouitProvider";
import { Transaction } from "../../types";
import { MiniSparkline } from "../components/MiniSparkline";

import { createClient } from "@/lib/supabase/client";
import { isAccountMatch } from "../../utils/bankAliases";
import { shouldDisplayTransactionTime } from "../components/WorkspaceViews";
const money = (value: number | string) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value));
const formatDate = (value: string) => new Date(value).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
const formatTime = (value: string) => new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).replace('.', ':') + " WIB";

type DashboardPeriod = "Bulan ini" | "3 bulan";

const periods: DashboardPeriod[] = ["Bulan ini", "3 bulan"];

const getPeriodBounds = (period: DashboardPeriod) => {
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  start.setDate(1);
  start.setMonth(start.getMonth() - (period === "3 bulan" ? 2 : 0));

  const previousStart = new Date(start);
  previousStart.setMonth(previousStart.getMonth() - (period === "3 bulan" ? 3 : 1));
  const previousEnd = new Date(Math.min(
    start.getTime(),
    previousStart.getTime() + (end.getTime() - start.getTime()),
  ));

  return { start, end, previousStart, previousEnd };
};

const getSeries = (transactions: Transaction[], type: Transaction["type"], start: Date, end: Date) => {
  const series = Array.from({ length: 8 }, () => 0);
  const duration = Math.max(end.getTime() - start.getTime(), 1);

  transactions.forEach((transaction) => {
    if (transaction.type !== type) return;
    const timestamp = new Date(transaction.date).getTime();
    if (!Number.isFinite(timestamp) || timestamp < start.getTime() || timestamp > end.getTime()) return;
    const index = Math.min(series.length - 1, Math.floor(((timestamp - start.getTime()) / duration) * series.length));
    series[index] += Number(transaction.amount);
  });

  return series;
};

const getRunningBalanceSeries = (
  transactions: Transaction[],
  initialBalance: number,
  start: Date,
  end: Date,
  pointCount: number,
) => {
  const changes = Array.from({ length: pointCount }, () => 0);
  const startTimestamp = start.getTime();
  const endTimestamp = end.getTime();
  const duration = Math.max(endTimestamp - startTimestamp, 1);
  let runningBalance = initialBalance;

  transactions.forEach((transaction) => {
    const timestamp = new Date(transaction.date).getTime();
    if (!Number.isFinite(timestamp) || timestamp > endTimestamp) return;
    const amount = Number(transaction.amount) || 0;
    const change = transaction.type === "INCOME" ? amount : -amount;

    if (timestamp < startTimestamp) {
      runningBalance += change;
      return;
    }

    const index = Math.min(
      pointCount - 1,
      Math.max(1, Math.ceil(((timestamp - startTimestamp) / duration) * (pointCount - 1))),
    );
    changes[index] += change;
  });

  const series = [runningBalance];
  for (let index = 1; index < pointCount; index += 1) {
    runningBalance += changes[index];
    series.push(runningBalance);
  }
  return series;
};

const getTrend = (
  current: number,
  previous: number,
  type: Transaction["type"],
  period: DashboardPeriod,
) => {
  const periodLabel = period === "Bulan ini" ? "bulan ini" : "dalam 3 bulan terakhir";
  const flowLabel = type === "INCOME" ? "pemasukan" : "pengeluaran";
  const flowVerb = type === "INCOME" ? "masuk" : "keluar";

  if (previous === 0) {
    return current > 0
      ? { direction: "up", text: `${money(current)} ${flowVerb} ${periodLabel}` } as const
      : { direction: "flat", text: `Belum ada ${flowLabel} ${periodLabel}` } as const;
  }
  if (current === previous) return { direction: "flat", text: "Setara dengan periode sebelumnya" } as const;

  const percentage = Math.abs(Math.round(((current - previous) / previous) * 100));
  return current > previous
    ? { direction: "up", text: `Naik ${percentage}% dari periode sebelumnya` } as const
    : { direction: "down", text: `Turun ${percentage}% dari periode sebelumnya` } as const;
};

const sourceLabel: Record<Transaction["source"], string> = {
  AUTOMATIC_EMAIL: "Via Email",
  MANUAL_CHAT: "Via AI Chat",
  MANUAL_FORM: "Via Manual",
};

let cachedDashboardTx: Transaction[] = [];
let cachedAccounts: any[] = [];
let cachedPrimaryAccount: any = null;

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<any[]>(cachedAccounts);
  const [primaryAccount, setPrimaryAccount] = useState<any>(cachedPrimaryAccount);
  const [period, setPeriod] = useState<DashboardPeriod>("Bulan ini");
  const [transactions, setTransactions] = useState<Transaction[]>(cachedDashboardTx);
  const { user, membership } = useDouit();

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
          id, amount, type, merchant, status, source, confidence_score, transaction_date, sumber_dana, notes,
          categories (name)
        `)
        .eq('user_id', user.id)
        .order('transaction_date', { ascending: false });

      if (data) {
        const mapped = data.map(d => ({
          ...d,
          date: d.transaction_date,
          notes: d.notes,
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

  const approvedAccountTransactions = React.useMemo(() => {
    let relevantTxs = transactions.filter(t => t.status === 'APPROVED');
    if (primaryAccount) {
      relevantTxs = relevantTxs.filter(t => isAccountMatch(primaryAccount.name, (t as any).sumber_dana));
    }
    return relevantTxs;
  }, [transactions, primaryAccount]);

  const initialBalance = React.useMemo(() => (
    primaryAccount
      ? Number(primaryAccount.initial_balance) || 0
      : accounts.reduce((sum, account) => sum + (Number(account.initial_balance) || 0), 0)
  ), [accounts, primaryAccount]);

  const summary = React.useMemo(() => {
    const incomeTxs = approvedAccountTransactions.filter(t => t.type === 'INCOME');
    const expenseTxs = approvedAccountTransactions.filter(t => t.type === 'EXPENSE');
    const income = incomeTxs.reduce((sum, t) => sum + Number(t.amount), 0);
    const expense = expenseTxs.reduce((sum, t) => sum + Number(t.amount), 0);
    return {
      income,
      expense,
      incomeCount: incomeTxs.length,
      expenseCount: expenseTxs.length,
      net_balance: initialBalance + income - expense
    };
  }, [approvedAccountTransactions, initialBalance]);

  const periodSummary = React.useMemo(() => {
    const { start, end, previousStart, previousEnd } = getPeriodBounds(period);
    const currentTransactions = approvedAccountTransactions.filter((transaction) => {
      const date = new Date(transaction.date);
      return date >= start && date <= end;
    });
    const previousTransactions = approvedAccountTransactions.filter((transaction) => {
      const date = new Date(transaction.date);
      return date >= previousStart && date < previousEnd;
    });
    const total = (items: Transaction[], type: Transaction["type"]) => items
      .filter(transaction => transaction.type === type)
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const income = total(currentTransactions, "INCOME");
    const expense = total(currentTransactions, "EXPENSE");
    const previousIncome = total(previousTransactions, "INCOME");
    const previousExpense = total(previousTransactions, "EXPENSE");
    const expenseByCategory = currentTransactions
      .filter(transaction => transaction.type === "EXPENSE")
      .reduce<Record<string, number>>((categories, transaction) => {
        categories[transaction.category] = (categories[transaction.category] || 0) + Number(transaction.amount);
        return categories;
      }, {});
    const topExpense = Object.entries(expenseByCategory).sort(([, first], [, second]) => second - first)[0];

    return {
      income,
      expense,
      incomeCount: currentTransactions.filter(transaction => transaction.type === "INCOME").length,
      expenseCount: currentTransactions.filter(transaction => transaction.type === "EXPENSE").length,
      incomeTrend: getTrend(income, previousIncome, "INCOME", period),
      expenseTrend: getTrend(expense, previousExpense, "EXPENSE", period),
      incomeSeries: getSeries(approvedAccountTransactions, "INCOME", start, end),
      expenseSeries: getSeries(approvedAccountTransactions, "EXPENSE", start, end),
      balanceSeries: getRunningBalanceSeries(
        approvedAccountTransactions,
        initialBalance,
        start,
        end,
        period === "Bulan ini" ? 16 : 20,
      ),
      topExpense: topExpense ? { category: topExpense[0], amount: topExpense[1] } : null,
      net: income - expense,
    };
  }, [approvedAccountTransactions, initialBalance, period]);

  const pendingTransactions = transactions.filter(t => t.status === 'PENDING_APPROVAL');

  return (
    <div className="workspace-page">
      <div className="page-heading dashboard-heading">
        <div>
          <div className="eyebrow"><CalendarDays size={14} /> {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          <h1>Selamat datang, {membership?.display_name?.split(" ")[0] ?? "User"}.</h1>
          <p>Ini gambaran keuanganmu bulan ini.</p>
        </div>
        <div className="heading-actions">
          <Link href="/transactions" className="button primary"><Plus size={17} /> Catat manual</Link>
        </div>
      </div>

      {pendingTransactions.length > 0 && (
        <section className="pending-action-center" aria-label="Transaksi yang perlu ditinjau">
          <div className="pending-action-copy">
            <div className="pending-action-icon">
              <CircleAlert size={20} />
            </div>
            <div>
              <h2>Perlu ditinjau</h2>
              <p>AI menemukan {pendingTransactions.length} transaksi yang menunggu persetujuanmu.</p>
            </div>
          </div>
          <Link href="/transactions" className="pending-action-link">Tinjau transaksi <ArrowRight size={15} /></Link>
        </section>
      )}

      <section className="financial-summary" aria-label="Ringkasan keuangan">
        <article className="balance-card financial-balance">
          <div className="balance-topline">
            <div className="balance-identity">
              <span className="balance-label"><Wallet size={16} /> Saldo bersih saat ini</span>
              {primaryAccount ? (
                <span className="account-badge">
                  {primaryAccount.type === 'bank' ? <CreditCard className="w-3 h-3" /> : primaryAccount.type === 'wallet' ? <Smartphone className="w-3 h-3" /> : <Wallet className="w-3 h-3" />}
                  {primaryAccount.name} (Utama)
                </span>
              ) : (
                <span className="account-badge">
                  <Wallet className="w-3 h-3" /> Total Rekening
                </span>
              )}
            </div>
            <div className="segmented-control" aria-label="Periode ringkasan">
              {periods.map((item) => (
                <button key={item} type="button" aria-pressed={period === item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>
              ))}
            </div>
          </div>
          <div className="balance-body">
            <div className="balance-main-copy">
              <p className="balance-amount">{money(summary.net_balance)}</p>
              <div className={`balance-context ${periodSummary.net > 0 ? "positive" : periodSummary.net < 0 ? "negative" : "neutral"}`}>
                {periodSummary.net > 0 ? <TrendingUp size={15} /> : periodSummary.net < 0 ? <ArrowDownRight size={15} /> : <Minus size={15} />}
                <span>
                  {period === "Bulan ini" ? "Bulan ini" : "3 bulan terakhir"}{" "}
                  {periodSummary.net > 0
                    ? <>surplus <strong>{money(periodSummary.net)}</strong></>
                    : periodSummary.net < 0
                      ? <>defisit <strong>{money(Math.abs(periodSummary.net))}</strong></>
                      : "pemasukan dan pengeluaran seimbang"}
                </span>
              </div>
            </div>
            <div
              className="balance-trend"
              role="img"
              aria-label={`Tren saldo bersih ${period.toLowerCase()}, dari ${money(periodSummary.balanceSeries[0])} menjadi ${money(periodSummary.balanceSeries.at(-1) ?? summary.net_balance)}`}
            >
              <div className="balance-trend-head" aria-hidden="true">
                <span>Pergerakan saldo</span>
              </div>
              <MiniSparkline
                data={periodSummary.balanceSeries}
                color="emerald"
                strokeColor="#c8f36b"
                strokeWidth={1.3}
                areaOpacity={0.06}
                verticalPadding={14}
                className="balance-trend-chart"
                height={88}
              />
            </div>
          </div>
          <div className="balance-footer">
            <span><i className="legend-dot income" /> Total pemasukan <b>{money(summary.income)}</b></span>
            <span><i className="legend-dot expense" /> Total pengeluaran <b>{money(summary.expense)}</b></span>
          </div>
        </article>

        <div className="financial-support">
          <article className="supporting-metric">
            <div className="supporting-metric-heading">
              <span className="supporting-metric-icon income"><ArrowDownLeft size={17} /></span>
              <span className="supporting-metric-label">Pemasukan</span>
              <span className="supporting-metric-period">{period}</span>
            </div>
            <div className="supporting-metric-body">
              <div>
                <strong>{money(periodSummary.income)}</strong>
                <small>{periodSummary.incomeCount} transaksi</small>
              </div>
              <div className="metric-sparkline" aria-hidden="true">
                <MiniSparkline data={periodSummary.incomeSeries} color="emerald" className="w-full h-10" height={40} />
              </div>
            </div>
            <div className={`metric-trend ${periodSummary.incomeTrend.direction === "up" ? "positive" : periodSummary.incomeTrend.direction === "down" ? "negative" : "neutral"}`}>
              {periodSummary.incomeTrend.direction === "up" ? <ArrowUpRight size={14} /> : periodSummary.incomeTrend.direction === "down" ? <ArrowDownRight size={14} /> : <Minus size={14} />}
              <span>{periodSummary.incomeTrend.text}</span>
            </div>
          </article>

          <article className="supporting-metric">
            <div className="supporting-metric-heading">
              <span className="supporting-metric-icon expense"><ArrowUpRight size={17} /></span>
              <span className="supporting-metric-label">Pengeluaran</span>
              <span className="supporting-metric-period">{period}</span>
            </div>
            <div className="supporting-metric-body">
              <div>
                <strong>{money(periodSummary.expense)}</strong>
                <small>{periodSummary.expenseCount} transaksi</small>
              </div>
              <div className="metric-sparkline" aria-hidden="true">
                <MiniSparkline data={periodSummary.expenseSeries} color="rose" className="w-full h-10" height={40} />
              </div>
            </div>
            <div className={`metric-trend ${periodSummary.expenseTrend.direction === "up" ? "negative" : periodSummary.expenseTrend.direction === "down" ? "positive" : "neutral"}`}>
              {periodSummary.expenseTrend.direction === "up" ? <ArrowUpRight size={14} /> : periodSummary.expenseTrend.direction === "down" ? <ArrowDownRight size={14} /> : <Minus size={14} />}
              <span>{periodSummary.expenseTrend.text}</span>
            </div>
          </article>

          <aside className="financial-insights" aria-label="Insight periode terpilih">
            <div className="insight-comparison">
              <span>{period === "Bulan ini" ? "Perbandingan bulan ini" : "Perbandingan 3 bulan"}</span>
              <strong>{periodSummary.net > 0 ? "Pemasukan lebih besar" : periodSummary.net < 0 ? "Pengeluaran lebih besar" : "Pemasukan dan pengeluaran seimbang"}</strong>
              <small>Selisih {money(Math.abs(periodSummary.net))}</small>
            </div>
            <div className="insight-top-expense">
              <span>Pengeluaran terbesar</span>
              {periodSummary.topExpense ? (
                <><strong>{periodSummary.topExpense.category}</strong><small>{money(periodSummary.topExpense.amount)}</small></>
              ) : (
                <><strong>Belum ada</strong><small>Belum ada pengeluaran pada periode ini</small></>
              )}
            </div>
          </aside>
        </div>
      </section>

      <div className="dashboard-columns dashboard-columns-single">
        <section className="panel recent-transactions-panel">
          <div className="panel-header">
            <div>
              <h2>Transaksi Terbaru</h2>
              <p>Riwayat transaksi otomatis dan manual</p>
            </div>
            <Link href="/transactions" className="text-button">Lihat semua <ArrowRight size={15} /></Link>
          </div>
          <div className="recent-transactions-wrap">
            <table className="recent-transactions-table">
              <thead>
                <tr>
                  <th>Transaksi</th>
                  <th>Tanggal</th>
                  <th className="amount-column">Jumlah</th>
                  <th>Kategori</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 && <tr className="empty-row"><td colSpan={5}>Belum ada transaksi.</td></tr>}
                {transactions.slice(0, 5).map((tx) => (
                  <tr key={tx.id}>
                    <td className="transaction-name-cell" data-label="Transaksi">
                      <div>
                        <strong>{tx.merchant}</strong>
                        <small>{sourceLabel[tx.source]}</small>
                      </div>
                    </td>
                    <td className="transaction-date-cell" data-label="Tanggal">
                      <div>
                        <span>{formatDate(tx.date)}</span>
                        {shouldDisplayTransactionTime(tx) && (
                          <small>{formatTime(tx.date)}</small>
                        )}
                      </div>
                    </td>
                    <td className={`transaction-amount-cell ${tx.type === 'INCOME' ? "income" : "expense"}`} data-label="Jumlah">
                      <strong>
                        {tx.type === 'INCOME' ? '+' : '-'}{money(tx.amount)}
                      </strong>
                    </td>
                    <td className="transaction-category-cell" data-label="Kategori"><span>{tx.category}</span></td>
                    <td className="transaction-status-cell" data-label="Status">
                      {tx.status === 'APPROVED' ? (
                        <span className="transaction-status approved"><CheckCircle2 size={12} /> Disetujui</span>
                      ) : tx.status === 'PENDING_APPROVAL' ? (
                        <span className="transaction-status pending"><CircleAlert size={12} /> Menunggu</span>
                      ) : (
                        <span className="transaction-status ignored"><Minus size={12} /> Diabaikan</span>
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
