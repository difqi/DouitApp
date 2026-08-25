"use client";

import { AlertCircle, AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronRight, Circle, CircleDashed, Clock, Copy, Edit2, Mail, MoreHorizontal, Plus, RefreshCw, RotateCcw, Settings, Shield, ShieldAlert, Tags, Trash2, User, Wallet, X } from "lucide-react";
import { useState, useEffect, useSyncExternalStore } from "react";
import { useDouit } from "../../providers/DouitProvider";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { CustomSelect } from "@/app/components/ui/CustomSelect";
import { BankLogo } from "@/app/components/BankLogo";
import { CATEGORY_ICON_OPTIONS, CategoryIcon, resolveCategoryColor } from "@/app/components/CategoryIcon";

type SettingsTab = 'email' | 'profile' | 'rules' | 'accounts';

const SETTINGS_NAV: { id: SettingsTab; label: string; description: string; icon: typeof Mail }[] = [
  { id: 'email', label: 'Email otomatis', description: 'Pencatatan dari notifikasi bank', icon: Mail },
  { id: 'profile', label: 'Profil & preferensi', description: 'Nama, email, dan keamanan', icon: User },
  { id: 'rules', label: 'Kategori & akun', description: 'Kategori dan aturan merchant', icon: Tags },
  { id: 'accounts', label: 'Rekening & saldo', description: 'Sumber dana dan saldo awal', icon: Wallet },
];

const CATEGORY_COLOR_OPTIONS = [
  "#16825d",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc6b2f",
  "#ca8a04",
  "#64748b",
] as const;

const formatRupiah = (value: number | string) => new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
}).format(Number(value));

const subscribeSettingsViewport = (onStoreChange: () => void) => {
  const mediaQuery = window.matchMedia("(max-width: 760px)");
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
};

const getSettingsMobileSnapshot = () => window.matchMedia("(max-width: 760px)").matches;
const getSettingsServerSnapshot = () => false;

