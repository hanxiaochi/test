"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { hasPermission } = require("../security/auth-core");

const CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

class WorkflowError extends Error {
  constructor(message, code, status = 400, details = {}) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.status = status;
    Object.assign(this, details);
  }
}

function text(value, label, maxLength = 200) {
  const result = String(value || "").trim();
  if (!result) throw new WorkflowError(`${label} is required`, "WORKFLOW_VALIDATION_FAILED");
  if (result.length > maxLength) throw new WorkflowError(`${label} is too long`, "WORKFLOW_VALIDATION_FAILED");
  return result;
}

function code(value, label) {
  const result = text(value, label, 64).toLowerCase();
  if (!CODE_PATTERN.test(result)) throw new WorkflowError(`${label} is invalid`, "WORKFLOW_VALIDATION_FAILED");
  return result;
}

function normalizeDefinition(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new WorkflowError("Workflow definition must be an object", "WORKFLOW_VALIDATION_FAILED");
  }
  if (!Array.isArray(input.states) || input.states.length < 2 || input.states.length > 30) {
    throw new WorkflowError("Workflow states must contain 2 to 30 entries", "WORKFLOW_VALIDATION_FAILED");
  }
  const states = input.states.map((item) => ({
    code: code(item && item.code, "State code"),
    label: text(item && item.label, "State label", 40),
    terminal: Boolean(item && item.terminal)
  }));
  if (new Set(states.map((item) => item.code)).size !== states.length) {
    throw new WorkflowError("Workflow state codes must be unique", "WORKFLOW_VALIDATION_FAILED");
  }
  if (new Set(states.map((item) => item.label)).size !== states.length) {
    throw new WorkflowError("Workflow state labels must be unique", "WORKFLOW_VALIDATION_FAILED");
  }
  const stateCodes = new Set(states.map((item) => item.code));
  const initialState = code(input.initialState, "Initial state");
  if (!stateCodes.has(initialState)) throw new WorkflowError("Initial state does not exist", "WORKFLOW_VALIDATION_FAILED");
  if (!Array.isArray(input.transitions) || input.transitions.length < 1 || input.transitions.length > 100) {
    throw new WorkflowError("Workflow transitions must contain 1 to 100 entries", "WORKFLOW_VALIDATION_FAILED");
  }
  const transitions = input.transitions.map((item) => {
    const action = code(item && item.action, "Transition action");
    const from = Array.isArray(item && item.from) ? item.from.map((value) => code(value, "Transition source")) : [];
    const to = code(item && item.to, "Transition target");
    if (!from.length || new Set(from).size !== from.length) {
      throw new WorkflowError("Transition sources must be a non-empty unique list", "WORKFLOW_VALIDATION_FAILED");
    }
    if (from.some((value) => !stateCodes.has(value)) || !stateCodes.has(to)) {
      throw new WorkflowError("Transition references an unknown state", "WORKFLOW_VALIDATION_FAILED");
    }
    if (from.includes(to)) throw new WorkflowError("Transition must change state", "WORKFLOW_VALIDATION_FAILED");
    return {
      action,
      label: text(item && (item.label || item.action), "Transition label", 40),
      from,
      to,
      permission: text(item && (item.permission || "data:write"), "Transition permission", 80),
      requireRemark: Boolean(item && item.requireRemark)
    };
  });
  const keys = transitions.flatMap((item) => item.from.map((from) => `${item.action}:${from}`));
  if (new Set(keys).size !== keys.length) {
    throw new WorkflowError("An action may have only one target from each state", "WORKFLOW_VALIDATION_FAILED");
  }
  return { initialState, states, transitions };
}

function defaultDefinition() {
  return normalizeDefinition({
    initialState: "draft",
    states: [
      { code: "draft", label: "草稿" },
      { code: "pending", label: "审核中" },
      { code: "approved", label: "已审核" },
      { code: "returned", label: "已退回" },
      { code: "adjusted", label: "已调整" },
      { code: "updated", label: "已更新" },
      { code: "archived", label: "已归档", terminal: true }
    ],
    transitions: [
      { action: "submit", label: "提交审核", from: ["draft", "returned", "adjusted", "updated"], to: "pending", permission: "data:write" },
      { action: "approve", label: "审核通过", from: ["pending"], to: "approved", permission: "data:write" },
      { action: "return", label: "退回修改", from: ["pending", "approved", "adjusted", "updated"], to: "returned", permission: "data:write", requireRemark: true },
      { action: "adjust", label: "调整", from: ["draft", "pending", "approved", "returned", "updated"], to: "adjusted", permission: "data:write", requireRemark: true },
      { action: "update", label: "确认更新", from: ["pending", "returned", "adjusted"], to: "updated", permission: "data:write" },
      { action: "archive", label: "归档", from: ["pending", "approved", "updated"], to: "archived", permission: "data:write" }
    ]
  });
}

