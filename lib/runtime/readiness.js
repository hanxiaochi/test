"use strict";

const crypto = require("crypto");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

function digest(payload) {
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function ok(name, details = {}) {
  return { name, status: "ok", ...details };
}

function failed(name, code) {
  return { name, status: "failed", code };
}

function quickCheck(name, db) {
  try {
    const rows = db.prepare("PRAGMA quick_check").all();
    const values = rows.flatMap((row) => Object.values(row)).map(String);
    return values.length > 0 && values.every((value) => value.toLowerCase() === "ok")
      ? ok(name)
      : failed(name, "SQLITE_INTEGRITY_FAILED");
  } catch (_error) {
    return failed(name, "SQLITE_UNAVAILABLE");
  }
}

function pendingCount(state) {
  return Array.isArray(state && state._workflowPendingTransactions)
    ? state._workflowPendingTransactions.length
    : 0;
}

function inspectJsonRuntime(status) {
  try {
    if (!status.exists || !fs.existsSync(status.file)) return failed("runtime", "RUNTIME_NOT_FOUND");
    const state = JSON.parse(fs.readFileSync(status.file, "utf8"));
    const pending = pendingCount(state);
    return pending ? failed("runtime", "WORKFLOW_TRANSACTION_PENDING") : ok("runtime", { pendingWorkflowTransactions: 0 });
  } catch (_error) {
    return failed("runtime", "RUNTIME_INVALID");
  }
}

function inspectSqliteRuntime(status) {
  let db;
  try {
    if (!status.exists || !fs.existsSync(status.file)) return failed("runtime", "RUNTIME_NOT_FOUND");
    db = new DatabaseSync(status.file, { readOnly: true });
    const integrity = quickCheck("runtime", db);
    if (integrity.status !== "ok") return integrity;
    const row = db.prepare("SELECT payload, checksum FROM runtime_state WHERE id=1").get();
    if (!row) return failed("runtime", "RUNTIME_NOT_INITIALIZED");
    if (digest(row.payload) !== row.checksum) return failed("runtime", "RUNTIME_CHECKSUM_MISMATCH");
    const state = JSON.parse(row.payload);
    const pending = pendingCount(state);
    return pending ? failed("runtime", "WORKFLOW_TRANSACTION_PENDING") : ok("runtime", { pendingWorkflowTransactions: 0 });
  } catch (_error) {
    return failed("runtime", "RUNTIME_INVALID");
  } finally {
    if (db) db.close();
  }
}

function readinessReport(options = {}) {
  const status = options.runtimeStatus || {};
  const checks = [];
  if (status.mode === "sqlite") checks.push(inspectSqliteRuntime(status));
  else if (status.mode === "json") checks.push(inspectJsonRuntime(status));
  else checks.push(failed("runtime", "STORAGE_MODE_UNSUPPORTED"));

  (options.databases || []).forEach((entry) => {
    checks.push(entry && entry.db ? quickCheck(String(entry.name || "database"), entry.db) : failed(String(entry && entry.name || "database"), "SQLITE_UNAVAILABLE"));
  });
  const ready = checks.length > 0 && checks.every((check) => check.status === "ok");
  return {
    status: ready ? "ready" : "unavailable",
    storageMode: String(status.mode || "unknown"),
    checkedAt: new Date(options.now === undefined ? Date.now() : options.now).toISOString(),
    checks
  };
}

module.exports = { digest, pendingCount, quickCheck, readinessReport };
