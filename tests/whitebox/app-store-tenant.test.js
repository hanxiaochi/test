"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { SqliteRuntimeStore } = require("../../lib/storage/sqlite-runtime-store");

function freshStore(mode, root) {
  if (mode === undefined) delete process.env.APP_STORAGE;
  else process.env.APP_STORAGE = mode;
  process.env.APP_RUNTIME_DB_PATH = path.join(root, "runtime-db.json");
  process.env.APP_SQLITE_DB_PATH = path.join(root, "runtime.db");
  const contextPath = require.resolve("../../lib/business-state-context");
  const storePath = require.resolve("../../lib/app-store");
  delete require.cache[storePath];
  delete require.cache[contextPath];
  const context = require(contextPath);
  const store = require(storePath);
  return { context, store };
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zwkjy-tenant-store-test-"));
}

function cleanup(root) {
  const resolved = path.resolve(root);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("zwkjy-tenant-store-test-")) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

test("JSON tenant state persists separately without exposing default rows", () => {
  const root = tempRoot();
  const originalEnv = { storage: process.env.APP_STORAGE, json: process.env.APP_RUNTIME_DB_PATH, sqlite: process.env.APP_SQLITE_DB_PATH };
  try {
    const template = { client: { clientName: "Default" }, rows: [{ id: 1 }], calculationRules: { moneyDigits: 2 }, metadata: { secret: true } };
    fs.writeFileSync(path.join(root, "runtime-db.json"), JSON.stringify(template), "utf8");
    const { context, store } = freshStore("json", root);
    const defaultState = store.load(template);
    context.configure({ defaultState, loadTenant: (tenantId, projectId, source) => store.loadScope(tenantId, projectId, source) });
    const tenantState = context.stateForTenant("tenant/a");
    assert.deepEqual(tenantState.rows, []);
    assert.deepEqual(tenantState.metadata, {});
    assert.equal(tenantState.client.clientName, "tenant/a");
    tenantState.rows.push({ id: 2 });
    const saved = context.runForTenant("tenant/a", () => store.save(tenantState, { actor: "tester" }));
    assert.equal(saved.tenantId, "tenant/a");
    assert.ok(saved.file.includes(`${path.sep}tenants${path.sep}`));
    assert.equal(saved.file.includes("tenant/a"), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "runtime-db.json"), "utf8")).rows, [{ id: 1 }]);
    context.clearTenantCache("tenant/a");
    assert.deepEqual(context.stateForTenant("tenant/a").rows, [{ id: 2 }]);
    const projectTwo = context.stateForScope("tenant/a", "project-2");
    assert.deepEqual(projectTwo.rows, []);
    projectTwo.rows.push({ id: 22 });
    const projectTwoSave = context.runForScope("tenant/a", "project-2", () => store.save(projectTwo, { actor: "tester" }));
    assert.notEqual(projectTwoSave.file, saved.file);
    assert.deepEqual(context.stateForTenant("tenant/a").rows, [{ id: 2 }]);
    store.close();
  } finally {
    if (originalEnv.storage === undefined) delete process.env.APP_STORAGE; else process.env.APP_STORAGE = originalEnv.storage;
    if (originalEnv.json === undefined) delete process.env.APP_RUNTIME_DB_PATH; else process.env.APP_RUNTIME_DB_PATH = originalEnv.json;
    if (originalEnv.sqlite === undefined) delete process.env.APP_SQLITE_DB_PATH; else process.env.APP_SQLITE_DB_PATH = originalEnv.sqlite;
    cleanup(root);
  }
});

test("SQLite tenant state uses a separate transactional database", () => {
  const root = tempRoot();
  const originalEnv = { storage: process.env.APP_STORAGE, json: process.env.APP_RUNTIME_DB_PATH, sqlite: process.env.APP_SQLITE_DB_PATH };
  let store;
  let external;
  try {
    const fresh = freshStore("sqlite", root);
    const { context } = fresh;
    store = fresh.store;
    const template = { rows: [{ id: 1 }], calculationRules: { moneyDigits: 2 } };
    const defaultState = store.load(template);
    context.configure({ defaultState, loadTenant: (tenantId, projectId, source) => store.loadScope(tenantId, projectId, source) });
    external = new SqliteRuntimeStore(path.join(root, "runtime.db"));
    external.load();
    external.save({ ...defaultState, rows: [{ id: 7 }] }, { actor: "external" });
    defaultState.rows.push({ id: 8 });
    assert.throws(
      () => context.runForScope("default", "1", () => store.save(defaultState, { actor: "stale" })),
      (error) => error.code === "SQLITE_RUNTIME_CONFLICT"
    );
    assert.deepEqual(defaultState.rows, [{ id: 7 }]);
    defaultState.rows = [{ id: 10 }];
    assert.equal(context.runForScope("default", "1", () => store.save(defaultState, { actor: "retry" })).version, 3);
    const tenantState = context.stateForTenant("tenant-b");
    tenantState.rows.push({ id: 9 });
    const saved = context.runForTenant("tenant-b", () => store.save(tenantState, { actor: "tester", action: "tenant-write" }));
    assert.equal(saved.unchanged, false);
    const status = context.runForTenant("tenant-b", () => store.status());
    assert.equal(status.tenantId, "tenant-b");
    assert.ok(status.version >= 2);
    assert.ok(store.tenantSqliteFile("tenant-b").includes(`${path.sep}tenants${path.sep}`));
    assert.deepEqual(defaultState.rows, [{ id: 10 }]);
  } finally {
    if (external) external.close();
    if (store) store.close();
    if (originalEnv.storage === undefined) delete process.env.APP_STORAGE; else process.env.APP_STORAGE = originalEnv.storage;
    if (originalEnv.json === undefined) delete process.env.APP_RUNTIME_DB_PATH; else process.env.APP_RUNTIME_DB_PATH = originalEnv.json;
    if (originalEnv.sqlite === undefined) delete process.env.APP_SQLITE_DB_PATH; else process.env.APP_SQLITE_DB_PATH = originalEnv.sqlite;
    cleanup(root);
  }
});

