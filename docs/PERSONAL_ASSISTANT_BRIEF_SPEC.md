# Personal Assistant and Morning Brief Specification

Status: Evolving product vision; Hermes daily-planning pilot implemented, activation pending
Date: 2026-09-01; immediate direction revised 2026-09-10
Scope: personal assistant, daily planning, continuity memory, morning brief, and research delivery

## 1. Product Intent

Build a personal assistant that makes starting the day feel clear, informed, and
pleasant. It lives in one calm chat surface inside the Personal OS. The assistant
helps the user talk through priorities, remembers the immediate working context,
forms a realistic daily plan, and delivers a prepared morning brief.

The experience should feel like sitting down with coffee to get oriented, not
opening a noisy dashboard or managing a generic backlog.

```txt
task/work history + recent conversation + daily memory
  -> assistant reasoning
  -> visible daily-plan proposals
  -> user approval
  -> canonical tasks and today's focus

research worker + reusable research artifacts
  -> prepared morning brief
  -> assistant chat delivery
```

The research worker is a separate internal role, not a second user-facing chat.
The personal assistant remains the single voice and the single place where the
user reads, discusses, and acts on the briefing.

## 2. Core User Outcomes

The user can:

1. Talk to the assistant about current priorities and changing constraints.
2. Have the assistant use today’s conversation plus yesterday’s outcomes and
   carry-forward context without replaying an unbounded lifetime transcript.
3. Receive a reasoned recommendation for today’s focus.
4. See when yesterday’s neglected, deferred, stale, or deadline-sensitive work
   should be confronted.
5. See when the proposed day exceeds realistic capacity, and choose what to
   defer deliberately.
6. Review and approve a task list that the assistant has assembled for today.
7. Find a greeting and prepared brief waiting in the same chat surface each
   morning.
8. Receive an SMS notification that the briefing is ready.

## 3. Trust and Write Boundaries

The established trust model remains in force:

```txt
Read structured context freely -> propose visibly -> write only with user approval
```

The assistant may recommend task creation, prioritization, carry-forward,
deferral, reordering, or archival. It must present these as a durable proposal
batch with clear reasons and a single review/apply step. Applied changes must
update canonical task state, daily focus state, and task revisions
transactionally.

An explicit user command may make a narrow direct write where the intent is
unambiguous, such as “add this paper to my briefing queue.” The assistant must
not silently add research-derived items to the task list.

## 4. Assistant Architecture and AI Runtime

The selected runtime is a dedicated local Hermes profile using the existing
ChatGPT Codex subscription. `ASSISTANT_LOCAL.md` records the current code,
activation steps and verification limits. The signed-in browser and real database
migration must be verified before calling the new planning layer live.

```txt
Authenticated local Next.js chat -> Hermes native loop with fixed app tools
  -> application-owned messages, three memory homes and revision receipts
  -> visible task proposal -> explicit Apply -> atomic task write/revision
Current Supabase tasks/focus + core memory supplement continuing native context
```

The application derives ownership from Supabase authentication and loads current
state server-side. Hermes's dedicated profile retains session history and
compaction across daily UI views; its competing user/general memory is disabled.
Its native session search is limited to that profile. The ordinary Hermes profile
is unchanged. The adapter uses the native tool registry rather than the known
broken stdio MCP path; general MCP support remains an independent follow-up.

The runtime has no API-billed fallback, shell, arbitrary file access, messaging,
ledger writes, or task-approval tool. Typed task creation/status/priority/progress
proposals now have a separate authenticated Apply transaction. Daily-focus edits,
full proposal batches, research, scheduling and public hosting remain deferred.
Use the Mac first; any future Droplet release needs its own operational acceptance.

## 5. Assistant Conversation and Memory

Pilot refinement (2026-09-12): the user selected Hermes for the pilot and three
application-owned homes: preferences, daily exchanges with reasoned carry-forward,
and ongoing priorities distilled across days. `ASSISTANT_MEMORY_PILOT.md` defines
their implemented pilot contracts, maintenance permissions and successor context.
Daily continuity below remains applicable; the new preference and priority homes
extend it. These contracts are not yet implemented. Routine maintenance of these
homes is a narrow delegated capability to implement separately from task writes.

