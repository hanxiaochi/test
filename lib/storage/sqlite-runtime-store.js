"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function checksum(payload) {
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

class SqliteRuntimeStore {
  constructor(file) {
    if (!file) throw new Error("SQLite database path is required");
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
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
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  initialize(seed, metadata = {}) {
    if (!this.currentRow()) this.save(seed, { actor: metadata.actor || "system", action: metadata.action || "initialize", checkpoint: true });
    return this.load();
  }

  currentRow() {
    return this.db.prepare("SELECT * FROM runtime_state WHERE id = 1").get();
  }

  load() {
    const row = this.currentRow();
    if (!row) return null;
    if (checksum(row.payload) !== row.checksum) throw new Error("SQLite runtime state checksum mismatch");
    return JSON.parse(row.payload);
  }

  save(state, metadata = {}) {
    const payload = JSON.stringify(state);
    const digest = checksum(payload);
    const current = this.currentRow();
    if (current && current.checksum === digest) return { version: current.version, checksum: digest, unchanged: true };
    const version = current ? Number(current.version) + 1 : 1;
    const now = new Date().toISOString();
    const actor = String(metadata.actor || "system");
    const action = String(metadata.action || "save");
    const checkpoint = metadata.checkpoint === true || !current;
    this.db.exec("BEGIN IMMEDIATE");
    try {
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
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { version, checksum: digest, unchanged: false };
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

module.exports = { SqliteRuntimeStore, checksum };
