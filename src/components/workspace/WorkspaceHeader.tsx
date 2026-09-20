"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { PopoverMenu } from "@/components/ui/PopoverMenu";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./WorkspaceHeader.module.css";

const surfaces = [
  { href: "/", label: "Work tracking" },
  { href: "/assistant", label: "Personal Assistant" },
  { href: "/settings/tasks", label: "Task Management" },
];

type Props = {
  email?: string | null;
  status?: string;
  onSignOut?: () => void;
  onReset?: () => void;
  unfinishedTimer?: boolean;
};

export function WorkspaceHeader({ email, status, onSignOut, onReset, unfinishedTimer = false }: Props) {
  const pathname = usePathname();
  const client = useMemo(() => createSupabaseBrowserClient(), []);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const updateDate = () => setDate(new Intl.DateTimeFormat("en-US", {
      weekday: "long", month: "long", day: "numeric",
    }).format(new Date()));
    updateDate();
    const timer = setInterval(updateDate, 60_000);
    const subscription = client?.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null);
      setReady(true);
    }).data.subscription;
    return () => { clearInterval(timer); subscription?.unsubscribe(); };
  }, [client]);
  const currentEmail = email === undefined ? sessionEmail : email;
  async function signOut() {
    if (onSignOut) { onSignOut(); return; }
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) setError(error.message);
    else window.location.assign("/");
  }
  return <header className={styles.header}>
    <div className={styles.ribbon}>
      <div className={styles.ribbonInner}>
        <span className={styles.date}>{date}</span>
        <div className={styles.account}>
          {currentEmail ? <span className={styles.email}>Logged in as <strong>{currentEmail}</strong></span> : null}
          <span className={styles.status} role="status">{error || status || (currentEmail ? "Workspace connected" : ready ? "Signed out" : "Connecting workspace…")}</span>
          <PopoverMenu label="Settings" buttonClassName={styles.settings}>
            <Link className={styles.menuItem} href="/settings/account">Account password</Link>
            <Link className={styles.menuItem} href="/projects/safety-evidence">Project fieldbook</Link>
            {currentEmail && onReset ? <button className={styles.menuItem} onClick={onReset} type="button">Reset workspace</button> : null}
            {currentEmail ? <button className={styles.menuItem} onClick={() => void signOut()} type="button">Sign out</button> : null}
          </PopoverMenu>
        </div>
      </div>
    </div>
    <nav className={styles.tabs} aria-label="Workspace surfaces">
      {surfaces.map(({ href, label }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={styles.tab}
        onNavigate={(event) => {
          if (unfinishedTimer && href !== pathname && !window.confirm("Switching surfaces will reset your unfinished timer. Leave Work tracking?")) event.preventDefault();
        }}
      >{label}</Link>)}
    </nav>
  </header>;
}
