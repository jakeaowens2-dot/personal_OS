import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? null;

  if (!url || !key) {
    return null;
  }

  return createBrowserClient(url, key);
}

export function createSupabaseRecoveryClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? null;

  if (!url || !key) {
    return null;
  }

  // Recovery starts in the native WebKit session but its email usually opens
  // in the system browser. Keep ordinary auth on PKCE while making only this
  // emailed recovery link portable across that browser boundary.
  return createBrowserClient(url, key, {
    isSingleton: false,
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "implicit",
      persistSession: false,
    },
  });
}
