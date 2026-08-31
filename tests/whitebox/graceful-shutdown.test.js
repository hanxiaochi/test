"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createGracefulShutdown } = require("../../lib/runtime/graceful-shutdown");

function harness(overrides = {}) {
  const calls = { close: 0, closeAll: 0, closeIdle: 0, clear: 0, errors: [], exits: [], resources: [] };
  let closeCallback;
  let timeoutCallback;
  const server = {
    close(callback) { calls.close += 1; closeCallback = callback; },
    closeAllConnections() { calls.closeAll += 1; },
    closeIdleConnections() { calls.closeIdle += 1; },
    ...overrides.server
  };
  const shutdown = createGracefulShutdown({
    server,
    resources: overrides.resources || [
      { close() { calls.resources.push("first"); } },
      () => calls.resources.push("second")
    ],
    timeoutMs: 25,
    logger: { error(...args) { calls.errors.push(args); } },
    exit(code) { calls.exits.push(code); },
    setTimer(callback) { timeoutCallback = callback; return { unref() {} }; },
    clearTimer() { calls.clear += 1; }
  });
  return { calls, close: (error) => closeCallback(error), shutdown, timeout: () => timeoutCallback() };
}

test("clean shutdown is idempotent and closes every resource once", () => {
  const run = harness();
  assert.equal(run.shutdown("SIGTERM"), true);
  assert.equal(run.shutdown("SIGINT"), false);
  assert.equal(run.calls.close, 1);
  assert.equal(run.calls.closeIdle, 1);
  run.close();
  assert.deepEqual(run.calls.resources, ["first", "second"]);
  assert.deepEqual(run.calls.exits, [0]);
  assert.equal(run.calls.clear, 1);
  run.timeout();
  assert.deepEqual(run.calls.exits, [0]);
});

test("timeout forces open connections closed and ignores a late callback", () => {
  const run = harness();
  run.shutdown("SIGTERM");
  run.timeout();
  assert.equal(run.calls.closeAll, 1);
  assert.deepEqual(run.calls.resources, ["first", "second"]);
  assert.deepEqual(run.calls.exits, [1]);
  assert.ok(run.calls.errors.some((args) => String(args[0]).includes("timed out")));
  run.close();
  assert.deepEqual(run.calls.exits, [1]);
});

test("resource failures do not prevent later resources from closing", () => {
  const calls = [];
  const run = harness({ resources: [
    { close() { calls.push("bad"); throw new Error("close failed"); } },
    { close() { calls.push("good"); } },
    null
  ] });
  run.shutdown();
  run.close();
  assert.deepEqual(calls, ["bad", "good"]);
  assert.deepEqual(run.calls.exits, [1]);
  assert.ok(run.calls.errors.some((args) => String(args[0]).includes("resource close failed")));
});

test("server close errors and synchronous failures exit unsuccessfully", () => {
  const callbackFailure = harness();
  callbackFailure.shutdown();
  callbackFailure.close(new Error("server close failed"));
  assert.deepEqual(callbackFailure.calls.exits, [1]);
  assert.ok(callbackFailure.calls.errors.some((args) => String(args[0]).includes("server close failed")));

  const thrown = harness({ server: { close() { throw new Error("close threw"); } } });
  assert.equal(thrown.shutdown(), true);
  assert.deepEqual(thrown.calls.exits, [1]);
  assert.ok(thrown.calls.errors.some((args) => String(args[0]).includes("server shutdown failed")));
});

test("invalid server configuration fails fast", () => {
  assert.throws(() => createGracefulShutdown(), /HTTP server/);
  assert.throws(() => createGracefulShutdown({ server: {} }), /HTTP server/);
});

test("default timer, logger, exit, and optional server branches are usable", () => {
  const exitCodes = [];
  const originalExit = process.exit;
  process.exit = (code) => exitCodes.push(code);
  try {
    const shutdown = createGracefulShutdown({ server: { close(callback) { callback(); } } });
    assert.equal(shutdown(), true);
    assert.deepEqual(exitCodes, [0]);
  } finally {
    process.exit = originalExit;
  }

  let callback;
  const minimalExit = [];
  const minimal = createGracefulShutdown({
    server: { close(next) { callback = next; } },
    resources: "not-an-array",
    timeoutMs: "invalid",
    logger: { error() {} },
    exit(code) { minimalExit.push(code); },
    setTimer() { return 1; },
    clearTimer() {}
  });
  minimal();
  callback();
  assert.deepEqual(minimalExit, [0]);
});

test("forced-close and non-Error failures are logged without skipping cleanup", () => {
  const run = harness({
    server: { closeAllConnections() { throw "forced close failed"; } },
    resources: [() => { throw "resource failed"; }]
  });
  run.shutdown();
  run.timeout();
  assert.deepEqual(run.calls.exits, [1]);
  assert.ok(run.calls.errors.some((args) => String(args[0]).includes("forced connection close failed") && args[1] === "forced close failed"));
  assert.ok(run.calls.errors.some((args) => String(args[0]).includes("resource close failed") && args[1] === "resource failed"));
});
