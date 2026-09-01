"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmailAuthPanel, type EmailAuthPanelState } from "@/components/auth/EmailAuthPanel";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import {
  createProjectTracker,
  ensureLaunchProjectTracker,
  fetchProjectTrackerItems,
  fetchProjectTrackers,
  LAUNCH_TRACKER_ITEMS,
  parseProjectOutline,
  reopenProjectTrackerItem,
  submitProjectTrackerItem,
} from "@/lib/projectTrackers";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AUTH_REQUIRED_MESSAGE, ensureWorkspaceUser } from "@/lib/workspace";
import type { ProjectTracker, ProjectTrackerItem } from "@/lib/types";

type PageState =
  | { kind: "connecting" | "saving"; message: string }
  | { kind: "ready" | "error" | "auth_required"; message: string };

const INITIAL_IMPORT = { outline: "", title: "" };
const LOCAL_PREVIEW_USER_ID = "local-preview";
const LOCAL_PREVIEW_TRACKER: ProjectTracker = {
  id: "local-preview-launch",
  user_id: LOCAL_PREVIEW_USER_ID,
  slug: "intersection-evidence-launch",
  title: "Intersection evidence launch",
  description: "Local development preview",
  created_at: "2026-08-31T00:00:00.000Z",
  updated_at: "2026-08-31T00:00:00.000Z",
};

function createLocalPreviewItems(trackerId = LOCAL_PREVIEW_TRACKER.id) {
  return LAUNCH_TRACKER_ITEMS.map<ProjectTrackerItem>((item, index) => ({
    id: `local-preview-${trackerId}-${index + 1}`,
    tracker_id: trackerId,
    user_id: LOCAL_PREVIEW_USER_ID,
    phase: item.phase,
    position: index + 1,
    title: item.title,
    description: item.description ?? null,
    input_kind: item.inputKind,
    input_label: item.inputLabel,
    input_placeholder: item.inputPlaceholder ?? null,
    submission: null,
    submitted_at: null,
    completed_at: null,
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  }));
}

function itemKindLabel(item: ProjectTrackerItem) {
  return { link: "Link", list: "Structured list", long_text: "Writing", short_text: "Short entry" }[item.input_kind];
}

function phaseGroups(items: ProjectTrackerItem[]) {
  return items.reduce<Array<{ phase: string; items: ProjectTrackerItem[] }>>((groups, item) => {
    const group = groups.find((entry) => entry.phase === item.phase);
    if (group) group.items.push(item);
    else groups.push({ phase: item.phase, items: [item] });
    return groups;
  }, []);
}

function draftsFromItems(items: ProjectTrackerItem[]) {
  return Object.fromEntries(items.map((item) => [item.id, item.submission ?? ""]));
}

function SubmittedValue({ value }: { value: string | null }) {
  const lines = (value ?? "").split("\n");

  return (
    <div className="mt-2 space-y-1.5 text-sm leading-6 text-[#203544]">
      {lines.map((line, index) => {
        const bulletMatch = line.match(/^\s*[-*•]\s+(.+)$/);
        if (bulletMatch) {
          return (
            <div key={`${line}-${index}`} className="flex gap-2.5">
              <span aria-hidden="true" className="mt-[0.48rem] h-1.5 w-1.5 shrink-0 bg-[#3d6d86]" />
              <span>{bulletMatch[1]}</span>
            </div>
          );
        }

        return line.trim() ? <p key={`${line}-${index}`}>{line}</p> : <div key={`space-${index}`} className="h-1.5" />;
      })}
    </div>
  );
}

export default function SafetyEvidenceProjectTrackerPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#f7f1e6]" />}>
      <SafetyEvidenceProjectTrackerWorkspace />
    </Suspense>
  );
}

