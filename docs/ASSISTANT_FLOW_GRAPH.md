# Personal Assistant conversation graph

This is the implemented control-flow contract for the local Personal OS
assistant. LangGraph coordinates durable conversation phases; it does not replace
Hermes, Supabase application memory, canonical tasks, or reviewed writes.

## Design boundary

The graph is intentionally coarse. A normal user message usually crosses three
application nodes:

```text
dispatch -> Hermes agent -> wait for user
```

A button-triggered morning opening is deterministic and crosses:

```text
dispatch -> select first question -> wait for user
```

An intermediate answer crosses:

```text
dispatch -> record answer / select next question -> Hermes bridge -> append canonical question -> wait for user
```

The final morning answer crosses one additional meaningful durability boundary:

```text
dispatch -> record final answer -> Hermes synthesis -> wait for user
```

Hermes's internal reasoning and tool loop remain intact inside one graph node.
Personal OS does not split that runtime into artificial planning/tool/token nodes.
The graph emits the first question directly for the explicit UI control. For later
questions, Hermes authors only the declarative conversational bridge responding
to the user's answer. A thin output harness removes accidental interrogative
sentences and appends the one canonical next question as the final paragraph.

## Daily flow

Each authenticated user and Central local date has one checkpoint thread:

```text
personal-os:<user-id>:<YYYY-MM-DD>
```

The graph begins in `idle` and waits for a normal application turn.

```text
background catch-up ───────────────────────────────┐
                                                   │ phase is preserved
idle                                               ▼
  ├─ explicit "Let's begin" button ──> deterministic question 1
  │                                    └─ awaiting_available_time
  ├─ clear, standalone affirmation ───> deterministic question 1
  │                                    └─ awaiting_available_time
  ├─ message containing instructions ─> Hermes normal agent
  │                                    └─ addresses instructions first
  ├─ ordinary request ─────────────────> Hermes normal agent
  │                                      └─ offers morning opening
  └─ decline ──────────────────────────> deferred

awaiting_available_time
  ├─ answer ─> checkpoint answer ─> Hermes response ─> awaiting_brain_dump
  └─ pause/decline ────────────────────> paused

awaiting_brain_dump
  ├─ answer ─> checkpoint answer ─> Hermes response ─> awaiting_company_move
  └─ pause/decline ────────────────────> paused

awaiting_company_move
  ├─ answer ─> synthesizing ─> Hermes synthesis/documentation ─> complete
  └─ pause/decline ────────────────────────────────────────────> paused

paused
  └─ continue ─────────────────────────> saved awaiting_* phase

complete/deferred
  └─ ordinary messages ────────────────> Hermes normal agent
```

A failed automatic catch-up is background maintenance, not a failed user
exchange. It remains auditable and retryable inside the collapsed carryover
disclosure, but it cannot suppress the morning opening or prevent a new
foreground turn. Starting foreground work supersedes only the pending background
graph node; the failed database turn remains as an honest audit record.

The three application-owned questions are:

1. How much time is available, including away-from-desk obligations?
2. What is on the user's mind, without premature prioritization?
3. What action or outcome would move the company forward the most?

For each intermediate transition, the graph first checkpoints the answer and
identifies exactly one required next question. Hermes receives the current user
turn and current Personal OS context and responds to the substance of that answer
without asking a question. The harness removes any accidental question sentence
and appends the canonical question once. Intermediate turns deliberately defer
task proposals and end-of-ritual documentation.

The final answer is checkpointed in `synthesizing` before Hermes runs. Only then
does the synthesis step receive all three answers with their canonical
source-message IDs, current Personal OS context, unresolved carryover, tasks,
priorities and pending decisions.

Final synthesis has one additional application capability: it can replace
Today’s Focus with an exact ordered list of existing unfinished tasks. The write
is bound to the active leased turn, persisted user-message sources and an
idempotent receipt. Life obligations, work explicitly deferred beyond today and
unapproved new-task proposals are excluded. Ordinary messages and intermediate
morning transitions cannot invoke this operation. Creating or changing a task
still requires a visible task proposal and user approval; accepting that proposal
does not itself schedule the task for today.

## Morning task-library hygiene

