"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AccountPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    // Subscription also handles the recovery session established by a redirect.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      if (session?.user.email) setEmail(session.user.email);
      setPassword("");
      setConfirmation("");
      setReady(true);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  async function submit() {
    if (!supabase || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (userId) {
        if (password !== confirmation) throw new Error("Passwords do not match.");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword(""); setConfirmation("");
        setNotice({ error: false, text: "Password saved. You can now sign in with your email and password." });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/settings/account` });
        if (error) throw error;
        setNotice({ error: false, text: "If that account exists, check its email for a password setup link. Open it in this browser." });
      }
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "Could not update account access." });
    } finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-xl space-y-6 px-6 py-12">
    <Link href="/" className="text-sm text-slate-600 underline underline-offset-4">Home</Link>
    <h1 className="text-2xl font-semibold">Account password</h1>
    {!supabase ? <p role="alert">Supabase connection is not configured.</p> : !ready ? <p>Checking your session…</p> : <>
      <p className="text-sm text-slate-600">{userId ? `Set or change the password for ${email}.` : "Already have an account? Request a one-time link to set or reset its password, or sign in first to change it here."}</p>
      {!userId ? <p className="text-sm text-slate-600">This one-time email is subject to Supabase’s email limit. Regular password sign-in does not send email.</p> : null}
      <form className="grid gap-4 border-t border-slate-300 pt-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {userId ? <>
          <label className="grid gap-2 text-sm">New password<input name="new-password" className="rounded-lg border border-slate-300 p-3" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label className="grid gap-2 text-sm">Confirm password<input name="confirm-password" className="rounded-lg border border-slate-300 p-3" type="password" autoComplete="new-password" required minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <p className="text-sm text-slate-500">Use at least 8 characters. Your account’s password policy may require more.</p>
        </> : <label className="grid gap-2 text-sm">Email<input name="email" className="rounded-lg border border-slate-300 p-3" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
        <Button type="submit" disabled={busy} variant="secondary">{busy ? "Working…" : userId ? "Save password" : "Email password setup link"}</Button>
      </form>
      {notice ? <p role={notice.error ? "alert" : "status"} className={`text-sm ${notice.error ? "text-rose-700" : "text-slate-600"}`}>{notice.text}</p> : null}
      {notice && !notice.error && userId ? <Link href="/" className="text-sm underline underline-offset-4">Return to workspace</Link> : null}
    </>}
  </main>;
}
