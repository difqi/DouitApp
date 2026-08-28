"use client";

import "./dompet.css";

import {
  Banknote,
  CreditCard,
  Edit2,
  Eye,
  EyeOff,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  Wallet,
  WalletCards,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { BankLogo } from "@/app/components/BankLogo";
import { useWalletSwipe } from "@/app/components/useWalletSwipe";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { CustomSelect } from "@/app/components/ui/CustomSelect";
import { useDouit } from "@/app/providers/DouitProvider";
import {
  AccountBalanceTransaction,
  getAccountCurrentBalance,
  getTotalCurrentBalance,
  PaymentAccount,
} from "@/lib/account-balance";
import { createClient } from "@/lib/supabase/client";

const formatRupiah = (value: number | string) => new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
}).format(Number(value));

const subscribeMobileViewport = (onStoreChange: () => void) => {
  const mediaQuery = window.matchMedia("(max-width: 760px)");
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
};

const getMobileViewportSnapshot = () => window.matchMedia("(max-width: 760px)").matches;
const getServerMobileViewportSnapshot = () => false;

const accountTypeLabel = (type: string) => {
  if (type === "bank") return "Rekening bank";
  if (type === "wallet") return "E-wallet";
  if (type === "cash") return "Uang tunai";
  return type ? type.replace(/[_-]+/g, " ") : "Sumber dana";
};

const AccountTypeIcon = ({ type, size = 16 }: { type: string; size?: number }) => {
  if (type === "bank") return <CreditCard size={size} />;
  if (type === "wallet") return <Smartphone size={size} />;
  if (type === "cash") return <Banknote size={size} />;
  return <Wallet size={size} />;
};

