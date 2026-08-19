"use client";

import React, { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Bell, AlertCircle, Info, CheckCircle2, Plus, ExternalLink, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useDouit } from "../providers/DouitProvider";
import { useRouter } from "next/navigation";
import Link from "next/link";
export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: "WARNING" | "INFO" | "SUCCESS" | "FORWARDING_CONFIRMATION" | string;
  is_read: boolean;
  metadata: any;
  created_at: string;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [userAccounts, setUserAccounts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { user } = useDouit();
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();

    const fetchNotifications = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

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
    };

    fetchNotifications();

    const channelName = `user_notifications_${user.id}`;
    
    // 1. Remove stale cached channel if React Strict Mode re-executed useEffect
    const existingChannel = supabase.getChannels().find(
      (ch) => ch.topic === `realtime:${channelName}`
    );
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
    }

    // 2. Create fresh channel instance, attach .on() listener FIRST, then subscribe
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
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setNotifications((prev) => [payload.new as AppNotification, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setNotifications((prev) => prev.map((n) => n.id === payload.new.id ? payload.new as AppNotification : n));
          } else if (payload.eventType === 'DELETE') {
            setNotifications((prev) => prev.filter((n) => n.id === payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

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
      setOpen(false);
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

  if (!mounted) {
    return (
      <button className="relative p-2 rounded-xl cursor-default border-none bg-transparent flex items-center justify-center text-slate-300" aria-label="Notifications">
        <Bell size={18} className="text-slate-300" />
      </button>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="relative p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer border-none bg-transparent flex items-center justify-center text-slate-300 hover:text-white" aria-label="Notifications">
          <Bell size={18} className="text-slate-300 hover:text-white transition-colors" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full ring-2 ring-[#17231f]" />
          )}
        </button>
      </Popover.Trigger>
      
      <Popover.Portal>
        <Popover.Content 
          className="w-[380px] bg-[#FAF9F6] border border-slate-200/80 shadow-xl rounded-2xl p-3 z-50 overflow-hidden flex flex-col"
          side="right"
          align="start"
          sideOffset={8}
        >
          <div className="text-slate-800 font-semibold text-sm px-1 pb-2 border-b border-slate-200/60 flex items-center justify-between">
            <h3 className="font-semibold m-0 text-sm">Notifikasi</h3>
            {unreadCount > 0 && (
              <button 
                onClick={markAllAsRead}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium bg-transparent border-none cursor-pointer"
              >
                Tandai semua dibaca
              </button>
            )}
          </div>
          
          <div className="overflow-y-auto max-h-[400px] scrollbar-thin">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                Belum ada notifikasi
              </div>
            ) : (
              <div className="flex flex-col">
                {notifications.map((n) => (
                  <div 
                    key={n.id} 
                    className="bg-[#132A1E] text-white rounded-xl p-4 my-2 flex gap-3 group relative"
                  >
                    {!n.is_read && (
                      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                    )}
                    <div className="mt-0.5">
                      {getIcon(n.type)}
                    </div>
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="flex justify-between items-start gap-2 pr-4">
                        <h4 className="text-white font-semibold text-sm tracking-wide m-0">
                          {n.title}
                        </h4>
                        <span className="text-emerald-400/70 text-[11px] whitespace-nowrap">
                          {timeAgo(n.created_at)}
                        </span>
                      </div>
                      <p className="text-[#a8c9b9] text-xs leading-relaxed mt-1 font-normal m-0">
                        {n.message}
                      </p>
                      
                      {n.metadata?.suggested_action === "CREATE_ACCOUNT" && n.metadata?.bank_keyword && (
                        isAccountAdded(n.metadata.bank_keyword) ? (
                          <span className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-[#1d402e] text-emerald-300 border border-[#2b5e43] shadow-inner w-fit">
                            ✓ Rekening Sudah Ditambahkan
                          </span>
                        ) : (
                          <button 
                            onClick={() => handleActionClick(n)}
                            className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-lime-400 text-slate-950 hover:bg-lime-300 shadow-sm transition-all active:scale-95 border-none cursor-pointer w-fit"
                          >
                            <Plus size={14} />
                            Tambah Rekening
                          </button>
                        )
                      )}

                      {n.metadata?.action_type === "FORWARDING_CONFIRMATION" && (() => {
                        const url = n.metadata?.confirmation_url;
                        const hasValidVfLink = typeof url === "string" && url.includes("/vf-");
                        const isConfirmed = n.metadata?.is_confirmed === true;

                        if (isConfirmed && hasValidVfLink) {
                          return (
                            <span className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-[#1d402e] text-emerald-300 border border-[#2b5e43] shadow-inner w-fit cursor-default">
                              <CheckCircle2 size={14} /> Email Berhasil Ditautkan
                            </span>
                          );
                        }

                        if (!isConfirmed && hasValidVfLink) {
                          return (
                            <button 
                              onClick={() => handleForwardingActionClick(n)}
                              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all shadow-sm active:scale-95 cursor-pointer w-fit"
                            >
                              <span>Konfirmasi Penautan di Google</span>
                              <ExternalLink size={14} />
                            </button>
                          );
                        }

                        return (
                          <span className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-amber-500/10 text-amber-300 border border-amber-500/20 w-fit cursor-default">
                            <AlertTriangle size={14} /> Link Verifikasi Tidak Valid
                          </span>
                        );
                      })()}
                    </div>
                    {!n.is_read && (
                      <button 
                        onClick={() => markAsRead(n.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#1d402e] rounded-full text-emerald-400/70 self-start transition-opacity border-none bg-transparent cursor-pointer absolute right-2 bottom-2"
                        title="Tandai sudah dibaca"
                      >
                        <CheckCircle2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          {notifications.length > 0 && (
            <div className="border-t border-slate-200/60 text-center">
              <Link href="/notifikasi" className="text-slate-600 hover:text-slate-900 font-medium text-xs pt-2 text-center block w-full transition-colors no-underline" onClick={() => setOpen(false)}>
                Lihat semua
              </Link>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
