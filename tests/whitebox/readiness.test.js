"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const readiness = require("../../lib/runtime/readiness");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "app-readiness-"));
}

function runtimeDb(file, state = {}, checksum = null) {
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE runtime_state(id INTEGER PRIMARY KEY, payload TEXT NOT NULL, checksum TEXT NOT NULL)");
  const payload = JSON.stringify(state);
  db.prepare("INSERT INTO runtime_state(id,payload,checksum) VALUES(1,?,?)").run(payload, checksum || readiness.digest(payload));
  db.close();
}

test("reports healthy SQLite runtime and dependency databases without exposing paths", () => {
  const root = tempRoot();
  const runtimeFile = path.join(root, "runtime.db");
  const dependencyFile = path.join(root, "security.db");
  runtimeDb(runtimeFile, { rows: [] });
  const dependency = new DatabaseSync(dependencyFile);
  dependency.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY)");
  const report = readiness.readinessReport({
    runtimeStatus: { mode: "sqlite", file: runtimeFile, exists: true },
    databases: [{ name: "security", db: dependency }],
    now: 0
  });
  assert.deepEqual(report, {
    status: "ready",
    storageMode: "sqlite",
    checkedAt: "1970-01-01T00:00:00.000Z",
    checks: [
      { name: "runtime", status: "ok", pendingWorkflowTransactions: 0 },
      { name: "security", status: "ok" }
    ]
  });
  assert.equal(JSON.stringify(report).includes(root), false);
  dependency.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("accepts a valid JSON runtime and detects pending workflow transactions", () => {
  const root = tempRoot();
  const file = path.join(root, "runtime.json");
  fs.writeFileSync(file, JSON.stringify({ rows: [] }));
  assert.equal(readiness.readinessReport({ runtimeStatus: { mode: "json", file, exists: true } }).status, "ready");
  fs.writeFileSync(file, JSON.stringify({ _workflowPendingTransactions: [{ id: "tx-1" }] }));
  const report = readiness.readinessReport({ runtimeStatus: { mode: "json", file, exists: true } });
  assert.equal(report.status, "unavailable");
  assert.equal(report.checks[0].code, "WORKFLOW_TRANSACTION_PENDING");
  assert.equal(readiness.pendingCount(null), 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("fails closed for missing, malformed, unsupported and uninitialized runtimes", () => {
  const root = tempRoot();
  const malformed = path.join(root, "bad.json");
  fs.writeFileSync(malformed, "{");
  assert.equal(readiness.readinessReport({ runtimeStatus: { mode: "json", file: malformed, exists: true } }).checks[0].code, "RUNTIME_INVALID");
  assert.equal(readiness.readinessReport({ runtimeStatus: { mode: "json", file: path.join(root, "missing"), exists: false } }).checks[0].code, "RUNTIME_NOT_FOUND");
  assert.equal(readiness.readinessReport({ runtimeStatus: { mode: "json", file: path.join(root, "missing"), exists: true } }).checks[0].code, "RUNTIME_NOT_FOUND");
  assert.equal(readiness.readinessReport({ runtimeStatus: { mode: "sqlite", file: path.join(root, "missing.db"), exists: true } }).checks[0].code, "RUNTIME_NOT_FOUND");
  assert.equal(readiness.readinessReport({ runtimeStatus: { mode: "memory" } }).checks[0].code, "STORAGE_MODE_UNSUPPORTED");
  assert.equal(readiness.readinessReport().storageMode, "unknown");
  const empty = path.join(root, "empty.db");
  const db = new DatabaseSync(empty);
  db.exec("CREATE TABLE runtime_state(id INTEGER PRIMARY KEY, payload TEXT, checksum TEXT)");
  db.close();
  assert.equal(readiness.readinessReport({ runtimeStatus: { mode: "sqlite", file: empty, exists: true } }).checks[0].code, "RUNTIME_NOT_INITIALIZED");
  fs.rmSync(root, { recursive: true, force: true });
});

test("detects checksum mismatch, invalid SQLite payload and pending transactions", () => {
  const root = tempRoot();
  const mismatch = path.join(root, "mismatch.db");
  runtimeDb(mismatch, {}, "invalid");
  assert.equal(readiness.readinessReport({ runtimeStatus: { mode: "sqlite", file: mismatch, exists: true } }).checks[0].code, "RUNTIME_CHECKSUM_MISMATCH");
  const invalid = path.join(root, "invalid.db");
  const invalidDb = new DatabaseSync(invalid);
  invalidDb.exec("CREATE TABLE runtime_state(id INTEGER PRIMARY KEY, payload TEXT, checksum TEXT)");
  invalidDb.prepare("INSERT INTO runtime_state VALUES(1,?,?)").run("{", readiness.digest("{"));
  invalidDb.close();
  assert.equal(readiness.readinessReport({ runtimeStatus: { mode: "sqlite", file: invalid, exists: true } }).checks[0].code, "RUNTIME_INVALID");
  const pending = path.join(root, "pending.db");
  runtimeDb(pending, { _workflowPendingTransactions: [{ id: "tx" }] });
  assert.equal(readiness.readinessReport({ runtimeStatus: { mode: "sqlite", file: pending, exists: true } }).checks[0].code, "WORKFLOW_TRANSACTION_PENDING");
  fs.rmSync(root, { recursive: true, force: true });
});

test("dependency checks fail closed for integrity errors, unavailable handles and exceptions", () => {
  const good = { prepare: () => ({ all: () => [{ quick_check: "ok" }] }) };
  const empty = { prepare: () => ({ all: () => [] }) };
  const corrupt = { prepare: () => ({ all: () => [{ quick_check: "broken" }] }) };
  const throwing = { prepare: () => { throw new Error("secret path"); } };
  assert.equal(readiness.quickCheck("good", good).status, "ok");
  assert.equal(readiness.quickCheck("empty", empty).code, "SQLITE_INTEGRITY_FAILED");
  assert.equal(readiness.quickCheck("corrupt", corrupt).code, "SQLITE_INTEGRITY_FAILED");
  assert.equal(readiness.quickCheck("throwing", throwing).code, "SQLITE_UNAVAILABLE");
  const report = readiness.readinessReport({
    runtimeStatus: { mode: "unsupported" },
    databases: [{ name: "missing" }, null]
  });
  assert.equal(report.status, "unavailable");
  assert.deepEqual(report.checks.slice(1).map((row) => row.code), ["SQLITE_UNAVAILABLE", "SQLITE_UNAVAILABLE"]);
  assert.equal(JSON.stringify(report).includes("secret path"), false);
});
