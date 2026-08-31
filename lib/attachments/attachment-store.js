"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const MIME_BY_EXTENSION = Object.freeze({
  ".csv": ["text/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"],
  ".doc": ["application/msword", "application/octet-stream"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"],
  ".jpeg": ["image/jpeg", "application/octet-stream"],
  ".jpg": ["image/jpeg", "application/octet-stream"],
  ".pdf": ["application/pdf", "application/octet-stream"],
  ".png": ["image/png", "application/octet-stream"],
  ".txt": ["text/plain", "application/octet-stream"],
  ".xls": ["application/vnd.ms-excel", "application/octet-stream"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream"],
  ".zip": ["application/zip", "application/x-zip-compressed", "application/octet-stream"]
});

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOriginalName(value) {
  const rawName = String(value || "");
  const latinBytes = Buffer.from(rawName, "latin1");
  const decodedName = latinBytes.toString("utf8");
  const recoveredUtf8 = !decodedName.includes("\uFFFD") && Buffer.from(decodedName, "utf8").equals(latinBytes);
  const name = (recoveredUtf8 ? decodedName : rawName).normalize("NFC").trim();
  if (!name || name === "." || name === "..") throw new Error("Attachment file name is required");
  if (name.length > 180) throw new Error("Attachment file name is too long");
  if (name !== path.basename(name) || /[\\/\0-\x1f\x7f]/.test(name)) throw new Error("Attachment file name contains an invalid path");
  if (!path.extname(name)) throw new Error("Attachment file extension is required");
  return name;
}

function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hasZipSignature(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]) && [0x04, 0x06, 0x08].includes(buffer[3]);
}

