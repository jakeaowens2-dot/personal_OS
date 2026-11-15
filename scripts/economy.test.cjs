const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );

const {
  behaviorEventsToSettlementEvents,
  buildWeeklyEconomyDays,
  computeSettlement,
  HEALTHY_BEHAVIOR_REWARD_MINUTES,
  ledgerEventsToSettlementEvents,
} = require("../src/lib/economy.ts");

function behaviorEvent(overrides) {
  return {
    id: "behavior-id",
    user_id: "user-id",
    behavior_type: "waking_routine",
    occurred_at: "2026-09-28T12:00:00.000Z",
    duration_minutes: null,
    penalty_minutes: 0,
    healthy_behavior_succeeded: true,
    note: null,
    created_at: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
}

test("healthy behavior outcomes map to the deployed reward contract", () => {
  const success = behaviorEvent({ behavior_type: "gallon_water" });
  const failure = behaviorEvent({
    healthy_behavior_succeeded: false,
    penalty_minutes: HEALTHY_BEHAVIOR_REWARD_MINUTES,
  });

  assert.deepEqual(behaviorEventsToSettlementEvents([success, failure]), [
    {
      kind: "credit",
      minutes: HEALTHY_BEHAVIOR_REWARD_MINUTES,
      at: success.occurred_at,
    },
    {
      kind: "penalty",
      minutes: HEALTHY_BEHAVIOR_REWARD_MINUTES,
      at: failure.occurred_at,
    },
  ]);
});

test("weekly behavior reward includes exercise and successful daily habits", () => {
  const weekStart = new Date(2026, 8, 28, 0, 0, 0, 0);
  const occurredAt = new Date(2026, 8, 28, 12, 0, 0, 0).toISOString();
  const days = buildWeeklyEconomyDays({
    behaviorEvents: [
      behaviorEvent({ occurred_at: occurredAt }),
      behaviorEvent({
        id: "water",
        behavior_type: "gallon_water",
        occurred_at: occurredAt,
      }),
      behaviorEvent({
        id: "exercise",
        behavior_type: "exercise",
        occurred_at: occurredAt,
        duration_minutes: 45,
        healthy_behavior_succeeded: null,
      }),
      behaviorEvent({
        id: "failed-water",
        behavior_type: "gallon_water",
        occurred_at: occurredAt,
        healthy_behavior_succeeded: false,
        penalty_minutes: HEALTHY_BEHAVIOR_REWARD_MINUTES,
      }),
    ],
    ledgerEvents: [],
    weekStart,
    workBlocks: [],
  });

  assert.equal(days[0].behaviorRewardMinutes, 105);
  assert.equal(days[0].penaltyMinutes, HEALTHY_BEHAVIOR_REWARD_MINUTES);
});

test("an audited correction and its reversal cancel without rewriting history", () => {
  const ledgerEvents = [
    {
      id: "historical-reconciliation",
      user_id: "user-id",
      event_type: "correction",
      delta_work_blocks: 0,
      delta_reward_blocks: 0,
      source: "manual_balance_reconciliation",
      metadata: { reward_minutes_delta: 270 },
      created_at: "2026-09-26T01:05:01.958Z",
    },
    {
      id: "historical-reconciliation-reversal",
      user_id: "user-id",
      event_type: "correction",
      delta_work_blocks: 0,
      delta_reward_blocks: 0,
      source: "manual_balance_reconciliation",
      metadata: { reward_minutes_delta: -270 },
      created_at: "2026-09-28T05:09:27.537Z",
    },
  ];

  const settlement = computeSettlement(ledgerEventsToSettlementEvents(ledgerEvents));

  assert.equal(settlement.netMinutes, 0);
  assert.equal(settlement.positiveMinutes, 0);
  assert.equal(settlement.debtMinutes, 0);
});
