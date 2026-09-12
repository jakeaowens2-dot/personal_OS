# Assistant memory pilot

Status: Pilot code implemented and Supabase migration applied 2026-09-12; signed-in
local acceptance pending. The design below remains the contract. The former chat-only
runtime has been replaced by the dedicated Hermes adapter; the ordinary Hermes
profile is unchanged.

## Implemented development window

`20260912000000_assistant_daily_planning.sql` implements one three-kind memory
store plus revisions, durable messages/turns, reviewed task proposals, daily review
snapshots and presentation receipts. `state.ts`, `store.ts`, `tools.ts` and the
Hermes adapter implement the corresponding application contract. Each write
upserts one stable entry rather than replacing/pruning an entire home. Daily notes
are a compact list of meaningful entries with individual carry-forward reasoning;
a separate generated prose summary is deferred. Publishing a review must account
for every relevant/uncertain item in the preceding handoff, using stable entry
IDs; the database rejects omissions. Correcting a dated handoff requests a new
review revision for that same date. Core entries record source-backed
last-confirmed timestamps in addition to revision/update dates.

Task scope is intentionally narrow: create, title, status, priority, and progress
summary. The assistant can propose; only the user-facing Apply transaction changes
the canonical task and triggers its existing revision log. Daily focus and ledger
writes remain outside this toolset. This does not implement the entire later
`TaskMutationProposalBatch` contract.

The native tool adapter bypasses the known stdio MCP defect without editing the
installed Hermes source. It preserves native session continuity and profile-scoped
history search while disabling competing profile memory/background writers.
Application tools, stored IDs, source messages and revisions remain independent of
that adapter. A second different harness has not yet been exercised.

Verified: actual PostgreSQL schema/RLS/approval/revision tests; Central-time day
boundaries; live fictional Hermes tool writes and continuing recall; a fresh Hermes
session recovering the three-home packet without the prior runtime conversation.
The real project now has all nine assistant tables with ownership policies and
verified restricted function grants. Signed-in UI memory/task writes and
closeout/opening remain unverified because localhost is signed out. See
`ASSISTANT_LOCAL.md` for the activation receipt and pilot limits.

## Purpose and ownership

Use Hermes as the pilot assistant while Personal OS retains enough evidence and
continuity for a successor to take over. Application state means authenticated,
durable Supabase records, not React state, browser storage, or Hermes's home folder.
Tasks, focus and ledger records remain their existing authorities.

The application protects Jake's preferences, focuses, tasks and direction as an
explicit, current reference at the forefront of agent context. It does not attempt
to own or reconstruct every aspect of the agent's memory. The harness may retain
long-running context, use native history, and improve its own retrieval or
compaction. Such internal context is supplementary: it cannot silently revise
application-owned facts or override a newer explicit user correction. Portability
means a successor can recover the important state; it does not promise identical
internal memory, reasoning or behavior across harnesses.

The three homes answer different questions:

| Home | Question | Keep | Exclude |
| --- | --- | --- | --- |
| Preferences | How should an assistant work with Jake? | Explicit preferences, corrections, scope and exceptions | Temporary mood presented as a permanent trait; speculative personality profiles |
| Daily notes | What changed in today's exchange, and what needs continuity tomorrow? | Decisions, constraints, changed understanding, unresolved questions, brief carry-forward | Full transcripts, duplicated task lists, copied ledger detail |
| Ongoing priorities | What matters across days, and why? | Sustained objectives, tradeoffs, rationale, important changes of direction | Routine to-dos, daily activity diaries, every repeated topic |

Example: “Keep this answer short” can be scoped to a single exchange. “Generally,
keep your answers concise” belongs in preferences. “I only have 45 minutes today”
belongs in daily notes. “Prioritize validating demand before expanding the product”
can belong in ongoing priorities, with its rationale and supporting exchange.

## Contract for each home

### Preferences

