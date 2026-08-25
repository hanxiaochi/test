"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function checksum(payload) {
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function concurrencyError(expectedVersion, actualVersion) {
  const error = new Error(`SQLite runtime state changed concurrently (expected version ${expectedVersion}, current version ${actualVersion}); reload before saving`);
  error.code = "SQLITE_RUNTIME_CONFLICT";
  error.expectedVersion = expectedVersion;
  error.actualVersion = actualVersion;
  return error;
}

class SqliteRuntimeStore {
  constructor(file) {
    if (!file) throw new Error("SQLite database path is required");
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.loadedVersion = null;
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA wal_autocheckpoint=250; PRAGMA journal_size_limit=16777216;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        checksum TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        action TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_revisions (
        version INTEGER PRIMARY KEY,
        payload TEXT NOT NULL,
        checksum TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        action TEXT NOT NULL
      );
    `);
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)")
      .run(new Date().toISOString());
    const migration2 = this.db.prepare("SELECT version FROM schema_migrations WHERE version = 2").get();
    if (!migration2) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const migrationCompleted = this.db.prepare("SELECT version FROM schema_migrations WHERE version = 2").get();
        if (!migrationCompleted) {
          this.db.exec(`
            CREATE TABLE runtime_revisions_v2 (
              version INTEGER PRIMARY KEY,
              payload TEXT,
              checksum TEXT NOT NULL,
              created_at TEXT NOT NULL,
              created_by TEXT NOT NULL,
              action TEXT NOT NULL,
              is_checkpoint INTEGER NOT NULL DEFAULT 0 CHECK (is_checkpoint IN (0, 1))
            );
            INSERT INTO runtime_revisions_v2(version, payload, checksum, created_at, created_by, action, is_checkpoint)
            SELECT version, payload, checksum, created_at, created_by, action, 1 FROM runtime_revisions;
            DROP TABLE runtime_revisions;
            ALTER TABLE runtime_revisions_v2 RENAME TO runtime_revisions;
          `);
          this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(2, ?)").run(new Date().toISOString());
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  initialize(seed, metadata = {}) {
    const payload = JSON.stringify(seed);
    const digest = checksum(payload);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.currentRow();
      if (!current) {
        this.writeState(payload, digest, null, {
          actor: metadata.actor || "system",
          action: metadata.action || "initialize",
          checkpoint: true
        });
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.load();
  }

  currentRow() {
    return this.db.prepare("SELECT * FROM runtime_state WHERE id = 1").get();
  }

  load() {
    const row = this.currentRow();
    if (!row) {
      this.loadedVersion = 0;
      return null;
    }
    if (checksum(row.payload) !== row.checksum) throw new Error("SQLite runtime state checksum mismatch");
    const state = JSON.parse(row.payload);
    this.loadedVersion = Number(row.version);
    return state;
  }

  writeState(payload, digest, current, metadata = {}) {
    const version = current ? Number(current.version) + 1 : 1;
    const now = new Date().toISOString();
    const actor = String(metadata.actor || "system");
    const action = String(metadata.action || "save");
    const checkpoint = metadata.checkpoint === true || !current;
    this.db.prepare(`
      INSERT INTO runtime_revisions(version, payload, checksum, created_at, created_by, action, is_checkpoint)
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `).run(version, checkpoint ? payload : null, digest, now, actor, action, checkpoint ? 1 : 0);
    this.db.prepare(`
      INSERT INTO runtime_state(id, version, payload, checksum, updated_at, updated_by, action)
      VALUES(1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        payload = excluded.payload,
        checksum = excluded.checksum,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by,
        action = excluded.action
    `).run(version, payload, digest, now, actor, action);
    return { version, checksum: digest, unchanged: false };
  }

  save(state, metadata = {}) {
    const payload = JSON.stringify(state);
    const digest = checksum(payload);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.currentRow();
      const actualVersion = current ? Number(current.version) : 0;
      if (current && current.checksum === digest) {
        this.loadedVersion = actualVersion;
        this.db.exec("COMMIT");
        return { version: actualVersion, checksum: digest, unchanged: true };
      }
      if (this.loadedVersion === null || this.loadedVersion !== actualVersion) {
        throw concurrencyError(this.loadedVersion, actualVersion);
      }
      const saved = this.writeState(payload, digest, current, metadata);
      this.db.exec("COMMIT");
      this.loadedVersion = saved.version;
      return saved;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  history(limit = 50) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
    return this.db.prepare(`
      SELECT version, checksum, created_at AS createdAt, created_by AS createdBy, action,
        is_checkpoint AS isCheckpoint
      FROM runtime_revisions ORDER BY version DESC LIMIT ?
    `).all(safeLimit);
  }

  restore(version, metadata = {}) {
    const row = this.db.prepare("SELECT payload, checksum, is_checkpoint AS isCheckpoint FROM runtime_revisions WHERE version = ?").get(Number(version));
    if (!row) throw new Error(`Runtime revision ${version} does not exist`);
    if (!row.isCheckpoint || !row.payload) throw new Error(`Runtime revision ${version} is not a restorable checkpoint`);
    if (checksum(row.payload) !== row.checksum) throw new Error(`Runtime revision ${version} checksum mismatch`);
    return this.save(JSON.parse(row.payload), {
      actor: metadata.actor || "system",
      action: metadata.action || `restore:${version}`,
      checkpoint: true
    });
  }

  status() {
    const row = this.currentRow();
    return {
      mode: "sqlite",
      file: this.file,
      exists: fs.existsSync(this.file),
      version: row ? Number(row.version) : 0,
      checksum: row ? row.checksum : ""
    };
  }

  close() {
    this.db.close();
  }
}

module.exports = { SqliteRuntimeStore, checksum, concurrencyError };
