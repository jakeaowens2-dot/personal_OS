import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectTracker, ProjectTrackerInputKind, ProjectTrackerItem } from "@/lib/types";

export type ProjectTrackerSeedItem = {
  description?: string;
  inputKind: ProjectTrackerInputKind;
  inputLabel: string;
  inputPlaceholder?: string;
  phase: string;
  title: string;
};

const LAUNCH_TRACKER_SLUG = "intersection-evidence-launch";

export const LAUNCH_TRACKER_ITEMS: ProjectTrackerSeedItem[] = [
  {
    phase: "01 — Offer",
    title: "Write the one-sentence offer",
    description: "A clear promise that says what you deploy, who it helps, and how quickly the package arrives.",
    inputKind: "short_text",
    inputLabel: "The offer",
    inputPlaceholder: "We deploy temporary cameras at an intersection and return…",
  },
  {
    phase: "01 — Offer",
    title: "Define the standard engagement",
    description: "Set the default scope: one intersection, deployment days, turnaround, approximate fixed price, and clear outputs.",
    inputKind: "list",
    inputLabel: "Engagement outline",
    inputPlaceholder: "• 1 intersection\n• 3 days deployed\n• 5-day turnaround\n• $X–$Y\n• Outputs: …",
  },
  {
    phase: "01 — Offer",
    title: "Describe the package a customer receives",
    description: "Make the tangible result believable: findings, metrics, map, clips, structured data, and appropriate video access.",
    inputKind: "list",
    inputLabel: "Customer-facing deliverables",
    inputPlaceholder: "• Findings summary\n• Metrics and tables\n• Annotated map\n• Representative clips\n• Downloadable data",
  },
  {
    phase: "02 — Ideal project fit",
    title: "Define the initial customer",
    description: "Start with transportation and safety consultants running active municipal projects, especially project managers with an immediate evidence need.",
    inputKind: "long_text",
    inputLabel: "Ideal customer profile",
    inputPlaceholder: "Who they are, what triggers the need, and which role buys or champions the work…",
  },
  {
    phase: "02 — Ideal project fit",
    title: "Define the initial use cases",
    description: "Cover intersection safety, pedestrian/cyclist behavior, speeding, yielding, conflicts, and before/after treatment evaluation.",
    inputKind: "list",
    inputLabel: "Priority use cases",
    inputPlaceholder: "• Intersection safety evaluation\n• Pedestrian/cyclist behavior\n• …",
  },
  {
    phase: "02 — Ideal project fit",
    title: "Build a list of 20–30 highly qualified targets",
    description: "Each target needs a named person, firm, active project, and a one-line explanation of why that project needs this evidence.",
    inputKind: "list",
    inputLabel: "Qualified targets",
    inputPlaceholder: "Name — Firm — Active project — Why this is a fit\n…",
  },
  {
    phase: "03 — Outreach & presence",
    title: "Write the short outreach copy",
    description: "No deck or feature dump. The only job is to start a conversation about a live project.",
    inputKind: "long_text",
    inputLabel: "Outreach message",
    inputPlaceholder: "Subject: …\n\nHi [Name],\n\n…",
  },
  {
    phase: "03 — Outreach & presence",
    title: "Set up a company-domain email",
    description: "Capture the mailbox or email address that will be used for outreach.",
    inputKind: "short_text",
    inputLabel: "Company email",
    inputPlaceholder: "name@company.com",
  },
  {
    phase: "03 — Outreach & presence",
    title: "Establish a credible LinkedIn presence",
    description: "Add the profile link after the profile represents the offer and relevant expertise.",
    inputKind: "link",
    inputLabel: "LinkedIn profile URL",
    inputPlaceholder: "https://www.linkedin.com/in/…",
  },
  {
    phase: "03 — Outreach & presence",
    title: "Publish a credibility-first website",
    description: "It only needs to avoid undermining trust: clearly explain the service, outputs, and how to get in touch.",
    inputKind: "link",
    inputLabel: "Website URL",
    inputPlaceholder: "https://…",
  },
];

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

function projectTrackerError(error: unknown, fallback: string) {
  const message = errorMessage(error, fallback);
  const normalized = message.toLowerCase();
  if (
    (normalized.includes("schema cache") && normalized.includes("project_tracker")) ||
    normalized.includes("project_trackers does not exist") ||
    normalized.includes("project_tracker_items does not exist")
  ) {
    return "The project tracker tables are not available yet. Apply the latest Supabase migration, then reload the app.";
  }
  return message;
}

function toSlug(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `project-${Date.now()}`;
}

function inferInputKind(title: string): ProjectTrackerInputKind {
  const lower = title.toLowerCase();
  if (/(website|linkedin|url|link|document|page)/.test(lower)) return "link";
  if (/(list|targets|use cases|deliverables|engagement)/.test(lower)) return "list";
  if (/(copy|profile|summary|description)/.test(lower)) return "long_text";
  return "short_text";
}

