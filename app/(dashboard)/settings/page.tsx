"use client";

import { Check, Copy, Mail, RefreshCw, Settings, ShieldAlert, User, Shield, AlertTriangle, Trash2, RotateCcw, Tags, Folder, ShoppingBag, Coffee, Car, Home, Smartphone, Briefcase, Heart, Book, Box, Edit2, Wallet, CreditCard, Receipt, CheckCircle2, Clock, CircleDashed, AlertCircle } from "lucide-react";

const IconMap: Record<string, any> = {
  Folder, ShoppingBag, Coffee, Car, Home, Smartphone, Briefcase, Heart, Book, Box, Tags, Receipt
};
import { useState, useEffect } from "react";
import { useDouit } from "../../providers/DouitProvider";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { CustomSelect } from "@/app/components/ui/CustomSelect";

export default function SettingsPage() {
  const { user, business, refresh } = useDouit();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Confirmation Dialog States
  const [confirmDeleteCatId, setConfirmDeleteCatId] = useState<string | null>(null);
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] = useState<string | null>(null);
  const [confirmDeleteAccountId, setConfirmDeleteAccountId] = useState<string | null>(null);
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);
  const [confirmResetDataOpen, setConfirmResetDataOpen] = useState(false);
  const [confirmDeleteAccountOpen, setConfirmDeleteAccountOpen] = useState(false);

  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    const action = searchParams?.get('action');
    const bankName = searchParams?.get('bankName');
    
    if (action === 'add_account') {
      setActiveTab('accounts');
      setEditAccountId(null);
      setAccName(bankName || "");
      setAccType("bank");
      setAccBalance("");
      setAccIsPrimary(false);
      setAccountModalOpen(true);
    }
  }, [searchParams]);

  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<'email' | 'profile' | 'rules' | 'accounts'>('email');

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
    
    if (newCat && Number(newCatBudget) > 0) {
      await supabase.from('category_budgets').insert({
        user_id: user.id,
        category_id: newCat.id,
        amount: Number(newCatBudget)
      });
    }
    setNewCatName("");
    setNewCatBudget("");
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
    await supabase.from('categories').update({
      budget_limit: Number(editCatBudget) || 0,
      name: editCatName
    }).eq('id', editCatId);
    
    await supabase.from('category_budgets').upsert({
      user_id: user.id,
      category_id: editCatId,
      amount: Number(editCatBudget) || 0
    }, { onConflict: 'user_id, category_id' });
    setEditCatModalOpen(false);
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
      await supabase.from('payment_accounts').update({
        name: accName,
        type: accType,
        initial_balance: Number(accBalance) || 0,
        is_primary: accIsPrimary
      }).eq('id', editAccountId);
    } else {
      const { data: newAccounts } = await supabase.from('payment_accounts').insert({
        user_id: user.id,
        name: accName,
        type: accType,
        initial_balance: Number(accBalance) || 0,
        is_primary: accIsPrimary
      }).select();

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
    fetchAccounts();
  };

  const handleDeletePaymentAccount = (id: string) => {
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

  return (
    <div className="workspace-page">
      <div className="workspace-heading">
        <div>
          <span className="workspace-eyebrow"><Settings size={14} /> Pengaturan</span>
          <h1>Pengaturan Douit</h1>
          <p>Atur pencatatan otomatis, profil, kategori, dan rekeningmu.</p>
        </div>
      </div>

      <div className="settings-container" style={{ maxWidth: '800px', margin: '0 auto', padding: '24px 0' }}>

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid #e2e8f0', marginBottom: '24px' }}>
          <button
            onClick={() => setActiveTab('email')}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'email' ? '2px solid #84cc16' : '2px solid transparent',
              color: activeTab === 'email' ? '#84cc16' : '#64748b',
              fontWeight: 600,
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            <Mail size={18} />
            Email Otomatis
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'profile' ? '2px solid #84cc16' : '2px solid transparent',
              color: activeTab === 'profile' ? '#84cc16' : '#64748b',
              fontWeight: 600,
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            <User size={18} />
            Profil & Keamanan
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'rules' ? '2px solid #84cc16' : '2px solid transparent',
              color: activeTab === 'rules' ? '#84cc16' : '#64748b',
              fontWeight: 600,
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            <Tags size={18} />
            Kategori & Aturan
          </button>
          <button
            onClick={() => setActiveTab('accounts')}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'accounts' ? '2px solid #84cc16' : '2px solid transparent',
              color: activeTab === 'accounts' ? '#84cc16' : '#64748b',
              fontWeight: 600,
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            <Wallet size={18} />
            Rekening & Saldo
          </button>
        </div>

        {/* TAB 1: INTEGRASI EMAIL */}
        {activeTab === 'email' && (
          <section className="settings-section" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', marginBottom: '24px' }}>
            <div style={{ padding: '24px', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ background: '#ecfccb', color: '#65a30d', padding: '8px', borderRadius: '8px' }}>
                    <Mail size={20} />
                  </div>
                  <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#0f172a' }}>Pencatatan Otomatis dari Email</h2>
                </div>

                {!isFetchingEmailStatus && (
                  <div>
                    {emailStatus === 'CONNECTED' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border shadow-xs transition-colors bg-emerald-50 text-emerald-700 border-emerald-200/80">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Terhubung dan terverifikasi
                      </span>
                    )}
                    {emailStatus === 'PENDING' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border shadow-xs transition-colors bg-amber-50 text-amber-700 border-amber-200/80">
                        <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                        Menunggu konfirmasi
                      </span>
                    )}
                    {emailStatus === 'UNLINKED' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border shadow-xs transition-colors bg-slate-100/80 text-slate-600 border-slate-200">
                        <CircleDashed className="w-3.5 h-3.5 text-slate-400" />
                        Belum ditautkan
                      </span>
                    )}
                  </div>
                )}
              </div>
              <p style={{ color: '#64748b', fontSize: '14px', lineHeight: 1.5, margin: '8px 0 0 0' }}>
                Teruskan email notifikasi transaksi dari bankmu, seperti BCA, Mandiri, atau BRI, ke alamat di bawah. Douit akan mencatat transaksinya secara otomatis.
              </p>
            </div>

            <div style={{ padding: '24px', background: '#f8fafc' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>Email khususmu</label>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    type="text"
                    readOnly
                    value={inboundEmailAlias || 'Memuat...'}
                    style={{
                      width: '100%', padding: '12px 16px', background: '#fff',
                      border: '1px solid #cbd5e1', borderRadius: '8px',
                      fontFamily: 'monospace', fontSize: '14px', color: '#0f172a'
                    }}
                  />
                </div>
                <button
                  onClick={handleCopy}
                  className="button primary"
                  style={{ height: '44px', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}
                >
                  {copied ? <><Check size={16} /> Disalin</> : <><Copy size={16} /> Salin Email</>}
                </button>
              </div>

              <div style={{ marginTop: '24px', padding: '16px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', display: 'flex', gap: '12px' }}>
                <ShieldAlert size={20} color="#d97706" style={{ flexShrink: 0 }} />
                <div>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 600, color: '#92400e' }}>Jaga kerahasiaan email ini</h4>
                  <p style={{ margin: 0, fontSize: '13px', color: '#b45309', lineHeight: 1.5 }}>
                    Siapa pun yang mengirim ke alamat ini dapat mencatat transaksi di akunmu. Jika alamatnya tersebar, segera buat email khusus yang baru.
                  </p>
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    style={{ background: 'none', border: 'none', color: '#d97706', fontWeight: 600, fontSize: '13px', padding: 0, marginTop: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <RefreshCw size={14} className={regenerating ? "spin" : ""} /> {regenerating ? "Membuat baru..." : "Buat email baru"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* TAB 2: PROFIL & KEAMANAN */}
        {activeTab === 'profile' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* CARD A: Informasi Profil & Presets */}
            <section className="settings-section" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ padding: '24px', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <div style={{ background: '#ecfccb', color: '#65a30d', padding: '8px', borderRadius: '8px' }}>
                    <User size={20} />
                  </div>
                  <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#0f172a' }}>Profil & Preferensi</h2>
                </div>
              </div>
              <div style={{ padding: '24px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>Nama Lengkap</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>Email akun</label>
                    <input
                      type="email"
                      value={user?.email || ""}
                      readOnly
                      disabled
                      style={{ width: '100%', padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', background: '#e2e8f0', color: '#64748b' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>Mata uang utama</label>
                    <CustomSelect
                      value={currency}
                      onChange={setCurrency}
                      options={[
                        { value: "IDR", label: "IDR (Indonesian Rupiah)" },
                        { value: "USD", label: "USD (US Dollar)" }
                      ]}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>Zona waktu</label>
                    <CustomSelect
                      value={timezone}
                      onChange={setTimezone}
                      options={[
                        { value: "Asia/Jakarta", label: "Asia/Jakarta (WIB)" },
                        { value: "Asia/Makassar", label: "Asia/Makassar (WITA)" },
                        { value: "Asia/Jayapura", label: "Asia/Jayapura (WIT)" }
                      ]}
                    />
                  </div>
                </div>
                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="button primary"
                    onClick={handleSaveProfile}
                    disabled={isSavingProfile}
                    style={{ padding: '10px 20px' }}
                  >
                    {isSavingProfile ? "Menyimpan..." : "Simpan Perubahan"}
                  </button>
                </div>
              </div>
            </section>

            {/* CARD B: Keamanan & Kata Sandi */}
            <section className="settings-section" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ padding: '24px', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <div style={{ background: '#ecfccb', color: '#65a30d', padding: '8px', borderRadius: '8px' }}>
                    <Shield size={20} />
                  </div>
                  <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#0f172a' }}>Keamanan & Kata Sandi</h2>
                </div>
              </div>
              <div style={{ padding: '24px', background: '#f8fafc' }}>
                {isOAuthUser ? (
                  <div style={{ padding: '16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', display: 'flex', gap: '12px' }}>
                    <ShieldAlert size={20} color="#2563eb" style={{ flexShrink: 0 }} />
                    <p style={{ margin: 0, fontSize: '14px', color: '#1e40af', lineHeight: 1.5 }}>
                      Akunmu terhubung dengan Google. Kata sandi dikelola langsung melalui akun Google-mu.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {passwordError && (
                      <div className="flex items-center gap-2 p-3.5 rounded-xl bg-rose-50 border border-rose-200/70 text-rose-700 text-xs animate-in fade-in duration-150 max-w-md">
                        <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                        <span className="font-medium">{passwordError}</span>
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px', maxWidth: '400px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>Kata Sandi Saat Ini</label>
                        <input
                          type="password"
                          value={currentPassword}
                          onChange={(e) => {
                            setPasswordError(null);
                            setCurrentPassword(e.target.value);
                          }}
                          placeholder="Masukkan kata sandi lama"
                          style={{ width: '100%', padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>Kata Sandi Baru</label>
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => {
                            setPasswordError(null);
                            setNewPassword(e.target.value);
                          }}
                          placeholder="Minimal 6 karakter"
                          style={{ width: '100%', padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>Konfirmasi Kata Sandi Baru</label>
                        <input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => {
                            setPasswordError(null);
                            setConfirmPassword(e.target.value);
                          }}
                          placeholder="Ulangi kata sandi baru"
                          style={{ width: '100%', padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px' }}
                        />
                      </div>
                    </div>
                    <div style={{ marginTop: '8px' }}>
                      <button
                        className="button primary"
                        onClick={handleUpdatePassword}
                        disabled={isSavingPassword || !newPassword || !confirmPassword}
                        style={{ padding: '10px 20px' }}
                      >
                        {isSavingPassword ? "Memperbarui..." : "Perbarui Kata Sandi"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* CARD C: Reset dan Hapus Akun */}
            <section className="settings-section" style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ padding: '24px', borderBottom: '1px solid #fecaca' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px', borderRadius: '8px' }}>
                    <AlertTriangle size={20} />
                  </div>
                  <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#7f1d1d' }}>Reset & Hapus Akun</h2>
                </div>
              </div>
              <div style={{ padding: '24px', background: '#fef2f2', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: '#fff', border: '1px solid #fca5a5', borderRadius: '8px' }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: '#991b1b' }}>Reset Data Transaksi</h4>
                    <p style={{ margin: 0, fontSize: '13px', color: '#b91c1c' }}>Hapus seluruh riwayat transaksimu. Tindakan ini tidak dapat dibatalkan.</p>
                  </div>
                  <button
                    onClick={handleResetData}
                    style={{ background: '#fff', border: '1px solid #dc2626', color: '#dc2626', padding: '8px 16px', borderRadius: '6px', fontWeight: 600, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <RotateCcw size={16} /> Reset Data
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: '#fff', border: '1px solid #fca5a5', borderRadius: '8px' }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: '#991b1b' }}>Hapus Akun Douit</h4>
                    <p style={{ margin: 0, fontSize: '13px', color: '#b91c1c' }}>Hapus akunmu beserta seluruh data secara permanen.</p>
                  </div>
                  <button
                    onClick={handleDeleteAccount}
                    style={{ background: '#dc2626', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '6px', fontWeight: 600, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Trash2 size={16} /> Hapus Akun
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: KATEGORI & ATURAN */}
        {activeTab === 'rules' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* SECTION A: Kategori Kustom */}
            <section className="settings-section" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ padding: '24px', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <div style={{ background: '#ecfccb', color: '#65a30d', padding: '8px', borderRadius: '8px' }}>
                    <Box size={20} />
                  </div>
                  <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#0f172a' }}>Kategori Kustom</h2>
                </div>
              </div>
              <div style={{ padding: '24px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {categories.map(cat => {
                    const IconComponent = IconMap[cat.icon_name] || Folder;
                    return (
                      <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: `1px solid ${cat.color_hex}40`, padding: '8px 12px', borderRadius: '8px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                        <div style={{ background: `${cat.color_hex}20`, color: cat.color_hex, padding: '6px', borderRadius: '6px' }}>
                          <IconComponent size={16} />
                        </div>
                        <div>
                          <span style={{ fontSize: '14px', fontWeight: 500, color: '#334155' }}>{cat.name}</span>
                          {cat.is_system && <span style={{ marginLeft: '6px', fontSize: '10px', background: '#e2e8f0', color: '#475569', padding: '2px 6px', borderRadius: '4px' }}>Sistem</span>}
                          <div style={{ marginTop: '2px' }}>
                            <span className="text-[10px] text-gray-500">
                              Anggaran: {cat.budget_limit > 0 ? new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(cat.budget_limit)) : "Belum diatur"}
                            </span>
                          </div>
                        </div>
                        {!cat.is_system && (
                          <div style={{ marginLeft: '8px', display: 'flex', gap: '4px' }}>
                            <button onClick={() => openEditCategory(cat)} style={{ background: '#f1f5f9', border: 'none', color: '#475569', cursor: 'pointer', padding: '4px', borderRadius: '4px' }}>
                              <Edit2 size={14} />
                            </button>
                            <button onClick={() => handleDeleteCategory(cat.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <form onSubmit={handleAddCategory} style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px', display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Tambah Kategori Baru</label>
                    <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Nama Kategori" style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px' }} required />
                  </div>
                  <div className="w-36">
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Tipe</label>
                    <CustomSelect
                      value={newCatType}
                      onChange={setNewCatType}
                      options={[
                        { value: "EXPENSE", label: "Pengeluaran" },
                        { value: "INCOME", label: "Pemasukan" }
                      ]}
                    />
                  </div>
                  <div className="w-36">
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Ikon</label>
                    <CustomSelect
                      value={newCatIcon}
                      onChange={setNewCatIcon}
                      options={Object.keys(IconMap).map(icon => {
                        const IconComp = IconMap[icon];
                        return {
                          value: icon,
                          label: icon,
                          icon: <IconComp className="w-4 h-4 text-emerald-700" />
                        };
                      })}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Warna</label>
                    <input type="color" value={newCatColor} onChange={e => setNewCatColor(e.target.value)} style={{ width: '40px', height: '36px', padding: '2px', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#fff' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Alokasi Anggaran (Rp)</label>
                    <input type="number" value={newCatBudget} onChange={e => setNewCatBudget(e.target.value)} placeholder="Contoh: 500000" style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px' }} />
                  </div>
                  <button type="submit" className="button primary" style={{ padding: '8px 16px', height: '36px' }}>Tambah</button>
                </form>
              </div>
            </section>

            {/* SECTION B: Aturan Merchant */}
            <section className="settings-section" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ padding: '24px', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <div style={{ background: '#ecfccb', color: '#65a30d', padding: '8px', borderRadius: '8px' }}>
                    <Tags size={20} />
                  </div>
                  <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#0f172a' }}>Aturan Transaksi Otomatis</h2>
                </div>
                <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>Terapkan kategori secara otomatis untuk transaksi dari merchant tertentu.</p>
              </div>
              <div style={{ padding: '24px', background: '#f8fafc' }}>
                {rules.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '14px', color: '#64748b', textAlign: 'center', padding: '24px 0' }}>Belum ada aturan tersimpan.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {rules.map(rule => {
                      const ruleCat = categories.find(c => c.id === rule.category_id);
                      return (
                        <div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', padding: '12px 16px', borderRadius: '8px' }}>
                          <div>
                            <span style={{ display: 'block', fontSize: '15px', fontWeight: 600, color: '#1e293b' }}>{rule.merchant_name}</span>
                            <span style={{ fontSize: '13px', color: '#64748b' }}>{ruleCat?.name || "Tidak diketahui"} {rule.keyword ? `• Catatan: ${rule.keyword}` : ''}</span>
                          </div>
                          <button onClick={() => handleDeleteRule(rule.id)} style={{ background: '#fee2e2', border: 'none', color: '#ef4444', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Hapus</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
        
        {/* TAB 4: REKENING & SALDO AWAL */}
        {activeTab === 'accounts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <section className="settings-section" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ padding: '24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <div style={{ background: '#ecfccb', color: '#65a30d', padding: '8px', borderRadius: '8px' }}>
                      <Wallet size={20} />
                    </div>
                    <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#0f172a' }}>Kelola Rekening & Saldo Awal</h2>
                  </div>
                  <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>Atur rekening, dompet, dan saldo awalmu.</p>
                </div>
                <button onClick={openAddAccount} className="button primary" style={{ padding: '8px 16px' }}>+ Tambah Rekening</button>
              </div>
              <div style={{ padding: '24px', background: '#f8fafc' }}>
                {accounts.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '14px', color: '#64748b', textAlign: 'center', padding: '24px 0' }}>Belum ada rekening tersimpan.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                    {accounts.map(acc => (
                      <div key={acc.id} style={{ background: '#fff', border: acc.is_primary ? '1px solid #84cc16' : '1px solid #e2e8f0', padding: '16px', borderRadius: '12px', position: 'relative' }}>
                        {acc.is_primary && (
                          <div style={{ position: 'absolute', top: '12px', right: '12px', background: '#ecfccb', color: '#4d7c0f', fontSize: '11px', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>Utama</div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                          <div style={{ color: '#475569' }}>
                            {acc.type === 'bank' ? <CreditCard size={18} /> : acc.type === 'wallet' ? <Smartphone size={18} /> : <Wallet size={18} />}
                          </div>
                          <span style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b' }}>{acc.name}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>Saldo Awal</span>
                            <span style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
                              {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(acc.initial_balance))}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => openEditAccount(acc)} style={{ background: '#f1f5f9', border: 'none', color: '#475569', padding: '6px', borderRadius: '6px', cursor: 'pointer' }}><Edit2 size={14} /></button>
                            <button onClick={() => handleDeletePaymentAccount(acc.id)} style={{ background: '#fee2e2', border: 'none', color: '#ef4444', padding: '6px', borderRadius: '6px', cursor: 'pointer' }}><Trash2 size={14} /></button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
        
        {/* ACCOUNT MODAL */}
        {accountModalOpen && (
          <div className="modal-scrim" onClick={() => setAccountModalOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="modal-dialog relative w-full max-w-md bg-white rounded-2xl md:rounded-3xl shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()} style={{ overflow: 'visible' }}>
              <div className="modal-header rounded-t-2xl md:rounded-t-3xl" style={{ padding: '20px 24px', borderBottom: '1px solid #eee' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>{editAccountId ? "Edit Rekening" : "Tambah Rekening"}</h3>
              </div>
              <form onSubmit={handleSaveAccount}>
                <div className="form-grid" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Nama Rekening / Bank</span>
                    <input type="text" value={accName} onChange={e => setAccName(e.target.value)} required placeholder="Contoh: Bank BRI" style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Tipe Rekening</span>
                    <CustomSelect
                      value={accType}
                      onChange={setAccType}
                      options={[
                        { value: "bank", label: "Bank" },
                        { value: "wallet", label: "E-Wallet" },
                        { value: "cash", label: "Tunai" }
                      ]}
                    />
                  </div>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Saldo Awal (Rp)</span>
                    <input type="number" value={accBalance === 0 ? "" : accBalance} onChange={e => setAccBalance(e.target.value)} required placeholder="Contoh: 100000" style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={accIsPrimary} onChange={e => setAccIsPrimary(e.target.checked)} />
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Jadikan Rekening Utama</span>
                  </label>
                </div>
                <div className="modal-actions rounded-b-2xl md:rounded-b-3xl" style={{ padding: '16px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#f8fafc' }}>
                  <button type="button" className="button secondary" onClick={() => setAccountModalOpen(false)}>Batal</button>
                  <button type="submit" className="button primary">Simpan</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* EDIT CATEGORY MODAL */}
        {editCatModalOpen && (
          <div className="modal-scrim" onClick={() => setEditCatModalOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="modal-dialog relative w-full max-w-md bg-white rounded-2xl md:rounded-3xl shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()} style={{ overflow: 'visible' }}>
              <div className="modal-header rounded-t-2xl md:rounded-t-3xl" style={{ padding: '20px 24px', borderBottom: '1px solid #eee' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>Edit Kategori & Alokasi</h3>
              </div>
              <form onSubmit={handleSaveCategoryEdit}>
                <div className="form-grid" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Nama Kategori</span>
                    <input type="text" value={editCatName} onChange={e => setEditCatName(e.target.value)} required style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Alokasi Anggaran (Rp)</span>
                    <input type="number" value={editCatBudget === "0" ? "" : editCatBudget} onChange={e => setEditCatBudget(e.target.value)} placeholder="Contoh: 1000000" style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                  </label>
                </div>
                <div className="modal-actions rounded-b-2xl md:rounded-b-3xl" style={{ padding: '16px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#f8fafc' }}>
                  <button type="button" className="button secondary" onClick={() => setEditCatModalOpen(false)}>Batal</button>
                  <button type="submit" className="button primary">Simpan</button>
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