export default function SettingsPage() {
  const { user, business, refresh } = useDouit();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobileViewport = useSyncExternalStore(
    subscribeSettingsViewport,
    getSettingsMobileSnapshot,
    getSettingsServerSnapshot,
  );

  // Confirmation Dialog States
  const [confirmDeleteCatId, setConfirmDeleteCatId] = useState<string | null>(null);
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] = useState<string | null>(null);
  const [confirmDeleteAccountId, setConfirmDeleteAccountId] = useState<string | null>(null);
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);
  const [confirmResetDataOpen, setConfirmResetDataOpen] = useState(false);
  const [confirmDeleteAccountOpen, setConfirmDeleteAccountOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [categoryIconPickerOpen, setCategoryIconPickerOpen] = useState(false);
  const [openAccountMenuId, setOpenAccountMenuId] = useState<string | null>(null);

  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    const action = searchParams?.get('action');
    const bankName = searchParams?.get('bankName');
    
    if (action === 'add_account') {
      setActiveTab('accounts');
      setMobileDetailOpen(true);
      setEditAccountId(null);
      setAccName(bankName || "");
      setAccType("bank");
      setAccBalance("");
      setAccIsPrimary(false);
      setAccountModalOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!addCategoryOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAddCategoryOpen(false);
        setCategoryIconPickerOpen(false);
      }
    };

    if (isMobileViewport) document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [addCategoryOpen, isMobileViewport]);

  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<SettingsTab>('email');

  // Tab 3 State
  const [categories, setCategories] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [isFetchingRules, setIsFetchingRules] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatType, setNewCatType] = useState("EXPENSE");
  const [newCatIcon, setNewCatIcon] = useState("Folder");
  const [newCatColor, setNewCatColor] = useState("#64748b");
  const [newCatBudget, setNewCatBudget] = useState("");

  // Edit Category Modal
  const [editCatModalOpen, setEditCatModalOpen] = useState(false);
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatBudget, setEditCatBudget] = useState("");

  // Profile state
  const [fullName, setFullName] = useState("");
  const [currency, setCurrency] = useState("IDR");
  const [timezone, setTimezone] = useState("Asia/Jakarta");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // OAuth Check
  const [isOAuthUser, setIsOAuthUser] = useState(false);

  // Tab 4 State (Accounts)
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isFetchingAccounts, setIsFetchingAccounts] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  
  // Account Form State
  const [accName, setAccName] = useState("");
  const [accType, setAccType] = useState("bank");
  const [accBalance, setAccBalance] = useState<string | number>("");
  const [accIsPrimary, setAccIsPrimary] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName((user.profile?.full_name as string) || (user.profile?.name as string) || "");

      const checkProvider = async () => {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (data?.user?.app_metadata?.providers?.includes('google')) {
          setIsOAuthUser(true);
        }
      };
      checkProvider();
    }
  }, [user]);

  useEffect(() => {
    if (user && activeTab === 'rules') {
      fetchRulesAndCategories();
    }
  }, [user, activeTab]);

  // Email Integration Status State
  const [emailStatus, setEmailStatus] = useState<'CONNECTED' | 'PENDING' | 'UNLINKED'>('UNLINKED');
  const [isFetchingEmailStatus, setIsFetchingEmailStatus] = useState(true);

  useEffect(() => {
    if (user && activeTab === 'email') {
      fetchEmailIntegrationStatus();
    }
  }, [user, activeTab]);

  const fetchEmailIntegrationStatus = async () => {
    if (!user?.id) return;
    setIsFetchingEmailStatus(true);
    const supabase = createClient();
    
    const { data: notifs } = await supabase
      .from('notifications')
      .select('id, metadata, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    const forwardingNotifs = notifs?.filter(
      (n: any) => n.metadata?.action_type === 'FORWARDING_CONFIRMATION'
    ) || [];

    // AUTO-CLEANUP / RESET: If any notification was marked as confirmed but lacks a valid /vf- link, reset is_confirmed to false in DB
    for (const n of forwardingNotifs) {
      const url = n.metadata?.confirmation_url;
      const isValidVfLink = typeof url === 'string' && url.includes('/vf-');
      if (n.metadata?.is_confirmed === true && !isValidVfLink) {
        console.warn(`[Auto-Cleanup] Resetting invalid confirmed state for notification ${n.id}`);
        const updatedMetadata = { ...n.metadata, is_confirmed: false, error: 'INVALID_VERIFICATION_LINK' };
        await supabase
          .from('notifications')
          .update({ metadata: updatedMetadata })
          .eq('id', n.id);
        n.metadata = updatedMetadata;
      }
    }

    const isFullyConnected = forwardingNotifs.some((n: any) => 
      n.metadata?.action_type === 'FORWARDING_CONFIRMATION' &&
      n.metadata?.is_confirmed === true &&
      typeof n.metadata?.confirmation_url === 'string' &&
      n.metadata.confirmation_url.includes('/vf-')
    );

    const hasPendingRecord = forwardingNotifs.length > 0;

    if (isFullyConnected) {
      setEmailStatus('CONNECTED');
    } else if (hasPendingRecord) {
      setEmailStatus('PENDING');
    } else {
      setEmailStatus('UNLINKED');
    }
    setIsFetchingEmailStatus(false);
  };

  useEffect(() => {
    if (user && activeTab === 'accounts') {
      fetchAccounts();
    }
  }, [user, activeTab]);

  const fetchAccounts = async () => {
    setIsFetchingAccounts(true);
    const supabase = createClient();
    const { data } = await supabase.from('payment_accounts').select('*').eq('user_id', user?.id).order('created_at', { ascending: true });
    if (data) setAccounts(data);
    setIsFetchingAccounts(false);
  };

  const fetchRulesAndCategories = async () => {
    setIsFetchingRules(true);
    const supabase = createClient();
    const { data: cats } = await supabase.from('categories').select('*, category_budgets(amount)').or(`user_id.eq.${user?.id},is_system.eq.true,user_id.is.null`).order('is_system', { ascending: false });
    if (cats) {
      setCategories(cats.filter((c: any) => c.name !== 'Nabung').map((c: any) => ({
        ...c,
        budget_limit: c.category_budgets && c.category_budgets.length > 0 ? c.category_budgets[0].amount : (c.budget_limit || 0)
      })));
    }

    const { data: mRules } = await supabase.from('merchant_rules').select('id, merchant_name, keyword, category_id').eq('user_id', user?.id);
    if (mRules) setRules(mRules);
    setIsFetchingRules(false);
  };

  const handleDeleteCategory = (id: string) => {
    if (!user) return;
    setConfirmDeleteCatId(id);
  };

  const executeDeleteCategory = async () => {
    if (!user || !confirmDeleteCatId) return;
    const id = confirmDeleteCatId;
    const supabase = createClient();
    const lainLain = categories.find(c => c.name === 'Lain-lain');
    
    if (lainLain) {
      await supabase.from('transactions').update({ category_id: lainLain.id }).eq('category_id', id);
    }
    
    const { error } = await supabase.from('categories').delete().eq('id', id);
    setConfirmDeleteCatId(null);
    if (error) {
      toast.error("Gagal menghapus kategori: " + error.message);
      return;
    }
    toast.success("Kategori berhasil dihapus.");
    fetchRulesAndCategories();
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newCatName) return;
    const supabase = createClient();
    const { data: newCat, error } = await supabase.from('categories').insert({
      user_id: user.id,
      name: newCatName,
      type: newCatType,
      icon_name: newCatIcon,
      color_hex: newCatColor,
      is_system: false,
      budget_limit: Number(newCatBudget) || 0
    }).select().single();

    if (error) {
      toast.error("Gagal menambahkan kategori: " + error.message);
      return;
    }
    
    if (newCat && Number(newCatBudget) > 0) {
      const { error: budgetError } = await supabase.from('category_budgets').insert({
        user_id: user.id,
        category_id: newCat.id,
        amount: Number(newCatBudget)
      });
      if (budgetError) {
        toast.error("Kategori dibuat, tetapi alokasi anggaran gagal disimpan: " + budgetError.message);
        setNewCatName("");
        setNewCatBudget("");
        setAddCategoryOpen(false);
        setCategoryIconPickerOpen(false);
        fetchRulesAndCategories();
        return;
      }
    }
    setNewCatName("");
    setNewCatBudget("");
    setAddCategoryOpen(false);
    setCategoryIconPickerOpen(false);
    toast.success("Kategori berhasil ditambahkan.");
    fetchRulesAndCategories();
  };

  const openEditCategory = (cat: any) => {
    setEditCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatBudget(cat.budget_limit ? cat.budget_limit.toString() : "");
    setEditCatModalOpen(true);
  };

  const handleSaveCategoryEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !editCatId) return;
    const supabase = createClient();
    const { error: categoryError } = await supabase.from('categories').update({
      budget_limit: Number(editCatBudget) || 0,
      name: editCatName
    }).eq('id', editCatId);

    if (categoryError) {
      toast.error("Gagal menyimpan kategori: " + categoryError.message);
      return;
    }
    
    const { error: budgetError } = await supabase.from('category_budgets').upsert({
      user_id: user.id,
      category_id: editCatId,
      amount: Number(editCatBudget) || 0
    }, { onConflict: 'user_id, category_id' });
    if (budgetError) {
      toast.error("Kategori tersimpan, tetapi alokasi anggaran gagal diperbarui: " + budgetError.message);
      return;
    }
    setEditCatModalOpen(false);
    toast.success("Perubahan kategori tersimpan.");
    fetchRulesAndCategories();
  };

  const handleDeleteRule = (id: string) => {
    if (!user) return;
    setConfirmDeleteRuleId(id);
  };

  const executeDeleteRule = async () => {
    if (!user || !confirmDeleteRuleId) return;
    const supabase = createClient();
    const { error } = await supabase.from('merchant_rules').delete().eq('id', confirmDeleteRuleId);
    setConfirmDeleteRuleId(null);
    if (error) {
      toast.error("Gagal menghapus aturan: " + error.message);
      return;
    }
    toast.success("Aturan berhasil dihapus.");
    fetchRulesAndCategories();
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !accName) return;
    const supabase = createClient();
    
    if (accIsPrimary) {
      await supabase.from('payment_accounts').update({ is_primary: false }).eq('user_id', user.id);
    }
    
    if (editAccountId) {
      const { error } = await supabase.from('payment_accounts').update({
        name: accName,
        type: accType,
        initial_balance: Number(accBalance) || 0,
        is_primary: accIsPrimary
      }).eq('id', editAccountId);
      if (error) {
        toast.error("Gagal menyimpan rekening: " + error.message);
        return;
      }
    } else {
      const { data: newAccounts, error } = await supabase.from('payment_accounts').insert({
        user_id: user.id,
        name: accName,
        type: accType,
        initial_balance: Number(accBalance) || 0,
        is_primary: accIsPrimary
      }).select();

      if (error) {
        toast.error("Gagal menambahkan rekening: " + error.message);
        return;
      }

      if (newAccounts && newAccounts.length > 0) {
        const newAccount = newAccounts[0];
        const keyword = accName.replace(/bank\s+/i, '').trim();
        
        // Relink transactions
        const { data: txsToUpdate } = await supabase
          .from('transactions')
          .select('id, notes')
          .eq('user_id', user.id);
          
        if (txsToUpdate && txsToUpdate.length > 0) {
          const tag = `[UNMATCHED_BANK:${keyword.toLowerCase()}]`;
          const matchedTxs = txsToUpdate.filter((tx: any) => 
             tx.notes && tx.notes.toLowerCase().includes(tag)
          );
          
          if (matchedTxs.length > 0) {
            const updatePromises = matchedTxs.map(async (tx: any) => {
               const regex = new RegExp(`\\[UNMATCHED_BANK:${keyword}\\]`, 'i');
               const newNotes = tx.notes.replace(regex, '').trim();
               
               await supabase.from('transactions')
                 .update({ 
                   sumber_dana: newAccount.name, // Link to new account name
                   notes: newNotes || null
                 })
                 .eq('id', tx.id);
            });
            await Promise.all(updatePromises);
            console.log(`✅ Relinked ${matchedTxs.length} historical ${keyword} transactions to account ${newAccount.id}`);
          }
        }
      }
    }
    
    setAccountModalOpen(false);
    setOpenAccountMenuId(null);
    toast.success(editAccountId ? "Perubahan rekening tersimpan." : "Rekening berhasil ditambahkan.");
    fetchAccounts();
  };

  const handleDeletePaymentAccount = (id: string) => {
    setOpenAccountMenuId(null);
    setConfirmDeleteAccountId(id);
  };

  const executeDeletePaymentAccount = async () => {
    if (!confirmDeleteAccountId) return;
    const supabase = createClient();
    const { error } = await supabase.from('payment_accounts').delete().eq('id', confirmDeleteAccountId);
    setConfirmDeleteAccountId(null);
    if (error) {
      toast.error("Gagal menghapus rekening: " + error.message);
      return;
    }
    toast.success("Rekening berhasil dihapus.");
    fetchAccounts();
  };

  const openAddAccount = () => {
    setEditAccountId(null);
    setAccName("");
    setAccType("bank");
    setAccBalance("");
    setAccIsPrimary(false);
    setAccountModalOpen(true);
  };

  const openEditAccount = (acc: any) => {
    setOpenAccountMenuId(null);
    setEditAccountId(acc.id);
    setAccName(acc.name);
    setAccType(acc.type);
    setAccBalance(acc.initial_balance ? acc.initial_balance.toString() : "");
    setAccIsPrimary(acc.is_primary);
    setAccountModalOpen(true);
  };

  const rawAlias = business?.default_notes || "";
  const emailDomain = process.env.NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN || 'astiizilaz.resend.app';
  const inboundEmailAlias = rawAlias ? `${rawAlias.split('@')[0]}@${emailDomain}` : "";

  const handleCopy = async () => {
    if (!inboundEmailAlias) return;
    await navigator.clipboard.writeText(inboundEmailAlias);
    setCopied(true);
    toast.success("Email alias berhasil disalin ke clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerate = () => {
    if (!user || regenerating) return;
    setConfirmRegenerateOpen(true);
  };

  const executeRegenerate = async () => {
    if (!user || regenerating) return;
    setRegenerating(true);
    const supabase = createClient();

    // Generate new alias: e.g., using a random string or uuid part
    const randomPart = Math.random().toString(36).substring(2, 10);
    const emailDomain = process.env.NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN || 'astiizilaz.resend.app';
    const newAlias = `${user.id.split('-')[0]}-${randomPart}@${emailDomain}`;

    const { error } = await supabase
      .from('profiles')
      .update({ inbound_email_alias: newAlias })
      .eq('id', user.id);

    if (error) {
      toast.error("Gagal membuat alias baru: " + error.message);
    } else {
      toast.success("Alias email berhasil diperbarui!");
      await refresh();
    }
    setRegenerating(false);
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setIsSavingProfile(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      data: { full_name: fullName }
    });

    if (error) {
      toast.error("Gagal menyimpan profil: " + error.message);
    } else {
      toast.success("Profil berhasil diperbarui!");
      await refresh();
    }
    setIsSavingProfile(false);
  };

  const handleUpdatePassword = async () => {
    if (!user) return;
    setPasswordError(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("Kata sandi baru tidak cocok dengan konfirmasi kata sandi.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("Kata sandi harus minimal 6 karakter.");
      return;
    }

    setIsSavingPassword(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      setPasswordError(error.message);
      toast.error("Gagal memperbarui kata sandi: " + error.message);
    } else {
      toast.success("Kata sandi berhasil diperbarui!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    setIsSavingPassword(false);
  };

  const handleResetData = () => {
    if (!user) return;
    setConfirmResetDataOpen(true);
  };

  const executeResetData = async () => {
    if (!user) return;
    const supabase = createClient();
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('user_id', user.id);

    if (error) {
      toast.error("Gagal mereset data: " + error.message);
    } else {
      toast.success("Seluruh data transaksi berhasil direset!");
      router.push("/");
    }
  };

  const handleDeleteAccount = () => {
    if (!user) return;
    setConfirmDeleteAccountOpen(true);
  };

  const executeDeleteAccount = async () => {
    toast.info("Penghapusan akun sedang diproses. (Fitur ini mungkin memerlukan konfigurasi sisi server lebih lanjut)");
  };

  const openSettingsTab = (tab: SettingsTab, mobile = false) => {
    setActiveTab(tab);
    if (mobile) setMobileDetailOpen(true);
  };

  const activeNavItem = SETTINGS_NAV.find((item) => item.id === activeTab) || SETTINGS_NAV[0];
  const systemCategories = categories.filter((category) => category.is_system || !category.user_id);
  const customCategories = categories.filter((category) => !category.is_system && category.user_id);

  return (
    <div className={`workspace-page settings-page ${mobileDetailOpen ? 'settings-mobile-detail-active' : ''}`}>
      {(!isMobileViewport || !mobileDetailOpen) && (
      <div className="workspace-heading settings-page-header">
        <div>
          <span className="workspace-eyebrow"><Settings size={14} /> Pengaturan</span>
          <h1>Pengaturan</h1>
          <p>Kelola profil, kategori, rekening, dan preferensi Douit.</p>
        </div>
      </div>
      )}

      <div className="settings-container">
        {isMobileViewport ? (!mobileDetailOpen ? (
          <nav className="settings-mobile-index" aria-label="Bagian pengaturan">
            {SETTINGS_NAV.map((item) => {
              const ItemIcon = item.icon;
              return (
                <button key={item.id} type="button" onClick={() => openSettingsTab(item.id, true)}>
                  <span className="settings-nav-icon"><ItemIcon size={19} /></span>
                  <span><b>{item.label}</b><small>{item.description}</small></span>
                  <ChevronRight size={18} />
                </button>
              );
            })}
          </nav>
        ) : null) : (
          <nav className="settings-desktop-nav" aria-label="Bagian pengaturan">
            {SETTINGS_NAV.map((item) => {
              const ItemIcon = item.icon;
              return (
                <button key={item.id} type="button" className={activeTab === item.id ? 'active' : ''} onClick={() => openSettingsTab(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}>
                  <ItemIcon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {(!isMobileViewport || mobileDetailOpen) && (
        <div className="settings-detail-shell">
          {isMobileViewport && <header className="settings-mobile-detail-header">
            <button type="button" onClick={() => setMobileDetailOpen(false)} aria-label="Kembali ke Pengaturan"><ArrowLeft size={19} /> Pengaturan</button>
            <h1>{activeNavItem.label}</h1>
            <p>{activeNavItem.description}</p>
          </header>}

        {/* TAB 1: INTEGRASI EMAIL */}
        {activeTab === 'email' && (
          <section className="settings-surface settings-email-section">
            <div className="settings-section-intro">
              <span className="settings-section-icon"><Mail size={20} /></span>
              <div><h2>Pencatatan otomatis dari email</h2><p>Teruskan notifikasi transaksi bank ke Douit agar transaksi dicatat otomatis.</p></div>
            </div>

            <div className="settings-email-address-block">
              <label>Email tujuan</label>
              <div className="settings-email-copy-row">
                <code>{inboundEmailAlias || 'Memuat...'}</code>
                <button type="button" className="button primary" onClick={handleCopy} disabled={!inboundEmailAlias}>
                  {copied ? <><Check size={16} /> Tersalin ✓</> : <><Copy size={16} /> Salin alamat</>}
                </button>
              </div>
            </div>

            <div className="settings-subsection settings-email-status-row">
              <div className="settings-email-status-copy">
                <h3>Status forwarding</h3>
                <p>Status tautan antara email bank dan alamat Douit.</p>
                <p className="settings-email-helper"><span>Petunjuk:</span> teruskan notifikasi transaksi bank ke alamat email di atas; detail teknis diproses aman di latar belakang.</p>
              </div>
              {isFetchingEmailStatus ? (
                <span className="settings-status neutral"><CircleDashed className="settings-status-spinner" size={14} /> Memeriksa...</span>
              ) : emailStatus === 'CONNECTED' ? (
                <span className="settings-status success"><CheckCircle2 size={14} /> Aktif</span>
              ) : emailStatus === 'PENDING' ? (
                <span className="settings-status warning"><Clock size={14} /> Menunggu konfirmasi</span>
              ) : (
                <span className="settings-status neutral"><Circle size={14} /> Belum aktif</span>
              )}
            </div>

            <div className="settings-notice settings-notice-warning">
              <ShieldAlert size={18} />
              <div><b>Jaga kerahasiaan alamat ini</b><p>Siapa pun yang mengirim ke alamat ini dapat memicu pencatatan. Buat alamat baru bila alamat tersebar.</p>
                <button type="button" onClick={handleRegenerate} disabled={regenerating}><RefreshCw size={14} className={regenerating ? "spin" : ""} /> {regenerating ? "Membuat baru..." : "Buat email baru"}</button>
              </div>
            </div>
          </section>
        )}

        {/* TAB 2: PROFIL & KEAMANAN */}
        {activeTab === 'profile' && (
          <div className="settings-section-stack">
            <section className="settings-surface">
              <div className="settings-section-intro">
                <span className="settings-profile-avatar">{(fullName || user?.email || 'D').slice(0, 1).toUpperCase()}</span>
                <div><h2>Profil</h2><p>Informasi utama yang tampil di akun Douit.</p></div>
              </div>
              <div className="settings-form-grid settings-form-grid-profile">
                <label className="settings-field"><span>Nama lengkap</span><input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
                <label className="settings-field"><span>Email akun</span><input type="email" value={user?.email || ""} readOnly disabled /></label>
              </div>

              <div className="settings-subsection">
                <div className="settings-subsection-heading"><h3>Preferensi</h3><p>Pilihan tampilan nominal dan waktu.</p></div>
                <div className="settings-form-grid">
                  <label className="settings-field"><span>Mata uang utama</span><CustomSelect value={currency} onChange={setCurrency} responsiveOverlay selectionTitle="Pilih mata uang" options={[{ value: "IDR", label: "IDR (Rupiah Indonesia)" }, { value: "USD", label: "USD (Dolar AS)" }]} /></label>
                  <label className="settings-field"><span>Zona waktu</span><CustomSelect value={timezone} onChange={setTimezone} responsiveOverlay selectionTitle="Pilih zona waktu" options={[{ value: "Asia/Jakarta", label: "Asia/Jakarta (WIB)" }, { value: "Asia/Makassar", label: "Asia/Makassar (WITA)" }, { value: "Asia/Jayapura", label: "Asia/Jayapura (WIT)" }]} /></label>
                </div>
              </div>
              <div className="settings-save-row"><button type="button" className="button primary" onClick={handleSaveProfile} disabled={isSavingProfile}>{isSavingProfile ? "Menyimpan..." : "Simpan perubahan"}</button></div>
            </section>

            <section className="settings-surface">
              <div className="settings-section-intro"><span className="settings-section-icon"><Shield size={20} /></span><div><h2>Keamanan</h2><p>Kelola kata sandi untuk menjaga akunmu.</p></div></div>
              <div className="settings-security-content">
                {isOAuthUser ? (
                  <div className="settings-notice settings-notice-info"><ShieldAlert size={18} /><p>Akunmu terhubung dengan Google. Kata sandi dikelola langsung melalui akun Google-mu.</p></div>
                ) : (
                  <div className="settings-password-form">
                    {passwordError && <div className="settings-form-error"><AlertCircle size={16} /><span>{passwordError}</span></div>}
                    <div className="settings-form-grid single">
                      <label className="settings-field"><span>Kata sandi saat ini</span><input type="password" value={currentPassword} onChange={(e) => { setPasswordError(null); setCurrentPassword(e.target.value); }} placeholder="Masukkan kata sandi lama" /></label>
                      <label className="settings-field"><span>Kata sandi baru</span><input type="password" value={newPassword} onChange={(e) => { setPasswordError(null); setNewPassword(e.target.value); }} placeholder="Minimal 6 karakter" /></label>
                      <label className="settings-field"><span>Konfirmasi kata sandi baru</span><input type="password" value={confirmPassword} onChange={(e) => { setPasswordError(null); setConfirmPassword(e.target.value); }} placeholder="Ulangi kata sandi baru" /></label>
                    </div>
                    <div className="settings-save-row"><button type="button" className="button primary" onClick={handleUpdatePassword} disabled={isSavingPassword || !newPassword || !confirmPassword}>{isSavingPassword ? "Menyimpan..." : "Simpan perubahan"}</button></div>
                  </div>
                )}
              </div>
            </section>

            <section className="settings-danger-zone" aria-labelledby="danger-zone-title">
              <div className="settings-section-intro"><span><AlertTriangle size={19} /></span><div><h2 id="danger-zone-title">Zona berbahaya</h2><p>Tindakan permanen yang perlu konfirmasi tambahan.</p></div></div>
              <div className="settings-danger-row"><div><h3>Reset data</h3><p>Hapus seluruh riwayat transaksi. Akunmu tetap aktif.</p></div><button type="button" className="settings-danger-button secondary" onClick={handleResetData}><RotateCcw size={15} /> Reset data</button></div>
              <div className="settings-danger-row"><div><h3>Hapus akun</h3><p>Hapus akun beserta seluruh data keuangan secara permanen.</p></div><button type="button" className="settings-danger-button" onClick={handleDeleteAccount}><Trash2 size={15} /> Hapus akun</button></div>
            </section>
          </div>
        )}

        {/* TAB 3: KATEGORI & ATURAN */}
        {activeTab === 'rules' && (
          <div className="settings-section-stack">
            <section className="settings-surface settings-category-section">
              <div className="settings-section-intro">
                <span className="settings-section-icon"><Tags size={20} /></span>
                <div><h2>Kategori</h2><p>Gunakan identitas kategori yang konsisten di seluruh Douit.</p></div>
              </div>

              {isFetchingRules ? <p className="settings-empty-state">Memuat kategori...</p> : <>
                <div className="settings-category-group">
                  <div className="settings-group-heading"><span className="settings-group-title"><h3>Kategori sistem</h3><em>{systemCategories.length}</em></span></div>
                  <div className="settings-category-list">
                    {systemCategories.map((category) => (
                      <div className="settings-category-row" key={category.id}>
                        <span className="settings-category-mark"><CategoryIcon category={category.name} size={18} /></span>
                        <span className="settings-list-copy"><b>{category.name}</b><small>{category.type === 'INCOME' ? 'Pemasukan' : 'Pengeluaran'} · {category.budget_limit > 0 ? `Anggaran ${formatRupiah(category.budget_limit)}` : 'Anggaran belum diatur'}</small></span>
                        <span className="settings-system-badge">Sistem</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="settings-category-group">
                  <div className="settings-group-heading">
                    <span className="settings-group-title"><h3>Kategori buatan sendiri</h3><em>{customCategories.length}</em></span>
                    <button type="button" className="settings-category-add-trigger" onClick={() => setAddCategoryOpen(true)}><Plus size={15} /> Tambah kategori</button>
                  </div>
                  {customCategories.length === 0 ? (
                    <p className="settings-empty-state settings-empty-state-compact">Belum ada kategori buatan sendiri.</p>
                  ) : (
                    <div className="settings-category-list">
                      {customCategories.map((category) => (
                        <div className="settings-category-row" key={category.id}>
                          <span className="settings-category-mark" style={{ color: resolveCategoryColor(category), backgroundColor: `${resolveCategoryColor(category)}14` }}><CategoryIcon category={category} size={18} /></span>
                          <span className="settings-list-copy"><b>{category.name}</b><small>{category.type === 'INCOME' ? 'Pemasukan' : 'Pengeluaran'} · {category.budget_limit > 0 ? `Anggaran ${formatRupiah(category.budget_limit)}` : 'Anggaran belum diatur'}</small></span>
                          <span className="settings-row-actions"><button type="button" onClick={() => openEditCategory(category)} aria-label={`Edit ${category.name}`}><Edit2 size={15} /></button><button type="button" className="danger" onClick={() => handleDeleteCategory(category.id)} aria-label={`Hapus ${category.name}`}><Trash2 size={15} /></button></span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>}

              {addCategoryOpen && (
                <div className={`settings-category-form-host ${isMobileViewport ? 'mobile-sheet' : 'desktop-panel'}`} onMouseDown={isMobileViewport ? () => { setAddCategoryOpen(false); setCategoryIconPickerOpen(false); } : undefined}>
                  <form className="settings-category-form" onSubmit={handleAddCategory} onMouseDown={(event) => event.stopPropagation()} role={isMobileViewport ? 'dialog' : undefined} aria-modal={isMobileViewport ? true : undefined} aria-labelledby="add-category-title">
                    <header className="settings-category-form-header">
                      <div><h3 id="add-category-title">Tambah kategori</h3><p>Buat identitas kategori yang mudah dikenali.</p></div>
                      <button type="button" onClick={() => { setAddCategoryOpen(false); setCategoryIconPickerOpen(false); }} aria-label="Tutup form tambah kategori"><X size={19} /></button>
                    </header>

                    <div className="settings-category-form-body">
                      <label className="settings-field"><span>Nama kategori</span><input type="text" value={newCatName} onChange={(event) => setNewCatName(event.target.value)} placeholder="Contoh: Freelance" required /></label>

                      <fieldset className="settings-choice-field"><legend>Tipe</legend><div className="settings-segmented-control"><button type="button" className={newCatType === 'EXPENSE' ? 'active' : ''} onClick={() => setNewCatType('EXPENSE')}>Pengeluaran</button><button type="button" className={newCatType === 'INCOME' ? 'active' : ''} onClick={() => setNewCatType('INCOME')}>Pemasukan</button></div></fieldset>

                      <fieldset className="settings-choice-field settings-icon-picker-field">
                        <legend>Pilih ikon</legend>
                        {isMobileViewport ? (
                          <div className="settings-icon-grid">{CATEGORY_ICON_OPTIONS.map((iconName) => <button key={iconName} type="button" className={newCatIcon === iconName ? 'active' : ''} onClick={() => setNewCatIcon(iconName)} aria-label={`Pilih ikon ${iconName}`} aria-pressed={newCatIcon === iconName}><CategoryIcon category={{ icon_name: iconName }} size={19} /></button>)}</div>
                        ) : (
                          <div className="settings-icon-picker-popover-wrap">
                            <button type="button" className="settings-icon-picker-trigger" onClick={() => setCategoryIconPickerOpen((open) => !open)} aria-expanded={categoryIconPickerOpen}><span><CategoryIcon category={{ icon_name: newCatIcon }} size={18} /></span> Pilih ikon</button>
                            {categoryIconPickerOpen && <div className="settings-icon-picker-popover"><div className="settings-icon-grid">{CATEGORY_ICON_OPTIONS.map((iconName) => <button key={iconName} type="button" className={newCatIcon === iconName ? 'active' : ''} onClick={() => { setNewCatIcon(iconName); setCategoryIconPickerOpen(false); }} aria-label={`Pilih ikon ${iconName}`} aria-pressed={newCatIcon === iconName}><CategoryIcon category={{ icon_name: iconName }} size={19} /></button>)}</div></div>}
                          </div>
                        )}
                      </fieldset>

                      <fieldset className="settings-choice-field settings-color-field"><legend>Warna aksen</legend><div className="settings-color-swatches">{CATEGORY_COLOR_OPTIONS.map((color) => <button key={color} type="button" className={newCatColor.toLowerCase() === color.toLowerCase() ? 'active' : ''} style={{ backgroundColor: color }} onClick={() => setNewCatColor(color)} aria-label={`Pilih warna ${color}`} aria-pressed={newCatColor.toLowerCase() === color.toLowerCase()}>{newCatColor.toLowerCase() === color.toLowerCase() && <Check size={14} />}</button>)}<label className={`settings-custom-color ${CATEGORY_COLOR_OPTIONS.some((color) => color.toLowerCase() === newCatColor.toLowerCase()) ? '' : 'active'}`} title="Pilih warna lain"><input type="color" value={newCatColor} onChange={(event) => setNewCatColor(event.target.value)} aria-label="Pilih warna lain" /><span style={{ backgroundColor: newCatColor }} /></label></div></fieldset>

                      <label className="settings-field settings-budget-field"><span>Alokasi anggaran (Rp)</span><input type="number" value={newCatBudget} onChange={(event) => setNewCatBudget(event.target.value)} placeholder="Opsional, contoh: 500000" /></label>
                    </div>

                    <footer className="settings-category-form-actions"><button type="button" className="button secondary" onClick={() => { setAddCategoryOpen(false); setCategoryIconPickerOpen(false); }}>Batal</button><button type="submit" className="button primary">Tambah kategori</button></footer>
                  </form>
                </div>
              )}

              <div className="settings-subsection settings-rules-section"><div className="settings-subsection-heading"><h3>Aturan transaksi otomatis</h3><p>Kategori yang diterapkan otomatis untuk merchant tertentu.</p></div>{rules.length === 0 ? <p className="settings-empty-state">Belum ada aturan tersimpan.</p> : <div className="settings-rule-list">{rules.map((rule) => { const ruleCategory = categories.find((category) => category.id === rule.category_id); return <div className="settings-rule-row" key={rule.id}><span className="settings-category-mark" style={{ color: resolveCategoryColor(ruleCategory), backgroundColor: `${resolveCategoryColor(ruleCategory)}14` }}><CategoryIcon category={ruleCategory || 'Lain-lain'} size={17} /></span><span className="settings-list-copy"><b>{rule.merchant_name}</b><small>{ruleCategory?.name || 'Tidak diketahui'}{rule.keyword ? ` · Catatan: ${rule.keyword}` : ''}</small></span><button type="button" onClick={() => handleDeleteRule(rule.id)}>Hapus</button></div>; })}</div>}</div>
            </section>
          </div>
        )}
        
        {/* TAB 4: REKENING & SALDO AWAL */}
        {activeTab === 'accounts' && (
          <div className="settings-section-stack">
            <section className="settings-surface">
              <div className="settings-section-intro settings-section-intro-action"><span className="settings-section-icon"><Wallet size={20} /></span><div><h2>Rekening & sumber dana</h2><p>Kelola rekening, dompet, dan saldo awalmu.</p></div><button type="button" onClick={openAddAccount} className="button primary settings-add-button"><Plus size={16} /> Tambah rekening</button></div>
              {isFetchingAccounts ? <p className="settings-empty-state">Memuat rekening...</p> : accounts.length === 0 ? <div className="settings-empty-state"><p>Belum ada rekening atau sumber dana.</p><button type="button" onClick={openAddAccount}>+ Tambah rekening</button></div> : <div className="settings-account-list">{accounts.map((account) => <div className={`settings-account-row ${account.is_primary ? 'primary' : ''}`} key={account.id}>
                <span className="settings-account-logo"><BankLogo bankName={account.name} className="settings-bank-logo" /></span>
                <span className="settings-list-copy"><span className="settings-account-name"><b>{account.name}</b>{account.is_primary && <em>Utama</em>}</span><small>Saldo awal · {formatRupiah(account.initial_balance)}</small></span>
                <div className="settings-overflow"><button type="button" className="settings-overflow-trigger" onClick={() => setOpenAccountMenuId((id) => id === account.id ? null : account.id)} aria-label={`Tindakan untuk ${account.name}`} aria-expanded={openAccountMenuId === account.id}><MoreHorizontal size={19} /></button>{openAccountMenuId === account.id && <div className="settings-overflow-menu"><button type="button" onClick={() => openEditAccount(account)}><Edit2 size={15} /> Edit</button><button type="button" className="danger" onClick={() => handleDeletePaymentAccount(account.id)}><Trash2 size={15} /> Hapus</button></div>}</div>
              </div>)}</div>}
            </section>
          </div>
        )}

        </div>
        )}
        
        {/* ACCOUNT MODAL */}
        {accountModalOpen && (
          <div className="settings-modal-scrim" onClick={() => setAccountModalOpen(false)}>
            <div className="settings-modal-dialog" onClick={e => e.stopPropagation()}>
              <div className="settings-modal-header"><div><h3>{editAccountId ? "Edit rekening" : "Tambah rekening"}</h3><p>Atur sumber dana dan saldo awal.</p></div><button type="button" onClick={() => setAccountModalOpen(false)} aria-label="Tutup"><X size={19} /></button></div>
              <form onSubmit={handleSaveAccount}>
                <div className="settings-modal-body">
                  <label className="settings-field"><span>Nama rekening / bank</span><input type="text" value={accName} onChange={e => setAccName(e.target.value)} required placeholder="Contoh: Bank BRI" /></label>
                  <label className="settings-field"><span>Tipe rekening</span>
                    <CustomSelect
                      value={accType}
                      onChange={setAccType}
                      responsiveOverlay
                      selectionTitle="Pilih tipe rekening"
                      options={[
                        { value: "bank", label: "Bank" },
                        { value: "wallet", label: "E-Wallet" },
                        { value: "cash", label: "Tunai" }
                      ]}
                    />
                  </label>
                  <label className="settings-field"><span>Saldo awal (Rp)</span><input type="number" value={accBalance === 0 ? "" : accBalance} onChange={e => setAccBalance(e.target.value)} required placeholder="Contoh: 100000" /></label>
                  <label className="settings-checkbox"><input type="checkbox" checked={accIsPrimary} onChange={e => setAccIsPrimary(e.target.checked)} /><span>Jadikan rekening utama</span></label>
                </div>
                <div className="settings-modal-actions">
                  <button type="button" className="button secondary" onClick={() => setAccountModalOpen(false)}>Batal</button>
                  <button type="submit" className="button primary">Simpan perubahan</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* EDIT CATEGORY MODAL */}
        {editCatModalOpen && (
          <div className="settings-modal-scrim" onClick={() => setEditCatModalOpen(false)}>
            <div className="settings-modal-dialog" onClick={e => e.stopPropagation()}>
              <div className="settings-modal-header"><div><h3>Edit kategori</h3><p>Perbarui nama dan alokasi anggaran.</p></div><button type="button" onClick={() => setEditCatModalOpen(false)} aria-label="Tutup"><X size={19} /></button></div>
              <form onSubmit={handleSaveCategoryEdit}>
                <div className="settings-modal-body"><label className="settings-field"><span>Nama kategori</span><input type="text" value={editCatName} onChange={e => setEditCatName(e.target.value)} required /></label><label className="settings-field"><span>Alokasi anggaran (Rp)</span><input type="number" value={editCatBudget === "0" ? "" : editCatBudget} onChange={e => setEditCatBudget(e.target.value)} placeholder="Contoh: 1000000" /></label></div>
                <div className="settings-modal-actions">
                  <button type="button" className="button secondary" onClick={() => setEditCatModalOpen(false)}>Batal</button>
                  <button type="submit" className="button primary">Simpan perubahan</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* CONFIRMATION DIALOGS */}
        <ConfirmDialog
          isOpen={!!confirmDeleteCatId}
          onClose={() => setConfirmDeleteCatId(null)}
          onConfirm={executeDeleteCategory}
          title="Hapus Kategori"
          description="Hapus kategori ini? Transaksi yang menggunakannya akan dialihkan ke 'Lain-lain'."
          confirmLabel="Hapus Kategori"
          variant="danger"
        />

        <ConfirmDialog
          isOpen={!!confirmDeleteRuleId}
          onClose={() => setConfirmDeleteRuleId(null)}
          onConfirm={executeDeleteRule}
          title="Hapus Aturan Merchant"
          description="Hapus aturan merchant ini?"
          confirmLabel="Hapus Aturan"
          variant="danger"
        />

        <ConfirmDialog
          isOpen={!!confirmDeleteAccountId}
          onClose={() => setConfirmDeleteAccountId(null)}
          onConfirm={executeDeletePaymentAccount}
          title="Hapus Rekening"
          description="Hapus rekening ini? Transaksi terkait tetap tersimpan, tetapi tidak lagi terhubung ke rekening tersebut."
          confirmLabel="Hapus Rekening"
          variant="danger"
        />

        <ConfirmDialog
          isOpen={confirmRegenerateOpen}
          onClose={() => setConfirmRegenerateOpen(false)}
          onConfirm={executeRegenerate}
          title="Buat Alias Email Baru"
          description="Buat email khusus baru? Alamat lama tidak akan dapat menerima transaksi lagi."
          confirmLabel="Buat Alias Baru"
          variant="warning"
          isLoading={regenerating}
        />

        <ConfirmDialog
          isOpen={confirmResetDataOpen}
          onClose={() => setConfirmResetDataOpen(false)}
          onConfirm={executeResetData}
          title="Reset Seluruh Data Transaksi"
          description="Seluruh riwayat transaksimu akan dihapus permanen. Tindakan ini tidak dapat dibatalkan."
          confirmLabel="Reset Semua Data"
          variant="danger"
        />

        <ConfirmDialog
          isOpen={confirmDeleteAccountOpen}
          onClose={() => setConfirmDeleteAccountOpen(false)}
          onConfirm={executeDeleteAccount}
          title="Hapus Akun Permanen"
          description="Akun, profil, kategori, dan seluruh data keuanganmu akan dihapus permanen. Tindakan ini tidak dapat dibatalkan."
          confirmLabel="Hapus Akun"
          variant="danger"
        />

      </div>
    </div>
  );
}
