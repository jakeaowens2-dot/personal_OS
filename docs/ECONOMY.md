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
  - **Weekday: 20 reward minutes** per work block.
  - **Weekend: 30 reward minutes** per work block (1.5x).
- `reward_minutes_earned = work_blocks × rate`.

Consequence: 1 full reward block (60 min) requires 3 work blocks on weekdays (3 × 20)
or 2 work blocks on weekends (2 × 30). This is why work blocks must NOT render as full
reward blocks — a single 50-min work block earns only ⅓ (weekday) or ½ (weekend) of a
reward block.

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
- Screen time: `penalty = max(0.5 × screen_minutes, screen_minutes − 60)`.
  (60 → 30, 120 → 60, 150 → 90.)
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

Reward that a penalty consumed is shown in the weekly overview as **destroyed reward
blocks**: greyed-out blue fill, purple border, purple ✕ overlay. Amount =
`min(weekly_penalty, weekly_reward_total)`.

## Weekly overview

Three sections, each with a block count and a total-hours label:

- **Work** — red blocks; total work minutes (blocks = minutes / 50).
- **Reward** — blue (work reward) + periwinkle (exercise) + destroyed (grey/✕) blocks;
  shows `total:` and `net:` (net = total − penalty).
- **Penalty** — purple blocks; total penalty minutes.

## Reference rates (constants in `src/lib/economy.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `WORK_BLOCK_WORK_MINUTES` | 50 | focused minutes per work block |
| `WORK_BLOCK_REST_MINUTES` | 10 | implied rest minutes per work block |
| `REWARD_BLOCK_MINUTES` | 60 | reward minutes per reward block |
| `WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK` | 20 | weekday reward rate |
| `WEEKEND_REWARD_MINUTES_PER_WORK_BLOCK` | 30 | weekend reward rate (1.5x) |
