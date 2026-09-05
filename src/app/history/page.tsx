"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LedgerEventList } from "@/components/ledger/LedgerEventList";
import { fetchActivityHistoryPage, type ActivityItem } from "@/lib/history";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AUTH_REQUIRED_MESSAGE, ensureWorkspaceUser } from "@/lib/workspace";

export default function HistoryPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(
    supabase ? null : "Supabase environment variables are missing.",
  );

  const loadPage = useCallback(async (workspaceUserId: string, before?: string | null) => {
    if (!supabase) {
      setError("Supabase environment variables are missing.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const page = await fetchActivityHistoryPage(supabase, workspaceUserId, { before });
      setItems((current) => before ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load activity history.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    void ensureWorkspaceUser(supabase)
      .then((user) => {
        setUserId(user.id);
        return loadPage(user.id);
      })
      .catch((connectionError) => {
        setError(connectionError instanceof Error ? connectionError.message : AUTH_REQUIRED_MESSAGE);
        setIsLoading(false);
      });
  }, [loadPage, supabase]);

  useEffect(() => {
    const target = loadMoreRef.current;

    if (!target || !userId || !nextCursor || isLoading) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        void loadPage(userId, nextCursor);
      }
    }, { rootMargin: "240px" });

    observer.observe(target);
    return () => observer.disconnect();
  }, [isLoading, loadPage, nextCursor, userId]);

  return (
    <main className="min-h-screen bg-[#f3ede4] px-5 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-end justify-between gap-6 border-b border-slate-300/70 pb-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Ledger</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Activity history</h1>
          </div>
          <Link className="text-sm text-slate-500 transition hover:text-slate-900" href="/">
            Back home
          </Link>
        </header>

        {error ? (
          <div className="py-12 text-sm text-rose-700">
            <p>{error}</p>
            {error === AUTH_REQUIRED_MESSAGE ? (
              <p className="mt-2 text-slate-500">Sign in on Home, then reopen this history window.</p>
            ) : null}
          </div>
        ) : (
          <>
            <LedgerEventList
              emptyMessage={isLoading ? "Loading activity…" : "No saved activity yet."}
              items={items}
            />
            <div className="flex min-h-24 items-center justify-center" ref={loadMoreRef}>
              {isLoading && items.length > 0 ? (
                <span className="text-xs text-slate-400">Loading older activity…</span>
              ) : !nextCursor && items.length > 0 ? (
                <span className="text-xs text-slate-400">Beginning of ledger</span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
