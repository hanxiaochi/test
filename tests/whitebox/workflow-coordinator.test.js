"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const coordinator = require("../../lib/workflow/workflow-coordinator");
const { WorkflowStore, defaultDefinition } = require("../../lib/workflow/workflow-store");
const { SqliteRuntimeStore } = require("../../lib/storage/sqlite-runtime-store");

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-coordinator-"));
  const store = new WorkflowStore(path.join(directory, "workflow.db"));
  const state = {
    manualMeasures: [{ manualId: 1, workflowInstanceKey: "instance-1", states: "草稿", amount: 10 }],
    workflowLogs: []
  };
  store.createVersion({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", definition: defaultDefinition() });
  try {
    return run({ store, state, resolveConfig: () => ({ rows: state.manualMeasures, key: "manualId" }) });
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function pending(state, overrides = {}) {
  return coordinator.beginPending(state, {
    id: "tx-1", tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", action: "submit",
    targets: [{ businessId: 1, instanceKey: "instance-1", expectedRevision: 1, expectedState: "pending", before: { manualId: 1, workflowInstanceKey: "instance-1", states: "草稿", amount: 10 } }],
    logIds: [1], ...overrides
  });
}

test("committed workflow clears its durable marker and keeps the business state", () => fixture(({ store, state, resolveConfig }) => {
  store.transition({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", businessId: "instance-1", action: "submit", actorAccount: "admin", permissions: ["data:write"] });
  state.manualMeasures[0].states = "审核中";
  state.workflowLogs.push({ logId: 1, workflowTransactionId: "tx-1" });
  pending(state);
  const result = coordinator.recoverPending(state, { workflowStore: store, tenantId: "tenant-a", projectId: "project-a", resolveConfig });
  assert.deepEqual(result, { changed: true, committed: 1, rolledBack: 0, transactionIds: ["tx-1"] });
  assert.equal(state.manualMeasures[0].states, "审核中");
  assert.equal(state.workflowLogs[0].workflowTransactionId, undefined);
  assert.equal(state[coordinator.PENDING_KEY], undefined);
}));

test("rolled back workflow restores exact rows and removes only its own logs", () => fixture(({ store, state, resolveConfig }) => {
  state.manualMeasures[0] = { manualId: 1, workflowInstanceKey: "instance-1", states: "审核中", amount: 99, added: true };
  state.workflowLogs.push(
    { logId: 1, workflowTransactionId: "tx-1" },
    { logId: 2, workflowTransactionId: "another-tx" }
  );
  pending(state);
  const result = coordinator.recoverPending(state, { workflowStore: store, tenantId: "tenant-a", projectId: "project-a", resolveConfig });
  assert.equal(result.rolledBack, 1);
  assert.deepEqual(state.manualMeasures[0], { manualId: 1, workflowInstanceKey: "instance-1", states: "草稿", amount: 10 });
  assert.deepEqual(state.workflowLogs, [{ logId: 2, workflowTransactionId: "another-tx" }]);
}));

test("partial commits, wrong scopes and missing rows fail closed", () => fixture(({ store, state, resolveConfig }) => {
  store.transition({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", businessId: "instance-1", action: "submit", actorAccount: "admin", permissions: ["data:write"] });
  pending(state, { targets: [
    { businessId: 1, instanceKey: "instance-1", expectedRevision: 1, expectedState: "pending", before: state.manualMeasures[0] },
    { businessId: 2, instanceKey: "instance-2", expectedRevision: 1, expectedState: "pending", before: { manualId: 2 } }
  ] });
  assert.throws(() => coordinator.recoverPending(state, { workflowStore: store, tenantId: "tenant-a", projectId: "project-a", resolveConfig }), /partially committed/);
  state[coordinator.PENDING_KEY] = [];
  pending(state, { tenantId: "tenant-b" });
  assert.throws(() => coordinator.recoverPending(state, { workflowStore: store, tenantId: "tenant-a", projectId: "project-a", resolveConfig }), /another business scope/);
  state[coordinator.PENDING_KEY] = [];
  pending(state, { targets: [{ businessId: 99, instanceKey: "missing", expectedRevision: 1, expectedState: "pending", before: { manualId: 99 } }] });
  assert.throws(() => coordinator.recoverPending(state, { workflowStore: store, tenantId: "tenant-a", projectId: "project-a", resolveConfig }), /cannot be recovered/);
}));

test("a workflow that advanced beyond the pending revision fails closed", () => fixture(({ store, state, resolveConfig }) => {
  store.transition({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", businessId: "instance-1", action: "submit", actorAccount: "admin", permissions: ["data:write"] });
  store.transition({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", businessId: "instance-1", action: "approve", actorAccount: "admin", permissions: ["data:write"] });
  pending(state);
  assert.throws(() => coordinator.recoverPending(state, { workflowStore: store, tenantId: "tenant-a", projectId: "project-a", resolveConfig }), /partially committed/);
  assert.equal(state[coordinator.PENDING_KEY].length, 1);
}));

test("marker validation and explicit finalization are bounded and deterministic", () => fixture(({ state }) => {
  assert.throws(() => coordinator.beginPending(null, {}), /state is required/);
  assert.throws(() => coordinator.beginPending(state, {}), /id is required/);
  assert.throws(() => pending(state, { targets: [] }), /targets are invalid/);
  pending(state);
  assert.throws(() => pending(state), /already exists/);
  state.workflowLogs.push({ logId: 1, workflowTransactionId: "tx-1" });
  assert.equal(coordinator.finalizePending(state, "tx-1").id, "tx-1");
  assert.equal(state.workflowLogs[0].workflowTransactionId, undefined);
  assert.equal(coordinator.finalizePending(state, "missing"), null);
  state[coordinator.PENDING_KEY] = Array.from({ length: coordinator.MAX_PENDING }, (_, index) => ({ id: `old-${index}` }));
  assert.throws(() => pending(state, { id: "overflow" }), /Too many/);
}));

test("a process restart compensates a business commit when workflow commit fails", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-restart-recovery-"));
  const workflowFile = path.join(directory, "workflow.db");
  const runtimeFile = path.join(directory, "runtime.db");
  let workflowStore = new WorkflowStore(workflowFile);
  let runtimeStore = new SqliteRuntimeStore(runtimeFile);
  workflowStore.createVersion({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", definition: defaultDefinition() });
  let state = runtimeStore.initialize({ manualMeasures: [{ manualId: 1, states: "草稿" }], workflowLogs: [] });
  try {
    assert.throws(() => workflowStore.transitionBatch({
      tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure",
      action: "submit", actorAccount: "admin", permissions: ["data:write"],
      items: [{ businessId: "instance-1", currentStateLabel: "草稿" }],
      applyState: (transitions) => {
        const before = cloneForTest(state.manualMeasures[0]);
        state.manualMeasures[0] = { ...state.manualMeasures[0], workflowInstanceKey: "instance-1", states: "审核中" };
        state.workflowLogs.push({ logId: 1, workflowTransactionId: "tx-restart" });
        coordinator.beginPending(state, {
          id: "tx-restart", tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", action: "submit", logIds: [1],
          targets: [{ businessId: 1, instanceKey: "instance-1", expectedRevision: transitions[0].instance.revision, expectedState: transitions[0].toState, before }]
        });
        runtimeStore.save(state, { actor: "admin", action: "workflow-pending" });
      },
      beforeCommit: () => { throw new Error("simulated process termination"); }
    }), /simulated process termination/);
    workflowStore.close();
    runtimeStore.close();
    workflowStore = new WorkflowStore(workflowFile);
    runtimeStore = new SqliteRuntimeStore(runtimeFile);
    state = runtimeStore.load();
    const result = coordinator.recoverPending(state, {
      workflowStore, tenantId: "tenant-a", projectId: "project-a",
      resolveConfig: () => ({ rows: state.manualMeasures, key: "manualId" })
    });
    runtimeStore.save(state, { actor: "system", action: "workflow-recovery", checkpoint: true });
    assert.equal(result.rolledBack, 1);
    assert.deepEqual(runtimeStore.load().manualMeasures, [{ manualId: 1, states: "草稿" }]);
    assert.equal(workflowStore.getInstance("tenant-a", "project-a", "manualmeasure", "instance-1"), null);
  } finally {
    workflowStore.close();
    runtimeStore.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function cloneForTest(value) {
  return JSON.parse(JSON.stringify(value));
}
