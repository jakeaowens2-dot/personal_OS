"use client";

import { useEffect, useMemo } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function AuthRecoveryRedirect() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  useEffect(() => {
    if (!supabase) return;

    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const callbackError = search.get("error_description") || hash.get("error_description");
    if (callbackError && window.location.pathname !== "/settings/account") {
      window.location.replace(`/settings/account?recovery_error=${encodeURIComponent(callbackError)}`);
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "PASSWORD_RECOVERY" || !session?.user.email || session.user.is_anonymous) return;
      if (window.location.pathname === "/settings/account") return;

      window.location.replace("/settings/account?recovery=1");
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  return null;
}
