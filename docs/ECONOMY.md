# Economy & Block Model

This document codifies the work/reward/penalty economy for the Productivity OS. It is the
source of truth for how blocks are counted, rendered, and settled. Update it whenever the
economy rules change, and keep `src/lib/economy.ts` in lockstep with it.

## Core unit: 1 block = 1 hour

A "block" is **one hour of its currency**, in every currency — work, reward, and penalty.
The rendered block glyph always means one hour. Partial blocks exist and are rendered with
light shading for the full block area plus dark fill for "block progress" (the fraction of
the hour actually present).

## Work currency

- **1 standard work block = 50 minutes of focused work + 10 minutes of rest = 1 hour.**
  The 10 minutes of rest is *implied* by the block; it is not separately logged.
- Work accumulates in minutes. `work_blocks = work_minutes / 50` (fractional allowed).
- A standard Pomodoro (50 min work) logs exactly **1 work block**.
- Work blocks are **derived** from logged duration. A long-flow session that ends at
  100 minutes logs **2 work blocks**; one that ends at 60 minutes logs **1.2 blocks**
  (1 full + a 20%-filled partial).

## Reward currency

- **1 reward block = 60 minutes of reward time** (1 hour).
- Reward earning rate (per work block, i.e. per 50 min of focused work):
  - **Weekday: 15 reward minutes** per work block.
  - **Weekend: 22.5 reward minutes** per work block (1.5x).
- `reward_minutes_earned = work_blocks × rate`.
- This policy is effective September 5, 2026 at midnight Central time. Earlier work
  retains the former 20-minute weekday / 30-minute weekend rate.

Consequence: 1 full reward block (60 min) requires 4 work blocks on weekdays. Weekend
work earns the same reward 1.5 times faster. Work blocks must NOT render as full reward
blocks — a single 50-minute work block earns ¼ of a weekday reward block.

## Long-flow (rolling) sessions

- A work timer that passes 50 minutes does not stop: it chimes and rolls into **overage
  mode**, counting up (with a `+` prefix).
- On "End session", the user is asked whether the session was uninterrupted:
  - **Yes** → log the full elapsed duration (50 min + overage).
  - **No** → log a single standard work block (50 min).
- Logged duration produces work blocks = `minutes / 50` and reward at the standard rate,
  immediately.
- **Rest duty:** after a long-flow session ends, the break timer is instantiated with
  **10 minutes of rest per 50 minutes of work**, as an exact ratio
  (`rest = max(10, round(work_minutes × 10 / 50))`).
  This is advisory — the user may take it or skip it; it is not enforced.

## Exercise

- Exercise is **1:1 positive reward**: X minutes of workout = +X reward minutes.
- It renders as **periwinkle** blocks and is tracked separately from work reward.

## Penalties (indulgence + screen time)

- Indulgent behavior: flat **−60 minutes** (1 penalty block).
- Screen time is penalized **1:1** for events on or after the September 5, 2026 policy
  rollout. Earlier recorded events retain the policy under which they occurred.
- Penalties render as **purple** blocks and are a **senior claim** on reward: they are
  paid down before anything else.

## Settlement order (fill-first)

Given, in minutes:

- `credit` = work reward + exercise  (total positive reward earned)
- `penalty` = total penalty minutes
- `spent` = total reward minutes redeemed

Settlement resolves in strict priority order:

1. **Penalty first** — `penalty_remaining = max(0, penalty − credit)`.
2. **Debt second** — `available_for_spend = max(0, credit − penalty)`;
   `debt = max(0, spent − available_for_spend)`.
3. **Positive remainder** — `positive = max(0, available_for_spend − spent)`.

Net balance = `credit − penalty − spent`.

### Reward-balance display

- `positive > 0` → solid **blue** blocks (work reward) + **periwinkle** blocks (exercise).
  Periwinkle is shown up to the exercise contribution; the remainder is blue.
- `penalty_remaining > 0` → **purple** blocks (partial). Purple blocks shrink as work
  arrives, because new reward fills the penalty first.
- `debt > 0` → **blue dashed-outline** blocks (partial). Debt blocks shrink and disappear
  as work pays them down; only after all penalty and debt are cleared does positive
  reward accrue as solid blocks.
- Penalty and debt are mutually exclusive with positive: if either is non-zero, positive
  is zero.

### "Destroyed" reward blocks (weekly overview only)

Reward that a penalty consumed is shown in the weekly overview by overlaying a purple
border and ✕ directly on the reward block it wiped out. It does not create an additional
block. Destruction is allocated within each day and capped at that day's earned reward.

## Weekly overview

Three category rows share a seven-day column grid. Each day renders its blocks in a
two-column reading order and shows a quiet daily time total beneath the group:

- **Work** — red blocks; total work minutes (blocks = minutes / 50).
- **Reward** — blue (work reward) + periwinkle (exercise), with destroyed reward marked
  directly on the underlying block; net = total − penalty.
- **Penalty** — purple blocks; total penalty minutes.

## Reference rates (constants in `src/lib/economy.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `WORK_BLOCK_WORK_MINUTES` | 50 | focused minutes per work block |
| `WORK_BLOCK_REST_MINUTES` | 10 | implied rest minutes per work block |
| `REWARD_BLOCK_MINUTES` | 60 | reward minutes per reward block |
| `ECONOMY_POLICY_V2_EFFECTIVE_AT` | 2026-09-05 midnight CT | new-policy boundary |
| `LEGACY_WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK` | 20 | pre-rollout weekday rate |
| `LEGACY_WEEKEND_REWARD_MINUTES_PER_WORK_BLOCK` | 30 | pre-rollout weekend rate |
| `WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK` | 15 | weekday reward rate |
| `WEEKEND_REWARD_MINUTES_PER_WORK_BLOCK` | 22.5 | weekend reward rate (1.5x) |
