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
  advanceDurableTimerState,
  parseDurableTimerState,
  timerStorageKey,
} = require("../src/lib/timerRuntime.ts");

const baseState = {
  version: 1,
  mode: "work",
  status: "running",
  remainingSeconds: 10,
  overageSeconds: 0,
  breakDurationSeconds: null,
  lastCompletedMode: null,
  savedAt: 1_000,
};

test("running work advances across an unmounted route", () => {
  assert.deepEqual(advanceDurableTimerState(baseState, 6_000), {
    ...baseState,
    remainingSeconds: 5,
    savedAt: 6_000,
  });
});

test("one delayed callback accounts for the full elapsed wall-clock interval", () => {
  const fiftyMinuteSession = {
    ...baseState,
    remainingSeconds: 3_000,
    savedAt: 50_000,
  };

  assert.deepEqual(
    advanceDurableTimerState(fiftyMinuteSession, 50_000 + 25 * 60 * 1_000),
    {
      ...fiftyMinuteSession,
      remainingSeconds: 1_500,
      savedAt: 50_000 + 25 * 60 * 1_000,
    },
  );
});

test("subsecond remainder is retained instead of accumulating clock drift", () => {
  const firstRefresh = advanceDurableTimerState(baseState, 2_499);
  assert.deepEqual(firstRefresh, {
    ...baseState,
    remainingSeconds: 9,
    savedAt: 2_000,
  });
  assert.strictEqual(
    advanceDurableTimerState(firstRefresh, 2_999),
    firstRefresh,
  );
  assert.deepEqual(advanceDurableTimerState(firstRefresh, 3_000), {
    ...baseState,
    remainingSeconds: 8,
    savedAt: 3_000,
  });
});

test("elapsed work rolls into overage instead of being reset", () => {
  assert.deepEqual(advanceDurableTimerState(baseState, 16_000), {
    ...baseState,
    status: "overage",
    remainingSeconds: 0,
    overageSeconds: 5,
    lastCompletedMode: "work",
    savedAt: 16_000,
  });
});

test("elapsed breaks restore as complete", () => {
  const breakState = {
    ...baseState,
    mode: "break",
    remainingSeconds: 5,
    breakDurationSeconds: 600,
  };

  assert.deepEqual(advanceDurableTimerState(breakState, 7_000), {
    ...breakState,
    status: "complete",
    remainingSeconds: 0,
    lastCompletedMode: "break",
    savedAt: 7_000,
  });
});

test("paused timers do not consume wall-clock time", () => {
  const pausedState = { ...baseState, status: "paused" };
  assert.deepEqual(advanceDurableTimerState(pausedState, 60_000), {
    ...pausedState,
    savedAt: 60_000,
  });
});

test("overage continues while another surface is open", () => {
  const overageState = {
    ...baseState,
    status: "overage",
    remainingSeconds: 0,
    overageSeconds: 12,
    lastCompletedMode: "work",
  };

  assert.deepEqual(advanceDurableTimerState(overageState, 4_000), {
    ...overageState,
    overageSeconds: 15,
    savedAt: 4_000,
  });
});

test("stored state is validated and scoped to the signed-in user", () => {
  assert.deepEqual(parseDurableTimerState(JSON.stringify(baseState)), baseState);
  assert.equal(parseDurableTimerState("{not-json"), null);
  assert.equal(
    parseDurableTimerState(JSON.stringify({ ...baseState, remainingSeconds: -1 })),
    null,
  );
  assert.equal(timerStorageKey("user-a"), "personal-os.timer.v1:user-a");
  assert.notEqual(timerStorageKey("user-a"), timerStorageKey("user-b"));
});