function SafetyEvidenceProjectTrackerWorkspace() {
  const searchParams = useSearchParams();
  const isLocalPreview = process.env.NODE_ENV === "development" && searchParams.get("preview") === "1";
  const initialPreviewItems = useMemo(() => isLocalPreview ? createLocalPreviewItems() : [], [isLocalPreview]);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [pageState, setPageState] = useState<PageState>(() => isLocalPreview
    ? { kind: "ready", message: "Local preview — changes reset on reload" }
    : { kind: "connecting", message: "Opening project…" });
  const [authPanelState, setAuthPanelState] = useState<EmailAuthPanelState>({ kind: "idle", message: null });
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(() => isLocalPreview ? LOCAL_PREVIEW_USER_ID : null);
  const [trackers, setTrackers] = useState<ProjectTracker[]>(() => isLocalPreview ? [LOCAL_PREVIEW_TRACKER] : []);
  const [activeTrackerId, setActiveTrackerId] = useState<string | null>(() => isLocalPreview ? LOCAL_PREVIEW_TRACKER.id : null);
  const [items, setItems] = useState<ProjectTrackerItem[]>(() => initialPreviewItems);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => draftsFromItems(initialPreviewItems));
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importState, setImportState] = useState(INITIAL_IMPORT);

  const activeTracker = trackers.find((tracker) => tracker.id === activeTrackerId) ?? null;
  const completeCount = items.filter((item) => item.completed_at).length;
  const groups = phaseGroups(items);

  const loadTracker = useCallback(async (trackerId: string, currentUserId: string) => {
    if (!supabase) return;
    const nextItems = await fetchProjectTrackerItems(supabase, trackerId, currentUserId);
    setItems(nextItems);
    setDrafts(draftsFromItems(nextItems));
    setActiveTrackerId(trackerId);
  }, [supabase]);

  const connect = useCallback(async () => {
    if (!supabase) {
      setPageState({ kind: "error", message: "This workspace is missing its Supabase connection." });
      return;
    }
    try {
      const user = await ensureWorkspaceUser(supabase);
      setUserId(user.id);
      const launchTracker = await ensureLaunchProjectTracker(supabase, user.id);
      setTrackers(await fetchProjectTrackers(supabase, user.id));
      await loadTracker(launchTracker.id, user.id);
      setPageState({ kind: "ready", message: "Your project is ready" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open the project tracker.";
      setPageState({ kind: message === AUTH_REQUIRED_MESSAGE ? "auth_required" : "error", message });
    }
  }, [loadTracker, supabase]);

  useEffect(() => {
    if (isLocalPreview) return;
    let cancelled = false;

    async function openProject() {
      if (!supabase) {
        if (!cancelled) setPageState({ kind: "error", message: "This workspace is missing its Supabase connection." });
        return;
      }
      try {
        const user = await ensureWorkspaceUser(supabase);
        const launchTracker = await ensureLaunchProjectTracker(supabase, user.id);
        const nextTrackers = await fetchProjectTrackers(supabase, user.id);
        const nextItems = await fetchProjectTrackerItems(supabase, launchTracker.id, user.id);
        if (cancelled) return;
        setUserId(user.id);
        setTrackers(nextTrackers);
        setActiveTrackerId(launchTracker.id);
        setItems(nextItems);
        setDrafts(draftsFromItems(nextItems));
        setPageState({ kind: "ready", message: "Your project is ready" });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Could not open the project tracker.";
        setPageState({ kind: message === AUTH_REQUIRED_MESSAGE ? "auth_required" : "error", message });
      }
    }

    void openProject();
    return () => { cancelled = true; };
  }, [isLocalPreview, supabase]);

  useEffect(() => {
    if (isLocalPreview) return;
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) void connect();
      else {
        setUserId(null); setItems([]); setTrackers([]);
        setPageState({ kind: "auth_required", message: AUTH_REQUIRED_MESSAGE });
      }
    });
    return () => subscription.unsubscribe();
  }, [connect, isLocalPreview, supabase]);

  async function submitItem(item: ProjectTrackerItem) {
    const draft = drafts[item.id]?.trim() ?? "";
    if (!userId || !draft) return;
    if (isLocalPreview) {
      const savedItem: ProjectTrackerItem = {
        ...item,
        completed_at: new Date().toISOString(),
        submission: draft,
        submitted_at: new Date().toISOString(),
      };
      const nextItems = items.map((item) => item.id === savedItem.id ? savedItem : item);
      setItems(nextItems);
      setPageState({ kind: "ready", message: "Submitted and checked off — local only" });
      return;
    }
    if (!supabase) return;
    setPageState({ kind: "saving", message: "Saving your submitted deliverable…" });
    try {
      const savedItem = await submitProjectTrackerItem(supabase, item, userId, draft);
      const nextItems = items.map((item) => item.id === savedItem.id ? savedItem : item);
      setItems(nextItems);
      setPageState({ kind: "ready", message: "Submitted and checked off" });
    } catch (error) {
      setPageState({ kind: "error", message: error instanceof Error ? error.message : "Could not save this deliverable." });
    }
  }

  async function reopenItem(item: ProjectTrackerItem) {
    if (!userId) return;
    if (isLocalPreview) {
      setItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, completed_at: null } : currentItem));
      setPageState({ kind: "ready", message: "Ready for an updated local submission" });
      return;
    }
    if (!supabase) return;
    setPageState({ kind: "saving", message: "Reopening deliverable…" });
    try {
      const reopened = await reopenProjectTrackerItem(supabase, item.id, userId);
      setItems((current) => current.map((item) => item.id === reopened.id ? reopened : item));
      setPageState({ kind: "ready", message: "Ready for an updated submission" });
    } catch (error) {
      setPageState({ kind: "error", message: error instanceof Error ? error.message : "Could not reopen this deliverable." });
    }
  }

  async function importOutline() {
    if (!userId) return;
    const parsedItems = parseProjectOutline(importState.outline);
    if (!importState.title.trim() || parsedItems.length === 0) {
      setPageState({ kind: "error", message: "Give the project a title and include at least one top-level bullet." });
      return;
    }
    setPageState({ kind: "saving", message: "Turning your outline into a checklist…" });
    try {
      if (isLocalPreview) {
        const tracker: ProjectTracker = {
          ...LOCAL_PREVIEW_TRACKER,
          id: `local-preview-import-${Date.now()}`,
          slug: `local-preview-${Date.now()}`,
          title: importState.title.trim(),
        };
        const localItems = parsedItems.map<ProjectTrackerItem>((item, index) => ({
          id: `${tracker.id}-${index + 1}`,
          tracker_id: tracker.id,
          user_id: LOCAL_PREVIEW_USER_ID,
          phase: item.phase,
          position: index + 1,
          title: item.title,
          description: item.description ?? null,
          input_kind: item.inputKind,
          input_label: item.inputLabel,
          input_placeholder: item.inputPlaceholder ?? null,
          submission: null,
          submitted_at: null,
          completed_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        setTrackers((current) => [...current, tracker]);
        setActiveTrackerId(tracker.id);
        setItems(localItems);
        setDrafts(draftsFromItems(localItems));
        setImportState(INITIAL_IMPORT);
        setIsImportOpen(false);
        setPageState({ kind: "ready", message: "Local checklist created — it will reset on reload" });
        return;
      }
      if (!supabase) return;
      const tracker = await createProjectTracker(supabase, userId, { items: parsedItems, title: importState.title });
      setTrackers((current) => [...current, tracker]);
      await loadTracker(tracker.id, userId);
      setImportState(INITIAL_IMPORT);
      setIsImportOpen(false);
      setPageState({ kind: "ready", message: "New project checklist created" });
    } catch (error) {
      setPageState({ kind: "error", message: error instanceof Error ? error.message : "Could not import this outline." });
    }
  }

  async function sendMagicLink() {
    if (!supabase || !email.trim()) {
      setAuthPanelState({ kind: "error", message: "Enter your email address to receive a sign-in link." });
      return;
    }
    setAuthPanelState({ kind: "sending", message: "Sending sign-in link…" });
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    setAuthPanelState(error
      ? { kind: "error", message: error.message || "Could not send the sign-in link." }
      : { kind: "sent", message: `Check ${email.trim()} for your sign-in link.` });
  }

  return (
    <main className="min-h-screen [--accent:#315f78] [--accent-soft:#dcebf2] [--border:#cbd6dd] bg-[linear-gradient(135deg,#f2f6f8_0%,#f8fafb_55%,#edf2f5_100%)] px-5 py-7 sm:px-8 sm:py-9">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-4 border-b border-[#cbd6dd] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[#627681]">{isLocalPreview ? "Local module preview" : "Project fieldbook"}</p>
            <h1 className="font-serif text-3xl tracking-tight text-[#1f3543] sm:text-4xl">{activeTracker?.title ?? "Project tracker"}</h1>
            <p className="max-w-2xl text-xs leading-5 text-[#536772]">A deliberate checklist for turning project work into a collected set of finished deliverables.</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-[#536772]">
            <span>{completeCount} / {items.length} submitted</span>
            {!isLocalPreview ? <Link className="underline decoration-[#9fb2bd] underline-offset-4 hover:text-[#1f3543]" href="/settings/tasks">Task vault</Link> : null}
            {!isLocalPreview ? <Link className="underline decoration-[#9fb2bd] underline-offset-4 hover:text-[#1f3543]" href="/">Home</Link> : null}
          </div>
        </header>

        {!userId ? (
          <div className="mt-10"><EmailAuthPanel email={email} onEmailChange={setEmail} onSubmit={() => void sendMagicLink()} state={authPanelState} title="Sign in to open this project" /></div>
        ) : (
          <section className="mt-6 max-w-4xl">
            <div className="flex flex-col gap-2 border-b border-[#cbd6dd] pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#627681]">Checklist</p><p className="mt-1 text-xs leading-5 text-[#607681]">Write directly beneath each task. Submit when it is ready to become part of the record.</p></div>
              <div className="flex items-center gap-4"><select className="border-b border-[#b7c5cd] bg-transparent py-1.5 text-xs font-semibold text-[#2a4859] outline-none" aria-label="Select project" onChange={(event) => userId && void loadTracker(event.target.value, userId)} value={activeTrackerId ?? ""}>{trackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.title}</option>)}</select><Button onClick={() => setIsImportOpen(true)} size="inline" variant="text">Import outline</Button></div>
            </div>

            <div className="mt-6 space-y-8">
              {groups.map((group) => (
                <section key={group.phase}>
                  <h2 className="border-b border-[#cbd6dd] pb-2 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[#466474]">{group.phase}</h2>
                  <ol className="mt-1 border-l border-[#b9c8d0] pl-5">
                    {group.items.map((item) => {
                      const complete = Boolean(item.completed_at);
                      const value = drafts[item.id] ?? "";
                      const isSingleLine = item.input_kind === "short_text" || item.input_kind === "link";
                      return <li key={item.id} className="relative border-b border-[#dce4e8] py-5 last:border-b-0">
                        <span aria-hidden="true" className={`absolute -left-[1.58rem] top-6 flex h-3 w-3 items-center justify-center border text-[8px] leading-none text-white ${complete ? "border-[#315f78] bg-[#315f78]" : "border-[#91a8b3] bg-[#f8fafb]"}`}>{complete ? "✓" : null}</span>
                        <div><p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[#627681]">{itemKindLabel(item)}</p><h3 className={`mt-1 font-serif text-xl leading-snug ${complete ? "text-[#60717b]" : "text-[#1f3543]"}`}>{item.title}</h3></div>
                        {item.description ? <p className="mt-2 max-w-3xl whitespace-pre-line text-xs leading-5 text-[#586d78]">{item.description}</p> : null}
                        {complete ? (
                          <div className="mt-3 border-l-2 border-[#76a0b5] pl-3">
                            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[#426b81]">Your submission</p>
                            <SubmittedValue value={item.submission} />
                            <Button className="mt-2" onClick={() => void reopenItem(item)} size="inline" variant="text">Edit submission</Button>
                          </div>
                        ) : (
                          <div className="mt-3">
                            <label className="sr-only" htmlFor={`deliverable-${item.id}`}>{item.input_label}</label>
                            {isSingleLine ? <input className="h-10 w-full rounded-none border border-[#cbd6dd] bg-white px-3 text-sm text-[#203544] shadow-[0_1px_4px_rgba(31,53,67,0.04)] outline-none placeholder:text-[#9aaab2] focus:border-[#315f78]" id={`deliverable-${item.id}`} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={item.input_placeholder ?? item.input_label} type={item.input_kind === "link" ? "url" : "text"} value={value} /> : <textarea className="min-h-28 w-full resize-y rounded-none border border-[#cbd6dd] bg-white p-3 text-xs leading-6 text-[#203544] shadow-[0_1px_4px_rgba(31,53,67,0.04)] outline-none placeholder:text-[#9aaab2] focus:border-[#315f78]" id={`deliverable-${item.id}`} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={item.input_placeholder ?? item.input_label} value={value} />}
                            <div className="mt-2 flex items-center gap-3"><Button disabled={!value.trim() || pageState.kind === "saving"} onClick={() => void submitItem(item)} size="sm">Submit &amp; mark complete</Button><span className="text-[0.68rem] text-[#71858e]">{item.input_label}</span></div>
                          </div>
                        )}
                      </li>;
                    })}
                  </ol>
                </section>
              ))}
            </div>
            <p aria-live="polite" className={`mt-5 text-xs ${pageState.kind === "error" ? "text-rose-700" : "text-[#607681]"}`}>{pageState.message}</p>
          </section>
        )}
      </div>

      <Dialog className="max-w-2xl" onClose={() => setIsImportOpen(false)} open={isImportOpen} title="Import a project outline">
        <div className="space-y-5">
          <p className="text-sm leading-6 text-slate-600">Use a heading such as “Phase 1 — Research,” followed by top-level bullets. Indented bullets become helpful detail for the item above them.</p>
          <label className="block space-y-2"><span className="text-sm text-slate-700">Project name</span><input className="h-11 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[var(--accent)]" onChange={(event) => setImportState((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. City launch" value={importState.title} /></label>
          <label className="block space-y-2"><span className="text-sm text-slate-700">Bulleted outline</span><textarea className="min-h-64 w-full border border-slate-300 bg-white p-3 font-mono text-xs leading-6 outline-none focus:border-[var(--accent)]" onChange={(event) => setImportState((current) => ({ ...current, outline: event.target.value }))} placeholder={"Phase 1 — Foundation\n- Write the brief\n  - Include the promise\n- Publish the page"} value={importState.outline} /></label>
          <div className="flex justify-end gap-3"><Button onClick={() => setIsImportOpen(false)} variant="secondary">Cancel</Button><Button onClick={() => void importOutline()}>Create checklist</Button></div>
        </div>
      </Dialog>
    </main>
  );
}
