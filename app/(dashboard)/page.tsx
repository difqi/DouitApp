"use client";

import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Bot,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CircleAlert,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  Minus,
  PiggyBank,
  Plus,
  RefreshCw,
  Smartphone,
  TrendingUp,
  Wallet
} from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import { useDouit } from "../providers/DouitProvider";
import { Transaction } from "../../types";
import { MiniSparkline } from "../components/MiniSparkline";
import { BankLogo } from "../components/BankLogo";
import { useWalletCarousel } from "../components/useWalletSwipe";
import { MobileProfileIdentity } from "../components/MobileAppHeader";
import { TransactionCreateModal } from "../components/TransactionCreateModal";

import { getAccountCurrentBalance, getTotalCurrentBalance, PaymentAccount } from "@/lib/account-balance";
import { createClient } from "@/lib/supabase/client";
import { isAccountMatch } from "../../utils/bankAliases";
import { shouldDisplayTransactionTime } from "../components/WorkspaceViews";
import { normalizeTransactionSubcategory } from "@/lib/categories";
import { formatTransactionCategoryLabel } from "@/lib/transaction-category-display";
import { aggregateApprovedTransactionsByParentCategory } from "@/lib/report-category-aggregation";
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
let cachedAccounts: PaymentAccount[] = [];
let cachedSelectedAccount: PaymentAccount | null = null;

const maskedMoney = "Rp ••••••••";

const accountTypeLabel = (type: string) => {
  if (type === "bank") return "Rekening bank";
  if (type === "wallet") return "E-wallet";
  if (type === "cash") return "Uang tunai";
  return type ? type.replace(/[_-]+/g, " ") : "Sumber dana";
};

type DashboardTransaction = Transaction & { sumber_dana?: string };

const TransactionStatusBadge = ({ status }: { status: Transaction["status"] }) => {
  if (status === "APPROVED") {
    return <span className="transaction-status approved"><CheckCircle2 size={12} /> Disetujui</span>;
  }
  if (status === "PENDING_APPROVAL") {
    return <span className="transaction-status pending"><CircleAlert size={12} /> Menunggu</span>;
  }
  return <span className="transaction-status ignored"><Minus size={12} /> Diabaikan</span>;
};

