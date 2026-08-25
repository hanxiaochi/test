"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function serializeRules(rules) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw new Error("Calculation rules must be an object");
  return JSON.stringify(canonicalize(rules));
}

function checksum(payload) {
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

class RuleStore {
  constructor(file, options = {}) {
    if (!file) throw new Error("Rule database path is required");
    this.file = path.resolve(file);
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rule_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS calculation_rule_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '*',
        version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
        rules_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        change_reason TEXT NOT NULL,
        created_by INTEGER,
        created_at TEXT NOT NULL,
        activated_at TEXT,
        UNIQUE(tenant_id, project_id, version)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_one_active
        ON calculation_rule_versions(tenant_id, project_id) WHERE status = 'active';
    `);
    this.db.prepare("INSERT OR IGNORE INTO rule_migrations(version, applied_at) VALUES(1, ?)").run(this.nowIso());
  }

  nowIso() {
    return new Date(this.now()).toISOString();
  }

  createVersion(options = {}) {
    const tenantId = String(options.tenantId || "default");
    const projectId = String(options.projectId || "*");
    const payload = serializeRules(options.rules);
    const digest = checksum(payload);
    const activate = options.activate !== false;
    const now = this.nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const latest = this.db.prepare(`
        SELECT COALESCE(MAX(version), 0) AS version FROM calculation_rule_versions
        WHERE tenant_id = ? AND project_id = ?
      `).get(tenantId, projectId);
      const version = Number(latest.version) + 1;
      if (activate) {
        this.db.prepare(`
          UPDATE calculation_rule_versions SET status = 'retired'
          WHERE tenant_id = ? AND project_id = ? AND status = 'active'
        `).run(tenantId, projectId);
      }
      const result = this.db.prepare(`
        INSERT INTO calculation_rule_versions(
          tenant_id, project_id, version, status, rules_json, checksum,
          change_reason, created_by, created_at, activated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId,
        projectId,
        version,
        activate ? "active" : "draft",
        payload,
        digest,
        String(options.changeReason || "规则调整"),
        options.createdBy || null,
        now,
        activate ? now : null
      );
      this.db.exec("COMMIT");
      return this.getById(Number(result.lastInsertRowid));
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  rowView(row) {
    if (!row) return null;
    if (checksum(row.rules_json) !== row.checksum) throw new Error(`Calculation rule version ${row.id} checksum mismatch`);
    return {
      id: Number(row.id),
      tenantId: row.tenant_id,
      projectId: row.project_id,
      version: Number(row.version),
      status: row.status,
      rules: JSON.parse(row.rules_json),
      checksum: row.checksum,
      changeReason: row.change_reason,
      createdBy: row.created_by === null ? null : Number(row.created_by),
      createdAt: row.created_at,
      activatedAt: row.activated_at
    };
  }

  getById(id) {
    return this.rowView(this.db.prepare("SELECT * FROM calculation_rule_versions WHERE id = ?").get(Number(id)));
  }

  getActive(tenantId = "default", projectId = "*") {
    const exact = this.db.prepare(`
      SELECT * FROM calculation_rule_versions
      WHERE tenant_id = ? AND project_id = ? AND status = 'active'
    `).get(String(tenantId), String(projectId));
    if (exact) return this.rowView(exact);
    if (String(projectId) === "*") return null;
    return this.rowView(this.db.prepare(`
      SELECT * FROM calculation_rule_versions
      WHERE tenant_id = ? AND project_id = '*' AND status = 'active'
    `).get(String(tenantId)));
  }

  history(tenantId = "default", projectId = "*", limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    return this.db.prepare(`
      SELECT * FROM calculation_rule_versions
      WHERE tenant_id = ? AND project_id = ?
      ORDER BY version DESC LIMIT ?
    `).all(String(tenantId), String(projectId), safeLimit).map((row) => this.rowView(row));
  }

  activate(options = {}) {
    const id = Number(options.id);
    const tenantId = options.tenantId === undefined ? null : String(options.tenantId);
    const target = tenantId === null
      ? this.db.prepare("SELECT * FROM calculation_rule_versions WHERE id = ?").get(id)
      : this.db.prepare("SELECT * FROM calculation_rule_versions WHERE id = ? AND tenant_id = ?").get(id, tenantId);
    if (!target) throw new Error("Calculation rule version does not exist");
    this.rowView(target);
    const now = this.nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        UPDATE calculation_rule_versions SET status = 'retired'
        WHERE tenant_id = ? AND project_id = ? AND status = 'active'
      `).run(target.tenant_id, target.project_id);
      this.db.prepare("UPDATE calculation_rule_versions SET status = 'active', activated_at = ? WHERE id = ?").run(now, id);
      this.db.exec("COMMIT");
      return this.getById(id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}

module.exports = { RuleStore, canonicalize, checksum, serializeRules };
