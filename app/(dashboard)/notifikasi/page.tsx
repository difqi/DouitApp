"use client";

import React, { useEffect, useState } from "react";
import { AlertCircle, Info, CheckCircle2, Plus, Bell, Trash2, Check, BellRing, ExternalLink, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useDouit } from "../../providers/DouitProvider";
import { useRouter } from "next/navigation";
import { AppNotification } from "../../components/NotificationBell";
import { toast } from "sonner";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";

export default function NotifikasiPage() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [userAccounts, setUserAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "UNREAD" | "WARNING">("ALL");
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const { user } = useDouit();
  const router = useRouter();

  useEffect(() => {
    if (!user?.id) return;
    const fetchNotifications = async () => {
      setLoading(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (data) {
        const cleanedData = data.map((n: any) => {
          if (
            n.metadata?.action_type === 'FORWARDING_CONFIRMATION' &&
            n.metadata?.is_confirmed === true &&
            (!n.metadata?.confirmation_url || typeof n.metadata.confirmation_url !== 'string' || !n.metadata.confirmation_url.includes('/vf-'))
          ) {
            return {
              ...n,
              metadata: {
                ...n.metadata,
                is_confirmed: false
              }
            };
          }
          return n;
        });
        setNotifications(cleanedData as AppNotification[]);
      }
      
      const { data: accounts } = await supabase.from('payment_accounts').select('name').eq('user_id', user.id);
      if (accounts) {
        setUserAccounts(accounts);
      }
      setLoading(false);
    };

    fetchNotifications();
    
    const supabase = createClient();
    const channelName = `user_notifikasi_page_${user.id}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const markAsRead = async (id: string) => {
    if (!user) return;
    const supabase = createClient();
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  };

  const markAllAsRead = async () => {
    if (!user) return;
    const supabase = createClient();
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const deleteAll = () => {
    if (!user || notifications.length === 0) return;
    setConfirmDeleteAllOpen(true);
  };

  const handleConfirmDeleteAll = async () => {
    if (!user) return;
    setIsDeletingAll(true);
    const supabase = createClient();
    const { error } = await supabase.from("notifications").delete().eq("user_id", user.id);
    setIsDeletingAll(false);
    if (error) {
      toast.error("Gagal menghapus notifikasi: " + error.message);
      return;
    }
    setNotifications([]);
    setConfirmDeleteAllOpen(false);
    toast.success("Semua notifikasi berhasil dihapus.");
  };

  const deleteNotification = async (id: string) => {
    if (!user) return;
    const supabase = createClient();
    await supabase.from("notifications").delete().eq("id", id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const timeAgo = (dateStr: string) => {
    const rtf = new Intl.RelativeTimeFormat("id", { numeric: "auto" });
    const diff = (new Date(dateStr).getTime() - Date.now()) / 1000;
    
    if (Math.abs(diff) < 60) return rtf.format(Math.round(diff), "second");
    if (Math.abs(diff) < 3600) return rtf.format(Math.round(diff / 60), "minute");
    if (Math.abs(diff) < 86400) return rtf.format(Math.round(diff / 3600), "hour");
    return rtf.format(Math.round(diff / 86400), "day");
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "WARNING": return (
        <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-600 border border-amber-200/60 flex items-center justify-center shrink-0 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
        </div>
      );
      case "SUCCESS": return (
        <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 flex items-center justify-center shrink-0 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        </div>
      );
      default: return (
        <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 border border-blue-200/60 flex items-center justify-center shrink-0 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/60">
          <Info className="w-4 h-4 flex-shrink-0" />
        </div>
      );
    }
  };

  const isAccountAdded = (bankKeyword: string) => {
    if (!bankKeyword || !userAccounts) return false;
    return userAccounts.some((acc) =>
      acc.name.toLowerCase().includes(bankKeyword.toLowerCase())
    );
  };

  const handleActionClick = (n: AppNotification) => {
    if (n.metadata?.suggested_action === "CREATE_ACCOUNT" && n.metadata?.bank_keyword) {
      markAsRead(n.id);
      router.push(`/settings?action=add_account&bankName=${encodeURIComponent(n.metadata.bank_keyword)}`);
    }
  };

  const handleForwardingActionClick = async (n: AppNotification) => {
    const urlToOpen = n.metadata?.confirmation_url;
    if (!urlToOpen || typeof urlToOpen !== 'string' || !urlToOpen.includes('/vf-')) return;
    
    window.open(urlToOpen, '_blank');
    
    const supabase = createClient();
    const newMetadata = { ...n.metadata, is_confirmed: true };
    await supabase.from("notifications").update({ 
      metadata: newMetadata, 
      is_read: true 
    }).eq("id", n.id);
    
    setNotifications((prev) =>
      prev.map((item) => (item.id === n.id ? { ...item, is_read: true, metadata: newMetadata } : item))
    );
  };

  const filteredNotifications = notifications.filter(n => {
    if (filter === "UNREAD") return !n.is_read;
    if (filter === "WARNING") return n.type === "WARNING";
    return true;
  });

  return (
    <div className="workspace-page">
      <div className="page-heading dashboard-heading" style={{ paddingBottom: '16px', borderBottom: '1px solid #e2e8f0' }}>
        <div>
          <div className="eyebrow"><BellRing size={14} /> Pusat Notifikasi</div>
          <h1>Notifikasi</h1>
          <p>Lihat update transaksi, anggaran, rekening, dan target tabunganmu.</p>
        </div>
      </div>

      <div className="w-full" style={{ margin: '24px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '4px', borderRadius: '8px' }}>
            <button 
              onClick={() => setFilter("ALL")} 
              style={{ padding: '6px 12px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer', transition: 'all 0.2s', background: filter === "ALL" ? '#fff' : 'transparent', color: filter === "ALL" ? '#0f172a' : '#64748b', boxShadow: filter === "ALL" ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}
            >
              Semua
            </button>
            <button 
              onClick={() => setFilter("UNREAD")} 
              style={{ padding: '6px 12px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer', transition: 'all 0.2s', background: filter === "UNREAD" ? '#fff' : 'transparent', color: filter === "UNREAD" ? '#0f172a' : '#64748b', boxShadow: filter === "UNREAD" ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}
            >
              Belum dibaca
            </button>
            <button 
              onClick={() => setFilter("WARNING")} 
              style={{ padding: '6px 12px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer', transition: 'all 0.2s', background: filter === "WARNING" ? '#fff' : 'transparent', color: filter === "WARNING" ? '#0f172a' : '#64748b', boxShadow: filter === "WARNING" ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}
            >
              Peringatan
            </button>
          </div>
          
          <div style={{ display: 'flex', gap: '12px' }}>
            {notifications.some(n => !n.is_read) && (
              <button onClick={markAllAsRead} className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium text-xs rounded-lg px-3 py-1.5 flex items-center gap-1.5 cursor-pointer">
                <Check size={14} /> Tandai semua dibaca
              </button>
            )}
            <button onClick={deleteAll} className="bg-rose-50 border border-rose-200/80 text-rose-600 hover:bg-rose-100 font-medium text-xs rounded-lg px-3 py-1.5 flex items-center gap-1.5 cursor-pointer">
              <Trash2 size={14} /> Hapus Semua
            </button>
          </div>
        </div>

        <div style={{ borderRadius: '12px' }}>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>Memuat notifikasi...</div>
          ) : filteredNotifications.length === 0 ? (
            <div style={{ padding: '64px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                <Bell size={24} />
              </div>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: '0 0 4px 0' }}>Belum ada notifikasi</h3>
                <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>Notifikasi penting tentang aktivitas keuanganmu akan muncul di sini.</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredNotifications.map((n) => {
                return (
                <div key={n.id} className="bg-gradient-to-br from-[#163023] to-[#0e1f16] border border-[#1f4230] rounded-2xl p-5 shadow-sm transition-all text-white flex gap-4 items-start relative group">
                  {!n.is_read && (
                    <div className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                  )}
                  <div className="mt-0.5">
                    {getIcon(n.type)}
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', paddingRight: '16px' }}>
                      <h4 className="text-white font-semibold text-sm tracking-wide m-0">{n.title}</h4>
                      <span className="text-emerald-400/70 text-[11px] whitespace-nowrap">{timeAgo(n.created_at)}</span>
                    </div>
                    <p className="text-[#a8c9b9] text-xs leading-relaxed mt-1 font-normal m-0">{n.message}</p>
                    
                    {n.metadata?.suggested_action === "CREATE_ACCOUNT" && n.metadata?.bank_keyword && (
                      <div style={{ marginTop: '12px' }}>
                        {isAccountAdded(n.metadata.bank_keyword) ? (
                          <span className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-[#1d402e] text-emerald-300 border border-[#2b5e43] shadow-inner">
                            <Check size={14} /> Rekening Sudah Ditambahkan
                          </span>
                        ) : (
                          <button 
                            onClick={() => handleActionClick(n)}
                            className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-lime-400 text-slate-950 hover:bg-lime-300 shadow-sm transition-all active:scale-95 border-none cursor-pointer"
                          >
                            <Plus size={14} />
                            Tambah Rekening
                          </button>
                        )}
                      </div>
                    )}
                    
                    {n.metadata?.action_type === "FORWARDING_CONFIRMATION" && (() => {
                      const url = n.metadata?.confirmation_url;
                      const hasValidVfLink = typeof url === "string" && url.includes("/vf-");
                      const isConfirmed = n.metadata?.is_confirmed === true;

                      if (isConfirmed && hasValidVfLink) {
                        return (
                          <div style={{ marginTop: '12px' }}>
                            <span className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-[#1d402e] text-emerald-300 border border-[#2b5e43] shadow-inner cursor-default">
                              <CheckCircle2 size={14} /> Email Berhasil Ditautkan
                            </span>
                          </div>
                        );
                      }

                      if (!isConfirmed && hasValidVfLink) {
                        return (
                          <div style={{ marginTop: '12px' }}>
                            <button 
                              onClick={() => handleForwardingActionClick(n)}
                              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all shadow-sm active:scale-95 cursor-pointer"
                            >
                              <span>Konfirmasi Penautan di Google</span>
                              <ExternalLink size={14} />
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div style={{ marginTop: '12px' }}>
                          <span className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-amber-500/10 text-amber-300 border border-amber-500/20 cursor-default">
                            <AlertTriangle size={14} /> Link Verifikasi Tidak Valid
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', opacity: 0, transition: 'opacity 0.2s', position: 'absolute', right: '16px', bottom: '16px' }} className="group-hover:opacity-100">
                    {!n.is_read && (
                      <button 
                        onClick={() => markAsRead(n.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', borderRadius: '50%' }}
                        title="Tandai dibaca"
                        className="hover:bg-[#1d402e] text-emerald-400/70"
                      >
                        <Check size={16} />
                      </button>
                    )}
                    <button 
                      onClick={() => deleteNotification(n.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', borderRadius: '50%' }}
                      title="Hapus notifikasi"
                      className="hover:bg-rose-950/40 text-rose-400"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmDeleteAllOpen}
        onClose={() => setConfirmDeleteAllOpen(false)}
        onConfirm={handleConfirmDeleteAll}
        title="Hapus Semua Notifikasi"
        description="Hapus seluruh riwayat notifikasi? Tindakan ini tidak dapat dibatalkan."
        confirmLabel="Hapus Semua"
        variant="danger"
        isLoading={isDeletingAll}
      />
    </div>
  );
}
