"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  AttachmentStore,
  checksum,
  normalizeOriginalName,
  validateSignature,
  validateUpload
} = require("../../lib/attachments/attachment-store");

function zipBytes(text = "fixture") {
  return Buffer.concat([Buffer.from("504b0304", "hex"), Buffer.from(text)]);
}

function scope(overrides = {}) {
  return {
    tenantId: "tenant-a",
    projectId: "project-a",
    module: "project_information",
    entityType: "document",
    entityId: "42",
    ...overrides
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "attachment-store-test-"));
  const store = new AttachmentStore({
    dbFile: path.join(root, "attachments.db"),
    objectDir: path.join(root, "objects"),
    maxBytes: 128,
    now: () => Date.parse("2026-08-26T08:00:00.000Z")
  });
  return {
    root,
    store,
    close() {
      if (store.db) store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test("file names and upload content are validated before storage", () => {
  assert.equal(normalizeOriginalName("  工程资料.docx  "), "工程资料.docx");
  assert.equal(normalizeOriginalName(Buffer.from("计量附件.docx", "utf8").toString("latin1")), "计量附件.docx");
  assert.equal(normalizeOriginalName("café.pdf"), "café.pdf");
  for (const invalid of ["", ".", "..", "../secret.pdf", "folder/file.pdf", "folder\\file.pdf", "bad\0.pdf", "no-extension"]) {
    assert.throws(() => normalizeOriginalName(invalid));
  }
  assert.throws(() => normalizeOriginalName(`${"a".repeat(181)}.pdf`), /too long/);
  assert.equal(checksum(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(validateSignature(".docx", zipBytes()), true);
  assert.equal(validateSignature(".pdf", Buffer.from("%PDF-1.7")), true);
  assert.equal(validateSignature(".png", Buffer.from("89504e470d0a1a0a", "hex")), true);
  assert.equal(validateSignature(".jpg", Buffer.from("ffd8ffd9", "hex")), true);
  assert.equal(validateSignature(".doc", Buffer.from("d0cf11e0a1b11ae1", "hex")), true);
  assert.equal(validateSignature(".txt", Buffer.from("plain text")), true);
  assert.equal(validateSignature(".txt", Buffer.from([0])), false);
  assert.equal(validateSignature(".exe", Buffer.from("MZ")), false);
  assert.throws(() => validateUpload({ originalName: "payload.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }), /not allowed/);
  assert.throws(() => validateUpload({ originalName: "report.pdf", mimeType: "image/png", buffer: Buffer.from("%PDF-1.7") }), /MIME/);
  assert.throws(() => validateUpload({ originalName: "report.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) }), /content is required/);
  assert.throws(() => validateUpload({ originalName: "report.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10), maxBytes: 5 }), /size limit/);
  assert.throws(() => validateUpload({ originalName: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("not pdf") }), /does not match/);
});

test("create writes an atomic object and exposes scoped verified bytes", () => {
  const ctx = fixture();
  try {
    const buffer = zipBytes("exact-original-bytes");
    const row = ctx.store.create({
      ...scope(),
      originalName: "第13期计量支付报表.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer,
      uploaderUserId: 7,
      remark: "验收附件"
    });
    assert.equal(row.id, 1);
    assert.equal(row.fileName, "第13期计量支付报表.docx");
    assert.equal(row.byteSize, buffer.length);
    assert.equal(row.sha256, checksum(buffer));
    assert.equal(row.uploadDate, "2026-08-26");
    assert.equal(row.remark, "验收附件");
    assert.equal(ctx.store.count(scope()), 1);
    assert.deepEqual(ctx.store.list(scope()).map((item) => item.id), [1]);
    assert.deepEqual(ctx.store.read({ ...scope(), id: row.id }).buffer, buffer);
    const stored = ctx.store.objectPath(row.storageName);
    if (process.platform !== "win32") assert.equal(fs.statSync(stored).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(path.dirname(stored)).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    ctx.close();
  }
});

test("tenant, project, entity and deleted-state boundaries fail closed", () => {
  const ctx = fixture();
  try {
    const row = ctx.store.create({
      ...scope(), originalName: "evidence.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 evidence")
    });
    assert.equal(ctx.store.list(scope({ tenantId: "tenant-b" })).length, 0);
    assert.equal(ctx.store.list(scope({ projectId: "project-b" })).length, 0);
    assert.equal(ctx.store.list(scope({ entityId: "43" })).length, 0);
    assert.throws(() => ctx.store.read({ ...scope({ projectId: "project-b" }), id: row.id }), (error) => error.code === "ATTACHMENT_NOT_FOUND");
    assert.equal(ctx.store.delete({ ...scope({ projectId: "project-b" }), id: row.id, deletedBy: 9 }), 0);
    assert.equal(ctx.store.delete({ ...scope(), id: row.id, deletedBy: 9 }), 1);
    assert.equal(ctx.store.delete({ ...scope(), id: row.id, deletedBy: 9 }), 0);
    assert.equal(ctx.store.count(scope()), 0);
    assert.throws(() => ctx.store.read({ ...scope(), id: row.id }), (error) => error.code === "ATTACHMENT_NOT_FOUND");
    const deleted = ctx.store.getById(row.id, scope(), { includeDeleted: true });
    assert.equal(deleted.deletedAt, "2026-08-26T08:00:00.000Z");
    assert.equal(deleted.deletedBy, 9);
  } finally {
    ctx.close();
  }
});

test("missing and corrupted objects are never returned", () => {
  const ctx = fixture();
  try {
    const first = ctx.store.create({ ...scope(), originalName: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first") });
    fs.writeFileSync(ctx.store.objectPath(first.storageName), "tampered");
    assert.throws(() => ctx.store.read({ ...scope(), id: first.id }), (error) => error.code === "ATTACHMENT_CORRUPT");

    const second = ctx.store.create({ ...scope(), originalName: "second.txt", mimeType: "text/plain", buffer: Buffer.from("second") });
    fs.unlinkSync(ctx.store.objectPath(second.storageName));
    assert.throws(() => ctx.store.read({ ...scope(), id: second.id }), (error) => error.code === "ATTACHMENT_CORRUPT");
    assert.throws(() => ctx.store.objectPath("../../outside"), /storage name/);
  } finally {
    ctx.close();
  }
});

test("object bytes are cleaned up when metadata commit fails", () => {
  const ctx = fixture();
  try {
    ctx.store.db.close();
    ctx.store.db = { prepare() { throw new Error("simulated database failure"); } };
    assert.throws(() => ctx.store.create({
      ...scope(), originalName: "failure.txt", mimeType: "text/plain", buffer: Buffer.from("cleanup")
    }), /simulated database failure/);
    const files = fs.readdirSync(path.join(ctx.root, "objects"), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    assert.equal(files.length, 0);
    ctx.store.db = null;
  } finally {
    ctx.close();
  }
});

test("constructor, scope and configured size failures are explicit", () => {
  assert.throws(() => new AttachmentStore(), /database path/);
  assert.throws(() => new AttachmentStore({ dbFile: "x" }), /object directory/);
  const ctx = fixture();
  try {
    assert.throws(() => ctx.store.list({}), /scope/);
    assert.throws(() => ctx.store.create({
      ...scope(), originalName: "large.txt", mimeType: "text/plain", buffer: Buffer.alloc(129, 0x61)
    }), /size limit/);
  } finally {
    ctx.close();
  }
  const defaultClockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "attachment-store-clock-test-"));
  const defaultClockStore = new AttachmentStore({ dbFile: path.join(defaultClockRoot, "db.sqlite"), objectDir: path.join(defaultClockRoot, "objects") });
  assert.match(defaultClockStore.nowIso(), /^\d{4}-\d{2}-\d{2}T/);
  defaultClockStore.close();
  fs.rmSync(defaultClockRoot, { recursive: true, force: true });
});
