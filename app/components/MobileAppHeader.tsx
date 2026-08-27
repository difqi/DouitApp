"use client";

import Link from "next/link";
import { useState } from "react";

import { useDouit } from "../providers/DouitProvider";
import { NotificationBell } from "./NotificationBell";

const getInitials = (name: string) => name
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join("")
  .toUpperCase() || "DU";

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
  const { membership, user } = useDouit();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const displayName = membership?.display_name?.trim() || "User";
  const firstName = displayName.split(/\s+/)[0];
  const metadata = user?.profile;
  const possibleAvatar = metadata?.avatar_url ?? metadata?.picture;
  const avatarUrl = typeof possibleAvatar === "string" ? possibleAvatar : null;

  return (
    <>
      <Link href="/settings" className="mobile-app-profile" aria-label="Buka profil dan pengaturan">
        <span className="mobile-app-avatar" aria-hidden="true">
          {avatarUrl && !avatarFailed ? (
            <img src={avatarUrl} alt="" onError={() => setAvatarFailed(true)} />
          ) : (
            getInitials(displayName)
          )}
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

export function MobileAppHeader() {
  return (
    <header className="mobile-app-header mobile-navigation">
      <MobileProfileIdentity />
    </header>
  );
}