const AccountTypeIcon = ({ type, size = 15 }: { type: string; size?: number }) => {
  if (type === "bank") return <CreditCard size={size} />;
  if (type === "wallet") return <Smartphone size={size} />;
  if (type === "cash") return <Banknote size={size} />;
  return <Wallet size={size} />;
};

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<PaymentAccount[]>(cachedAccounts);
  const [selectedAccount, setSelectedAccount] = useState<PaymentAccount | null>(cachedSelectedAccount);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [period, setPeriod] = useState<DashboardPeriod>("Bulan ini");
  const [transactions, setTransactions] = useState<Transaction[]>(cachedDashboardTx);
  const [transactionModalOpen, setTransactionModalOpen] = useState(false);
  const { user, membership } = useDouit();

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();

    const fetchTransactions = async () => {
      const { data: accData } = await supabase.from('payment_accounts').select('*').eq('user_id', user.id);
      if (accData) {
        const nextAccounts = accData as PaymentAccount[];
        cachedAccounts = nextAccounts;
        setAccounts(nextAccounts);
        setSelectedAccount((currentAccount) => {
          const nextSelected = nextAccounts.find((account) => account.id === currentAccount?.id)
            || nextAccounts.find((account) => account.is_primary)
            || nextAccounts[0]
            || null;
          cachedSelectedAccount = nextSelected;
          return nextSelected;
        });
      }

      const { data, error } = await supabase
        .from('transactions')
        .select(`
          id, amount, type, merchant, status, source, confidence_score, transaction_date, category_id, subcategory_id, sumber_dana, notes,
          categories (name),
          subcategories (id, category_id, user_id, name, is_system, system_key, icon_name, color_hex, created_at)
        `)
        .eq('user_id', user.id)
        .order('transaction_date', { ascending: false });

      if (data) {
        const mapped = data.map(d => ({
          ...d,
          date: d.transaction_date,
          notes: d.notes,
          category: (d.categories as any)?.name || 'Lain-lain',
          category_id: d.category_id,
          subcategory_id: d.subcategory_id,
          subcategory: normalizeTransactionSubcategory({
            relation: d.subcategories,
            categoryId: d.category_id,
            subcategoryId: d.subcategory_id,
            userId: user.id,
          }),
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
    if (selectedAccount) {
      relevantTxs = relevantTxs.filter(t => isAccountMatch(selectedAccount.name, (t as any).sumber_dana));
    }
    return relevantTxs;
  }, [transactions, selectedAccount]);

  const initialBalance = React.useMemo(() => (
    selectedAccount
      ? Number(selectedAccount.initial_balance) || 0
      : accounts.reduce((sum, account) => sum + (Number(account.initial_balance) || 0), 0)
  ), [accounts, selectedAccount]);

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
    const topExpense = aggregateApprovedTransactionsByParentCategory(currentTransactions)
      .filter((category) => category.expense > 0)
      .sort((first, second) => second.expense - first.expense)[0];

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
      topExpense: topExpense ? { category: topExpense.name, amount: topExpense.expense } : null,
      net: income - expense,
    };
  }, [approvedAccountTransactions, initialBalance, period]);

  const pendingTransactions = transactions.filter(t => t.status === 'PENDING_APPROVAL');
  const selectedIndex = Math.max(0, accounts.findIndex((account) => account.id === selectedAccount?.id));
  const selectAccountAt = React.useCallback((index: number) => {
    const account = accounts[index];
    if (!account) return;
    cachedSelectedAccount = account;
    setSelectedAccount(account);
  }, [accounts]);
  const {
    carouselRef,
    handleScroll: handleCarouselScroll,
    beginUserInteraction,
    scrollToIndex,
  } = useWalletCarousel({ itemCount: accounts.length, selectedIndex, onSelect: selectAccountAt });
  const totalBalance = React.useMemo(
    () => getTotalCurrentBalance(accounts, transactions),
    [accounts, transactions],
  );
  const accountBalances = React.useMemo(() => new Map(
    accounts.map((account) => [account.id, getAccountCurrentBalance(account, transactions)]),
  ), [accounts, transactions]);
  const balanceText = (value: number | string) => balanceVisible ? money(value) : maskedMoney;
  const selectedAccountName = selectedAccount?.name || "Total rekening";
  const recentTransactions = transactions.slice(0, 5) as DashboardTransaction[];
  const showAccountAt = (index: number) => {
    selectAccountAt(index);
    scrollToIndex(index);
  };
  const showNextAccount = () => {
    if (accounts.length < 2) return;
    showAccountAt((selectedIndex + 1) % accounts.length);
  };

  return (
    <div className="workspace-page dashboard-page">
      <div className="page-heading dashboard-heading dashboard-desktop-only">
        <div>
          <div className="eyebrow"><CalendarDays size={14} /> {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          <h1>Selamat datang, {membership?.display_name?.split(" ")[0] ?? "User"}.</h1>
          <p className="dashboard-heading-subtitle">Ini gambaran keuanganmu bulan ini.</p>
        </div>
        <div className="heading-actions">
          <button type="button" className="button primary" onClick={() => setTransactionModalOpen(true)} aria-haspopup="dialog"><Plus size={17} /> Catat manual</button>
        </div>
      </div>

      <section className="dashboard-mobile-hero dashboard-mobile-only" aria-label="Saldo dan rekening aktif">
        <header className="dashboard-hero-profile-row mobile-navigation">
          <MobileProfileIdentity />
        </header>

        <section className="dashboard-mobile-total" aria-label="Total saldo seluruh sumber dana">
          <div>
            <span>Total saldo</span>
            <strong>{balanceText(totalBalance)}</strong>
          </div>
          <button
            type="button"
            onClick={() => setBalanceVisible((visible) => !visible)}
            aria-label={balanceVisible ? "Sembunyikan nominal" : "Tampilkan nominal"}
            aria-pressed={!balanceVisible}
          >
            {balanceVisible ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        </section>

        <section className="dashboard-wallet-explorer" aria-label="Rekening aktif">
          {accounts.length > 0 ? (
            <div
              ref={carouselRef}
              className={`dashboard-wallet-track ${accounts.length === 1 ? "single" : ""}`}
              onScroll={handleCarouselScroll}
              onPointerDown={beginUserInteraction}
              onWheel={beginUserInteraction}
            >
              {accounts.map((account, index) => {
                const accountType = accountTypeLabel(account.type);
                return (
                  <article
                    key={account.id}
                    className={`dashboard-wallet-card ${index === selectedIndex ? "active" : ""}`}
                    data-variant={index % 4}
                    role="group"
                    aria-label={`Rekening ${index + 1} dari ${accounts.length}: ${account.name}`}
                    aria-current={index === selectedIndex ? "true" : undefined}
                  >
                    <div className="dashboard-wallet-topline">
                      <span className="dashboard-wallet-logo" aria-hidden="true">
                        <BankLogo bankName={account.name} className="h-full w-full max-w-full shrink-0 overflow-hidden" />
                      </span>
                      <div className="dashboard-wallet-actions">
                        <span className="dashboard-wallet-type">
                          <AccountTypeIcon type={account.type} />
                          {accountType}
                        </span>
                        {accounts.length > 1 && index === selectedIndex && (
                          <button type="button" className="dashboard-wallet-cycle" onClick={showNextAccount} aria-label="Lihat rekening berikutnya">
                            <RefreshCw size={17} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="dashboard-wallet-identity">
                      <h2>{account.name}</h2>
                      <p>{account.is_primary ? "Rekening utama" : accountType}</p>
                    </div>
                    <div className="dashboard-wallet-balance">
                      <span>Saldo saat ini</span>
                      <strong>{balanceText(accountBalances.get(account.id) || 0)}</strong>
                    </div>
                    <Wallet className="dashboard-wallet-mark" aria-hidden="true" />
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="dashboard-wallet-card active single" data-variant="0">
              <div className="dashboard-wallet-topline">
                <span className="dashboard-wallet-logo" aria-hidden="true"><Wallet size={28} /></span>
                <span className="dashboard-wallet-type"><Wallet size={15} /> Sumber dana</span>
              </div>
              <div className="dashboard-wallet-identity"><h2>Belum ada rekening</h2><p>Tambahkan sumber dana dari halaman Dompet</p></div>
              <div className="dashboard-wallet-balance"><span>Saldo saat ini</span><strong>{balanceText(totalBalance)}</strong></div>
              <Wallet className="dashboard-wallet-mark" aria-hidden="true" />
            </div>
          )}
          {accounts.length > 1 && (
            <div className="dashboard-wallet-indicators" aria-label={`Rekening ${selectedIndex + 1} dari ${accounts.length}`}>
              {accounts.map((account, index) => (
                <button
                  key={account.id}
                  type="button"
                  className={index === selectedIndex ? "active" : ""}
                  onClick={() => showAccountAt(index)}
                  aria-label={`Lihat ${account.name}`}
                  aria-current={index === selectedIndex ? "true" : undefined}
                />
              ))}
            </div>
          )}
        </section>
      </section>

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

      <section className="dashboard-mobile-summary dashboard-mobile-only" aria-label="Ringkasan keuangan mobile">
        <nav className="dashboard-quick-actions" aria-label="Aksi cepat">
          <button type="button" className="quick-action quick-action-record" onClick={() => setTransactionModalOpen(true)} aria-haspopup="dialog"><span><Plus size={21} /></span><small>Catat</small></button>
          <Link href="/chat" className="quick-action quick-action-ai"><span><Bot size={20} /></span><small>Douit AI</small></Link>
          <Link href="/nabung" className="quick-action quick-action-saving"><span><PiggyBank size={20} /></span><small>Nabung</small></Link>
          <Link href="/laporan" className="quick-action quick-action-report"><span><ChartNoAxesColumnIncreasing size={20} /></span><small>Laporan</small></Link>
        </nav>

        <section className="dashboard-flow-card" aria-label={`${period}: pemasukan dan pengeluaran`}>
          <article className="dashboard-flow-metric income">
            <span className="dashboard-flow-icon"><ArrowUpRight size={16} /></span>
            <div className="dashboard-flow-copy">
              <strong>{balanceText(periodSummary.income)}</strong>
              <span className="dashboard-flow-label">Pemasukan</span>
              <small>{periodSummary.incomeCount} transaksi</small>
            </div>
          </article>
          <article className="dashboard-flow-metric expense">
            <span className="dashboard-flow-icon"><ArrowDownRight size={16} /></span>
            <div className="dashboard-flow-copy">
              <strong>{balanceText(periodSummary.expense)}</strong>
              <span className="dashboard-flow-label">Pengeluaran</span>
              <small>{periodSummary.expenseCount} transaksi</small>
            </div>
          </article>
        </section>

        <article className="dashboard-analysis-card">
          <header>
            <div><span>Analisis</span><h2>Pergerakan saldo</h2><small>{selectedAccountName}</small></div>
            <div className="dashboard-period-control" aria-label="Periode grafik">
              {periods.map((item) => (
                <button key={item} type="button" aria-pressed={period === item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>
              ))}
            </div>
          </header>
          <div
            className="dashboard-analysis-chart"
            role="img"
            aria-label={balanceVisible
              ? `Tren saldo ${selectedAccountName} ${period.toLowerCase()}, dari ${money(periodSummary.balanceSeries[0])} menjadi ${money(periodSummary.balanceSeries.at(-1) ?? summary.net_balance)}`
              : `Tren saldo ${selectedAccountName} ${period.toLowerCase()}`}
          >
            <MiniSparkline
              data={periodSummary.balanceSeries}
              color="emerald"
              strokeColor="#c8f36b"
              strokeWidth={1.8}
              areaOpacity={0.1}
              verticalPadding={18}
              className="dashboard-analysis-sparkline"
              height={104}
            />
          </div>
          <div className={`dashboard-balance-condition ${periodSummary.net > 0 ? "positive" : periodSummary.net < 0 ? "negative" : "neutral"}`}>
            {periodSummary.net > 0 ? <TrendingUp size={15} /> : periodSummary.net < 0 ? <ArrowDownRight size={15} /> : <Minus size={15} />}
            <span>
              {periodSummary.net > 0
                ? <>Periode ini surplus {balanceText(periodSummary.net)}</>
                : periodSummary.net < 0
                  ? <>Periode ini defisit {balanceText(Math.abs(periodSummary.net))}</>
                  : "Pemasukan dan pengeluaran seimbang"}
            </span>
          </div>
        </article>

        <aside className="dashboard-mobile-insights" aria-label="Insight periode terpilih">
          <article className={`dashboard-insight-card comparison ${periodSummary.net > 0 ? "positive" : periodSummary.net < 0 ? "negative" : "neutral"}`}>
            <span>{period === "Bulan ini" ? "Perbandingan bulan ini" : "Perbandingan 3 bulan"}</span>
            <strong>{periodSummary.net > 0 ? "Pemasukan lebih besar" : periodSummary.net < 0 ? "Pengeluaran lebih besar" : "Arus seimbang"}</strong>
            <small>Selisih {balanceText(Math.abs(periodSummary.net))}</small>
          </article>
          <article className="dashboard-insight-card top-expense">
            <span>Pengeluaran terbesar</span>
            {periodSummary.topExpense ? (
              <><strong>{periodSummary.topExpense.category}</strong><small>{balanceText(periodSummary.topExpense.amount)}</small></>
            ) : (
              <><strong>Belum ada</strong><small>Belum ada pengeluaran</small></>
            )}
          </article>
        </aside>
      </section>

      <section className="financial-summary dashboard-desktop-summary dashboard-desktop-only" aria-label="Ringkasan keuangan">
        <article className="balance-card financial-balance">
          <div className="balance-topline">
            <div className="balance-identity">
              <span className="balance-label"><Wallet size={16} /> Saldo bersih saat ini</span>
              {selectedAccount ? (
                <span className="account-badge">
                  <AccountTypeIcon type={selectedAccount.type} size={12} />
                  {selectedAccount.name}{selectedAccount.is_primary ? " (Utama)" : ""}
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
            <table className="recent-transactions-table dashboard-recent-desktop dashboard-desktop-only">
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
                {recentTransactions.length === 0 && <tr className="empty-row"><td colSpan={5}>Belum ada transaksi.</td></tr>}
                {recentTransactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="dashboard-recent-name-cell">
                      <div className="dashboard-recent-identity">
                        <span className="dashboard-transaction-logo" aria-hidden="true">
                          <BankLogo bankName={tx.sumber_dana || "Tunai"} className="h-full w-full max-w-full shrink-0 overflow-hidden" />
                        </span>
                        <div>
                          <strong>{tx.merchant}</strong>
                          <small>{tx.sumber_dana || "Tunai"} · {sourceLabel[tx.source]}</small>
                        </div>
                      </div>
                    </td>
                    <td className="dashboard-recent-date-cell">
                      <div>
                        <span>{formatDate(tx.date)}</span>
                        {shouldDisplayTransactionTime(tx) && <small>{formatTime(tx.date)}</small>}
                      </div>
                    </td>
                    <td className={`dashboard-recent-amount-cell ${tx.type === "INCOME" ? "income" : "expense"}`}>
                      <strong>{tx.type === "INCOME" ? "+" : "-"}{balanceText(tx.amount)}</strong>
                    </td>
                    <td className="dashboard-recent-category-cell"><span title={formatTransactionCategoryLabel(tx.category, tx.subcategory?.name)}>{formatTransactionCategoryLabel(tx.category, tx.subcategory?.name)}</span></td>
                    <td className="dashboard-recent-status-cell"><TransactionStatusBadge status={tx.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="dashboard-recent-mobile dashboard-mobile-only" role="list">
              {recentTransactions.length === 0 && <p className="dashboard-recent-empty">Belum ada transaksi.</p>}
              {recentTransactions.map((tx) => (
                <article className="dashboard-transaction-feed-item" key={tx.id} role="listitem">
                  <span className="dashboard-transaction-logo" aria-hidden="true">
                    <BankLogo bankName={tx.sumber_dana || "Tunai"} className="h-full w-full max-w-full shrink-0 overflow-hidden" />
                  </span>
                  <div className="dashboard-transaction-feed-copy">
                    <div className="dashboard-transaction-feed-heading">
                      <strong>{tx.merchant}</strong>
                      <b className={tx.type === "INCOME" ? "income" : "expense"}>{tx.type === "INCOME" ? "+" : "-"}{balanceText(tx.amount)}</b>
                    </div>
                    <span>{tx.sumber_dana || "Tunai"} · {sourceLabel[tx.source]}</span>
                    <small>
                      {formatDate(tx.date)}
                      {shouldDisplayTransactionTime(tx) && <> · {formatTime(tx.date)}</>}
                    </small>
                    <div className="dashboard-transaction-feed-footer">
                      <em title={formatTransactionCategoryLabel(tx.category, tx.subcategory?.name)}>{formatTransactionCategoryLabel(tx.category, tx.subcategory?.name)}</em>
                      <TransactionStatusBadge status={tx.status} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
      <TransactionCreateModal open={transactionModalOpen} onClose={() => setTransactionModalOpen(false)} />
    </div>
  );
}
