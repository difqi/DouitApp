"use client";

import Link from "next/link";

import { useDouit } from "../providers/DouitProvider";
import { DouitLogo } from "./icons/DouitLogo";
import { NotificationBell } from "./NotificationBell";

const getCurrentDateLabel = () => {
  const label = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date());

  return label.charAt(0).toUpperCase() + label.slice(1);
};

export function MobileProfileIdentity() {
  const { membership } = useDouit();
  const displayName = membership?.display_name?.trim() || "User";
  const firstName = displayName.split(/\s+/)[0];

  return (
    <>
      <Link href="/settings" className="mobile-app-profile" aria-label="Buka profil dan pengaturan">
        <span className="mobile-app-avatar mobile-app-logo" aria-hidden="true">
          <DouitLogo className="h-full w-full" />
        </span>
        <span className="mobile-app-identity">
          <strong>Halo, {firstName}.</strong>
          <time suppressHydrationWarning>{getCurrentDateLabel()}</time>
        </span>
      </Link>
      <NotificationBell mode="link" />
    </>
  );
}
