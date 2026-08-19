"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Mock User & Business Types for Frontend Phase
export type AuthUser = { id: string; email?: string; profile?: Record<string, unknown> };

export type Membership = {
  id: string;
  business_id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
};

export type Business = {
  id: string;
  name: string;
  address?: string;
  email?: string;
  default_notes?: string;
};

interface DouitContextValue {
  user: AuthUser | null;
  membership: Membership | null;
  business: Business | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const DouitContext = createContext<DouitContextValue | null>(null);

export function DouitProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email, profile: session.user.user_metadata });

        // Fetch profile to get inbound email alias
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();

        const displayName = session.user.user_metadata?.name || session.user.email?.split('@')[0] || "User";

        setMembership({
          id: session.user.id,
          business_id: session.user.id,
          user_id: session.user.id,
          email: session.user.email!,
          display_name: displayName,
          role: "administrator",
          status: "active",
        });

        setBusiness({
          id: session.user.id,
          name: `${displayName} Finance`,
          email: session.user.email,
          default_notes: profile?.inbound_email_alias,
        });
      } else {
        setUser(null);
        setMembership(null);
        setBusiness(null);
      }
    } catch (cause) {
      console.error(cause);
      setError("Tidak dapat memuat sesi Anda");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ user, membership, business, loading, error, refresh }), [user, membership, business, loading, error, refresh]);
  return <DouitContext.Provider value={value}>{children}</DouitContext.Provider>;
}

export function useDouit() {
  const value = useContext(DouitContext);
  if (!value) throw new Error("useDouit must be used inside DouitProvider");
  return value;
}
