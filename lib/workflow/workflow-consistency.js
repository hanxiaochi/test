"use strict";

const { PENDING_KEY } = require("./workflow-coordinator");

const DEFAULT_PENDING_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_ISSUES = 1000;
const MAX_SCANNED_INSTANCES = 1000000;

function scanWorkflowConsistency(options = {}) {
  const state = options.state;
  const store = options.workflowStore;
  const tenantId = String(options.tenantId || "");
  const projectId = String(options.projectId || "");
  const modules = Array.isArray(options.modules) ? options.modules : [];
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Workflow consistency state is required");
  if (!store || typeof store.listInstances !== "function" || typeof store.eventStats !== "function") throw new Error("Workflow consistency store is required");
  if (!tenantId || !projectId) throw new Error("Workflow consistency scope is required");
  const now = Number(options.now === undefined ? Date.now() : options.now);
  const pendingMaxAgeMs = Math.max(1000, Number(options.pendingMaxAgeMs) || DEFAULT_PENDING_MAX_AGE_MS);
  const instancePageSize = Math.max(1, Math.min(5000, Number(options.instancePageSize) || 5000));
  const maxScannedInstances = options.maxScannedInstances === undefined
    ? MAX_SCANNED_INSTANCES
    : Math.max(instancePageSize, Math.min(MAX_SCANNED_INSTANCES, Number(options.maxScannedInstances) || MAX_SCANNED_INSTANCES));
  const issues = [];
  let truncated = false;
  const addIssue = (severity, code, details = {}) => {
    if (issues.length >= MAX_ISSUES) {
      truncated = true;
      return;
    }
    issues.push({ severity, code, ...details });
  };
  const totals = { modules: modules.length, businessRows: 0, linkedRows: 0, instances: 0, events: 0, pendingTransactions: 0 };

  modules.forEach((moduleConfig) => {
    const module = String(moduleConfig.code || "");
    const rows = Array.isArray(moduleConfig.rows) ? moduleConfig.rows : [];
    const key = String(moduleConfig.key || "");
    if (!module || !key) throw new Error("Workflow consistency module configuration is invalid");
    const instances = [];
    for (let offset = 0; ; offset += instancePageSize) {
      if (offset >= maxScannedInstances) throw new Error(`Workflow module ${module} exceeds the consistency scan limit`);
      const page = store.listInstances(tenantId, projectId, module, { limit: instancePageSize, offset });
      instances.push(...page);
      if (page.length < instancePageSize) break;
    }
    const instancesByKey = new Map(instances.map((instance) => [instance.businessId, instance]));
    const linkedKeys = new Map();
    totals.businessRows += rows.length;
    totals.instances += instances.length;

    rows.forEach((row) => {
      const businessId = String(row[key] || row.id || "");
      const instanceKey = String(row.workflowInstanceKey || "");
      if (!instanceKey) return;
      totals.linkedRows += 1;
      if (linkedKeys.has(instanceKey)) {
        addIssue("error", "DUPLICATE_WORKFLOW_INSTANCE_KEY", { module, businessId, instanceKey, relatedBusinessId: linkedKeys.get(instanceKey) });
        return;
      }
      linkedKeys.set(instanceKey, businessId);
      const instance = instancesByKey.get(instanceKey);
      if (!instance) {
        addIssue("error", "MISSING_WORKFLOW_INSTANCE", { module, businessId, instanceKey });
        return;
      }
      if (String(row.states || "") !== String(instance.currentStateLabel || "")) {
        addIssue("error", "WORKFLOW_STATE_MISMATCH", { module, businessId, instanceKey, businessState: String(row.states || ""), workflowState: instance.currentStateLabel });
      }
    });

    instances.forEach((instance) => {
      const eventStats = store.eventStats({ tenantId, projectId, module, businessId: instance.businessId });
      totals.events += eventStats.count;
      const contiguous = eventStats.count === 0
        ? Number(instance.revision) === 0
        : eventStats.firstRevision === 1 && eventStats.latestRevision === eventStats.count;
      if (!contiguous || eventStats.latestRevision !== Number(instance.revision)) {
        addIssue("error", "WORKFLOW_EVENT_REVISION_GAP", { module, instanceKey: instance.businessId, instanceRevision: instance.revision, latestEventRevision: eventStats.latestRevision, firstEventRevision: eventStats.firstRevision, eventCount: eventStats.count });
      }
      if (!linkedKeys.has(instance.businessId)) {
        addIssue("info", "ORPHAN_WORKFLOW_AUDIT_HISTORY", { module, instanceKey: instance.businessId, revision: instance.revision });
      }
    });
  });

  const pending = Array.isArray(state[PENDING_KEY]) ? state[PENDING_KEY] : [];
  pending.forEach((transaction) => {
    if (String(transaction.tenantId) !== tenantId || String(transaction.projectId) !== projectId) {
      addIssue("error", "CROSS_SCOPE_PENDING_TRANSACTION", { transactionId: transaction.id });
      return;
    }
    totals.pendingTransactions += 1;
    const createdAt = Date.parse(transaction.createdAt);
    const ageMs = Number.isFinite(createdAt) && Number.isFinite(now) ? Math.max(0, now - createdAt) : null;
    addIssue(ageMs === null || ageMs > pendingMaxAgeMs ? "error" : "warning", "PENDING_WORKFLOW_TRANSACTION", { transactionId: transaction.id, module: transaction.module, ageMs });
  });

  const counts = issues.reduce((result, issue) => {
    result[issue.severity] += 1;
    return result;
  }, { error: 0, warning: 0, info: 0 });
  return {
    status: counts.error ? "error" : counts.warning ? "warning" : "ok",
    tenantId,
    projectId,
    checkedAt: new Date(Number.isFinite(now) ? now : Date.now()).toISOString(),
    totals,
    counts,
    truncated,
    issues
  };
}

module.exports = { DEFAULT_PENDING_MAX_AGE_MS, MAX_ISSUES, MAX_SCANNED_INSTANCES, scanWorkflowConsistency };
