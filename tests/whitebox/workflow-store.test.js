"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { WorkflowStore, defaultDefinition, normalizeDefinition } = require("../../lib/workflow/workflow-store");

function withStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-store-"));
  let clock = Date.parse("2026-08-26T00:00:00.000Z");
  const store = new WorkflowStore(path.join(directory, "workflow.db"), { now: () => clock++ });
  try {
    return run(store);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function createDefault(store, overrides = {}) {
  return store.createVersion({
    tenantId: "tenant-a",
    projectId: "project-a",
    module: "manualmeasure",
    definition: defaultDefinition(),
    changeReason: "initial workflow",
    createdBy: 7,
    ...overrides
  });
}

function transition(store, overrides = {}) {
  return store.transition({
    tenantId: "tenant-a",
    projectId: "project-a",
    module: "manualmeasure",
    businessId: "101",
    businessNo: "SD-101",
    action: "submit",
    actorUserId: 7,
    actorAccount: "admin",
    permissions: ["data:write"],
    ...overrides
  });
}

test("definitions are normalized, versioned, activated, inherited and isolated", () => withStore((store) => {
  const first = createDefault(store, { activate: false });
  assert.equal(first.version, 1);
  assert.equal(first.status, "draft");
  assert.equal(store.getActive("tenant-a", "project-a", "manualmeasure"), null);

  const second = createDefault(store, { changeReason: "activate second" });
  assert.equal(second.version, 2);
  assert.equal(second.status, "active");
  assert.equal(store.history("tenant-a", "project-a", "manualmeasure", 1).length, 1);
  assert.equal(store.activate({ id: first.id, tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure" }).status, "active");
  assert.equal(store.getDefinition(second.id).status, "retired");

  createDefault(store, { projectId: "*", module: "billmeasure", changeReason: "tenant fallback" });
  assert.equal(store.getActive("tenant-a", "project-z", "billmeasure").projectId, "*");
  assert.equal(store.getActive("tenant-b", "project-z", "billmeasure"), null);
  assert.throws(() => store.activate({ id: first.id, tenantId: "tenant-b", projectId: "project-a", module: "manualmeasure" }), (error) => error.code === "WORKFLOW_DEFINITION_NOT_FOUND" && error.status === 404);
}));

test("workflow transition enforces state, permission, remarks, revision and event identity", () => withStore((store) => {
  createDefault(store);
  const submitted = transition(store, { currentStateLabel: "草稿" });
  assert.equal(submitted.fromState, "draft");
  assert.equal(submitted.toStateLabel, "审核中");
  assert.equal(submitted.instance.revision, 1);

  assert.throws(() => transition(store, { action: "archive", expectedRevision: 0 }), (error) => error.code === "WORKFLOW_REVISION_CONFLICT" && error.actualRevision === 1);
  assert.throws(() => transition(store, { action: "submit", expectedRevision: 1 }), (error) => error.code === "WORKFLOW_TRANSITION_NOT_ALLOWED" && error.currentState === "pending");
  assert.throws(() => transition(store, { action: "approve", expectedRevision: 1, permissions: [] }), (error) => error.code === "WORKFLOW_PERMISSION_DENIED" && error.requiredPermission === "data:write");

  const approved = transition(store, { action: "approve", expectedRevision: 1 });
  assert.equal(approved.instance.currentState, "approved");
  assert.throws(() => transition(store, { action: "return", expectedRevision: 2, remark: "" }), (error) => error.code === "WORKFLOW_REMARK_REQUIRED");
  const returned = transition(store, { action: "return", expectedRevision: 2, remark: "资料不完整" });
  assert.equal(returned.instance.currentStateLabel, "已退回");

  const events = store.events({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", businessId: 101 });
  assert.equal(events.length, 3);
  assert.equal(events[0].actorAccount, "admin");
  assert.equal(events[0].remark, "资料不完整");
  assert.deepEqual(store.events({ tenantId: "tenant-b", projectId: "project-a", module: "manualmeasure", businessId: 101 }), []);

  let appliedState = "";
  transition(store, { businessId: 102, applyState: (result) => { appliedState = result.toStateLabel; } });
  assert.equal(appliedState, "审核中");
  assert.throws(() => transition(store, { businessId: 103, applyState: () => { throw new Error("business save failed"); } }), /business save failed/);
  assert.equal(store.getInstance("tenant-a", "project-a", "manualmeasure", 103), null);
}));

test("new instances pin a definition version and infer legacy state labels", () => withStore((store) => {
  const first = createDefault(store);
  const approved = transition(store, { businessId: 201, currentStateLabel: "待审核", action: "approve" });
  assert.equal(approved.instance.definitionId, first.id);
  assert.equal(approved.fromState, "pending");

  const changed = defaultDefinition();
  changed.transitions.find((item) => item.action === "submit").label = "重新提交";
  const second = createDefault(store, { definition: changed, changeReason: "label update" });
  assert.notEqual(second.id, first.id);
  const returned = transition(store, { businessId: 201, action: "return", expectedRevision: 1, remark: "return" });
  assert.equal(returned.instance.definitionId, first.id);
  const newInstance = transition(store, { businessId: 202, currentStateLabel: "未知旧状态" });
  assert.equal(newInstance.instance.definitionId, second.id);
  assert.equal(newInstance.fromState, "draft");
}));

test("module, project and tenant form independent instance keys", () => withStore((store) => {
  createDefault(store);
  createDefault(store, { projectId: "project-b" });
  createDefault(store, { tenantId: "tenant-b" });
  createDefault(store, { module: "billmeasure" });
  transition(store);
  transition(store, { projectId: "project-b" });
  transition(store, { tenantId: "tenant-b" });
  transition(store, { module: "billmeasure" });
  assert.equal(store.getInstance("tenant-a", "project-a", "manualmeasure", 101).revision, 1);
  assert.deepEqual(store.eventStats({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", businessId: 101 }), { count: 1, firstRevision: 1, latestRevision: 1 });
  assert.deepEqual(store.eventStats({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", businessId: "missing" }), { count: 0, firstRevision: 0, latestRevision: 0 });
  assert.equal(store.listInstances("tenant-a", "project-a", "manualmeasure", 1).length, 1);
  assert.equal(store.listInstances("tenant-a", "project-a", "manualmeasure", { limit: 1, offset: 1 }).length, 0);
  assert.equal(store.listInstances("tenant-a", "project-a", "manualmeasure", 0)[0].businessId, "101");
  assert.equal(store.listInstances("tenant-a", "project-b", "manualmeasure").length, 1);
  assert.equal(store.listInstances("tenant-a", "project-a", "billmeasure").length, 1);
  assert.equal(store.listInstances("tenant-b", "project-b", "manualmeasure").length, 0);
  assert.equal(store.getInstance("tenant-a", "project-b", "manualmeasure", 101).revision, 1);
  assert.equal(store.getInstance("tenant-b", "project-a", "manualmeasure", 101).revision, 1);
  assert.equal(store.getInstance("tenant-a", "project-a", "billmeasure", 101).revision, 1);
}));

test("batch transitions validate every item and commit atomically", () => withStore((store) => {
  createDefault(store);
  let applied = [];
  const batch = store.transitionBatch({
    tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure",
    action: "submit", actorUserId: 7, actorAccount: "admin", permissions: ["data:write"],
    items: [
      { businessId: 301, businessNo: "SD-301", currentStateLabel: "草稿" },
      { businessId: 302, businessNo: "SD-302", currentStateLabel: "待上报" }
    ],
    applyState: (results) => { applied = results.map((item) => item.instance.businessId); }
  });
  assert.equal(batch.count, 2);
  assert.deepEqual(applied, ["301", "302"]);
  assert.equal(store.getInstance("tenant-a", "project-a", "manualmeasure", 301).currentState, "pending");
  assert.equal(store.getInstance("tenant-a", "project-a", "manualmeasure", 302).revision, 1);

  assert.throws(() => store.transitionBatch({
    tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure",
    action: "submit", actorAccount: "admin", permissions: ["data:write"],
    items: [
      { businessId: 303, currentStateLabel: "草稿" },
      { businessId: 302, currentStateLabel: "审核中" }
    ]
  }), (error) => error.code === "WORKFLOW_TRANSITION_NOT_ALLOWED" && error.businessId === "302");
  assert.equal(store.getInstance("tenant-a", "project-a", "manualmeasure", 303), null);
  assert.equal(store.getInstance("tenant-a", "project-a", "manualmeasure", 302).revision, 1);

  assert.throws(() => store.transitionBatch({
    tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure",
    action: "submit", actorAccount: "admin", permissions: ["data:write"],
    items: [{ businessId: 304 }, { businessId: 305 }],
    applyState: () => { throw new Error("business batch save failed"); }
  }), /business batch save failed/);
  assert.equal(store.getInstance("tenant-a", "project-a", "manualmeasure", 304), null);
  assert.equal(store.getInstance("tenant-a", "project-a", "manualmeasure", 305), null);

  let externalBusinessSaved = false;
  assert.throws(() => store.transitionBatch({
    tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure",
    action: "submit", actorAccount: "admin", permissions: ["data:write"],
    items: [{ businessId: 306 }],
    applyState: () => { externalBusinessSaved = true; },
    beforeCommit: () => { throw new Error("injected workflow commit failure"); }
  }), /injected workflow commit failure/);
  assert.equal(externalBusinessSaved, true);
  assert.equal(store.getInstance("tenant-a", "project-a", "manualmeasure", 306), null);
}));

test("tampered workflow definitions fail closed before reads or activation", () => withStore((store) => {
  const version = createDefault(store);
  store.db.prepare("UPDATE workflow_definitions SET definition_json=? WHERE id=?").run(JSON.stringify({ initialState: "draft", states: [], transitions: [] }), version.id);
  assert.throws(() => store.getDefinition(version.id), (error) => error.code === "WORKFLOW_DEFINITION_TAMPERED" && error.status === 500);
  assert.throws(() => store.getActive("tenant-a", "project-a", "manualmeasure"), /checksum mismatch/);
  assert.throws(() => store.history("tenant-a", "project-a", "manualmeasure"), /checksum mismatch/);
  assert.throws(() => store.activate({ id: version.id, tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure" }), /checksum mismatch/);
}));

test("invalid definitions and transition inputs fail closed", () => withStore((store) => {
  const base = defaultDefinition();
  assert.throws(() => new WorkflowStore(), /path is required/);
  const defaultClockFile = path.join(path.dirname(store.file), "default-clock.db");
  const defaultClockStore = new WorkflowStore(defaultClockFile);
  assert.match(defaultClockStore.nowIso(), /^\d{4}-\d{2}-\d{2}T/);
  defaultClockStore.close();
  assert.throws(() => normalizeDefinition(null), /must be an object/);
  assert.throws(() => normalizeDefinition({ ...base, states: [base.states[0]] }), /2 to 30/);
  assert.throws(() => normalizeDefinition({ ...base, states: [...base.states, { ...base.states[0] }] }), /codes must be unique/);
  assert.throws(() => normalizeDefinition({ ...base, states: [...base.states.slice(0, -1), { code: "other", label: base.states[0].label }] }), /labels must be unique/);
  assert.throws(() => normalizeDefinition({ ...base, initialState: "missing" }), /does not exist/);
  assert.throws(() => normalizeDefinition({ ...base, transitions: [] }), /1 to 100/);
  assert.throws(() => normalizeDefinition({ ...base, transitions: [{ action: "x", from: [], to: "draft" }] }), /non-empty unique/);
  assert.throws(() => normalizeDefinition({ ...base, transitions: [{ action: "x", from: ["missing"], to: "draft" }] }), /unknown state/);
  assert.throws(() => normalizeDefinition({ ...base, transitions: [{ action: "x", from: ["draft"], to: "draft" }] }), /must change state/);
  assert.throws(() => normalizeDefinition({ ...base, transitions: [{ action: "x", from: ["draft"], to: "pending" }, { action: "x", from: ["draft"], to: "approved" }] }), /only one target/);
  assert.throws(() => normalizeDefinition({ ...base, states: base.states.map((item, index) => index === 0 ? { ...item, code: "BAD CODE" } : item) }), /invalid/);
  const fallbackTransition = normalizeDefinition({ ...base, transitions: [{ action: "send", from: ["draft"], to: "pending" }] });
  assert.equal(fallbackTransition.transitions[0].label, "send");
  assert.equal(fallbackTransition.transitions[0].permission, "data:write");

  assert.throws(() => store.createVersion({ tenantId: "tenant-a", projectId: "project-a", module: "bad module", definition: base }), /invalid/);
  assert.throws(() => store.createVersion({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", definition: base, changeReason: "x".repeat(501) }), /too long/);
  const defaults = store.createVersion({ module: "defaultmodule", definition: base, activate: false });
  assert.equal(defaults.tenantId, "default");
  assert.equal(defaults.projectId, "*");
  assert.equal(defaults.createdBy, null);
  assert.equal(store.getActive("default", "*", "defaultmodule"), null);
  assert.equal(store.history("default", "*", "defaultmodule", 999).length, 1);
  assert.equal(store.history("default", "*", "defaultmodule", 0).length, 1);
  assert.throws(() => transition(store), (error) => error.code === "WORKFLOW_DEFINITION_NOT_FOUND");
  createDefault(store);
  assert.throws(() => transition(store, { businessId: "" }), /Business id is required/);
  assert.throws(() => transition(store, { expectedRevision: -1 }), /Expected revision is invalid/);
  assert.throws(() => transition(store, { actorAccount: "" }), /Actor account is required/);
  assert.throws(() => store.transitionBatch({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", actorAccount: "admin", items: [] }), /1 to 500/);
  assert.throws(() => store.transitionBatch({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", actorAccount: "admin", items: Array.from({ length: 501 }, (_, index) => ({ businessId: index + 1, action: "submit" })) }), /1 to 500/);
  assert.throws(() => store.transitionBatch({ tenantId: "tenant-a", projectId: "project-a", module: "manualmeasure", actorAccount: "admin", items: [{ businessId: 1, action: "submit" }, { businessId: 1, action: "submit" }] }), /duplicate business ids/);
  transition(store, { businessId: 999, businessNo: "", actorUserId: null, permissions: ["*"] });
  store.db.prepare("UPDATE workflow_instances SET current_state='legacy-unknown' WHERE business_id='999'").run();
  assert.equal(store.getInstance("tenant-a", "project-a", "manualmeasure", 999).currentStateLabel, "legacy-unknown");
}));