export function parseProjectOutline(outline: string): ProjectTrackerSeedItem[] {
  const items: ProjectTrackerSeedItem[] = [];
  let phase = "Imported deliverables";
  let currentItem: ProjectTrackerSeedItem | null = null;

  for (const rawLine of outline.split("\n")) {
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const text = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (!text) continue;
    const isBullet = /^\s*(?:[-*•]|\d+[.)])\s+/.test(rawLine);

    if (!isBullet) {
      if (currentItem && indent > 0) {
        currentItem.description = `${currentItem.description ?? ""}\n${text}`.trim();
      } else if (/^(phase|stage|step)\b/i.test(text)) {
        phase = text;
        currentItem = null;
      }
      continue;
    }

    if (indent === 0) {
      currentItem = {
        phase,
        title: text,
        description: "",
        inputKind: inferInputKind(text),
        inputLabel: "Submission",
        inputPlaceholder: "Enter the completed deliverable…",
      };
      items.push(currentItem);
    } else if (currentItem) {
      currentItem.description = `${currentItem.description ?? ""}\n• ${text}`.trim();
    }
  }

  return items;
}

export async function fetchProjectTrackers(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("project_trackers")
    .select("id, user_id, slug, title, description, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(projectTrackerError(error, "Could not load project trackers."));
  return (data ?? []) as ProjectTracker[];
}

export async function fetchProjectTrackerItems(supabase: SupabaseClient, trackerId: string, userId: string) {
  const { data, error } = await supabase
    .from("project_tracker_items")
    .select("id, tracker_id, user_id, phase, position, title, description, input_kind, input_label, input_placeholder, submission, submitted_at, completed_at, created_at, updated_at")
    .eq("tracker_id", trackerId)
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (error) throw new Error(projectTrackerError(error, "Could not load project deliverables."));
  return (data ?? []) as ProjectTrackerItem[];
}

export async function createProjectTracker(
  supabase: SupabaseClient,
  userId: string,
  input: { description?: string; items: ProjectTrackerSeedItem[]; title: string },
) {
  const baseSlug = toSlug(input.title);
  const slug = `${baseSlug}-${Date.now().toString(36)}`;
  const { data: tracker, error: trackerError } = await supabase
    .from("project_trackers")
    .insert({ description: input.description?.trim() || null, slug, title: input.title.trim(), user_id: userId })
    .select("id, user_id, slug, title, description, created_at, updated_at")
    .single();
  if (trackerError) throw new Error(projectTrackerError(trackerError, "Could not create the project tracker."));

  if (input.items.length) {
    const { error: itemError } = await supabase.from("project_tracker_items").insert(
      input.items.map((item, index) => ({
        description: item.description?.trim() || null,
        input_kind: item.inputKind,
        input_label: item.inputLabel,
        input_placeholder: item.inputPlaceholder?.trim() || null,
        phase: item.phase.trim() || "Imported deliverables",
        position: index + 1,
        title: item.title.trim(),
        tracker_id: tracker.id,
        user_id: userId,
      })),
    );
    if (itemError) throw new Error(projectTrackerError(itemError, "Could not create the project deliverables."));
  }

  return tracker as ProjectTracker;
}

export async function ensureLaunchProjectTracker(supabase: SupabaseClient, userId: string) {
  const { data: existing, error } = await supabase
    .from("project_trackers")
    .select("id, user_id, slug, title, description, created_at, updated_at")
    .eq("user_id", userId)
    .eq("slug", LAUNCH_TRACKER_SLUG)
    .maybeSingle();
  if (error) throw new Error(projectTrackerError(error, "Could not open the launch tracker."));
  if (existing) return existing as ProjectTracker;

  const { data: tracker, error: trackerError } = await supabase
    .from("project_trackers")
    .insert({
      description: "A focused launch checklist for temporary intersection-safety evidence.",
      slug: LAUNCH_TRACKER_SLUG,
      title: "Intersection evidence launch",
      user_id: userId,
    })
    .select("id, user_id, slug, title, description, created_at, updated_at")
    .single();
  if (trackerError) throw new Error(projectTrackerError(trackerError, "Could not create the launch tracker."));

  const { error: itemError } = await supabase.from("project_tracker_items").insert(
    LAUNCH_TRACKER_ITEMS.map((item, index) => ({
      description: item.description ?? null,
      input_kind: item.inputKind,
      input_label: item.inputLabel,
      input_placeholder: item.inputPlaceholder ?? null,
      phase: item.phase,
      position: index + 1,
      title: item.title,
      tracker_id: tracker.id,
      user_id: userId,
    })),
  );
  if (itemError) throw new Error(projectTrackerError(itemError, "Could not create the launch deliverables."));
  return tracker as ProjectTracker;
}

export async function submitProjectTrackerItem(
  supabase: SupabaseClient,
  item: ProjectTrackerItem,
  userId: string,
  submission: string,
) {
  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("project_tracker_items")
    .update({ completed_at: completedAt, submission: submission.trim(), submitted_at: completedAt })
    .eq("id", item.id)
    .eq("user_id", userId)
    .select("id, tracker_id, user_id, phase, position, title, description, input_kind, input_label, input_placeholder, submission, submitted_at, completed_at, created_at, updated_at")
    .single();
  if (error) throw new Error(projectTrackerError(error, "Could not save this deliverable."));
  return data as ProjectTrackerItem;
}

export async function reopenProjectTrackerItem(supabase: SupabaseClient, itemId: string, userId: string) {
  const { data, error } = await supabase
    .from("project_tracker_items")
    .update({ completed_at: null })
    .eq("id", itemId)
    .eq("user_id", userId)
    .select("id, tracker_id, user_id, phase, position, title, description, input_kind, input_label, input_placeholder, submission, submitted_at, completed_at, created_at, updated_at")
    .single();
  if (error) throw new Error(projectTrackerError(error, "Could not reopen this deliverable."));
  return data as ProjectTrackerItem;
}
