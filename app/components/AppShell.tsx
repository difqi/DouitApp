"use client";

import {
  ArrowLeftRight,
  Bot,
  ChevronDown,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  X,
  User,
  LogOut,
  BarChart3,
  PiggyBank,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDouit } from "../providers/DouitProvider";
import { createClient } from "@/lib/supabase/client";
import { NotificationBell } from "./NotificationBell";
import { DouitLogo } from "./icons/DouitLogo";
import { WorkspaceLoading } from "@/components/ui/WorkspaceLoading";

type ActivePage = "dashboard" | "chat" | "transactions" | "settings" | "laporan" | "nabung";

const nav = [
  { id: "dashboard", label: "Ringkasan", href: "/", icon: LayoutDashboard },
  { id: "transactions", label: "Transaksi", href: "/transactions", icon: ArrowLeftRight },
  { id: "laporan", label: "Laporan", href: "/laporan", icon: BarChart3 },
  { id: "nabung", label: "Nabung", href: "/nabung", icon: PiggyBank, isNew: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  let active: ActivePage = "dashboard";
  if (pathname.includes("/transactions")) active = "transactions";
  else if (pathname.includes("/chat")) active = "chat";
  else if (pathname.includes("/settings")) active = "settings";
  else if (pathname.includes("/laporan")) active = "laporan";
  else if (pathname.includes("/nabung")) active = "nabung";
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const { user, membership, business, loading } = useDouit();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
  }, [loading, router, user]);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.href = '/login';
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  if (loading || !user || !membership || !business) {
    return <WorkspaceLoading />;
  }

  const initials = business.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const memberInitials = membership.display_name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();

  return (
    <div className={`app-frame ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""} ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-brand-row flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Link
              href="/"
              className="brand flex items-center gap-2.5 text-white font-bold no-underline tracking-tight transition-opacity hover:opacity-90"
              onClick={() => setMenuOpen(false)}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 border border-white/10 shadow-sm">
                <DouitLogo className="h-6 w-6" />
              </div>
              <span className="text-xl font-bold tracking-tight text-white leading-none">Douit</span>
            </Link>
            <NotificationBell />
          </div>
          <button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Tutup menu"><X size={20} /></button>
        </div>
        <div className="business-switcher" title={business.name} style={{ cursor: 'default' }}>
          <span className="business-logo">{initials}</span>
          <span><b>{business.name}</b><small>Akun pribadi</small></span>
        </div>
        <nav className="main-nav" aria-label="Navigasi utama">
          <span className="nav-label">Keuanganmu</span>
          {nav.map(({ id, label, href, icon: Icon, isNew }) => (
            <Link key={id} href={href} title={sidebarCollapsed ? label : undefined} className={`nav-item ${active === id ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
              <Icon size={18} />
              <span>{label}</span>
              {isNew && !sidebarCollapsed && (
                <span className="ml-auto bg-emerald-500/20 text-emerald-400 text-[10px] font-medium px-1.5 py-0.5 rounded border border-emerald-500/30">
                  Baru
                </span>
              )}
            </Link>
          ))}

          <span className="nav-label ai-label">Asisten</span>
          <Link href="/chat" title={sidebarCollapsed ? "Douit AI" : undefined} className={`nav-item ai-nav ${active === "chat" ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
            <Bot size={18} /><span>Douit AI</span><Sparkles size={13} className="nav-sparkle" />
          </Link>
        </nav>
        <div className="sidebar-tip">
          <span><Sparkles size={15} /></span>
          <b>Kelola uang lebih mudah</b>
          <p>Catat transaksi atau cari insight lewat percakapan.</p>
          <Link href="/chat">Tanya Douit AI</Link>
        </div>
        <div className="sidebar-bottom">
          <Link href="/settings" title={sidebarCollapsed ? "Pengaturan" : undefined} className={`nav-item ${active === "settings" ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
            <Settings size={17} /><span>Pengaturan</span>
          </Link>
          <div className="profile-container" style={{ position: 'relative', width: '100%' }}>
            <button className="profile-row cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors rounded-lg p-2" title="Kelola profil" onClick={() => setProfileMenuOpen(!profileMenuOpen)} style={{ width: '100%', border: 'none' }}>
              <span className="profile-avatar">{memberInitials}</span>
              <span><b>{membership.display_name}</b><small>{membership.role}</small></span>
              <ChevronDown size={14} style={{ transform: profileMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>
            {profileMenuOpen && (
              <div
                className="profile-dropdown bg-[#FAF7F2] border border-[#E8DFC8] shadow-md shadow-black/5 rounded-xl overflow-hidden flex flex-col"
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  left: 0,
                  right: 0,
                  zIndex: 50
                }}
              >
                <div className="px-3 py-2.5 bg-[#17231f] flex items-center gap-2">
                  <User className="h-4 w-4 text-slate-200 flex-shrink-0" />
                  <div className="flex flex-col overflow-hidden">
                    <p className="m-0 text-[13px] font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis">{user.email}</p>
                    <p className="m-0 text-[12px] text-slate-300 capitalize">{membership.role}</p>
                  </div>
                </div>
                <div className="bg-[#E8DFC8] h-[1px] w-full"></div>
                <div className="bg-transparent p-1.5 flex flex-col gap-1">
                  <button
                    onClick={() => { setProfileMenuOpen(false); setMenuOpen(false); router.push('/settings'); }}
                    className="w-full text-left px-2 py-1.5 text-[13px] text-[#1E293B] bg-transparent hover:bg-[#F2EBDC] border-none rounded-md cursor-pointer flex items-center gap-2 transition-colors"
                  >
                    <Settings className="h-4 w-4 text-[#1E293B]" />
                    <span className="text-[#1E293B] font-medium">Profil & pengaturan</span>
                  </button>
                  <button
                    onClick={() => { setProfileMenuOpen(false); handleLogout(); }}
                    className="w-full text-left px-2 py-1.5 text-[13px] text-red-600 bg-transparent hover:bg-red-100/50 border-none rounded-md cursor-pointer flex items-center gap-2 transition-colors"
                  >
                    <LogOut className="h-4 w-4 text-red-600" />
                    <span className="text-red-600 font-medium">Keluar</span>
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </aside>
      <button
        className="sidebar-collapse"
        onClick={() => setSidebarCollapsed((current) => !current)}
        aria-label={sidebarCollapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
        title={sidebarCollapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
      >
        {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
      {menuOpen && <button className="sidebar-scrim" aria-label="Tutup menu" onClick={() => setMenuOpen(false)} />}
      <main className="main-area">
        <button className="mobile-menu-button" aria-label="Buka menu" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
        <div className={`page-content ${active === "chat" ? "chat-page-content" : ""}`}>{children}</div>
      </main>
    </div>
  );
}
