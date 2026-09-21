import type { TaskProposal } from "./state";

/** Display durable description, progress and real task links as separate concepts. */
export function proposalPresentation(proposal: TaskProposal) {
  const before = proposal.before_json;
  const patch = proposal.patch_json;
  const description = patch.description ?? before?.description;
  const progress = patch.human_summary ?? before?.human_summary;
  const ids = patch.prerequisite_task_ids ?? before?.agent_payload_json?.prerequisite_task_ids ?? [];
  const snapshot = proposal.prerequisite_snapshot_json ?? [];
  const notes = before?.agent_payload_json?.dependencies;
  return {
    title: patch.title ?? before?.title ?? "Task update",
    previousTitle: patch.title && before?.title !== patch.title ? before?.title : undefined,
    priority: patch.priority ?? before?.priority ?? (before ? undefined : "medium"),
    previousPriority: patch.priority && before?.priority !== patch.priority ? before?.priority : undefined,
    // Old pilot tasks used only human_summary. Keep them readable without rewriting data.
    description: description ?? progress ?? "No description recorded.",
    progress: description != null ? progress : undefined,
    previousDescription: patch.description !== undefined && before?.description !== patch.description ? before?.description : undefined,
    previousProgress: patch.human_summary !== undefined && before?.human_summary !== patch.human_summary ? before?.human_summary : undefined,
    status: patch.status ?? before?.status ?? "open",
    previousStatus: patch.status && before?.status !== patch.status ? before?.status : undefined,
    dependencies: ids.map((id) => {
      const task = snapshot.find((item) => item.id === id);
      return task ? `${task.title}${task.status === "completed" ? " · completed" : ""}` : `Task ${id}`;
    }),
    dependencyNotes: Array.isArray(notes) ? notes.filter((note) => typeof note === "string" && Boolean(note.trim())) : [],
    prerequisitesChanged: patch.prerequisite_task_ids !== undefined,
  };
}


/** Short factual history entries from the canonical task revision log. */
export function taskRevisionSummary(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const short = (value: unknown) => {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  };
  if (!before) return `Created${after.title ? `: ${short(after.title)}` : ""}.`;
  const changes: string[] = [];
  if (before.title !== after.title) changes.push(`Renamed: ${short(after.title)}`);
  if (before.status !== after.status) changes.push(`Marked ${String(after.status).replaceAll("_", " ")}`);
  if (before.priority !== after.priority) changes.push(`Priority changed to ${after.priority}`);
  if (before.human_summary !== after.human_summary) changes.push(after.human_summary ? `Progress: ${short(after.human_summary)}` : "Progress note cleared");
  if (before.description !== after.description) changes.push(after.description ? `Description: ${short(after.description)}` : "Description cleared");
  const prior = before.agent_payload_json as { prerequisite_task_ids?: string[] } | null;
  const next = after.agent_payload_json as { prerequisite_task_ids?: string[] } | null;
  if (JSON.stringify(prior?.prerequisite_task_ids ?? []) !== JSON.stringify(next?.prerequisite_task_ids ?? [])) changes.push("Prerequisites updated");
  return changes.join(" · ") || "Task details updated.";
}

export function proposalStatusSummary(proposal: TaskProposal) {
  const before = proposal.before_json;
  const patch = proposal.status === "rejected" ? {} : proposal.patch_json;
  return patch.human_summary ?? before?.human_summary ?? patch.description ?? before?.description ?? "No status summary recorded yet.";
}
