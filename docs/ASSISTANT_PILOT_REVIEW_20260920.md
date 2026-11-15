# Assistant pilot review — 2026-09-20

## Scope and evidence

Read-only inspection of the signed-in local assistant, persisted Supabase messages,
turns, memory documents/revisions, tool receipts, proposals and resulting tasks.
No user tasks or memory were changed by this audit.

Planning turn: `7dd88358-84de-4620-a6bf-93fa66b5e15e`.
User source: `34e0d02d-72cd-4017-bd8a-ec31fd2f657a`.
Assistant reply: `b9c7ca90-4120-4a4b-98ad-66f26ce7f418`.
The turn completed successfully; source-to-reply elapsed time was approximately
174 seconds. This is one observed turn, not a latency benchmark.

## What worked

- Ongoing priorities revision 1 preserved the business rationale: deliver the
  Historic Old Town NIA report, convert the 9th & Washburn work into a case study,
  and support the sales and marketing motion through consistent outreach.
- Daily notes revision 1 retained the sequence and all three quantities: five
  follow-ups, five new emails, and five LinkedIn outreaches. It marked the plan
  relevant for the next day, with rationale and the actual user source ID.
- No enduring preference was invented from this planning request. The preferences
  home is empty; the other two homes have one sourced entry each.
- Five write/proposal receipts establish actual application-tool use: one
  priorities save, one daily save, and three task proposals. Read calls are not
  represented by these receipts; their absence is not evidence of no context read.
- All three proposals were subsequently accepted and became canonical open tasks:
  report (high priority), case study (medium), daily outreach (medium). The
  assistant correctly described them as proposals awaiting approval in its reply.
- No invented delivery date was persisted. Tasks have no due date, and the report
  note explicitly says the user did not specify one.

## Gaps exposed by real use

1. **Cadence drift:** the user said “each day of the week”; the reply, daily memory
   and outreach task narrowed this to workdays without confirmation. Clarify
   weekday versus seven-day intent before treating that interpretation as settled.
2. **Dependencies are prose only:** the case-study note says it follows report
   delivery, but each new task has an empty `agent_payload_json`. There is no
   machine-readable prerequisite. The current proposal tool cannot write it.
3. **Recurring work is one ordinary task:** the outreach target has no recurrence
   or per-day completion accounting. Finishing this task once would not prove the
   daily commitment fulfilled for future days.
4. **Descriptions use the progress-note field:** useful task text was saved as
   `human_summary`; canonical `description` remains null. The new card presents
   that note as its main body, without silently migrating stored task content.
5. **The weekly schedule is a suggestion:** the assistant allocated Monday–Friday
   and proposed Tuesday report delivery without checking capacity/deadline. Those
   dates were not written to tasks, but the response should label them tentative.
6. **Daily continuity is not yet proven with these real notes:** the preceding
   closeout was stopped and has no published review. Stored daily notes survived;
   that is not proof of a completed closeout/opening cycle. Code supplies memory
   to later turns, and earlier synthetic recall tests passed; a subsequent real
   turn using this plan has not yet been evaluated.

The pilot performs real, sourced memory writes and reviewed task creation. It is
useful for planning now, but the above gaps limit execution tracking and continuity.

## UI delivered in this window

Each proposal has its own compact card: one title, semantic priority chip,
description first, prerequisites second. Existing recorded dependencies are shown;
none are invented from prose. Prior values and rationale remain inspectable.
Pending cards start expanded. Successful resolution remounts the card collapsed;
accepted cards say “Task change accepted” and can be reopened with the arrow.
Failed resolution leaves the pending review available. Rejected cards are labeled
distinctly. No task mutation or approval boundary changed.

Verified with TypeScript/lint, 19 assistant tests, and signed-in desktop/390px
browser inspection of actual accepted cards and expansion. No new live task was
created merely to test the visual transition.

## Next bounded development window

- Clarify outreach cadence, then record the correction through the normal sourced
  memory/proposal path; do not silently repair user state during an audit.
- Extend reviewed task proposals to canonical descriptions and structured
  prerequisites, including validation and approval-time conflict checks. Decide
  prerequisite identity/semantics before extending the write contract.
- Test a real second turn recalling the plan, correcting one fact and reporting
  progress; verify exactly the intended memory/task revisions.
- Complete one closeout/opening cycle with visible carry-forward reasoning.
- Define the smallest daily outreach completion representation from use before
  introducing a general recurring-task engine.