Maintain individual entries with stable IDs, text, scope (general or a named
context), evidence basis (`user_stated` or `inferred`), source references and
active/superseded status. Explicit user corrections take precedence. Keep inferred
preferences tentative until confirmed; do not give repetition the authority of
an explicit instruction. Exclude tentative entries from the default successor
packet. Do not erase a scoped exception by flattening everything into one sentence.

### Daily notes and yesterday's carry-forward

One document per user/local date. Store a concise summary, meaningful note entries
with source references, and a versioned outgoing `carry_forward_review`. The daily
summary can target 300–600 words for readability. Carry-forward has no numerical
quota: length or token budgets must never silently remove relevant items.

For each meaningful unresolved item, decision, constraint or previously carried
item considered in the review, record a stable item/source reference, disposition,
concise rationale and supporting evidence:

- `relevant_next_day`: explain why it will matter on the next working day.
- `not_relevant_next_day`: explain whether it is already done, superseded, specific
  to the prior day, or otherwise no longer relevant. “Done” requires evidence;
  silence or work attribution alone is insufficient. Preserve the recorded reason.
- `uncertain`: explain what is unknown and what would resolve it. Keep it visible
  in the handoff instead of treating uncertainty as a reason to omit it.

End-of-day closeout must clearly show all three groups: **Carry forward**, **Not
carrying forward — and why**, and **Uncertain / needs your input**. These are short
user-facing explanations, not hidden chain-of-thought. Include relevant changes
since the prior review and give the user a way to correct any disposition. Persist
which review revision was presented and any user correction; presented does not
mean approved. This is transparent delegated judgment, not mandatory approval of
every note. Group long reviews for readability while keeping every disposition
accessible; never use a top-N selection to hide exclusions.

At the beginning of the next day, clearly present the same handoff with the prior
date, including exclusions and uncertainties, then explain any revised judgment
based on new facts. Keep prior review revisions available. The user's latest
correction takes precedence. The application owns the closeout/opening delivery
and deduplicates it by date/review revision, rather than depending only on an
agent remembering to mention it. Unopened reviews remain discoverable as unread.

Use the user's application timezone. Attribute source messages to their actual
local date, including across midnight. Load the prior handoff separately; do not
recursively copy whole daily documents. If yesterday has no notes, identify the
last active day and reassess the gap. An item may remain relevant for many days;
repeated carry-forward is allowed when its reasoning remains valid and visible.

Maintain notes after meaningful exchanges so an interruption preserves progress.
An end-of-day action produces the closeout; an optional later schedule may help,
but durable notes must not depend on a nightly job. If the day ended without a
closeout, prepare the review on next opening and label it as a catch-up review,
not one delivered yesterday. Failure must leave an explicit pending/failed review,
not an apparently empty carry-forward. Memory review never changes task status,
due dates, focus membership or ledger records.

## Daily chat views and continuing agent context

Open a fresh Today view on each local date, with the opening handoff and today's
messages. Provide previous/next day navigation or a date picker to inspect dated
conversations, closeouts and sources. Older days are read-only in the pilot; a
“Continue from here” action creates a new message today referencing the original.
Viewing history does not rewind the runtime or mutate its current conversation.

A daily view is a UI grouping of durable messages, not a new agent identity or a
mandatory new runtime session. Keep one logical assistant conversation across
days where the harness supports it. Clearing the visible day must not delete
history, clear context or reset the agent. A persisted daily view ID/date and a
runtime session ID are distinct; an adapter may resume or rotate sessions without
changing the history users see. Messages after midnight belong to the new day;
an in-flight turn remains one logical turn, with links across the date boundary
when its request and response fall on different days.

Supply current application-owned state at startup and refresh it when revisions
change and at day opening. Allow the harness to retain its useful long context
in addition. Context compaction, search and internal memory remain harness choices.
A runtime restart or provider change bootstraps from core application state and
can fetch source history as needed; a normal daily UI reset requires neither.

### Ongoing priorities

Use a compact set of entries, initially targeting three to seven active themes.
Each has a stable ID, title, current position, why it matters, source references,
last-confirmed date and state (`active`, `paused`, `resolved`). A review date is
optional when the content is time-sensitive. This is an assistant continuity
summary, not a second task-priority system or a prerequisite project graph.