function validateSignature(extension, buffer) {
  if ([".txt", ".csv"].includes(extension)) return !buffer.includes(0);
  if ([".docx", ".xlsx", ".zip"].includes(extension)) return hasZipSignature(buffer);
  if ([".doc", ".xls"].includes(extension)) return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  if (extension === ".pdf") return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (extension === ".png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if ([".jpg", ".jpeg"].includes(extension)) return buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  return false;
}

function validateUpload(options = {}) {
  const originalName = normalizeOriginalName(options.originalName);
  const extension = path.extname(originalName).toLowerCase();
  const allowedMimes = MIME_BY_EXTENSION[extension];
  if (!allowedMimes) throw new Error("Attachment file type is not allowed");
  const mimeType = String(options.mimeType || "application/octet-stream").trim().toLowerCase();
  if (!allowedMimes.includes(mimeType)) throw new Error("Attachment MIME type does not match its extension");
  if (!Buffer.isBuffer(options.buffer) || options.buffer.length === 0) throw new Error("Attachment content is required");
  const maxBytes = positiveInteger(options.maxBytes, 20 * 1024 * 1024);
  if (options.buffer.length > maxBytes) throw new Error("Attachment exceeds the configured size limit");
  if (!validateSignature(extension, options.buffer)) throw new Error("Attachment content does not match its extension");
  return { originalName, extension, mimeType, maxBytes };
}

class AttachmentStore {
  constructor(options = {}) {
    if (!options.dbFile) throw new Error("Attachment database path is required");
    if (!options.objectDir) throw new Error("Attachment object directory is required");
    this.dbFile = path.resolve(options.dbFile);
    this.objectDir = path.resolve(options.objectDir);
    this.maxBytes = positiveInteger(options.maxBytes, 20 * 1024 * 1024);
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    fs.mkdirSync(path.dirname(this.dbFile), { recursive: true });
    fs.mkdirSync(this.objectDir, { recursive: true });
    this.db = new DatabaseSync(this.dbFile);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA wal_autocheckpoint=250; PRAGMA journal_size_limit=16777216;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS attachment_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        module TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        original_name TEXT NOT NULL,
        storage_name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size > 0),
        sha256 TEXT NOT NULL,
        uploader_user_id INTEGER,
        remark TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_by INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_scope_entity
        ON attachments(tenant_id, project_id, module, entity_type, entity_id, deleted_at);
    `);
    this.db.prepare("INSERT OR IGNORE INTO attachment_migrations(version, applied_at) VALUES(1, ?)").run(this.nowIso());
  }

  nowIso() {
    return new Date(this.now()).toISOString();
  }

  scope(options = {}) {
    const scope = {
      tenantId: String(options.tenantId || "").trim(),
      projectId: String(options.projectId || "").trim(),
      module: String(options.module || "").trim(),
      entityType: String(options.entityType || "").trim(),
      entityId: String(options.entityId || "").trim()
    };
    if (Object.values(scope).some((value) => !value)) throw new Error("Complete attachment scope is required");
    return scope;
  }

  objectPath(storageName) {
    const name = String(storageName || "");
    if (!/^[a-f0-9]{2}\/[a-f0-9-]{36}$/.test(name)) throw new Error("Invalid attachment storage name");
    const target = path.resolve(this.objectDir, ...name.split("/"));
    const relative = path.relative(this.objectDir, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid attachment storage path");
    return target;
  }

  view(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      attachmentId: Number(row.id),
      tenantId: row.tenant_id,
      projectId: row.project_id,
      module: row.module,
      entityType: row.entity_type,
      entityId: row.entity_id,
      originalName: row.original_name,
      fileName: row.original_name,
      storageName: row.storage_name,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      size: Number(row.byte_size),
      sha256: row.sha256,
      uploaderUserId: row.uploader_user_id === null ? null : Number(row.uploader_user_id),
      remark: row.remark,
      createdAt: row.created_at,
      uploadDate: row.created_at.slice(0, 10),
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by === null ? null : Number(row.deleted_by)
    };
  }

  create(options = {}) {
    const scope = this.scope(options);
    const validated = validateUpload({ ...options, maxBytes: this.maxBytes });
    const digest = checksum(options.buffer);
    const objectId = crypto.randomUUID();
    const storageName = `${digest.slice(0, 2)}/${objectId}`;
    const target = this.objectPath(storageName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    let committed = false;
    try {
      const handle = fs.openSync(temporary, "wx", 0o600);
      try {
        fs.writeFileSync(handle, options.buffer);
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(temporary, target);
      const result = this.db.prepare(`
        INSERT INTO attachments(
          tenant_id, project_id, module, entity_type, entity_id, original_name,
          storage_name, mime_type, byte_size, sha256, uploader_user_id, remark, created_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        scope.tenantId, scope.projectId, scope.module, scope.entityType, scope.entityId,
        validated.originalName, storageName, validated.mimeType, options.buffer.length, digest,
        options.uploaderUserId || null, String(options.remark || "").trim().slice(0, 500), this.nowIso()
      );
      committed = true;
      return this.getById(Number(result.lastInsertRowid), scope, { includeDeleted: true });
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      if (!committed && fs.existsSync(target)) fs.unlinkSync(target);
    }
  }

  list(options = {}) {
    const scope = this.scope(options);
    return this.db.prepare(`
      SELECT * FROM attachments
      WHERE tenant_id = ? AND project_id = ? AND module = ? AND entity_type = ? AND entity_id = ? AND deleted_at IS NULL
      ORDER BY id DESC
    `).all(scope.tenantId, scope.projectId, scope.module, scope.entityType, scope.entityId).map((row) => this.view(row));
  }

  count(options = {}) {
    const scope = this.scope(options);
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM attachments
      WHERE tenant_id = ? AND project_id = ? AND module = ? AND entity_type = ? AND entity_id = ? AND deleted_at IS NULL
    `).get(scope.tenantId, scope.projectId, scope.module, scope.entityType, scope.entityId);
    return Number(row.count);
  }

  getById(id, options = {}, flags = {}) {
    const scope = this.scope(options);
    const deletedClause = flags.includeDeleted ? "" : " AND deleted_at IS NULL";
    const row = this.db.prepare(`
      SELECT * FROM attachments
      WHERE id = ? AND tenant_id = ? AND project_id = ? AND module = ? AND entity_type = ? AND entity_id = ?${deletedClause}
    `).get(Number(id), scope.tenantId, scope.projectId, scope.module, scope.entityType, scope.entityId);
    return this.view(row);
  }

  read(options = {}) {
    const row = this.getById(options.id, options);
    if (!row) throw Object.assign(new Error("Attachment does not exist"), { code: "ATTACHMENT_NOT_FOUND" });
    const target = this.objectPath(row.storageName);
    let buffer;
    try {
      buffer = fs.readFileSync(target);
    } catch {
      throw Object.assign(new Error("Attachment object is unavailable"), { code: "ATTACHMENT_CORRUPT" });
    }
    if (buffer.length !== row.byteSize || checksum(buffer) !== row.sha256) {
      throw Object.assign(new Error("Attachment integrity check failed"), { code: "ATTACHMENT_CORRUPT" });
    }
    return { row, buffer };
  }

  delete(options = {}) {
    const scope = this.scope(options);
    const result = this.db.prepare(`
      UPDATE attachments SET deleted_at = ?, deleted_by = ?
      WHERE id = ? AND tenant_id = ? AND project_id = ? AND module = ? AND entity_type = ? AND entity_id = ? AND deleted_at IS NULL
    `).run(
      this.nowIso(), options.deletedBy || null, Number(options.id), scope.tenantId, scope.projectId,
      scope.module, scope.entityType, scope.entityId
    );
    return Number(result.changes);
  }

  close() {
    if (this.db) this.db.close();
    this.db = null;
  }
}

module.exports = { AttachmentStore, MIME_BY_EXTENSION, checksum, normalizeOriginalName, validateSignature, validateUpload };
