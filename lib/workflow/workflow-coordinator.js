"use strict";

const PENDING_KEY = "_workflowPendingTransactions";
const MAX_PENDING = 100;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pendingRows(state) {
  if (!Array.isArray(state[PENDING_KEY])) state[PENDING_KEY] = [];
  return state[PENDING_KEY];
}

function beginPending(state, transaction) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Workflow business state is required");
  const id = String(transaction && transaction.id || "").trim();
  if (!id) throw new Error("Workflow transaction id is required");
  const rows = pendingRows(state);
  if (rows.some((item) => item.id === id)) throw new Error("Workflow transaction id already exists");
  if (rows.length >= MAX_PENDING) throw new Error("Too many pending workflow transactions");
  const targets = Array.isArray(transaction.targets) ? transaction.targets : [];
  if (!targets.length || targets.length > 500) throw new Error("Workflow transaction targets are invalid");
  const record = clone({
    id,
    tenantId: transaction.tenantId,
    projectId: transaction.projectId,
    module: transaction.module,
    action: transaction.action,
    createdAt: transaction.createdAt || new Date().toISOString(),
    targets,
    logIds: Array.isArray(transaction.logIds) ? transaction.logIds : []
  });
  rows.push(record);
  return record;
}

function removePending(state, transactionId) {
  const rows = Array.isArray(state[PENDING_KEY]) ? state[PENDING_KEY] : [];
  const index = rows.findIndex((item) => item.id === transactionId);
  if (index < 0) return null;
  const [record] = rows.splice(index, 1);
  if (!rows.length) delete state[PENDING_KEY];
  return record;
}

function cleanTransactionLogs(state, transactionId, remove) {
  if (!Array.isArray(state.workflowLogs)) return;
  if (remove) {
    state.workflowLogs = state.workflowLogs.filter((log) => log.workflowTransactionId !== transactionId);
    return;
  }
  state.workflowLogs.forEach((log) => {
    if (log.workflowTransactionId === transactionId) delete log.workflowTransactionId;
  });
}

function instanceOutcome(workflowStore, record) {
  const outcomes = record.targets.map((target) => {
    const instance = workflowStore.getInstance(record.tenantId, record.projectId, record.module, target.instanceKey);
    if (!instance || Number(instance.revision) < Number(target.expectedRevision)) return "not-committed";
    if (Number(instance.revision) === Number(target.expectedRevision) && instance.currentState === target.expectedState) return "committed";
    return "inconsistent";
  });
  if (outcomes.every((value) => value === "committed")) return "committed";
  if (outcomes.every((value) => value === "not-committed")) return "rolled-back";
  throw new Error(`Workflow transaction ${record.id} is partially committed`);
}

function restoreTargets(state, record, resolveConfig) {
  const config = resolveConfig(record.module);
  if (!config || !Array.isArray(config.rows) || !config.key) throw new Error(`Workflow module ${record.module} cannot be recovered`);
  record.targets.forEach((target) => {
    const row = config.rows.find((item) => String(item[config.key] || item.id) === String(target.businessId));
    if (!row) throw new Error(`Workflow business row ${record.module}:${target.businessId} cannot be recovered`);
    Reflect.ownKeys(row).forEach((key) => Reflect.deleteProperty(row, key));
    Object.assign(row, clone(target.before));
  });
  cleanTransactionLogs(state, record.id, true);
}

function recoverPending(state, options) {
  const rows = Array.isArray(state && state[PENDING_KEY]) ? [...state[PENDING_KEY]] : [];
  const summary = { changed: false, committed: 0, rolledBack: 0, transactionIds: [] };
  rows.forEach((record) => {
    if (String(record.tenantId) !== String(options.tenantId) || String(record.projectId) !== String(options.projectId)) {
      throw new Error(`Workflow transaction ${record.id} belongs to another business scope`);
    }
    const outcome = instanceOutcome(options.workflowStore, record);
    if (outcome === "rolled-back") {
      restoreTargets(state, record, options.resolveConfig);
      summary.rolledBack += 1;
    } else {
      cleanTransactionLogs(state, record.id, false);
      summary.committed += 1;
    }
    removePending(state, record.id);
    summary.changed = true;
    summary.transactionIds.push(record.id);
  });
  return summary;
}

function finalizePending(state, transactionId) {
  cleanTransactionLogs(state, transactionId, false);
  return removePending(state, transactionId);
}

module.exports = { MAX_PENDING, PENDING_KEY, beginPending, finalizePending, recoverPending };
