"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STORAGE_PATTERN = /^[a-f0-9]{2}\/[a-f0-9-]{36}$/;

function checksum(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }

function scanAttachmentConsistency(options = {}) {
  if (!options.db || typeof options.db.prepare !== "function") throw new Error("Attachment database is required");
  const objectDir = path.resolve(String(options.objectDir || ""));
  if (!options.objectDir) throw new Error("Attachment object directory is required");
  const maxRows = Math.max(1, Math.min(1000000, Number(options.maxRows) || 1000000));
  const maxIssues = Math.max(1, Math.min(10000, Number(options.maxIssues) || 1000));
  const pageSize = Math.max(1, Math.min(5000, Number(options.pageSize) || 1000));
  const issues = [];
  const counts = { metadata: 0, objects: 0, errors: 0, warnings: 0, active: 0, deleted: 0 };
  const referenced = new Set();
  function issue(severity, code, details = {}) {
    counts[severity === "error" ? "errors" : "warnings"] += 1;
    if (issues.length < maxIssues) issues.push({ severity, code, ...details });
  }
  let offset = 0;
  while (true) {
    const rows = options.db.prepare("SELECT id,storage_name,byte_size,sha256,deleted_at FROM attachments ORDER BY id LIMIT ? OFFSET ?").all(pageSize, offset);
    if (!rows.length) break;
    if (counts.metadata + rows.length > maxRows) throw new Error("Attachment metadata scan limit exceeded");
    rows.forEach((row) => {
      counts.metadata += 1;
      if (row.deleted_at === null) counts.active += 1; else counts.deleted += 1;
      const storageName = String(row.storage_name || "");
      if (!STORAGE_PATTERN.test(storageName)) {
        issue("error", "ATTACHMENT_STORAGE_NAME_INVALID", { attachmentId: Number(row.id) });
        return;
      }
      referenced.add(storageName);
      const target = path.resolve(objectDir, ...storageName.split("/"));
      let stat;
      try { stat = fs.lstatSync(target); } catch (_error) {
        issue("error", "ATTACHMENT_OBJECT_MISSING", { attachmentId: Number(row.id), storageName });
        return;
      }
      if (stat.isSymbolicLink() || !stat.isFile()) {
        issue("error", "ATTACHMENT_OBJECT_TYPE_INVALID", { attachmentId: Number(row.id), storageName });
        return;
      }
      const bytes = fs.readFileSync(target);
      if (bytes.length !== Number(row.byte_size)) issue("error", "ATTACHMENT_OBJECT_SIZE_MISMATCH", { attachmentId: Number(row.id), storageName });
      if (checksum(bytes) !== String(row.sha256)) issue("error", "ATTACHMENT_OBJECT_CHECKSUM_MISMATCH", { attachmentId: Number(row.id), storageName });
    });
    offset += rows.length;
    if (rows.length < pageSize) break;
  }
  function walk(directory, relative = "") {
    if (!fs.existsSync(directory)) return;
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const source = path.join(directory, entry.name);
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) { issue("error", "ATTACHMENT_OBJECT_SYMLINK", { storageName: next }); return; }
      if (stat.isDirectory()) { walk(source, next); return; }
      if (!stat.isFile()) { issue("error", "ATTACHMENT_OBJECT_TYPE_INVALID", { storageName: next }); return; }
      counts.objects += 1;
      if (counts.objects > maxRows) throw new Error("Attachment object scan limit exceeded");
      if (!referenced.has(next)) issue("warning", "ATTACHMENT_OBJECT_ORPHANED", { storageName: next });
    });
  }
  walk(objectDir);
  return { ok: counts.errors === 0, counts, issues, truncated: counts.errors + counts.warnings > issues.length };
}

module.exports = { STORAGE_PATTERN, checksum, scanAttachmentConsistency };