### Conversation behavior

The assistant chat supports normal planning discussion: priorities, tradeoffs,
new work, blockers, deadlines, and reflections on what did or did not happen.
It should use plain language and explain recommendations with evidence from the
user’s own work state.

It is not an autonomous operator. It should not make external communications,
calendar changes, task mutations, or other durable changes without the
appropriate explicit approval.

### Daily chat and continuing context

Each local day opens a fresh chat view, with dated history navigation back to
prior exchanges. This is a presentation reset, not deletion of history or a new
agent instance. Preserve the logical conversation and useful runtime context
across days where supported. Daily UI IDs and runtime session IDs are distinct.
Opening history is read-only; continuing an older exchange creates a message
today with a link to its source. A day boundary does not discard an in-flight turn.

### Core application context

Provide the following current application reference to the agent, alongside any
useful context and memory retained by its harness:

- active user preferences and ongoing priorities, including rationale and revisions;
- today’s recent messages and today’s daily memory document;
- the prior day's carry-forward review, including exclusions and uncertainty;
- the current planning context packet: today/yesterday focus, carryover,
  completions, work attribution, deadline pressure, backlog pressure, and
  repeated-deferral flags.

Durable dated message history remains available for user review and source
retrieval. The app supplies core state at the forefront; the harness may maintain
long-running context, retrieve older material and improve its internal memory.
Application state owns Jake's preferences, focuses, tasks and direction without
attempting to replace all native context handling. Disable competing Hermes
preference/general-memory stores for the dedicated profile once app tools work,
while preserving native conversation continuity, search and compaction.

### Daily memory document

Maintain one editable document per user and date with these sections:

- Starting context
- Planned focus
- Notable changes and decisions
- Work completed or advanced
- Deferred, blocked, or avoided work
- User preferences and feedback
- Carry forward to tomorrow

Planning finalization updates the plan sections. Work-block attribution updates
the work record. An end-of-day consolidation produces the final summary and the
next day's carry-forward review. Notes also persist incrementally during the day.

Carry-forward has no fixed item quota. Classify the meaningful candidates as
relevant tomorrow, not relevant tomorrow (with a reason such as completed or
superseded), or uncertain. Never silently omit an item due to count, age or
uncertainty; completion requires evidence. Show the dispositions and short reasons
clearly at end-of-day closeout and again at next opening. Let the user correct
them, preserve review revisions, and explain changes at the next review. A viewed
review is not automatically approved. If closeout was missed, prepare a labeled
catch-up review on next opening. Uncertain items stay visible; repeated carry is
permitted when still relevant. None of these dispositions changes canonical tasks.

## 6. Daily Planning and Capacity Reasoning

### Inputs

The assistant’s daily plan should be grounded in structured records, in this
order:

1. Today’s focus list
2. Yesterday’s focus list and outcomes
3. Unresolved carryover
4. Recent work-block attributions and completed tasks
5. Deadline and backlog pressure
6. Repeated deferrals, stale high-priority work, and explicit user concerns
7. The user’s stated availability for today, when supplied

### Capacity check

The assistant estimates whether the day is overloaded by comparing:

- estimated remaining work blocks on candidate tasks;
- recent actual completed work blocks on comparable days;
- today’s stated available time; and
- fixed near-term deadlines or commitments represented in the task system.

The estimate must be framed as a helpful warning, not false precision. When
planned demand materially exceeds capacity, it should suggest a small primary
focus, secondary work, and intentional deferrals. It should show why each item
is included or excluded.

### Neglected-work rule

Repeatedly deferred, stale, or important tasks should trigger an explicit
disposition recommendation:

- do it today;
- split it into a smaller next action;
- mark it blocked with a reason;
- schedule it later with a reason;
- lower its priority; or
- archive it.

The assistant must not repeatedly carry an item forward without making the
tradeoff visible.

