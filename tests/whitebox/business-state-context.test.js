"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

function freshContext() {
  const modulePath = require.resolve("../../lib/business-state-context");
  delete require.cache[modulePath];
  return require(modulePath);
}

test("proxy resolves isolated tenant state across interleaved async work", async () => {
  const context = freshContext();
  const states = { default: { value: "default", rows: [] }, a: { value: "a", rows: [] }, b: { value: "b", rows: [] } };
  context.configure({ defaultState: states.default, loadTenant: (tenantId) => states[tenantId] });
  const db = context.proxy();
  const seen = [];
  await Promise.all([
    context.runForTenant("a", async () => {
      db.rows.push("a1");
      await new Promise((resolve) => setTimeout(resolve, 15));
      seen.push(db.value, db.rows.join(","));
    }),
    context.runForTenant("b", async () => {
      db.rows.push("b1");
      await new Promise((resolve) => setTimeout(resolve, 2));
      seen.push(db.value, db.rows.join(","));
    })
  ]);
  assert.deepEqual(states.a.rows, ["a1"]);
  assert.deepEqual(states.b.rows, ["b1"]);
  assert.deepEqual(seen.sort(), ["a", "a1", "b", "b1"]);
  assert.equal(db.value, "default");
});

test("proxy supports object operations and invalid tenant loads fail closed", () => {
  const context = freshContext();
  context.configure({ defaultState: { a: 1 }, loadTenant: () => null });
  const db = context.proxy();
  assert.deepEqual(Object.keys(db), ["a"]);
  db.b = 2;
  assert.equal("b" in db, true);
  delete db.a;
  assert.equal("a" in db, false);
  assert.throws(() => context.runForTenant("bad", () => {}), /Invalid business state/);
  context.clearTenantCache("bad");
  context.clearTenantCache("default");
  assert.equal(context.proxy(), db, "proxy should be stable for module consumers");
  assert.equal(Object.getOwnPropertyDescriptor(db, "missing"), undefined);
  assert.throws(() => context.configure({}), /required/);
});

test("missing loader and array tenant states are rejected", () => {
  const withoutLoader = freshContext();
  withoutLoader.configure({ defaultState: { ok: true } });
  assert.equal(withoutLoader.current().tenantId, "default");
  assert.throws(() => withoutLoader.runForTenant("missing", () => {}), /unavailable/);

  const arrayLoader = freshContext();
  arrayLoader.configure({ defaultState: { ok: true }, loadTenant: () => [] });
  assert.throws(() => arrayLoader.stateForTenant("array"), /Invalid business state/);
  assert.equal(arrayLoader.runForTenant(undefined, () => arrayLoader.current().tenantId), "default");
});

test("project scopes are cached and cleared independently by tenant", () => {
  const context = freshContext();
  const loads = [];
  context.configure({
    defaultState: { scope: "default::1" },
    loadTenant: (tenantId, projectId) => {
      loads.push(`${tenantId}::${projectId}`);
      return { scope: `${tenantId}::${projectId}` };
    }
  });
  assert.equal(context.scopeKey(), "default::1");
  assert.equal(context.scopeKey("", ""), "default::1");
  assert.equal(context.stateForScope().scope, "default::1");
  assert.equal(context.runForScope(null, null, () => context.current().projectId), "1");
  assert.equal(context.runForScope("tenant-x", "project-a", () => context.proxy().scope), "tenant-x::project-a");
  assert.equal(context.stateForScope("tenant-x", "project-b").scope, "tenant-x::project-b");
  assert.equal(context.stateForScope("tenant-x", "project-b").scope, "tenant-x::project-b");
  assert.deepEqual(loads, ["tenant-x::project-a", "tenant-x::project-b"]);
  context.clearTenantCache("tenant-x");
  context.clearTenantCache();
  assert.equal(context.stateForScope("tenant-x", "project-a").scope, "tenant-x::project-a");
  assert.equal(loads.length, 3);
});
