import { buildPlanningContextPacket } from "@/lib/planning";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export async function loadAssistantContext(): Promise<{ context: Record<string, unknown> | null; label: string }> {
  const client = createSupabaseBrowserClient();
  if (!client) return { context: null, label: "Working from our conversation" };
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { context: null, label: "Sign in on Home to include your tasks" };
  const userId = data.user.id;
  const [planning, tasks] = await Promise.allSettled([
    buildPlanningContextPacket(client, userId),
    client.from("tasks").select("id,title,description,status,priority,due_at,human_summary,updated_at")
      .eq("user_id", userId).in("status", ["open", "in_progress", "blocked"])
      .order("updated_at", { ascending: false }).limit(41),
  ]);
  const warnings: string[] = [];
  if (planning.status === "rejected") warnings.push("Planning context could not be loaded.");
  const rows = tasks.status === "fulfilled" && !tasks.value.error ? tasks.value.data : null;
  if (rows === null) warnings.push("Open tasks could not be loaded.");
  const packet = planning.status === "fulfilled" ? planning.value : null;
  const context = {
    generatedAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    planning: packet,
    openTasks: (rows ?? []).slice(0, 40).map((task) => ({ ...task, description: task.description?.slice(0, 800), human_summary: task.human_summary?.slice(0, 500), title: task.title.slice(0, 300) })),
    openTasksTruncated: (rows?.length ?? 0) > 40,
    warnings,
  };
  const incomplete = warnings.length > 0 || (packet?.contextWarnings.length ?? 0) > 0 || context.openTasksTruncated;
  return { context, label: incomplete ? "Some workspace context is unavailable or limited" : "Using your current tasks and focus" };
}