function definitionPayload(definition) {
  return JSON.stringify(normalizeDefinition(definition));
}

function definitionChecksum(payload) {
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

class WorkflowStore {
  constructor(file, options = {}) {
    if (!file) throw new Error("Workflow database path is required");
    this.file = path.resolve(file);
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        module TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft','active','retired')),
        definition_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        change_reason TEXT NOT NULL,
        created_by INTEGER,
        created_at TEXT NOT NULL,
        activated_at TEXT,
        UNIQUE(tenant_id, project_id, module, version)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_definition_active
        ON workflow_definitions(tenant_id, project_id, module) WHERE status='active';
      CREATE TABLE IF NOT EXISTS workflow_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        module TEXT NOT NULL,
        business_id TEXT NOT NULL,
        business_no TEXT NOT NULL DEFAULT '',
        definition_id INTEGER NOT NULL REFERENCES workflow_definitions(id),
        current_state TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, project_id, module, business_id)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_instances_scope
        ON workflow_instances(tenant_id, project_id, module, current_state);
      CREATE TABLE IF NOT EXISTS workflow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        action TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        actor_user_id INTEGER,
        actor_account TEXT NOT NULL,
        remark TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(instance_id, revision)
      );
    `);
    this.db.prepare("INSERT OR IGNORE INTO workflow_migrations(version, applied_at) VALUES(1, ?)").run(this.nowIso());
  }

  nowIso() {
    return new Date(this.now()).toISOString();
  }

  transaction(run) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        error.rollbackError = rollbackError.message;
      }
      throw error;
    }
  }

  definitionView(row) {
    if (!row) return null;
    if (definitionChecksum(row.definition_json) !== row.checksum) {
      throw new WorkflowError(`Workflow definition ${row.id} checksum mismatch`, "WORKFLOW_DEFINITION_TAMPERED", 500);
    }
    return {
      id: Number(row.id), tenantId: row.tenant_id, projectId: row.project_id, module: row.module,
      version: Number(row.version), status: row.status, definition: normalizeDefinition(JSON.parse(row.definition_json)),
      changeReason: row.change_reason, createdBy: row.created_by === null ? null : Number(row.created_by),
      createdAt: row.created_at, activatedAt: row.activated_at
    };
  }

  createVersion(options = {}) {
    const tenantId = text(options.tenantId || "default", "Tenant id", 100);
    const projectId = text(options.projectId || "*", "Project id", 100);
    const module = code(options.module, "Workflow module");
    const definition = normalizeDefinition(options.definition);
    const payload = definitionPayload(definition);
    const activate = options.activate !== false;
    const now = this.nowIso();
    return this.transaction(() => {
      const latest = this.db.prepare("SELECT COALESCE(MAX(version),0) version FROM workflow_definitions WHERE tenant_id=? AND project_id=? AND module=?").get(tenantId, projectId, module);
      const version = Number(latest.version) + 1;
      if (activate) this.db.prepare("UPDATE workflow_definitions SET status='retired' WHERE tenant_id=? AND project_id=? AND module=? AND status='active'").run(tenantId, projectId, module);
      const result = this.db.prepare(`INSERT INTO workflow_definitions
        (tenant_id,project_id,module,version,status,definition_json,checksum,change_reason,created_by,created_at,activated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(tenantId, projectId, module, version, activate ? "active" : "draft", payload, definitionChecksum(payload), text(options.changeReason || "流程调整", "Change reason", 500), options.createdBy || null, now, activate ? now : null);
      return this.getDefinition(Number(result.lastInsertRowid));
    });
  }

  getDefinition(id) {
    return this.definitionView(this.db.prepare("SELECT * FROM workflow_definitions WHERE id=?").get(Number(id)));
  }

  getActive(tenantId, projectId, module) {
    const exact = this.db.prepare("SELECT * FROM workflow_definitions WHERE tenant_id=? AND project_id=? AND module=? AND status='active'").get(String(tenantId), String(projectId), code(module, "Workflow module"));
    if (exact) return this.definitionView(exact);
    if (String(projectId) === "*") return null;
    return this.definitionView(this.db.prepare("SELECT * FROM workflow_definitions WHERE tenant_id=? AND project_id='*' AND module=? AND status='active'").get(String(tenantId), code(module, "Workflow module")));
  }

  history(tenantId, projectId, module, limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    return this.db.prepare("SELECT * FROM workflow_definitions WHERE tenant_id=? AND project_id=? AND module=? ORDER BY version DESC LIMIT ?").all(String(tenantId), String(projectId), code(module, "Workflow module"), safeLimit).map((row) => this.definitionView(row));
  }

  activate(options = {}) {
    const target = this.db.prepare("SELECT * FROM workflow_definitions WHERE id=? AND tenant_id=? AND project_id=? AND module=?").get(Number(options.id), String(options.tenantId), String(options.projectId), code(options.module, "Workflow module"));
    if (!target) throw new WorkflowError("Workflow definition does not exist", "WORKFLOW_DEFINITION_NOT_FOUND", 404);
    this.definitionView(target);
    return this.transaction(() => {
      this.db.prepare("UPDATE workflow_definitions SET status='retired' WHERE tenant_id=? AND project_id=? AND module=? AND status='active'").run(target.tenant_id, target.project_id, target.module);
      this.db.prepare("UPDATE workflow_definitions SET status='active',activated_at=? WHERE id=?").run(this.nowIso(), Number(target.id));
      return this.getDefinition(Number(target.id));
    });
  }

  instanceView(row) {
    if (!row) return null;
    const definition = this.getDefinition(Number(row.definition_id));
    const state = definition.definition.states.find((item) => item.code === row.current_state);
    return {
      id: Number(row.id), tenantId: row.tenant_id, projectId: row.project_id, module: row.module,
      businessId: row.business_id, businessNo: row.business_no, definitionId: Number(row.definition_id),
      definitionVersion: definition.version, currentState: row.current_state, currentStateLabel: state ? state.label : row.current_state,
      revision: Number(row.revision), createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  getInstance(tenantId, projectId, module, businessId) {
    return this.instanceView(this.db.prepare("SELECT * FROM workflow_instances WHERE tenant_id=? AND project_id=? AND module=? AND business_id=?").get(String(tenantId), String(projectId), code(module, "Workflow module"), String(businessId)));
  }

  listInstances(tenantId, projectId, module, options = 1000) {
    const requestedLimit = options && typeof options === "object" ? options.limit : options;
    const requestedOffset = options && typeof options === "object" ? options.offset : 0;
    const safeLimit = Math.max(1, Math.min(5000, Number(requestedLimit) || 1000));
    const safeOffset = Math.max(0, Number(requestedOffset) || 0);
    return this.db.prepare("SELECT * FROM workflow_instances WHERE tenant_id=? AND project_id=? AND module=? ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?")
      .all(String(tenantId), String(projectId), code(module, "Workflow module"), safeLimit, safeOffset)
      .map((row) => this.instanceView(row));
  }

  resolveInitialState(definition, label) {
    const value = String(label || "").trim();
    const aliases = { "待审核": "pending", "待处理": "pending", "上报": "pending", "处理中": "pending", "启用": "draft", "锁定": "draft" };
    const exact = definition.states.find((item) => item.code === value.toLowerCase() || item.label === value);
    return exact ? exact.code : aliases[value] && definition.states.some((item) => item.code === aliases[value]) ? aliases[value] : definition.initialState;
  }

  transition(options = {}) {
    const result = this.transitionBatch({
      ...options,
      items: [{
        businessId: options.businessId,
        businessNo: options.businessNo,
        currentStateLabel: options.currentStateLabel,
        expectedRevision: options.expectedRevision,
        action: options.action,
        remark: options.remark
      }],
      applyState: typeof options.applyState === "function" ? (results) => options.applyState(results[0]) : undefined
    });
    return result.results[0];
  }

  transitionBatch(options = {}) {
    const tenantId = text(options.tenantId || "default", "Tenant id", 100);
    const projectId = text(options.projectId || "1", "Project id", 100);
    const module = code(options.module, "Workflow module");
    const account = text(options.actorAccount, "Actor account", 100);
    const permissions = Array.isArray(options.permissions) ? options.permissions : [];
    if (!Array.isArray(options.items) || !options.items.length || options.items.length > 500) {
      throw new WorkflowError("Workflow batch must contain 1 to 500 items", "WORKFLOW_VALIDATION_FAILED");
    }
    const items = options.items.map((item) => {
      const businessId = text(item && item.businessId, "Business id", 100);
      const expectedValue = item && item.expectedRevision;
      const expectedRevision = expectedValue === undefined || expectedValue === null || expectedValue === "" ? null : Number(expectedValue);
      if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) throw new WorkflowError("Expected revision is invalid", "WORKFLOW_VALIDATION_FAILED");
      return {
        businessId,
        businessNo: String(item && item.businessNo || "").slice(0, 200),
        currentStateLabel: item && item.currentStateLabel,
        expectedRevision,
        action: code(item && item.action || options.action, "Workflow action"),
        remark: String(item && item.remark !== undefined ? item.remark : options.remark || "").trim().slice(0, 2000)
      };
    });
    if (new Set(items.map((item) => item.businessId)).size !== items.length) {
      throw new WorkflowError("Workflow batch contains duplicate business ids", "WORKFLOW_VALIDATION_FAILED");
    }
    return this.transaction(() => {
      const results = items.map((item) => {
        let row = this.db.prepare("SELECT * FROM workflow_instances WHERE tenant_id=? AND project_id=? AND module=? AND business_id=?").get(tenantId, projectId, module, item.businessId);
        if (!row) {
          const active = this.getActive(tenantId, projectId, module);
          if (!active) throw new WorkflowError("No active workflow definition", "WORKFLOW_DEFINITION_NOT_FOUND", 404);
          const now = this.nowIso();
          const initialState = this.resolveInitialState(active.definition, item.currentStateLabel);
          const inserted = this.db.prepare(`INSERT INTO workflow_instances
            (tenant_id,project_id,module,business_id,business_no,definition_id,current_state,revision,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,0,?,?)`).run(tenantId, projectId, module, item.businessId, item.businessNo, active.id, initialState, now, now);
          row = this.db.prepare("SELECT * FROM workflow_instances WHERE id=?").get(Number(inserted.lastInsertRowid));
        }
        if (item.expectedRevision !== null && Number(row.revision) !== item.expectedRevision) {
          throw new WorkflowError("Workflow has been updated; refresh and retry", "WORKFLOW_REVISION_CONFLICT", 409, { expectedRevision: item.expectedRevision, actualRevision: Number(row.revision), businessId: item.businessId });
        }
        const version = this.getDefinition(Number(row.definition_id));
        const transition = version.definition.transitions.find((candidate) => candidate.action === item.action && candidate.from.includes(row.current_state));
        if (!transition) throw new WorkflowError(`Action ${item.action} is not allowed from ${row.current_state}`, "WORKFLOW_TRANSITION_NOT_ALLOWED", 409, { currentState: row.current_state, businessId: item.businessId });
        if (!hasPermission(permissions, transition.permission)) throw new WorkflowError("No permission for workflow action", "WORKFLOW_PERMISSION_DENIED", 403, { requiredPermission: transition.permission, businessId: item.businessId });
        if (transition.requireRemark && !item.remark) throw new WorkflowError("Remark is required for this workflow action", "WORKFLOW_REMARK_REQUIRED", 400, { businessId: item.businessId });
        const revision = Number(row.revision) + 1;
        const now = this.nowIso();
        this.db.prepare("UPDATE workflow_instances SET current_state=?,revision=?,business_no=?,updated_at=? WHERE id=?").run(transition.to, revision, item.businessNo || row.business_no, now, Number(row.id));
        const event = this.db.prepare(`INSERT INTO workflow_events
          (instance_id,revision,action,from_state,to_state,actor_user_id,actor_account,remark,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)`).run(Number(row.id), revision, item.action, row.current_state, transition.to, options.actorUserId || null, account, item.remark, now);
        return { instance: this.getInstance(tenantId, projectId, module, item.businessId), eventId: Number(event.lastInsertRowid), action: item.action, fromState: row.current_state, toState: transition.to, toStateLabel: version.definition.states.find((state) => state.code === transition.to).label };
      });
      if (typeof options.applyState === "function") options.applyState(results);
      if (typeof options.beforeCommit === "function") options.beforeCommit(results);
      return { count: results.length, results };
    });
  }

  events(options = {}) {
    const instance = this.getInstance(options.tenantId, options.projectId, options.module, options.businessId);
    if (!instance) return [];
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
    return this.db.prepare("SELECT * FROM workflow_events WHERE instance_id=? ORDER BY revision DESC LIMIT ?").all(instance.id, limit).map((row) => ({
      id: Number(row.id), instanceId: Number(row.instance_id), revision: Number(row.revision), action: row.action,
      fromState: row.from_state, toState: row.to_state, actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id),
      actorAccount: row.actor_account, remark: row.remark, createdAt: row.created_at
    }));
  }

  eventStats(options = {}) {
    const instance = this.getInstance(options.tenantId, options.projectId, options.module, options.businessId);
    if (!instance) return { count: 0, firstRevision: 0, latestRevision: 0 };
    const row = this.db.prepare("SELECT COUNT(*) count,COALESCE(MIN(revision),0) first_revision,COALESCE(MAX(revision),0) latest_revision FROM workflow_events WHERE instance_id=?").get(instance.id);
    return { count: Number(row.count), firstRevision: Number(row.first_revision), latestRevision: Number(row.latest_revision) };
  }

  close() {
    this.db.close();
  }
}

module.exports = { WorkflowError, WorkflowStore, defaultDefinition, definitionChecksum, definitionPayload, normalizeDefinition };