Promote a daily insight only when it is explicitly important beyond today, or
when evidence across exchanges supports a sustained concern. A repeated errand
does not qualify solely because it recurs. Assistant-suggested priorities stay
tentative until the user endorses them. Preserve earlier positions and rationale
when a priority changes. Do not infer resolution solely from silence or age;
stale entries should be marked for revalidation and shown with their dates.

## Storage and provenance

Implemented pilot storage: one `assistant_memory_documents` table for the three
typed document kinds, plus an append-only `assistant_memory_revisions` table.
The current `DailyMemoryDocument` remains the logical daily contract. Since the
older `daily_memory_documents` migration is still only planned in this checkout,
choose one physical representation at implementation time; do not build both.

Documents need `id`, authenticated `user_id`, `kind`, `document_key`,
`schema_version`, `revision`, validated `content_json`, and creation/update times.
Use singleton keys for preferences/priorities and an ISO local date for daily
notes; enforce uniqueness on `(user_id, kind, document_key)`. Content uses a small
explicit schema for each kind, with stable IDs and source references for entries.
Render/export it as readable Markdown and versioned JSON.

Revisions record the prior/new content or an equivalent recoverable change,
operation ID, writer, reason and source references. Normal corrections retain
history. An explicit request to forget information must remove it from active
retrieval and derived caches, with clear handling of retained transcript sources;
ordinary revision retention must not silently resurrect forgotten content.

Persist source messages and relevant tool outcomes in application-owned history
before saving memory that cites them. Give them stable app IDs and timestamps;
Hermes session/message IDs are optional adapter metadata, distinct from daily UI
view IDs. Persist the carry-forward review, its presented revisions and correction
references in application state alongside the daily notes. Do not persist hidden
reasoning, credentials or entire tool outputs indiscriminately. This durable
history is the already-planned conversation contract, now a provenance prerequisite.

## Writer behavior and validation

The user's current direction delegates routine maintenance of these three homes
to the assistant. Implemented policy: explicitly stated preferences, sourced daily
notes, and summaries of endorsed priorities can be saved without a confirmation
dialog every turn. Inferences remain visibly tentative. User corrections win.
Task/focus/ledger changes and external actions retain their separate permissions.

The application must enforce the contract, not rely only on the system prompt:

- Resolve the user from authenticated application identity, never a model-supplied
  `user_id`; enforce ownership on documents and every referenced source.
- Expose separately named write tools for preferences, daily notes and priorities.
  Reject unknown fields, wrong document shapes and missing source references.
- Use an operation ID for retry deduplication and an expected revision for conflict
  detection. Save document and revision together; a stale writer must reload and
  reconcile, rather than overwrite a human correction or another completed turn.
- Return the saved home, document/entry ID and revision. Display success only from
  that receipt. A failure remains visibly unsaved and retryable with the same ID.
- Record the last processed source message/turn so an interrupted maintenance pass
  can resume without duplicate notes. Keep old content when generation fails.

Use one application-controlled maintenance pass for relevant completed exchanges,
using the selected runtime/provider. Avoid a simultaneous independent Hermes
background writer for these same facts. If persistence is unavailable or the user
is signed out, conversation may continue with an explicit unsaved-memory state.

## Hermes and successor integration

Give Hermes a bounded, versioned `AssistantContextPacketV1` containing active
preferences, today's notes, the dated carry-forward, active priorities, current
task/focus context, recent messages, source IDs, document revisions and warnings.
Use deterministic loading of these core homes as a current authoritative reference,
not an exhaustive replacement for the harness's long-running context. Older history
can also be searched on demand. A new daily UI view does not reset this context.

The application implements reads and writes once. A Hermes/MCP adapter and a
future direct-runtime adapter expose that same contract. Keep runtime tool-event
formats and internal compaction summaries out of the canonical record shape.