## 7. Morning Brief Experience

### Delivery

At 7:00 AM in the user’s configured timezone, the system creates an assistant
greeting and publishes the prepared brief in the chat surface. If the user opens
the app later, the message is waiting as an unread morning greeting.

The system also sends a concise SMS notification, for example: “Your Personal OS
morning brief is ready.” The text should link to the authenticated app but should
not contain sensitive task, company, or research content.

SMS is an explicit product requirement. Provider selection, consent capture,
phone-number verification, delivery costs, and opt-out handling remain an
implementation decision. The notification layer must support:

- explicit opt-in and phone-number verification;
- timezone and enabled/disabled preferences;
- pause/mute controls and an unsubscribe path;
- delivery attempts and failures recorded without storing provider secrets in
  user-visible data; and
- graceful fallback to the in-app unread greeting.

### Editorial sections

Each full morning edition has four sections:

1. **Road safety and transportation signals** — meaningful policy, city,
   procurement, technology, safety, and market developments.
2. **Competition watch** — material company developments, not a comprehensive
   daily digest of every competitor.
3. **Interest piece** — one enjoyable, longer deep dive drawn from a real,
   cited story. It may be adjacent to the user’s work rather than directly about
   road safety.
4. **Paper deep dive** — a readable explanation of a paper from the user’s
   paper queue, with the parts most relevant to the user’s work called out.

Each factual item must retain its sources, source publication date, discovery
time, relevance explanation, confidence, and first-seen date. A brief cannot
present unsourced factual claims as established news.

### Geographic lens

The default research geography is North America, with elevated relevance for
Kansas City and its surrounding regional transportation, safety, policy, and
procurement context. The system should favor local material when it is meaningful
without making the entire edition parochial.

## 8. Competition Watchlist

The watchlist has two levels so research effort tracks strategic value.

### Close watch

These organizations receive deeper, more frequent scrutiny for material product,
customer, partnership, funding, regulatory, and market-positioning developments:

- Rekor
- Miovision
- GoodVision
- Hayden AI

### General watch

These organizations and their direct category competitors receive only major,
relevant updates:

- StreetLight Safety (the exact organization and canonical source URLs must be
  confirmed during watchlist setup)
- Immediate competitors of the close-watch and general-watch companies, once
  explicitly classified in the watchlist registry

The registry must store canonical name, aliases, category, watch level,
geographic relevance, approved source domains, and an active/inactive state.
It must not expand into an uncontrolled directory of every company in a broad
industry.

Preferred evidence includes company newsrooms, public filings, customer or agency
announcements, procurement records, and reputable reporting. The assistant should
distinguish confirmed facts from inference and explain why a development matters.

## 9. Research Library and Unread Buffer

### Paper queue

The paper queue lets the user add a URL, DOI, title, or document plus an optional
note about why it matters. Each item has a status such as queued, researching,
briefed, saved for later, or skipped. The assistant selects a queued paper for a
deep dive based on user priority and relevance; it may recommend, but not silently
add, new papers.

### Reusable research artifacts

Long-form interest pieces and paper summaries are stored as reusable briefing
artifacts, separate from a particular day’s edition. Keep a small prepared buffer
of roughly two strong long-form artifacts whenever possible. This avoids
regenerating expensive editorial work simply because a daily edition goes unread.

### Unread behavior

An unread newsletter should be carried forward thoughtfully:

1. Do not regenerate its long-form interest piece or paper deep dive.
2. Keep those artifacts pending until a brief containing them is viewed or they
   are deliberately replaced.
3. Collect genuinely time-sensitive, high-importance developments in an
   **In case you missed it** section, labeled with the date on which each fact
   first appeared.
4. Keep ordinary, non-urgent news from crowding future editions just because one
   edition was missed.
5. When the user opens a brief, record `opened_at`, acknowledge its pending
   artifacts, and clear the in-case-you-missed-it buffer that the view resolved.

The user should never need to read several duplicated newsletters to catch up.

## 10. Data Contracts

The exact names may evolve, but implementation should introduce typed,
user-scoped records for the following concepts:

