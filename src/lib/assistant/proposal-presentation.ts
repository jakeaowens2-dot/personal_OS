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
