import type { TaskProposal } from "./state";

/** Present the proposed snapshot, never infer structured dependencies from prose. */
export function proposalPresentation(proposal: TaskProposal) {
  const before = proposal.before_json;
  const patch = proposal.patch_json;
  const dependencies = before?.agent_payload_json?.dependencies ?? [];
  return {
    title: patch.title ?? before?.title ?? "Task update",
    previousTitle: patch.title && before?.title !== patch.title ? before?.title : undefined,
    priority: patch.priority ?? before?.priority ?? (before ? undefined : "medium"),
    previousPriority: patch.priority && before?.priority !== patch.priority ? before?.priority : undefined,
    description: patch.human_summary ?? before?.description ?? before?.human_summary ?? "No description recorded.",
    previousDescription: patch.human_summary !== undefined && before?.human_summary !== patch.human_summary ? before?.human_summary : undefined,
    status: patch.status ?? before?.status ?? "open",
    previousStatus: patch.status && before?.status !== patch.status ? before?.status : undefined,
    dependencies: dependencies.filter((dependency): dependency is string => typeof dependency === "string" && Boolean(dependency.trim())),
  };
}
