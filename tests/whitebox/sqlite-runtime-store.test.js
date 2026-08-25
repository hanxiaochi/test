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