test("SQLite is the default and migrates each legacy JSON scope exactly once", () => {
  const root = tempRoot();
  const originalEnv = { storage: process.env.APP_STORAGE, json: process.env.APP_RUNTIME_DB_PATH, sqlite: process.env.APP_SQLITE_DB_PATH };
  try {
    delete process.env.APP_STORAGE;
    process.env.APP_RUNTIME_DB_PATH = path.join(root, "runtime-db.json");
    process.env.APP_SQLITE_DB_PATH = path.join(root, "runtime.db");
    const defaultSeed = { rows: [{ id: 1, value: "json-seed" }], calculationRules: { moneyDigits: 2 } };
    fs.writeFileSync(process.env.APP_RUNTIME_DB_PATH, JSON.stringify(defaultSeed), "utf8");
    const { context, store } = freshStore(undefined, root);
    assert.equal(store.mode, "sqlite");
    const defaultState = store.load({ rows: [] });
    assert.deepEqual(defaultState, defaultSeed);
    context.configure({ defaultState, loadTenant: (tenantId, projectId, source) => store.loadScope(tenantId, projectId, source) });

    const tenantJson = store.tenantJsonFile("legacy-tenant", "project-2");
    fs.mkdirSync(path.dirname(tenantJson), { recursive: true });
    fs.writeFileSync(tenantJson, JSON.stringify({ rows: [{ id: 2, value: "tenant-json" }], calculationRules: { moneyDigits: 3 } }), "utf8");
    const migratedTenant = context.stateForScope("legacy-tenant", "project-2");
    assert.equal(migratedTenant.rows[0].value, "tenant-json");
    context.runForScope("legacy-tenant", "project-2", () => store.save({ ...migratedTenant, rows: [{ id: 3, value: "sqlite-newer" }] }, { actor: "tester", action: "edit", checkpoint: true }));
    assert.equal(context.runForScope("legacy-tenant", "project-2", () => store.history(10)).length, 2);
    const restored = context.runForScope("legacy-tenant", "project-2", () => store.restore(1, { actor: "tester" }));
    assert.equal(restored.version, 3);
    assert.equal(context.runForScope("legacy-tenant", "project-2", () => store.status()).version, 3);
    store.close();

    fs.writeFileSync(process.env.APP_RUNTIME_DB_PATH, "{corrupt-default-json", "utf8");
    fs.writeFileSync(tenantJson, "{corrupt-tenant-json", "utf8");
    const reopened = freshStore(undefined, root);
    const reopenedDefault = reopened.store.load({ rows: [] });
    assert.deepEqual(reopenedDefault, defaultSeed);
    reopened.context.configure({ defaultState: reopenedDefault, loadTenant: (tenantId, projectId, source) => reopened.store.loadScope(tenantId, projectId, source) });
    assert.equal(reopened.context.stateForScope("legacy-tenant", "project-2").rows[0].value, "tenant-json");
    reopened.store.close();
  } finally {
    if (originalEnv.storage === undefined) delete process.env.APP_STORAGE; else process.env.APP_STORAGE = originalEnv.storage;
    if (originalEnv.json === undefined) delete process.env.APP_RUNTIME_DB_PATH; else process.env.APP_RUNTIME_DB_PATH = originalEnv.json;
    if (originalEnv.sqlite === undefined) delete process.env.APP_SQLITE_DB_PATH; else process.env.APP_SQLITE_DB_PATH = originalEnv.sqlite;
    cleanup(root);
  }
});

test("default SQLite migration fails closed when the only legacy JSON source is corrupt", () => {
  const root = tempRoot();
  const originalEnv = { storage: process.env.APP_STORAGE, json: process.env.APP_RUNTIME_DB_PATH, sqlite: process.env.APP_SQLITE_DB_PATH };
  let store;
  try {
    fs.writeFileSync(path.join(root, "runtime-db.json"), "{invalid-json", "utf8");
    ({ store } = freshStore(undefined, root));
    assert.throws(() => store.load({ rows: [] }), SyntaxError);
    fs.rmSync(path.join(root, "runtime-db.json"));
    assert.deepEqual(store.load({ rows: [{ id: "fallback" }] }), { rows: [{ id: "fallback" }] });
  } finally {
    if (store) store.close();
    if (originalEnv.storage === undefined) delete process.env.APP_STORAGE; else process.env.APP_STORAGE = originalEnv.storage;
    if (originalEnv.json === undefined) delete process.env.APP_RUNTIME_DB_PATH; else process.env.APP_RUNTIME_DB_PATH = originalEnv.json;
    if (originalEnv.sqlite === undefined) delete process.env.APP_SQLITE_DB_PATH; else process.env.APP_SQLITE_DB_PATH = originalEnv.sqlite;
    cleanup(root);
  }
});
