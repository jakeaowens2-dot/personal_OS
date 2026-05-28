"use client";

import { Button } from "@/components/ui/Button";

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

export function EmailAuthPanel({
  email,
  onEmailChange,
  onSubmit,
  state,
  title = "Sign in with a magic link",
}: EmailAuthPanelProps) {
  const messageTone = state.kind === "error" ? "text-rose-700" : "text-slate-600";

  return (
    <section className="mx-auto w-full max-w-xl border border-slate-300/70 bg-[#f6f4ee]/92 p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)] sm:p-8">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Persistent workspace</p>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
        <p className="max-w-lg text-sm leading-6 text-slate-600">
          Use email sign-in so your workspace stays attached to one durable account instead of changing with anonymous
          browser sessions.
        </p>
      </div>

      <div className="mt-6 grid gap-4 border-t border-slate-200/80 pt-5">
        <label className="space-y-2">
          <span className="text-sm text-slate-600">Email</span>
          <input
            autoComplete="email"
            className="h-11 w-full rounded-[0.8rem] border border-slate-300/80 bg-white/80 px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="you@example.com"
            type="email"
            value={email}
          />
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button onClick={onSubmit} variant="secondary">
            {state.kind === "sending" ? "Sending link..." : "Email sign-in link"}
          </Button>
          {state.message ? <p className={`text-sm ${messageTone}`}>{state.message}</p> : null}
        </div>
      </div>
    </section>
  );
}
