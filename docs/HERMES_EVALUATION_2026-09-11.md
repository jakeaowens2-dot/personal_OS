# Hermes local evaluation — 2026-09-11

## Result

Hermes is a credible runtime candidate for Personal OS. Real Codex-authenticated
turns, local-file reading, persistent memory, and cross-session retrieval worked.
The installed build's stdio MCP path failed; an evaluation-only correction made
the MCP call work. Do not describe the unmodified installation as fully passing.

## Setup

- Installed Hermes 0.20.5 (2026.8.19), commit `52bcfb47`, at
  `/Users/jakeaowens/.hermes/hermes-agent`.
- Separate `HERMES_HOME` at `/private/tmp/personal-os-hermes-eval-20260911/profile`.
- Existing Codex login imported using Hermes's credential helper into that private
  test home. The temporary credential copy was removed after verification.
- Provider `openai-codex`, model `gpt-5.6-terra`, low reasoning, Hermes's own loop
  (`codex_responses`), not its optional Codex App Server runtime.
- No API keys, Nous credentials, or paid fallback providers configured in the
  test. Nine successful main model calls logged through `openai-codex`. Exact
  Business allowance accounting and future quota behavior were not measured.
- Synthetic project note and a local read-only stdio MCP fixture. No real project
  records, external messaging, task mutations, or authenticated SaaS MCP tested.
- A profile separates state; it is not itself a filesystem sandbox. File access
  was limited by the test instructions and selected tools, not a new isolation layer.

## Observed tests

| Test | Result |
| --- | --- |
| Real model reply through existing Codex login | Pass after allowing host network access |
| Read local project note | Pass; file-only verification code returned correctly |
| Stdio MCP discovery | Pass |
| Stdio MCP execution, installed build | Fail; live subprocess incorrectly classified as exited |
| Stdio MCP execution, corrected test launcher | Pass; independently logged receipt matched model output |
| Explicit general memory save | Pass |
| Explicit user-profile save | Pass with a separate correctly addressed call |
| Recall in a fresh process and new session | Pass; format, decision and reason recalled |
| Search prior conversations | Pass; exact codes and source session retrieved |
| Original settings preserved | Hash-verified Hermes config/auth and Codex config unchanged |

The restart run had only memory and session-search toolsets, with MCP removed
from its configuration. Its prompt did not include either verification code.
Neither code appeared in the saved memory files. The recorded tool trace shows
`session_search`, with no file or MCP calls, followed by correct retrieval.

## Issues found

1. `tools/mcp_tool.py`, `MCPServerTask._stdio_children_dead`, returns `True` when
   `psutil.pid_exists(pid)` is true. This rejects live stdio servers before calls
   reach them. A temporary launcher replaced only that predicate and verified
   the before/after result against its own live PID. The installed file was not
   edited. The successful call also emitted an unawaited-coroutine warning from
   the neighboring liveness-watcher check; that remains unresolved.
2. The first model turn put `target` inside each memory batch operation, omitting
   the required top-level target. Hermes accepted the call and saved both entries
   in general memory. The assistant overstated that it had saved a user-profile
   entry. Explicit instructions to make separate top-level-target calls produced
   the expected `USER.md` entry. This needs argument-validation hardening before
   relying on unattended memory organization.
3. The first sandboxed launch failed at the network proxy, before inference.
   Host-network execution resolved it. The first test fixture also depended on
   an unavailable FastMCP import; it was replaced with a dependency-free MCP
   fixture. Neither initial failure was counted as an agent capability failure.
4. Hermes returned CLI exit code zero even for the failed initial model request.
   Integrations must inspect the actual turn/tool outcomes, not only process exit.

## Evidence

Evaluation files are outside the repository at
`/private/tmp/personal-os-hermes-eval-20260911/`:

- `evidence/results.json`: asserted checks and successful model-call metadata.
- `evidence/tool-transcripts.json`: conversation/tool records, excluding reasoning.
- `evidence/mcp-calls.jsonl`: independent server-side invocation receipt.
- `evidence/learn.log`, `learn-fixed.log`, `recall.log`: individual run logs.
- `hermes_test_launcher.py`: evaluation-only MCP correction.
- `run.py`, `setup.py`, `verify.py`: runner, fixture setup, and evidence checks.
- `profile/memories/` and `profile/state.db`: isolated synthetic memory/history.

Successful corrected session: `20260911_001017_c9a998`.
Fresh recall session: `20260911_001049_716f77`.

## Immediate bearing

Prefer a Hermes-backed pilot over building a complete custom memory framework.
First resolve and re-test the installed MCP defect and memory argument validation.
Then connect Personal OS through a narrow read interface and test the desired
real MCP service. Retain Supabase as the authority for tasks and the ledger.
The existing web assistant still uses the previous restricted Codex adapter;
this evaluation did not switch its backend or deploy anything.
