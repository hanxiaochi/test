"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  hasPermission,
  normalizeAccount,
  validatePasswordPolicy,
  verifyPassword
} = require("./auth-core");

const DUMMY_PASSWORD_HASH = hashPassword("invalid-login-placeholder", "00000000000000000000000000000000");

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function loginIdentityHash(identity = {}) {
  const normalized = [identity.ip, identity.tenantId, identity.account]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

class SecurityStore {
  constructor(file, options = {}) {
    if (!file) throw new Error("Security database path is required");
    this.file = path.resolve(file);
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA wal_autocheckpoint=250; PRAGMA journal_size_limit=16777216;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS security_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        account TEXT NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, account)
      );
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 0 CHECK (built_in IN (0, 1)),
        UNIQUE(tenant_id, code)
      );
      CREATE TABLE IF NOT EXISTS permissions (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY(user_id, role_id)
      );
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
        PRIMARY KEY(role_id, permission_code)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS security_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT,
        user_id INTEGER,
        action TEXT NOT NULL,
        result TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id TEXT NOT NULL DEFAULT '',
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit(created_at);
      CREATE TABLE IF NOT EXISTS login_failures (
        identity_hash TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL CHECK (attempts > 0),
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_login_failures_updated ON login_failures(updated_at);
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        project_key TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, project_key)
      );
      CREATE TABLE IF NOT EXISTS user_projects (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        PRIMARY KEY(user_id, project_id)
      );
      CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_user_projects_project ON user_projects(project_id);
    `);
    this.db.prepare("INSERT OR IGNORE INTO security_migrations(version, applied_at) VALUES(1, ?)").run(this.nowIso());
    this.db.prepare("INSERT OR IGNORE INTO security_migrations(version, applied_at) VALUES(2, ?)").run(this.nowIso());
    this.db.prepare("INSERT OR IGNORE INTO security_migrations(version, applied_at) VALUES(3, ?)").run(this.nowIso());
  }

  nowIso() {
    return new Date(this.now()).toISOString();
  }

  loginRateOptions(options = {}) {
    return {
      maxAttempts: positiveInteger(options.maxAttempts, 10),
      windowMs: positiveInteger(options.windowMs, 15 * 60 * 1000),
      maxEntries: positiveInteger(options.maxEntries, 10000)
    };
  }

  loginRateResult(row, policy, now) {
    if (!row) return { allowed: true, remaining: policy.maxAttempts, retryAfterSeconds: 0 };
    const blocked = Number(row.attempts) >= policy.maxAttempts;
    return {
      allowed: !blocked,
      remaining: Math.max(0, policy.maxAttempts - Number(row.attempts)),
      retryAfterSeconds: blocked ? Math.max(1, Math.ceil((policy.windowMs - (now - Number(row.started_at))) / 1000)) : 0
    };
  }

  pruneLoginFailures(now, policy) {
    this.db.prepare("DELETE FROM login_failures WHERE started_at <= ?").run(now - policy.windowMs);
    this.db.prepare(`
      DELETE FROM login_failures WHERE identity_hash IN (
        SELECT identity_hash FROM login_failures
        ORDER BY updated_at DESC, identity_hash DESC
        LIMIT -1 OFFSET ?
      )
    `).run(policy.maxEntries);
  }

  loginRateStatus(identity, options = {}) {
    const policy = this.loginRateOptions(options);
    const now = this.now();
    this.pruneLoginFailures(now, policy);
    const row = this.db.prepare("SELECT attempts, started_at FROM login_failures WHERE identity_hash = ?").get(loginIdentityHash(identity));
    return this.loginRateResult(row, policy, now);
  }

  recordLoginFailure(identity, options = {}) {
    const policy = this.loginRateOptions(options);
    const now = this.now();
    const identityHash = loginIdentityHash(identity);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.pruneLoginFailures(now, policy);
      this.db.prepare(`
        INSERT INTO login_failures(identity_hash, attempts, started_at, updated_at)
        VALUES(?, 1, ?, ?)
        ON CONFLICT(identity_hash) DO UPDATE SET
          attempts = login_failures.attempts + 1,
          updated_at = excluded.updated_at
      `).run(identityHash, now, now);
      this.pruneLoginFailures(now, policy);
      const row = this.db.prepare("SELECT attempts, started_at FROM login_failures WHERE identity_hash = ?").get(identityHash);
      this.db.exec("COMMIT");
      return this.loginRateResult(row, policy, now);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  recordLoginSuccess(identity) {
    return this.db.prepare("DELETE FROM login_failures WHERE identity_hash = ?").run(loginIdentityHash(identity)).changes > 0;
  }

  bootstrap(options = {}) {
    const tenantId = String(options.tenantId || "default");
    const tenantName = String(options.tenantName || "默认组织");
    const account = normalizeAccount(options.account || "ys1");
    const displayName = String(options.displayName || account);
    const password = String(options.password ?? "000000");
    const existingUser = this.db.prepare("SELECT id FROM users WHERE tenant_id = ? AND account = ?").get(tenantId, account);
    if (!existingUser && options.requireStrongPassword) {
      const policy = validatePasswordPolicy(password);
      if (!policy.ok) throw new Error(`Production bootstrap password is invalid: ${policy.failures.join("；")}`);
    }
    const now = this.nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO tenants(id, name, status, created_at, updated_at) VALUES(?, ?, 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
      `).run(tenantId, tenantName, now, now);
      this.db.prepare("INSERT OR IGNORE INTO permissions(code, name) VALUES('*', '全部权限')").run();
      this.db.prepare("INSERT OR IGNORE INTO permissions(code, name) VALUES('data:read', '查看业务数据')").run();
      this.db.prepare("INSERT OR IGNORE INTO permissions(code, name) VALUES('data:write', '修改业务数据')").run();
      this.db.prepare("INSERT OR IGNORE INTO permissions(code, name) VALUES('admin:access', '访问管理后台')").run();
      this.db.prepare("INSERT OR IGNORE INTO permissions(code, name) VALUES('admin:users', '管理用户与角色')").run();
      this.db.prepare("INSERT OR IGNORE INTO roles(tenant_id, code, name, built_in) VALUES(?, 'admin', '系统管理员', 1)").run(tenantId);
      this.db.prepare("INSERT OR IGNORE INTO roles(tenant_id, code, name, built_in) VALUES(?, 'editor', '业务编辑者', 1)").run(tenantId);
      this.db.prepare("INSERT OR IGNORE INTO roles(tenant_id, code, name, built_in) VALUES(?, 'viewer', '只读用户', 1)").run(tenantId);
      const role = this.db.prepare("SELECT id FROM roles WHERE tenant_id = ? AND code = 'admin'").get(tenantId);
      this.db.prepare("INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES(?, '*')").run(role.id);
      const editorRole = this.db.prepare("SELECT id FROM roles WHERE tenant_id = ? AND code = 'editor'").get(tenantId);
      const viewerRole = this.db.prepare("SELECT id FROM roles WHERE tenant_id = ? AND code = 'viewer'").get(tenantId);
      this.db.prepare("INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES(?, 'data:read')").run(editorRole.id);
      this.db.prepare("INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES(?, 'data:write')").run(editorRole.id);
      this.db.prepare("INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES(?, 'data:read')").run(viewerRole.id);
      this.db.prepare(`
        INSERT OR IGNORE INTO projects(tenant_id, project_key, name, status, created_at, updated_at)
        VALUES(?, '1', '默认项目', 'active', ?, ?)
      `).run(tenantId, now, now);
      let user = existingUser || this.db.prepare("SELECT id FROM users WHERE tenant_id = ? AND account = ?").get(tenantId, account);
      let created = false;
      if (!user) {
        const result = this.db.prepare(`
          INSERT INTO users(tenant_id, account, display_name, password_hash, status, must_change_password, created_at, updated_at)
          VALUES(?, ?, ?, ?, 'active', 1, ?, ?)
        `).run(tenantId, account, displayName, hashPassword(password), now, now);
        user = { id: Number(result.lastInsertRowid) };
        created = true;
      }
      this.db.prepare("INSERT OR IGNORE INTO user_roles(user_id, role_id) VALUES(?, ?)").run(user.id, role.id);
      this.db.exec("COMMIT");
      return { tenantId, userId: Number(user.id), account, created };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  audit(entry) {
    this.db.prepare(`
      INSERT INTO security_audit(
        tenant_id, user_id, action, result, target_type, target_id,
        ip_address, user_agent, details_json, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.tenantId || null,
      entry.userId || null,
      String(entry.action || "unknown"),
      String(entry.result || "unknown"),
      String(entry.targetType || ""),
      String(entry.targetId || ""),
      String(entry.ipAddress || ""),
      String(entry.userAgent || ""),
      JSON.stringify(entry.details || {}),
      this.nowIso()
    );
  }

  permissionsForUser(userId) {
    return this.db.prepare(`
      SELECT DISTINCT p.code
      FROM permissions p
      JOIN role_permissions rp ON rp.permission_code = p.code
      JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ?
      ORDER BY p.code
    `).all(Number(userId)).map((row) => row.code);
  }

  rolesForUser(userId) {
    return this.db.prepare(`
      SELECT r.code, r.name
      FROM roles r JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ? ORDER BY r.code
    `).all(Number(userId));
  }

  authenticate(options = {}) {
    const tenantId = String(options.tenantId || "default");
    const account = normalizeAccount(options.account);
    const user = this.db.prepare(`
      SELECT u.*, t.status AS tenant_status FROM users u
      JOIN tenants t ON t.id = u.tenant_id
      WHERE u.tenant_id = ? AND u.account = ?
    `).get(tenantId, account);
    const passwordOk = verifyPassword(options.password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
    if (!user || user.status !== "active" || user.tenant_status !== "active" || !passwordOk) {
      this.audit({
        tenantId,
        userId: user ? Number(user.id) : null,
        action: "login",
        result: "denied",
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        details: { account }
      });
      return null;
    }
    const token = createSessionToken();
    const createdAt = this.nowIso();
    const ttlMs = options.remember ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;
    const expiresAt = new Date(this.now() + ttlMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO sessions(token_hash, user_id, created_at, expires_at, ip_address, user_agent)
        VALUES(?, ?, ?, ?, ?, ?)
      `).run(hashSessionToken(token), user.id, createdAt, expiresAt, String(options.ipAddress || ""), String(options.userAgent || ""));
      this.audit({
        tenantId,
        userId: Number(user.id),
        action: "login",
        result: "success",
        ipAddress: options.ipAddress,
        userAgent: options.userAgent
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { token, expiresAt, user: this.userView(user) };
  }

  changePassword(options = {}) {
    const tenantId = String(options.tenantId || "default");
    const userId = Number(options.userId);
    const user = this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(userId, tenantId);
    if (!user || !verifyPassword(options.currentPassword, user.password_hash)) {
      this.audit({
        tenantId,
        userId: user ? userId : null,
        action: "password.change",
        result: "denied",
        targetType: "user",
        targetId: user ? String(userId) : "",
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        details: { reason: "current-password" }
      });
      throw new Error("当前密码不正确");
    }
    const policy = validatePasswordPolicy(options.newPassword);
    if (!policy.ok) throw new Error(policy.failures.join("；"));
    if (verifyPassword(options.newPassword, user.password_hash)) throw new Error("新密码不能与当前密码相同");
    const now = this.nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
        .run(hashPassword(options.newPassword), now, userId);
      this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, userId);
      this.audit({
        tenantId,
        userId,
        action: "password.change",
        result: "success",
        targetType: "user",
        targetId: String(userId),
        ipAddress: options.ipAddress,
        userAgent: options.userAgent
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.userView(this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId));
  }

  userView(user) {
    return {
      id: Number(user.id),
      tenantId: user.tenant_id,
      account: user.account,
      displayName: user.display_name,
      status: user.status,
      mustChangePassword: Boolean(user.must_change_password),
      roles: this.rolesForUser(user.id),
      permissions: this.permissionsForUser(user.id),
      projects: this.accessibleProjects(user.id, user.tenant_id)
    };
  }

  ensureProject(options = {}) {
    const tenantId = String(options.tenantId || "default");
    const projectKey = String(options.projectId ?? options.projectKey ?? "").trim();
    if (!projectKey) throw new Error("Project id is required");
    const tenant = this.db.prepare("SELECT id FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) throw new Error("Tenant does not exist");
    const status = String(options.status || "active");
    if (!["active", "disabled"].includes(status)) throw new Error("Invalid project status");
    const now = this.nowIso();
    this.db.prepare(`
      INSERT INTO projects(tenant_id, project_key, name, status, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, project_key) DO UPDATE SET
        name = excluded.name, status = excluded.status, updated_at = excluded.updated_at
    `).run(tenantId, projectKey, String(options.name || projectKey), status, now, now);
    return this.db.prepare(`
      SELECT id, tenant_id AS tenantId, project_key AS projectId, name, status,
        created_at AS createdAt, updated_at AS updatedAt
      FROM projects WHERE tenant_id = ? AND project_key = ?
    `).get(tenantId, projectKey);
  }

  listProjects(tenantId = "default") {
    return this.db.prepare(`
      SELECT id, tenant_id AS tenantId, project_key AS projectId, name, status,
        created_at AS createdAt, updated_at AS updatedAt
      FROM projects WHERE tenant_id = ? ORDER BY project_key
    `).all(String(tenantId));
  }

  accessibleProjects(userId, tenantId = "default") {
    const permissions = this.permissionsForUser(userId);
    if (hasPermission(permissions, "admin:access")) return this.listProjects(tenantId).filter((project) => project.status === "active");
    return this.db.prepare(`
      SELECT p.id, p.tenant_id AS tenantId, p.project_key AS projectId, p.name, p.status,
        p.created_at AS createdAt, p.updated_at AS updatedAt
      FROM projects p JOIN user_projects up ON up.project_id = p.id
      WHERE up.user_id = ? AND p.tenant_id = ? AND p.status = 'active'
      ORDER BY p.project_key
    `).all(Number(userId), String(tenantId));
  }

  canAccessProject(userId, tenantId, projectId) {
    return this.accessibleProjects(userId, tenantId).some((project) => project.projectId === String(projectId));
  }

  setUserProjects(options = {}) {
    const tenantId = String(options.tenantId || "default");
    const userId = Number(options.userId);
    const projectIds = [...new Set((Array.isArray(options.projectIds) ? options.projectIds : []).map(String))];
    const user = this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(userId, tenantId);
    if (!user) throw new Error("User does not exist");
    const projects = projectIds.length
      ? this.db.prepare(`SELECT id, project_key FROM projects WHERE tenant_id = ? AND project_key IN (${projectIds.map(() => "?").join(",")}) AND status = 'active'`).all(tenantId, ...projectIds)
      : [];
    if (projects.length !== projectIds.length) throw new Error("One or more projects do not exist");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM user_projects WHERE user_id = ?").run(userId);
      projects.forEach((project) => this.db.prepare("INSERT INTO user_projects(user_id, project_id) VALUES(?, ?)").run(userId, project.id));
      this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(this.nowIso(), userId);
      this.audit({
        tenantId,
        userId: options.actorUserId,
        action: "user.projects",
        result: "success",
        targetType: "user",
        targetId: String(userId),
        details: { projectIds }
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.userView(user);
  }

  getSession(token) {
    if (!token) return null;
    const row = this.db.prepare(`
      SELECT s.expires_at, s.revoked_at, u.*,
        t.status AS tenant_status
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN tenants t ON t.id = u.tenant_id
      WHERE s.token_hash = ?
    `).get(hashSessionToken(token));
    if (!row || row.revoked_at || row.status !== "active" || row.tenant_status !== "active") return null;
    if (Date.parse(row.expires_at) <= this.now()) return null;
    return { expiresAt: row.expires_at, user: this.userView(row) };
  }

  authorize(token, permission) {
    const session = this.getSession(token);
    if (!session || !hasPermission(session.user.permissions, permission)) return null;
    return session;
  }

  logout(token, context = {}) {
    if (!token) return false;
    const tokenHash = hashSessionToken(token);
    const session = this.db.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND revoked_at IS NULL").get(tokenHash);
    if (!session) return false;
    const user = this.db.prepare("SELECT tenant_id FROM users WHERE id = ?").get(session.user_id);
    this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?").run(this.nowIso(), tokenHash);
    this.audit({
      tenantId: user && user.tenant_id,
      userId: Number(session.user_id),
      action: "logout",
      result: "success",
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });
    return true;
  }

  createUser(options = {}) {
    const tenantId = String(options.tenantId || "default");
    const account = normalizeAccount(options.account);
    if (!account) throw new Error("Account is required");
    const policy = validatePasswordPolicy(options.password);
    if (!policy.ok) throw new Error(policy.failures.join("；"));
    const now = this.nowIso();
    const roleCodes = Array.isArray(options.roleCodes) && options.roleCodes.length ? options.roleCodes : ["admin"];
    const roles = this.db.prepare(`SELECT id FROM roles WHERE tenant_id = ? AND code IN (${roleCodes.map(() => "?").join(",")})`)
      .all(tenantId, ...roleCodes);
    if (roles.length !== new Set(roleCodes).size) throw new Error("One or more roles do not exist");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`
        INSERT INTO users(tenant_id, account, display_name, password_hash, status, must_change_password, created_at, updated_at)
        VALUES(?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(
        tenantId,
        account,
        String(options.displayName || account),
        hashPassword(options.password),
        options.mustChangePassword ? 1 : 0,
        now,
        now
      );
      const userId = Number(result.lastInsertRowid);
      roles.forEach((role) => this.db.prepare("INSERT INTO user_roles(user_id, role_id) VALUES(?, ?)").run(userId, role.id));
      const requestedProjectIds = options.projectIds === undefined
        ? this.listProjects(tenantId).filter((project) => project.status === "active").map((project) => project.projectId)
        : [...new Set((Array.isArray(options.projectIds) ? options.projectIds : []).map(String))];
      if (requestedProjectIds.length) {
        const projects = this.db.prepare(`SELECT id FROM projects WHERE tenant_id = ? AND project_key IN (${requestedProjectIds.map(() => "?").join(",")}) AND status = 'active'`).all(tenantId, ...requestedProjectIds);
        if (projects.length !== requestedProjectIds.length) throw new Error("One or more projects do not exist");
        projects.forEach((project) => this.db.prepare("INSERT INTO user_projects(user_id, project_id) VALUES(?, ?)").run(userId, project.id));
      }
      this.audit({ tenantId, userId, action: "user.create", result: "success", targetType: "user", targetId: String(userId), details: { account } });
      this.db.exec("COMMIT");
      return this.userView(this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId));
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listUsers(tenantId = "default") {
    return this.db.prepare("SELECT * FROM users WHERE tenant_id = ? ORDER BY account").all(String(tenantId))
      .map((user) => this.userView(user));
  }

  listRoles(tenantId = "default") {
    return this.db.prepare(`
      SELECT r.id, r.code, r.name, r.built_in AS builtIn,
        GROUP_CONCAT(rp.permission_code, ',') AS permissionCodes
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE r.tenant_id = ?
      GROUP BY r.id, r.code, r.name, r.built_in
      ORDER BY r.code
    `).all(String(tenantId)).map((role) => ({
      ...role,
      builtIn: Boolean(role.builtIn),
      permissions: String(role.permissionCodes || "").split(",").filter(Boolean)
    }));
  }

  setUserStatus(options = {}) {
    const status = String(options.status || "");
    if (!["active", "disabled"].includes(status)) throw new Error("Invalid user status");
    const userId = Number(options.userId);
    const user = this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(userId, String(options.tenantId || "default"));
    if (!user) throw new Error("User does not exist");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").run(status, this.nowIso(), userId);
      if (status === "disabled") this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(this.nowIso(), userId);
      this.audit({
        tenantId: user.tenant_id,
        userId: options.actorUserId,
        action: "user.status",
        result: "success",
        targetType: "user",
        targetId: String(userId),
        details: { status }
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.userView(this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId));
  }

  resetUserPassword(options = {}) {
    const tenantId = String(options.tenantId || "default");
    const userId = Number(options.userId);
    const user = this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(userId, tenantId);
    if (!user) throw new Error("User does not exist");
    const policy = validatePasswordPolicy(options.password);
    if (!policy.ok) throw new Error(policy.failures.join("；"));
    const now = this.nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?")
        .run(hashPassword(options.password), now, userId);
      this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, userId);
      this.audit({
        tenantId,
        userId: options.actorUserId,
        action: "user.password.reset",
        result: "success",
        targetType: "user",
        targetId: String(userId),
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        details: { account: user.account }
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.userView(this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId));
  }

  setUserRoles(options = {}) {
    const tenantId = String(options.tenantId || "default");
    const userId = Number(options.userId);
    const roleCodes = [...new Set(Array.isArray(options.roleCodes) ? options.roleCodes.map(String) : [])];
    if (!roleCodes.length) throw new Error("At least one role is required");
    const user = this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(userId, tenantId);
    if (!user) throw new Error("User does not exist");
    const placeholders = roleCodes.map(() => "?").join(",");
    const roles = this.db.prepare(`SELECT id, code FROM roles WHERE tenant_id = ? AND code IN (${placeholders})`).all(tenantId, ...roleCodes);
    if (roles.length !== roleCodes.length) throw new Error("One or more roles do not exist");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(userId);
      roles.forEach((role) => this.db.prepare("INSERT INTO user_roles(user_id, role_id) VALUES(?, ?)").run(userId, role.id));
      this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(this.nowIso(), userId);
      this.audit({
        tenantId,
        userId: options.actorUserId,
        action: "user.roles",
        result: "success",
        targetType: "user",
        targetId: String(userId),
        details: { roleCodes }
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.userView(user);
  }

  auditRows(limit = 100, tenantId = null) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
    if (tenantId !== null && tenantId !== undefined) {
      return this.db.prepare("SELECT * FROM security_audit WHERE tenant_id = ? ORDER BY id DESC LIMIT ?").all(String(tenantId), safeLimit);
    }
    return this.db.prepare("SELECT * FROM security_audit ORDER BY id DESC LIMIT ?").all(safeLimit);
  }

  close() {
    this.db.close();
  }
}

module.exports = { SecurityStore };
