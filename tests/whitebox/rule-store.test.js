"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { RuleStore, serializeRules } = require("../../lib/rules/rule-store");

function withStore(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zwkjy-rule-test-"));
  let now = Date.parse("2026-08-25T00:00:00.000Z");
  const store = new RuleStore(path.join(root, "rules.db"), { now: () => now++ });
  try {
    return fn(store);
  } finally {
    store.close();
    const resolved = path.resolve(root);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("zwkjy-rule-test-")) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

test("canonical serialization is stable and rejects invalid rules", () => {
  assert.equal(serializeRules({ b: 2, a: { d: 4, c: [3, { y: 2, x: 1 }] } }), serializeRules({ a: { c: [3, { x: 1, y: 2 }], d: 4 }, b: 2 }));
  assert.throws(() => serializeRules(null), /must be an object/);
  assert.throws(() => serializeRules([]), /must be an object/);
});

test("versions are immutable, sequential, and only one is active", () => withStore((store) => {
  assert.equal(store.getActive(), null);
  const first = store.createVersion({ rules: { retentionRate: 10 }, changeReason: "初始规则", createdBy: 1 });
  const draft = store.createVersion({ rules: { retentionRate: 9 }, activate: false, changeReason: "待审核" });
  assert.equal(first.version, 1);
  assert.equal(first.status, "active");
  assert.equal(draft.version, 2);
  assert.equal(draft.status, "draft");
  assert.equal(store.getActive().id, first.id);
  assert.deepEqual(store.history().map((row) => row.version), [2, 1]);

  const activated = store.activate({ id: draft.id });
  assert.equal(activated.status, "active");
  assert.equal(store.getActive().rules.retentionRate, 9);
  assert.deepEqual(store.history().map((row) => row.status), ["active", "retired"]);
  assert.throws(() => store.activate({ id: 9999 }), /does not exist/);
}));

test("project rules override tenant defaults and otherwise inherit", () => withStore((store) => {
  const global = store.createVersion({ rules: { moneyDigits: 2 } });
  assert.equal(store.getActive("default", "project-a").id, global.id);
  const project = store.createVersion({ projectId: "project-a", rules: { moneyDigits: 0 } });
  assert.equal(store.getActive("default", "project-a").id, project.id);
  assert.equal(store.getActive("default", "project-b").id, global.id);
  assert.throws(() => store.activate({ id: project.id, tenantId: "default", projectId: "project-b" }), /does not exist/);
  assert.deepEqual(store.history("default", "project-a", 0).map((row) => row.version), [1]);
  const otherTenant = store.createVersion({ tenantId: "other", rules: { moneyDigits: 4 } });
  assert.throws(() => store.activate({ id: otherTenant.id, tenantId: "default" }), /does not exist/);
  assert.equal(store.getActive("other", "*").id, otherTenant.id);
}));

test("checksum tampering fails closed", () => withStore((store) => {
  const version = store.createVersion({ rules: { retentionRate: 10 } });
  store.db.prepare("UPDATE calculation_rule_versions SET rules_json = ? WHERE id = ?").run('{"retentionRate":99}', version.id);
  assert.throws(() => store.getById(version.id), /checksum mismatch/);
  assert.throws(() => store.activate({ id: version.id }), /checksum mismatch/);
}));

test("invalid database path is rejected", () => {
  assert.throws(() => new RuleStore(""), /path is required/);
});