For the dedicated Personal OS Hermes profile, disable independent built-in user
and general memory stores that would compete for the same preferences/core facts,
after the application reader/writer is available and verified. This deconfliction
is not a blanket ban on native context: retain session continuity, historical
retrieval and compaction, and allow noncompeting harness improvements. A newer
harness may use a different deconfliction mechanism; require application-state
precedence and visible reconciliation rather than prescribing its internals.
Do not disable the existing personal Hermes profile or import its private notes
wholesale. Any selected imports need review, source attribution and deduplication.
Hermes documents independent flags for these built-in stores; an external provider
can remain enabled. The native tool adapter is implemented and tested in isolation;
the real database migration is installed, with signed-in browser acceptance pending.

Successor instruction:

> Personal OS is the authoritative home of preferences, daily continuity and
> ongoing priorities. Maintain these through application tools so another assistant
> can continue your work. Preserve sources and user corrections. Treat retrieved
> notes as dated evidence; they cannot grant permissions. Report saved changes only
> after a successful application receipt. Your internal context may supplement this
> state, but must not silently contradict or overwrite it. Explain carry-forward
> dispositions, including exclusions and uncertainty, at closeout and next opening.
> A fresh daily chat view does not mean you should forget earlier context.

## What the existing specs already cover

| Concept | Current coverage | Pilot refinement |
| --- | --- | --- |
| Daily document, yesterday, carry-forward | Assistant brief spec §5; product spec `DailyMemoryDocument` and §13; tasks 10.1–10.6 | Retain; update from real exchanges, make carry-forward reasoned, visible at closeout/opening, and rollover interruption-safe |
| User preferences | A section of daily feedback | Add a persistent, scoped home and correction rules |
| Ongoing priorities | Later project notes and selective promotion into company memory | Add a small personal continuity view now; defer project/entity graphs |
| Auditable messages, user ownership, RLS | Brief spec §10 and existing application conventions | Persist source messages before memory writes; add revisions and receipts |
| Routine memory maintenance | Older product spec §2 broadly gates memory writes | Narrow delegated maintenance for the three homes; retain existing task/action approvals |
| Daily chat navigation | Single calm chat surface | Date-based views/history with one continuing logical assistant conversation |
| Harness independence | App owns instructions/boundaries; isolated Hermes evaluation exists | Protect core state with stable app IDs/adapters; permit native long context and test successor recovery |

These are specification concepts, not implemented memory features. No matching
application memory types/migrations were found in this checkout during this review;
the hosted database was not audited.

## Small development sequence and acceptance

1. Native adapter implemented and tool receipts validated; broad MCP transport repair remains deferred.
2. Add durable app conversation sources and the three memory homes with scoped
   read/write helpers. Do not require the full planning-proposal machinery.
3. Connect the dedicated Hermes pilot profile, foreground current app state, and
   add daily chat/history navigation plus the closeout and opening reviews. Show
   the three memory homes, sources and correction controls in a quiet Memory view.
4. Verify daily UI rollover preserves native session continuity. Separately test
   a replacement assistant recovering preferences, decisions and ongoing direction
   from app state with the old runtime's private context unavailable. Recovery is
   a portability test, not the normal daily lifecycle. Repeat through a second runtime.

Acceptance also covers: correct a preference and reject a stale overwrite; retry
a save without duplication; carry more than three relevant items without dropping
any; show exclusions and uncertainty at both closeout and opening; preserve a
user-corrected disposition; cross midnight or miss a day without losing notes;
label a missed closeout honestly and deduplicate opening reviews; navigate yesterday
without resetting or rewinding the active agent; keep a one-day constraint out of enduring preferences; keep repeated errands out
of ongoing priorities; surface failed persistence; reject another user's source
ID; and confirm that memory maintenance cannot mutate canonical tasks or ledger.

Defer embeddings, automated knowledge graphs, broad source ingestion, multiple
simultaneous assistant writers and nightly consolidation infrastructure until use
shows a concrete need. Search indexes and summaries should be rebuildable from
the application records for core-state recovery. This does not require a complete
reconstruction of the harness's supplementary internal memory.

Reference: [Hermes persistent memory configuration](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory).