Before the final synthesis agent call, the application scans the full non-archived
task library and joins actual last work-attribution times (excluding deleted work).
This is context retrieval, not another graph node or morning question. It supplies
at most three oldest candidates: completed history after seven quiet days, and
unfinished work after thirty days without creation, edits or recorded use. Current
focus, pending changes, live prerequisites/parents and unchanged rejected archive
suggestions are excluded. The recent sixty-task context window cannot hide the
older library from this scan. Query failures are explicit and do not block planning.

Hermes evaluates candidates against the morning answers and current commitments.
It may propose archival through the existing reviewed task tools, or retain an
uncertain item. Age is never a completion/irrelevance judgment. Canonical tasks
change only after Accept; archival preserves attribution and revision history.

## Persistence and recovery

`assistant_langgraph` is a private Postgres schema managed by LangGraph's official
Postgres checkpointer. Browser database roles have no schema access. Checkpoints
use synchronous durability at the coarse node boundaries above.

If the browser reloads or the native app closes while waiting for input, the
current question and collected answers remain in the checkpoint. If a Hermes node
is stopped or fails, the graph remains positioned before that coarse node. The
existing saved-exchange control invokes the same application turn ID and resumes
the node. Already completed graph nodes are not repeated.

Switching between Personal OS surfaces is not a stop signal. The originating
request remains alive after the Assistant view unmounts, and a newly mounted
Assistant view recognizes a fresh server-side `running` turn, polls its durable
state, and displays the saved reply when it completes. Only the explicit Stop
control aborts a foreground in-page request. On state reads, the server reconciles
expired leases and orphaned `running` rows into honest failed turns, preserving
messages, checkpoints, proposals and receipts. Live turns (including carryover)
are polled until settled; only the latest foreground exchange offers recovery.
Rejected requests that were never persisted offer Retry, not Resume/Steer.

Carryover cannot hold the foreground conversation hostage. A foreground request
cancels and awaits any local carryover worker before entering the shared Hermes
profile. The database also allows foreground takeover of a carryover lease left
by a server restart, fencing late writes from the old worker. A live foreground
lease still rejects competing work. Carryover uses no foreground busy/retry state.

“Steer instead” records a new sourced user message, retains the stopped request in
graph state, adds the new direction, and restarts only the pending Hermes node.
Hermes receives the original request, the steering direction, current application
state and existing tool receipts. The stopped turn remains an honest failed audit
record; the successful steering turn becomes the visible response anchor.

The graph records the last successfully processed turn ID and response. If graph
execution completed but the final application response write was interrupted, a
retry returns the checkpointed response rather than invoking Hermes again.

Side effects remain protected by existing application leases, expected revisions,
stable operation IDs and reviewed proposal contracts. A graph checkpoint is not
proof that a task or memory write succeeded; tool receipts remain authoritative.

## Authority boundaries

LangGraph owns:

- Current daily initialization phase.
- Collected morning answers needed to continue the flow.
- The next executable graph node.
- Recovery of a stopped coarse node.
- The last graph response for idempotent response recovery.

Supabase Personal OS records own:

- Visible user and assistant messages.
- Sourced memory documents and append-only revisions.
- Daily carryover reviews and presentation receipts.
- Task proposals, approval, canonical tasks and task revisions.
- Work, reward, behavior and ledger data.

Hermes owns:

- Normal conversational reasoning.
- The substantive response between each morning question.
- Final morning-plan synthesis.
- Use of the fixed Personal OS read/write tool contract.
- Its private native conversational context and compaction.

The UI reads only a small projection of graph state: phase, which questions have
answers, and completion time. Background catch-up messages are removed from the
main conversational stream; their structured review remains available behind the
collapsed carryover disclosure.

## Deliberate limits

- The graph does not checkpoint individual model tokens or hidden reasoning.
- Stopping during a Hermes call restarts that Hermes node from its saved inputs.
- Steering restarts the coarse Hermes node. It does not resume or expose hidden
  token-level reasoning from the cancelled model call.
- Intent detection for starting, pausing or declining the morning opening is
  deliberately narrow and high-confidence. Other messages go to Hermes normally.
- During morning transitions, the harness enforces only the canonical final
  question. The prompt asks Hermes for a declarative bridge, and the graph removes
  accidental interrogative sentences before appending that question. It does not
  otherwise template Hermes's conversational response.
- LangGraph Store and LangSmith are not used. Personal OS does not maintain a
  second knowledge-memory system inside LangGraph.
