"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MAX_ISSUES, scanWorkflowConsistency } = require("../../lib/workflow/workflow-consistency");

function storeFixture(instances = [], eventRows = {}) {
  return {
    listInstances(tenantId, projectId, module, options) {
      assert.equal(tenantId, "tenant-a");
      assert.equal(projectId, "project-a");
      assert.equal(module, "manualmeasure");
      assert.ok(options.limit >= 1 && options.limit <= 5000);
      return instances.slice(options.offset, options.offset + options.limit);
    },
    eventStats({ businessId }) {
      const rows = eventRows[businessId] || [];
      const revisions = rows.map((row) => Number(row.revision));
      return { count: rows.length, firstRevision: rows.length ? Math.min(...revisions) : 0, latestRevision: rows.length ? Math.max(...revisions) : 0 };
    }
  };
}

function scan(state, instances, events, overrides = {}) {
  return scanWorkflowConsistency({
    state,
    workflowStore: storeFixture(instances, events),
    tenantId: "tenant-a",
    projectId: "project-a",
    modules: [{ code: "manualmeasure", key: "manualId", rows: state.manualMeasures || [] }],
    now: Date.parse("2026-08-26T00:10:00.000Z"),
    ...overrides
  });
}

test("consistent linked rows and retained orphan histories are distinguished", () => {
  const state = { manualMeasures: [{ manualId: 1, workflowInstanceKey: "wf-1", states: "审核中" }] };
  const instances = [
    { businessId: "wf-1", currentStateLabel: "审核中", revision: 1 },
    { businessId: "deleted-wf", currentStateLabel: "已审核", revision: 2 }
  ];
  const result = scan(state, instances, {
    "wf-1": [{ revision: 1 }],
    "deleted-wf": [{ revision: 2 }, { revision: 1 }]
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.counts, { error: 0, warning: 0, info: 1 });
  assert.equal(result.issues[0].code, "ORPHAN_WORKFLOW_AUDIT_HISTORY");
  assert.deepEqual(result.totals, { modules: 1, businessRows: 1, linkedRows: 1, instances: 2, events: 3, pendingTransactions: 0 });
});

test("duplicate keys, missing instances, state mismatch and revision gaps are errors", () => {
  const state = { manualMeasures: [
    { manualId: 1, workflowInstanceKey: "wf-1", states: "草稿" },
    { manualId: 2, workflowInstanceKey: "wf-1", states: "审核中" },
    { manualId: 3, workflowInstanceKey: "missing", states: "草稿" },
    { manualId: 4, states: "草稿" }
  ] };
  const result = scan(state, [
    { businessId: "wf-1", currentStateLabel: "审核中", revision: 2 },
    { businessId: "wf-gap", currentStateLabel: "已审核", revision: 2 }
  ], { "wf-1": [{ revision: 1 }], "wf-gap": [{ revision: 2 }] });
  assert.equal(result.status, "error");
  assert.deepEqual(new Set(result.issues.map((issue) => issue.code)), new Set([
    "WORKFLOW_STATE_MISMATCH", "DUPLICATE_WORKFLOW_INSTANCE_KEY", "MISSING_WORKFLOW_INSTANCE", "WORKFLOW_EVENT_REVISION_GAP", "ORPHAN_WORKFLOW_AUDIT_HISTORY"
  ]));
});

test("fresh and stale pending transactions receive warning and error severity", () => {
  const state = {
    manualMeasures: [],
    _workflowPendingTransactions: [
      { id: "fresh", tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", createdAt: "2026-08-26T00:09:30.000Z" },
      { id: "stale", tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", createdAt: "invalid" },
      { id: "cross", tenantId: "tenant-b", projectId: "project-a", module: "manualmeasure", createdAt: "2026-08-26T00:10:00.000Z" }
    ]
  };
  const result = scan(state, [], {}, { pendingMaxAgeMs: 60000 });
  assert.equal(result.counts.warning, 1);
  assert.equal(result.counts.error, 2);
  assert.equal(result.totals.pendingTransactions, 2);
});

test("invalid contracts fail closed and issue output is bounded", () => {
  assert.throws(() => scanWorkflowConsistency({ state: [] }), /state is required/);
  assert.throws(() => scanWorkflowConsistency(), /state is required/);
  assert.throws(() => scanWorkflowConsistency({ state: {} }), /store is required/);
  assert.throws(() => scanWorkflowConsistency({ state: {}, workflowStore: { listInstances() {} }, tenantId: "tenant-a", projectId: "project-a" }), /store is required/);
  assert.throws(() => scanWorkflowConsistency({ state: {}, workflowStore: storeFixture() }), /scope is required/);
  assert.throws(() => scanWorkflowConsistency({ state: {}, workflowStore: storeFixture(), tenantId: "tenant-a", projectId: "project-a", modules: [{}] }), /configuration is invalid/);
  const state = { manualMeasures: Array.from({ length: MAX_ISSUES + 5 }, (_, index) => ({ manualId: index + 1, workflowInstanceKey: `missing-${index}` })) };
  const result = scan(state, [], {});
  assert.equal(result.issues.length, MAX_ISSUES);
  assert.equal(result.truncated, true);
});

test("defaults support empty scopes and zero-revision retained instances", () => {
  const state = { manualMeasures: [] };
  const instance = { businessId: "draft-history", currentStateLabel: "草稿", revision: 0 };
  const result = scanWorkflowConsistency({
    state,
    workflowStore: storeFixture([instance], {}),
    tenantId: "tenant-a",
    projectId: "project-a",
    modules: [{ code: "manualmeasure", key: "manualId", rows: state.manualMeasures }]
  });
  assert.equal(result.status, "ok");
  assert.equal(result.counts.info, 1);
  assert.match(result.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("instance scans paginate until every workflow instance is checked", () => {
  const state = { manualMeasures: [] };
  const instances = [
    { businessId: "history-1", currentStateLabel: "草稿", revision: 0 },
    { businessId: "history-2", currentStateLabel: "草稿", revision: 0 }
  ];
  const result = scan(state, instances, {}, { instancePageSize: 1 });
  assert.equal(result.totals.instances, 2);
  assert.equal(result.counts.info, 2);
  assert.throws(() => scan(state, instances, {}, { instancePageSize: 1, maxScannedInstances: 2 }), /exceeds the consistency scan limit/);
});
