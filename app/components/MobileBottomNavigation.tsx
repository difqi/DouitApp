"use client";

import { ArrowLeftRight, Home, Settings, Sparkles, WalletCards } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const mobileNavigation = [
  { label: "Ringkasan", href: "/", icon: Home, primary: false },
  { label: "Transaksi", href: "/transactions", icon: ArrowLeftRight, primary: false },
  { label: "Douit AI", href: "/chat", icon: Sparkles, primary: true },
  { label: "Dompet", href: "/dompet", icon: WalletCards, primary: false },
  { label: "Pengaturan", href: "/settings", icon: Settings, primary: false },
] as const;

const isCurrentRoute = (pathname: string, href: string) => (
  href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`)
);

export function MobileBottomNavigation() {
  const pathname = usePathname();

  return (
    <nav className="mobile-bottom-navigation mobile-navigation" aria-label="Navigasi utama mobile">
      {mobileNavigation.map(({ label, href, icon: Icon, primary }) => {
        const active = isCurrentRoute(pathname, href);

        return (
          <Link
            key={href}
            href={href}
            className={`mobile-bottom-nav-item${primary ? " mobile-bottom-nav-primary" : ""}${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span className="mobile-bottom-nav-icon" aria-hidden="true"><Icon size={primary ? 24 : 21} /></span>
            <span className="mobile-bottom-nav-label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