| Concept | Purpose |
| --- | --- |
| Assistant thread and messages | Durable dated chat history; daily UI views remain independent of continuing runtime context. |
| Carry-forward reviews | Reasoned dispositions, evidence, revisions, user corrections and closeout/opening presentation state. |
| Planning sessions and proposal batches | Explain how a day’s focus was formed and enforce approval before task writes. |
| Daily memory documents | Compact daily continuity and carry-forward context. |
| Daily briefs | Structured edition, section payloads, sources, `opened_at`, and generation status. |
| Research artifacts | Reusable long-form, paper, signal, and competition material. |
| Paper queue | User-curated papers and their briefing state. |
| Competitor/source registry | Curated entity identities, watch level, aliases, and approved sources. |
| Brief-item exposures | First-seen date, edition presentation, acknowledgement, and rollover state. |
| Notification preferences/deliveries | SMS opt-in, timezone, delivery attempts, and failures. |
| Generation runs | Idempotency, source/research failures, and operational traceability. |

All records must use the existing authenticated user scope and row-level security.
Secrets for AI, search, SMS, or source providers belong only in server-side secret
storage.

## 11. Scheduled Workflow

Research work should be prepared before the user’s morning ritual, then published
at 7:00 AM. The workflow is:

1. A pre-generation run collects new candidate signals, refreshes the research
   buffer, and selects or preserves pending long-form and paper artifacts.
2. The run validates source requirements, removes duplicates, applies relevance
   scoring, and saves a structured draft edition.
3. The 7:00 AM publish run atomically makes the edition available, creates the
   assistant greeting, and requests the SMS notification.
4. A view of the edition records `opened_at` and resolves eligible unread-buffer
   items.
5. Failures are visible in a run log. A partial brief may publish with a concise
   unavailable-section notice; a failed research source must not prevent the
   planning assistant from working.

Every run is idempotent per user/date/edition type so retries do not create
duplicate briefs, greetings, texts, or buffer entries. The job must use the
configured local timezone correctly across daylight-saving changes.

Scheduling is deferred. If the Codex runtime moves to a Droplet, use one
Droplet timer to own the scheduled workflow; Supabase remains durable storage.
Do not introduce an overlapping Supabase schedule for the same job.

## 12. Implementation Sequence

1. **Working local conversation** — Codex Business authentication, a small chat,
   saved recent conversation and optional existing task context. No new database
   model is a prerequisite.
2. **Lived-use feedback** — use morning planning, changing priorities and reflection
   to discover what the assistant actually needs. Fix the smallest observed gaps.
3. **Daily-planning pilot** — implemented three-home continuity, daily history and
   task create/status/priority/progress proposals with transactional approval.
   Real Supabase activation is pending; daily-focus mutation remains deferred.
4. **Continuity and availability** — improve memory and add Droplet hosting when
   local/browser limitations are materially getting in the way.
5. **Proactive briefing** — add scheduled greeting/internal brief, then selective
   research, paper queues and SMS as independently useful improvements.

The broader data contracts and behavior described above remain a vision, not
prerequisites or a commitment to implement every table before using the assistant.

## 13. Definition of a Useful First Release

The first experiment is useful when the user can open the assistant, talk through
real priorities using their Codex subscription, change direction in a follow-up,
and return to the saved conversation. Context gaps must be visible. No task
changes occur during this read-only stage.

The current next milestone is signed-in use of the implemented memory and task
proposal layer. A later milestone may add reviewed daily-focus changes. The
full morning ritual with research and SMS remains a later product outcome.

## 14. Non-Goals and Deferred Decisions

Do not add autonomous task mutation, autonomous external action, a broad company
database, unrestricted web ingestion, or a user-visible multi-agent control room
in this work.

The following require a separate implementation decision:

- SMS provider and cost model
- exact default daily capacity and work-block assumptions
- canonical source domains and aliases for each watchlist organization
- paper file-storage and full-text extraction policy
- whether the assistant should ever notify through additional channels such as
  browser push or email
