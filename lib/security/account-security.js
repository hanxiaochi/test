"use strict";

const { verifyPassword } = require("./auth-core");

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function securityPolicy(source = process.env) {
  return Object.freeze({
    passwordMaxAgeDays: boundedInteger(source.APP_PASSWORD_MAX_AGE_DAYS, 90, 30, 365),
    passwordHistoryCount: boundedInteger(source.APP_PASSWORD_HISTORY_COUNT, 5, 3, 20),
    maxFailedAttempts: boundedInteger(source.APP_ACCOUNT_LOCK_ATTEMPTS, 5, 3, 10),
    lockMinutes: boundedInteger(source.APP_ACCOUNT_LOCK_MINUTES, 30, 5, 1440),
    idleSessionMinutes: boundedInteger(source.APP_SESSION_IDLE_MINUTES, 30, 5, 240),
    maxSessionHours: boundedInteger(source.APP_SESSION_MAX_HOURS, 8, 1, 24),
    auditRetentionDays: boundedInteger(source.APP_AUDIT_RETENTION_DAYS, 180, 180, 3650)
  });
}

class AccountSecurityControls {
  constructor(db, options = {}) {
    if (!db) throw new Error("Security database handle is required");
    this.db = db;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.policy = options.policy || securityPolicy(options.env);
    this.migrate();
  }

  nowIso() {
    return new Date(this.now()).toISOString();
  }

  ensureColumn(table, column, definition) {
    const exists = this.db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
    if (!exists) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  migrate() {
    this.ensureColumn("users", "password_changed_at", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("users", "failed_login_attempts", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("users", "locked_until", "TEXT");
    this.ensureColumn("sessions", "last_seen_at", "TEXT NOT NULL DEFAULT ''");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS password_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id, id DESC);
    `);
    this.db.prepare("UPDATE users SET password_changed_at = updated_at WHERE password_changed_at = ''").run();
    this.db.prepare("UPDATE sessions SET last_seen_at = created_at WHERE last_seen_at = ''").run();
    this.db.prepare(`
      INSERT INTO password_history(user_id, password_hash, created_at)
      SELECT u.id, u.password_hash, CASE WHEN u.password_changed_at = '' THEN u.updated_at ELSE u.password_changed_at END
      FROM users u WHERE NOT EXISTS (SELECT 1 FROM password_history h WHERE h.user_id = u.id)
    `).run();
    this.db.prepare("INSERT OR IGNORE INTO security_migrations(version, applied_at) VALUES(6, ?)").run(this.nowIso());
  }

  passwordExpired(user) {
    if (!user || !user.password_changed_at) return true;
    return Date.parse(user.password_changed_at) + this.policy.passwordMaxAgeDays * 86400000 <= this.now();
  }

  assertPasswordNotReused(userId, password) {
    const rows = this.db.prepare("SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY id DESC LIMIT ?")
      .all(Number(userId), this.policy.passwordHistoryCount);
    if (rows.some((row) => verifyPassword(password, row.password_hash))) {
      throw new Error(`新密码不能与最近${this.policy.passwordHistoryCount}次密码相同`);
    }
  }

  recordPassword(userId, passwordHash, changedAt = this.nowIso()) {
    this.db.prepare("INSERT INTO password_history(user_id, password_hash, created_at) VALUES(?, ?, ?)")
      .run(Number(userId), String(passwordHash), changedAt);
    this.db.prepare(`
      DELETE FROM password_history WHERE user_id = ? AND id NOT IN (
        SELECT id FROM password_history WHERE user_id = ? ORDER BY id DESC LIMIT ?
      )
    `).run(Number(userId), Number(userId), this.policy.passwordHistoryCount);
  }

  isLocked(user) {
    return Boolean(user && user.locked_until && Date.parse(user.locked_until) > this.now());
  }

  recordLoginFailure(userId) {
    const row = this.db.prepare("SELECT failed_login_attempts FROM users WHERE id = ?").get(Number(userId));
    if (!row) return { attempts: 0, lockedUntil: null };
    const attempts = Number(row.failed_login_attempts || 0) + 1;
    const lockedUntil = attempts >= this.policy.maxFailedAttempts
      ? new Date(this.now() + this.policy.lockMinutes * 60000).toISOString()
      : null;
    this.db.prepare("UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?")
      .run(lockedUntil ? 0 : attempts, lockedUntil, Number(userId));
    return { attempts, lockedUntil };
  }

  recordLoginSuccess(userId) {
    this.db.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?").run(Number(userId));
  }

  unlock(userId) {
    return this.db.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?")
      .run(Number(userId)).changes > 0;
  }

  sessionExpiresAt(remember) {
    const hours = remember ? Math.min(this.policy.maxSessionHours, 8) : this.policy.maxSessionHours;
    return new Date(this.now() + hours * 3600000).toISOString();
  }

  sessionAllowed(row) {
    if (!row || Date.parse(row.expires_at) <= this.now()) return false;
    const lastSeen = Date.parse(row.last_seen_at || row.created_at);
    return Number.isFinite(lastSeen) && lastSeen + this.policy.idleSessionMinutes * 60000 > this.now();
  }

  touchSession(tokenHash) {
    this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .run(this.nowIso(), String(tokenHash));
  }
}

module.exports = { AccountSecurityControls, boundedInteger, securityPolicy };
