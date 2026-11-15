import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaperReadingEntry } from "@/lib/types";

export type PaperReadingInput = {
  title: string;
  citation: string;
  sourceUrl: string;
  completedOn: string;
  notes: string;
};

function message(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    if (error.message.toLowerCase().includes("paper_reading_entries")) {
      return "The paper log is not active yet. Apply the Knowledge & Growth migration, then reopen the app.";
    }
    return error.message;
  }
  return fallback;
}

export async function fetchPaperReadings(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("paper_reading_entries")
    .select("id,user_id,title,citation,source_url,completed_on,notes,created_at,updated_at")
    .eq("user_id", userId)
    .order("completed_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(message(error, "Could not load your paper log."));
  return (data ?? []) as PaperReadingEntry[];
}

export async function createPaperReading(
  supabase: SupabaseClient,
  userId: string,
  input: PaperReadingInput,
) {
  const title = input.title.trim();
  const notes = input.notes.trim();
  if (!title || !notes) throw new Error("Add the paper title and the notes you want to keep.");
  const { data, error } = await supabase
    .from("paper_reading_entries")
    .insert({
      user_id: userId,
      title,
      citation: input.citation.trim() || null,
      source_url: input.sourceUrl.trim() || null,
      completed_on: input.completedOn,
      notes,
    })
    .select("id,user_id,title,citation,source_url,completed_on,notes,created_at,updated_at")
    .single();
  if (error) throw new Error(message(error, "Could not save this paper."));
  return data as PaperReadingEntry;
}
