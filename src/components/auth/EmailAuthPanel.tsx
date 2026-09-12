"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type EmailAuthPanelState =
  | { kind: "idle"; message: string | null }
  | { kind: "sending"; message: string }
  | { kind: "sent"; message: string }
  | { kind: "error"; message: string };

type EmailAuthPanelProps = {
  email: string;
  onEmailChange: (value: string) => void;
  onSubmit: () => void;
  state: EmailAuthPanelState;
  title?: string;
};

export function EmailAuthPanel({ email, onEmailChange, onSubmit, state, title = "Sign in" }: EmailAuthPanelProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [password, setPassword] = useState("");
  const [passwordState, setPasswordState] = useState<EmailAuthPanelState>({ kind: "idle", message: null });
  const current = mode === "magic" ? state : passwordState;
  const busy = current.kind === "sending";

  async function signIn() {
    setPasswordState({ kind: "sending", message: "Signing in…" });
    try {
      if (!supabase) throw new Error("Supabase connection is not configured.");
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setPassword("");
      setPasswordState({ kind: "sent", message: "Signed in." });
    } catch (error) {
      setPasswordState({ kind: "error", message: error instanceof Error ? error.message : "Could not sign in." });
    }
  }

  return (
    <section className="mx-auto w-full max-w-xl border border-slate-300/70 bg-[#f6f4ee]/92 p-6 sm:p-8">
      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
      <form className="mt-6 grid gap-4 border-t border-slate-200/80 pt-5" onSubmit={(event) => {
        event.preventDefault();
        if (!busy) { if (mode === "magic") onSubmit(); else void signIn(); }
      }}>
        <label className="grid gap-2 text-sm text-slate-600">
          Email
          <input autoComplete="username" name="email" required className="h-11 w-full rounded-lg border border-slate-300 bg-white/80 px-4 text-slate-900" onChange={(event) => onEmailChange(event.target.value)} placeholder="you@example.com" type="email" value={email} />
        </label>
        {mode === "password" ? <label className="grid gap-2 text-sm text-slate-600">
          Password
          <input autoComplete="current-password" name="password" required className="h-11 w-full rounded-lg border border-slate-300 bg-white/80 px-4 text-slate-900" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </label> : null}
        <Button type="submit" disabled={busy} variant="secondary">{busy ? (mode === "password" ? "Signing in…" : "Sending link…") : (mode === "password" ? "Sign in" : "Email sign-in link")}</Button>
        {current.message ? <p role={current.kind === "error" ? "alert" : "status"} className={`text-sm ${current.kind === "error" ? "text-rose-700" : "text-slate-600"}`}>{current.message}</p> : null}
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
          <button disabled={busy} type="button" className="underline underline-offset-4" onClick={() => { setMode(mode === "password" ? "magic" : "password"); setPassword(""); setPasswordState({ kind: "idle", message: null }); }}>{mode === "password" ? "Use an email link instead" : "Use a password instead"}</button>
          <Link className="underline underline-offset-4" href="/settings/account">Set or reset password</Link>
        </div>
      </form>
    </section>
  );
}
