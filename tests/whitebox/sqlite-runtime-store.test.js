"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { SqliteRuntimeStore, checksum } = require("../../lib/storage/sqlite-runtime-store");

function withStore(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zwkjy-store-test-"));
  const store = new SqliteRuntimeStore(path.join(root, "runtime.db"));
  try {
    return fn(store);
  } finally {
    store.close();
    const resolved = path.resolve(root);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("zwkjy-store-test-")) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

test("checksum is deterministic", () => {
  assert.equal(checksum("abc"), checksum("abc"));
  assert.notEqual(checksum("abc"), checksum("abd"));
});

test("initialization, idempotent save, history, and restore are versioned", () => withStore((store) => {
  assert.equal(store.load(), null);
  assert.deepEqual(store.initialize({ value: 1 }, { actor: "tester" }), { value: 1 });
  assert.equal(store.status().version, 1);

  const unchanged = store.save({ value: 1 }, { actor: "tester" });
  assert.equal(unchanged.unchanged, true);
  assert.equal(unchanged.version, 1);

  const changed = store.save({ value: 2 }, { actor: "tester", action: "edit" });
  assert.equal(changed.unchanged, false);
  assert.equal(changed.version, 2);
  assert.deepEqual(store.load(), { value: 2 });
  assert.deepEqual(store.history(1).map((row) => row.version), [2]);
  assert.equal(store.history(1)[0].isCheckpoint, 0);
  assert.throws(() => store.restore(2), /not a restorable checkpoint/);

  const restored = store.restore(1, { actor: "admin" });
  assert.equal(restored.version, 3);
  assert.deepEqual(store.load(), { value: 1 });
  assert.deepEqual(store.history(10).map((row) => row.version), [3, 2, 1]);
  assert.equal(store.history(10)[0].isCheckpoint, 1);
}));

test("history limits are bounded and missing revisions fail closed", () => withStore((store) => {
  store.initialize({ value: 1 });
  assert.equal(store.history(0).length, 1);
  assert.throws(() => store.restore(99), /does not exist/);
}));

test("tampered current state is rejected by checksum verification", () => withStore((store) => {
  store.initialize({ value: 1 });
  store.db.prepare("UPDATE runtime_state SET payload = ? WHERE id = 1").run('{"value":999}');
  assert.throws(() => store.load(), /checksum mismatch/);
}));

test("invalid path and transaction failure surface clear errors", () => {
  assert.throws(() => new SqliteRuntimeStore(""), /path is required/);
  withStore((store) => {
    store.initialize({ value: 1 });
    store.db.exec("DROP TABLE runtime_revisions");
    assert.throws(() => store.save({ value: 2 }), /runtime_revisions/);
    assert.deepEqual(store.load(), { value: 1 });
  });
});

test("concurrent connections initialize atomically and reject stale writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zwkjy-store-test-"));
  const file = path.join(root, "runtime.db");
  const first = new SqliteRuntimeStore(file);
  const second = new SqliteRuntimeStore(file);
  let blind;
  try {
    assert.deepEqual(first.initialize({ value: 1 }, { actor: "first" }), { value: 1 });
    assert.deepEqual(second.initialize({ value: 999 }, { actor: "second" }), { value: 1 });
    assert.equal(first.history(10).length, 1);

    assert.deepEqual(second.load(), { value: 1 });
    assert.equal(first.save({ value: 2 }, { actor: "first" }).version, 2);
    assert.throws(
      () => second.save({ value: 3 }, { actor: "second" }),
      (error) => error.code === "SQLITE_RUNTIME_CONFLICT" && error.expectedVersion === 1 && error.actualVersion === 2
    );
    assert.deepEqual(first.load(), { value: 2 });
    assert.deepEqual(second.load(), { value: 2 });
    assert.equal(second.save({ value: 3 }, { actor: "second" }).version, 3);

    blind = new SqliteRuntimeStore(file);
    assert.throws(
      () => blind.save({ value: 4 }, { actor: "blind" }),
      (error) => error.code === "SQLITE_RUNTIME_CONFLICT" && error.expectedVersion === null && error.actualVersion === 3
    );
    assert.deepEqual(first.load(), { value: 3 });
  } finally {
    if (blind) blind.close();
    second.close();
    first.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
