"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const scanner = require("../../lib/attachments/attachment-consistency");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "attachment-scan-"));
  const objects = path.join(root, "objects"); fs.mkdirSync(objects);
  const db = new DatabaseSync(path.join(root, "attachments.db"));
  db.exec("CREATE TABLE attachments(id INTEGER PRIMARY KEY,storage_name TEXT,byte_size INTEGER,sha256 TEXT,deleted_at TEXT)");
  return { root, objects, db };
}

function add(f, id, name, bytes, deletedAt = null, overrides = {}) {
  const target = path.join(f.objects, ...name.split("/")); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  f.db.prepare("INSERT INTO attachments VALUES(?,?,?,?,?)").run(id, name, overrides.size ?? bytes.length, overrides.hash ?? scanner.checksum(bytes), deletedAt);
}

test("valid active and deleted attachments pass with pagination", () => {
  const f = fixture();
  add(f, 1, `aa/${crypto.randomUUID()}`, Buffer.from("one"));
  add(f, 2, `bb/${crypto.randomUUID()}`, Buffer.from("two"), "2026-01-01T00:00:00Z");
  const report = scanner.scanAttachmentConsistency({ db: f.db, objectDir: f.objects, pageSize: 1 });
  assert.equal(report.ok, true); assert.deepEqual(report.counts, { metadata: 2, objects: 2, errors: 0, warnings: 0, active: 1, deleted: 1 });
  f.db.close(); fs.rmSync(f.root, { recursive: true, force: true });
});

test("missing, malformed, wrong size, wrong checksum and orphan objects are reported", () => {
  const f = fixture();
  add(f, 1, `aa/${crypto.randomUUID()}`, Buffer.from("size"), null, { size: 99, hash: "bad" });
  f.db.prepare("INSERT INTO attachments VALUES(2,'invalid',1,'bad',NULL)").run();
  f.db.prepare("INSERT INTO attachments VALUES(3,?,1,'bad',NULL)").run(`cc/${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(f.objects, "orphan")); fs.writeFileSync(path.join(f.objects, "orphan", "file"), "x");
  const report = scanner.scanAttachmentConsistency({ db: f.db, objectDir: f.objects });
  assert.equal(report.ok, false);
  assert.deepEqual(new Set(report.issues.map((row) => row.code)), new Set(["ATTACHMENT_OBJECT_SIZE_MISMATCH", "ATTACHMENT_OBJECT_CHECKSUM_MISMATCH", "ATTACHMENT_STORAGE_NAME_INVALID", "ATTACHMENT_OBJECT_MISSING", "ATTACHMENT_OBJECT_ORPHANED"]));
  f.db.close(); fs.rmSync(f.root, { recursive: true, force: true });
});

test("invalid contracts, bounded issues and scan limits fail closed", () => {
  assert.throws(() => scanner.scanAttachmentConsistency(), /database/);
  const f = fixture();
  assert.throws(() => scanner.scanAttachmentConsistency({ db: f.db }), /directory/);
  f.db.prepare("INSERT INTO attachments VALUES(1,'invalid',0,'',NULL),(2,'invalid2',0,'',NULL)").run();
  const bounded = scanner.scanAttachmentConsistency({ db: f.db, objectDir: f.objects, maxIssues: 1 });
  assert.equal(bounded.truncated, true); assert.equal(bounded.issues.length, 1);
  assert.throws(() => scanner.scanAttachmentConsistency({ db: f.db, objectDir: f.objects, maxRows: 1, pageSize: 2 }), /metadata scan limit/);
  f.db.close(); fs.rmSync(f.root, { recursive: true, force: true });
});

test("directories, absent object roots and object scan limits are handled explicitly", () => {
  const f = fixture();
  const name = `aa/${crypto.randomUUID()}`;
  fs.mkdirSync(path.join(f.objects, ...name.split("/")), { recursive: true });
  f.db.prepare("INSERT INTO attachments VALUES(1,?,1,'bad',NULL)").run(name);
  assert.equal(scanner.scanAttachmentConsistency({ db: f.db, objectDir: f.objects }).issues[0].code, "ATTACHMENT_OBJECT_TYPE_INVALID");
  const absent = path.join(f.root, "absent");
  assert.equal(scanner.scanAttachmentConsistency({ db: { prepare: () => ({ all: () => [] }) }, objectDir: absent }).counts.objects, 0);
  f.db.exec("DELETE FROM attachments");
  fs.rmSync(path.join(f.objects, "aa"), { recursive: true, force: true });
  fs.writeFileSync(path.join(f.objects, "one"), "1"); fs.writeFileSync(path.join(f.objects, "two"), "2");
  assert.throws(() => scanner.scanAttachmentConsistency({ db: f.db, objectDir: f.objects, maxRows: 1 }), /object scan limit/);
  f.db.close(); fs.rmSync(f.root, { recursive: true, force: true });
});