function AccountLogo({ bankName, variant }: { bankName: string; variant: "hero" | "card" | "list" }) {
  const dimensions = variant === "hero"
    ? { width: 76, height: 48 }
    : variant === "card"
      ? { width: 60, height: 42 }
      : { width: 56, height: 39 };
  const frameClassName = variant === "card" ? "wallet-account-logo" : `wallet-${variant}-logo`;

  return (
    <span
      className={`wallet-logo-frame ${frameClassName}`}
      style={{
        display: "grid",
        width: dimensions.width,
        height: dimensions.height,
        flex: `0 0 ${dimensions.width}px`,
        placeItems: "center",
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      <BankLogo bankName={bankName} className="wallet-logo-mark h-full w-full max-w-full shrink-0 overflow-hidden" />
    </span>
  );
}

type MenuPosition = { top: number; left: number };
export default function DompetPage() {
  const { user } = useDouit();
  const searchParams = useSearchParams();
  const shouldOpenSuggestedAccount = searchParams.get("action") === "add_account";
  const suggestedBankName = searchParams.get("bankName") || "";
  const isMobileViewport = useSyncExternalStore(
    subscribeMobileViewport,
    getMobileViewportSnapshot,
    getServerMobileViewportSnapshot,
  );
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [transactions, setTransactions] = useState<AccountBalanceTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [confirmDeleteAccountId, setConfirmDeleteAccountId] = useState<string | null>(null);
  const [actionAccountId, setActionAccountId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [accName, setAccName] = useState("");
  const [accType, setAccType] = useState("bank");
  const [accBalance, setAccBalance] = useState("");
  const [accIsPrimary, setAccIsPrimary] = useState(false);
  const walletHeroRef = useRef<HTMLDivElement>(null);

  const fetchWalletData = useCallback(async () => {
    if (!user?.id) return;
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const [accountsResult, transactionsResult] = await Promise.all([
      supabase.from("payment_accounts").select("*").eq("user_id", user.id).order("created_at", { ascending: true }),
      supabase.from("transactions").select("amount, type, status, sumber_dana").eq("user_id", user.id).eq("status", "APPROVED"),
    ]);

    if (accountsResult.error || transactionsResult.error) {
      setLoadError("Rekening dan saldo belum dapat dimuat.");
      setIsLoading(false);
      return;
    }

    const nextAccounts = (accountsResult.data || []) as PaymentAccount[];
    setAccounts(nextAccounts);
    setTransactions((transactionsResult.data || []) as AccountBalanceTransaction[]);
    setSelectedAccountId((currentId) => {
      if (currentId && nextAccounts.some((account) => account.id === currentId)) return currentId;
      return nextAccounts.find((account) => account.is_primary)?.id || nextAccounts[0]?.id || null;
    });
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void fetchWalletData(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [fetchWalletData]);

  useEffect(() => {
    if (!accountModalOpen && !(isMobileViewport && actionAccountId)) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountModalOpen(false);
      setActionAccountId(null);
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [accountModalOpen, actionAccountId, isMobileViewport]);

  useEffect(() => {
    if (!actionAccountId || isMobileViewport) return;
    const closeMenu = () => setActionAccountId(null);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [actionAccountId, isMobileViewport]);

  const accountBalances = useMemo(() => new Map(
    accounts.map((account) => [account.id, getAccountCurrentBalance(account, transactions)]),
  ), [accounts, transactions]);
  const totalBalance = useMemo(
    () => getTotalCurrentBalance(accounts, transactions),
    [accounts, transactions],
  );
  const selectedIndex = Math.max(0, accounts.findIndex((account) => account.id === selectedAccountId));
  const selectedAccount = accounts[selectedIndex] || null;
  const stackedAccounts = useMemo(() => {
    if (accounts.length === 0) return [];
    return Array.from({ length: Math.min(accounts.length, 3) }, (_, depth) => {
      const accountIndex = (selectedIndex + depth) % accounts.length;
      return { account: accounts[accountIndex], accountIndex, depth };
    });
  }, [accounts, selectedIndex]);
  const actionAccount = accounts.find((account) => account.id === actionAccountId) || null;
  const selectAccountAt = useCallback((index: number) => {
    const account = accounts[index];
    if (account) setSelectedAccountId(account.id);
  }, [accounts]);
  const {
    dragOffset,
    handlePointerDown,
    handlePointerMove,
    finishPointerGesture,
  } = useWalletSwipe({ itemCount: accounts.length, selectedIndex, onSelect: selectAccountAt });

  const openAddAccount = () => {
    setEditAccountId(null);
    setAccName("");
    setAccType("bank");
    setAccBalance("");
    setAccIsPrimary(false);
    setAccountModalOpen(true);
  };

  useEffect(() => {
    if (!shouldOpenSuggestedAccount) return;
    const timeoutId = window.setTimeout(() => {
      setEditAccountId(null);
      setAccName(suggestedBankName);
      setAccType("bank");
      setAccBalance("");
      setAccIsPrimary(false);
      setAccountModalOpen(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [shouldOpenSuggestedAccount, suggestedBankName]);

  const openEditAccount = (account: PaymentAccount) => {
    setActionAccountId(null);
    setEditAccountId(account.id);
    setAccName(account.name);
    setAccType(account.type);
    setAccBalance(String(account.initial_balance ?? ""));
    setAccIsPrimary(account.is_primary);
    setAccountModalOpen(true);
  };

  const handleSaveAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !accName.trim() || isSaving) return;
    setIsSaving(true);
    const supabase = createClient();
    let savedAccountId = editAccountId;

    if (accIsPrimary) {
      const { error } = await supabase.from("payment_accounts").update({ is_primary: false }).eq("user_id", user.id);
      if (error) {
        toast.error("Gagal memperbarui rekening utama: " + error.message);
        setIsSaving(false);
        return;
      }
    }

    if (editAccountId) {
      const { error } = await supabase.from("payment_accounts").update({
        name: accName.trim(),
        type: accType,
        initial_balance: Number(accBalance) || 0,
        is_primary: accIsPrimary,
      }).eq("id", editAccountId);
      if (error) {
        toast.error("Gagal menyimpan rekening: " + error.message);
        setIsSaving(false);
        return;
      }
    } else {
      const { data: newAccounts, error } = await supabase.from("payment_accounts").insert({
        user_id: user.id,
        name: accName.trim(),
        type: accType,
        initial_balance: Number(accBalance) || 0,
        is_primary: accIsPrimary,
      }).select();

      if (error) {
        toast.error("Gagal menambahkan rekening: " + error.message);
        setIsSaving(false);
        return;
      }

      if (newAccounts?.length) {
        const newAccount = newAccounts[0];
        savedAccountId = newAccount.id;
        const keyword = accName.replace(/bank\s+/i, "").trim();
        const { data: transactionsToUpdate } = await supabase
          .from("transactions")
          .select("id, notes")
          .eq("user_id", user.id);

        if (transactionsToUpdate?.length) {
          const tag = `[UNMATCHED_BANK:${keyword.toLowerCase()}]`;
          const matchedTransactions = transactionsToUpdate.filter((transaction: { notes?: string | null }) =>
            transaction.notes?.toLowerCase().includes(tag),
          );
          await Promise.all(matchedTransactions.map(async (transaction: { id: string; notes: string }) => {
            const regex = new RegExp(`\\[UNMATCHED_BANK:${keyword}\\]`, "i");
            const nextNotes = transaction.notes.replace(regex, "").trim();
            await supabase.from("transactions").update({
              sumber_dana: newAccount.name,
              notes: nextNotes || null,
            }).eq("id", transaction.id);
          }));
        }
      }
    }

    setAccountModalOpen(false);
    setIsSaving(false);
    if (accIsPrimary && savedAccountId) setSelectedAccountId(savedAccountId);
    toast.success(editAccountId ? "Perubahan rekening tersimpan." : "Rekening berhasil ditambahkan.");
    await fetchWalletData();
  };

  const makePrimaryAccount = async (account: PaymentAccount) => {
    if (!user || account.is_primary) return;
    setActionAccountId(null);
    const supabase = createClient();
    const { error: resetError } = await supabase.from("payment_accounts").update({ is_primary: false }).eq("user_id", user.id);
    if (resetError) {
      toast.error("Gagal memperbarui rekening utama: " + resetError.message);
      return;
    }
    const { error } = await supabase.from("payment_accounts").update({ is_primary: true }).eq("id", account.id);
    if (error) {
      toast.error("Gagal menjadikan rekening utama: " + error.message);
      return;
    }
    setSelectedAccountId(account.id);
    toast.success(`${account.name} sekarang menjadi rekening utama.`);
    await fetchWalletData();
  };

  const executeDeletePaymentAccount = async () => {
    if (!confirmDeleteAccountId) return;
    const supabase = createClient();
    const { error } = await supabase.from("payment_accounts").delete().eq("id", confirmDeleteAccountId);
    setConfirmDeleteAccountId(null);
    if (error) {
      toast.error("Gagal menghapus rekening: " + error.message);
      return;
    }
    toast.success("Rekening berhasil dihapus.");
    await fetchWalletData();
  };

  const openActionMenu = (accountId: string, trigger: HTMLButtonElement) => {
    if (actionAccountId === accountId) {
      setActionAccountId(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const menuHeight = accounts.find((account) => account.id === accountId)?.is_primary ? 104 : 150;
    const menuWidth = 200;
    const viewportPadding = 12;
    const left = Math.min(
      Math.max(rect.right - menuWidth, viewportPadding),
      window.innerWidth - menuWidth - viewportPadding,
    );
    const hasSpaceBelow = window.innerHeight - rect.bottom >= menuHeight + 12;
    setMenuPosition({
      left,
      top: hasSpaceBelow ? rect.bottom + 7 : Math.max(viewportPadding, rect.top - menuHeight - 7),
    });
    setActionAccountId(accountId);
  };

  const showNextAccount = () => {
    if (accounts.length < 2) return;
    selectAccountAt((selectedIndex + 1) % accounts.length);
  };

  const selectFromList = (account: PaymentAccount) => {
    setSelectedAccountId(account.id);
    if (isMobileViewport) walletHeroRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const maskedBalance = "Rp ••••••••";
  const balanceText = (value: number) => balanceVisible ? formatRupiah(value) : maskedBalance;

  const renderMobileWalletCard = (account: PaymentAccount, accountIndex: number, depth: number) => {
    const isActive = depth === 0;
    return (
      <div
        key={account.id}
        className="wallet-mobile-card wallet-stack-card"
        data-depth={depth}
        data-variant={accountIndex % 4}
        aria-hidden={isActive ? undefined : true}
        style={isActive ? {
          transform: `translate3d(${dragOffset}px, 0, 0) rotate(${dragOffset / 80}deg)`,
          transition: dragOffset ? "none" : undefined,
        } : undefined}
        onPointerDown={isActive ? handlePointerDown : undefined}
        onPointerMove={isActive ? handlePointerMove : undefined}
        onPointerUp={isActive ? finishPointerGesture : undefined}
        onPointerCancel={isActive ? finishPointerGesture : undefined}
      >
        <div className="wallet-card-topline">
          <AccountLogo bankName={account.name} variant="hero" />
          <div className="wallet-card-actions">
            <span className="wallet-card-type"><AccountTypeIcon type={account.type} /><span>{accountTypeLabel(account.type)}</span></span>
            {accounts.length > 1 && (
              <button
                type="button"
                className="wallet-cycle-button"
                onClick={isActive ? showNextAccount : undefined}
                tabIndex={isActive ? undefined : -1}
                aria-label="Lihat dompet berikutnya"
              >
                <RefreshCw size={17} />
              </button>
            )}
          </div>
        </div>
        <div className="wallet-card-identity">
          <h2>{account.name}</h2>
          <p>{account.is_primary ? "Rekening utama" : accountTypeLabel(account.type)}</p>
        </div>
        <div className="wallet-card-balance"><span>Saldo saat ini</span><strong>{balanceText(accountBalances.get(account.id) || 0)}</strong></div>
        <div className="wallet-card-mark" aria-hidden="true"><WalletCards /></div>
      </div>
    );
  };

  const renderAccountActions = () => {
    if (!actionAccount || typeof document === "undefined") return null;
    const actionButtons = (
      <>
        <button type="button" onClick={() => openEditAccount(actionAccount)}><Edit2 size={17} /> Edit rekening</button>
        {!actionAccount.is_primary && (
          <button type="button" onClick={() => void makePrimaryAccount(actionAccount)}><WalletCards size={17} /> Jadikan utama</button>
        )}
        <button type="button" className="danger" onClick={() => { setActionAccountId(null); setConfirmDeleteAccountId(actionAccount.id); }}><Trash2 size={17} /> Hapus rekening</button>
      </>
    );

    return createPortal(
      isMobileViewport ? (
        <div className="wallet-action-sheet-scrim" onPointerDown={() => setActionAccountId(null)}>
          <section className="wallet-action-sheet" onPointerDown={(event) => event.stopPropagation()} aria-label={`Tindakan untuk ${actionAccount.name}`}>
            <div className="wallet-sheet-handle" />
            <header><div><span>Tindakan rekening</span><h2>{actionAccount.name}</h2></div><button type="button" onClick={() => setActionAccountId(null)} aria-label="Tutup tindakan"><X size={20} /></button></header>
            <div className="wallet-action-sheet-buttons">{actionButtons}</div>
          </section>
        </div>
      ) : menuPosition ? (
        <div className="wallet-menu-layer" onPointerDown={() => setActionAccountId(null)}>
          <div className="wallet-context-menu" style={menuPosition} onPointerDown={(event) => event.stopPropagation()}>{actionButtons}</div>
        </div>
      ) : null,
      document.body,
    );
  };

  return (
    <div className="workspace-page wallet-page">
      <header className="workspace-heading wallet-page-heading">
        <div>
          <span className="workspace-eyebrow"><WalletCards size={14} /> Dompet</span>
          <h1>Dompet</h1>
          <p>Kelola rekening, e-wallet, dan saldo kamu.</p>
        </div>
        {!isMobileViewport && !isLoading && !loadError && accounts.length > 0 && (
          <button type="button" className="button primary wallet-desktop-add" onClick={openAddAccount}><Plus size={17} /> Tambah rekening</button>
        )}
      </header>

      {isLoading ? (
        <div className="wallet-loading" aria-live="polite">
          <div className="wallet-loading-hero" />
          <div className="wallet-loading-grid"><i /><i /><i /><i /></div>
          <span>Memuat rekening dan saldo...</span>
        </div>
      ) : loadError ? (
        <section className="wallet-state wallet-state-error">
          <Wallet size={28} />
          <h2>Dompet belum dapat dimuat</h2>
          <p>{loadError}</p>
          <button type="button" className="button secondary" onClick={() => void fetchWalletData()}>Coba lagi</button>
        </section>
      ) : accounts.length === 0 ? (
        <section className="wallet-state wallet-empty-state">
          <span><WalletCards size={28} /></span>
          <small>Total saldo · {formatRupiah(0)}</small>
          <h2>Dompetmu masih kosong</h2>
          <p>Tambahkan rekening, e-wallet, atau uang tunai untuk mulai melacak saldo.</p>
          <button type="button" className="button primary" onClick={openAddAccount}><Plus size={17} /> Tambah rekening</button>
        </section>
      ) : isMobileViewport ? (
        <div className="wallet-mobile-presentation">
          <section className="wallet-mobile-hero-shell" aria-label="Ringkasan dompet">
            <div className="wallet-mobile-hero">
              <header className="wallet-mobile-hero-heading">
                <h1>Dompet</h1>
                <p>Kelola rekening, e-wallet, dan saldo kamu.</p>
              </header>
              <div className="wallet-mobile-total" aria-label="Total saldo seluruh sumber dana">
                <div><span>Total saldo</span><strong>{balanceText(totalBalance)}</strong></div>
                <button type="button" onClick={() => setBalanceVisible((visible) => !visible)} aria-label={balanceVisible ? "Sembunyikan saldo" : "Tampilkan saldo"}>{balanceVisible ? <EyeOff size={19} /> : <Eye size={19} />}</button>
              </div>
              <svg className="wallet-mobile-hero-wave" viewBox="0 0 400 64" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 30C72 51 126 52 190 32C260 10 323 5 400 28V64H0Z" fill="currentColor" />
              </svg>
            </div>

            {selectedAccount && (
              <section className="wallet-mobile-explorer" ref={walletHeroRef} aria-label="Dompet aktif">
                <div className="wallet-real-card-stack" data-size={stackedAccounts.length}>
                  {stackedAccounts.map(({ account, accountIndex, depth }) => renderMobileWalletCard(account, accountIndex, depth))}
                </div>
              </section>
            )}
          </section>

          {accounts.length > 1 && (
            <div className="wallet-explorer-controls">
              <div className="wallet-page-indicators" aria-label={`Dompet ${selectedIndex + 1} dari ${accounts.length}`}>
                {accounts.map((account, index) => <button key={account.id} type="button" className={index === selectedIndex ? "active" : ""} onClick={() => selectAccountAt(index)} aria-label={`Lihat ${account.name}`} aria-current={index === selectedIndex ? "true" : undefined} />)}
              </div>
            </div>
          )}
          <button type="button" className="button primary wallet-mobile-add" onClick={openAddAccount}><Plus size={17} /> Tambah rekening</button>

          <section className="wallet-accounts-section" aria-labelledby="wallet-mobile-accounts-heading">
            <div className="wallet-section-heading"><div><h2 id="wallet-mobile-accounts-heading">Rekening & sumber dana</h2></div><small>{accounts.length} rekening</small></div>
            <div className="wallet-account-list">
              {accounts.map((account) => (
                <div className="wallet-account-row" key={account.id}>
                  <button type="button" className="wallet-account-select" onClick={() => selectFromList(account)} aria-label={`Pilih ${account.name} sebagai kartu dompet aktif`}>
                    <AccountLogo bankName={account.name} variant="list" />
                    <span className="wallet-list-copy"><span><b>{account.name}</b>{account.is_primary && <em>Utama</em>}</span><small>{account.is_primary ? "Rekening utama" : accountTypeLabel(account.type)}</small><strong>{balanceText(accountBalances.get(account.id) || 0)}</strong></span>
                  </button>
                  <button type="button" className="wallet-overflow-button" onClick={(event) => openActionMenu(account.id, event.currentTarget)} aria-label={`Tindakan untuk ${account.name}`} aria-expanded={actionAccountId === account.id}><MoreHorizontal size={21} /></button>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="wallet-desktop-presentation">
          <section className="wallet-total-hero" aria-label="Total saldo seluruh sumber dana">
            <div className="wallet-total-copy">
              <span>Total saldo</span>
              <strong>{balanceText(totalBalance)}</strong>
              <small>{accounts.length} sumber dana</small>
            </div>
            <button type="button" onClick={() => setBalanceVisible((visible) => !visible)} aria-label={balanceVisible ? "Sembunyikan saldo" : "Tampilkan saldo"}>{balanceVisible ? <EyeOff size={19} /> : <Eye size={19} />}</button>
            <div className="wallet-total-decoration" aria-hidden="true"><WalletCards /><CreditCard /></div>
          </section>

          <section className="wallet-accounts-section" aria-labelledby="wallet-desktop-accounts-heading">
            <div className="wallet-section-heading"><div><span>Kelola dompet</span><h2 id="wallet-desktop-accounts-heading">Rekening & sumber dana</h2></div><small>{accounts.length} rekening</small></div>
            <div className="wallet-account-grid">
              {accounts.map((account, index) => (
                <article className="wallet-account-card" data-surface={index % 4} key={account.id}>
                  <div className="wallet-account-card-top">
                    <AccountLogo bankName={account.name} variant="card" />
                    <div className="wallet-account-copy"><h3>{account.name}</h3><p>{accountTypeLabel(account.type)}{account.is_primary && <em>Utama</em>}</p></div>
                    <button type="button" className="wallet-overflow-button" onClick={(event) => openActionMenu(account.id, event.currentTarget)} aria-label={`Tindakan untuk ${account.name}`} aria-expanded={actionAccountId === account.id}><MoreHorizontal size={20} /></button>
                  </div>
                  <div className="wallet-account-balance"><strong>{balanceText(accountBalances.get(account.id) || 0)}</strong><span>Saldo saat ini</span></div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {accountModalOpen && typeof document !== "undefined" && createPortal(
        <div className="wallet-modal-scrim" onPointerDown={() => !isSaving && setAccountModalOpen(false)}>
          <section className="wallet-account-dialog" onPointerDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="wallet-account-dialog-title">
            <header><div><span>{editAccountId ? "Perbarui sumber dana" : "Sumber dana baru"}</span><h2 id="wallet-account-dialog-title">{editAccountId ? "Edit rekening" : "Tambah rekening"}</h2><p>Atur identitas rekening dan saldo awal.</p></div><button type="button" onClick={() => setAccountModalOpen(false)} disabled={isSaving} aria-label="Tutup"><X size={20} /></button></header>
            <form onSubmit={handleSaveAccount}>
              <div className="wallet-account-form-body">
                <label className="settings-field"><span>Nama rekening / bank</span><input type="text" value={accName} onChange={(event) => setAccName(event.target.value)} required placeholder="Contoh: Bank BRI" autoFocus={!isMobileViewport} /></label>
                <label className="settings-field"><span>Tipe rekening</span><CustomSelect value={accType} onChange={setAccType} responsiveOverlay selectionTitle="Pilih tipe rekening" options={[{ value: "bank", label: "Bank" }, { value: "wallet", label: "E-Wallet" }, { value: "cash", label: "Tunai" }]} /></label>
                <label className="settings-field"><span>Saldo awal (Rp)</span><input type="number" inputMode="numeric" value={accBalance} onChange={(event) => setAccBalance(event.target.value)} required placeholder="Contoh: 100000" /><small>Saldo awal menjadi dasar perhitungan saldo saat ini.</small></label>
                <label className="settings-checkbox"><input type="checkbox" checked={accIsPrimary} onChange={(event) => setAccIsPrimary(event.target.checked)} /><span>Jadikan rekening utama</span></label>
              </div>
              <footer><button type="button" className="button secondary" onClick={() => setAccountModalOpen(false)} disabled={isSaving}>Batal</button><button type="submit" className="button primary" disabled={isSaving}>{isSaving ? "Menyimpan..." : "Simpan perubahan"}</button></footer>
            </form>
          </section>
        </div>,
        document.body,
      )}

      {renderAccountActions()}
      <ConfirmDialog
        isOpen={!!confirmDeleteAccountId}
        onClose={() => setConfirmDeleteAccountId(null)}
        onConfirm={() => void executeDeletePaymentAccount()}
        title="Hapus Rekening"
        description="Hapus rekening ini? Transaksi terkait tetap tersimpan, tetapi tidak lagi terhubung ke rekening tersebut."
        confirmLabel="Hapus Rekening"
        variant="danger"
      />
    </div>
  );
}
