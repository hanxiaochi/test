"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const JSZip = require("jszip");
const { DatabaseSync } = require("node:sqlite");
const service = require("../../lib/backup/system-backup");

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "system-backup-test-")); }

function database(file, value = 1) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE sample(value INTEGER); INSERT INTO sample VALUES(?)".replace("?", String(value)));
  return db;
}

test("creates, validates and restores a complete mixed archive into a new directory", async () => {
  const temp = root();
  const data = path.join(temp, "data");
  fs.mkdirSync(path.join(data, "attachments", "aa"), { recursive: true });
  fs.writeFileSync(path.join(data, "attachments", "aa", "object"), "document");
  fs.mkdirSync(path.join(data, "exports"));
  fs.writeFileSync(path.join(data, "exports", "ignored"), "derived");
  fs.writeFileSync(path.join(data, "runtime.db-wal"), "ignored");
  const db = database(path.join(data, "runtime.db"), 42);
  const sources = service.collectDirectory(data, "data", { excludeNames: ["exports"] });
  const archive = await service.createSystemBackup({ sources, createdAt: 0, createdBy: "admin", applicationVersion: "1.2.3" });
  const verified = await service.validateSystemBackup(archive);
  assert.equal(verified.manifest.format, service.FORMAT);
  assert.equal(verified.manifest.createdAt, "1970-01-01T00:00:00.000Z");
  assert.deepEqual([...verified.files.keys()], ["data/attachments/aa/object", "data/runtime.db"]);
  const target = path.join(temp, "restored");
  const restored = await service.restoreToNewDirectory(archive, target);
  assert.equal(restored.files, 2);
  assert.equal(fs.readFileSync(path.join(target, "data", "attachments", "aa", "object"), "utf8"), "document");
  const restoredDb = new DatabaseSync(path.join(target, "data", "runtime.db"), { readOnly: true });
  assert.equal(restoredDb.prepare("SELECT value FROM sample").get().value, 42);
  restoredDb.close();
  db.close();
  fs.rmSync(temp, { recursive: true, force: true });
});

test("SQLite snapshot includes committed WAL data and passes integrity validation", async () => {
  const temp = root();
  const file = path.join(temp, "live.db");
  const first = database(file, 1);
  const second = new DatabaseSync(file);
  second.exec("INSERT INTO sample VALUES(2)");
  const bytes = await service.sqliteBytes(file, first);
  await service.verifySqlite(bytes);
  assert.equal(bytes.subarray(0, 16).toString("binary"), "SQLite format 3\0");
  second.close(); first.close();
  await assert.rejects(service.verifySqlite(Buffer.from("not sqlite")), /invalid/);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("collection is deterministic and rejects unsafe archive paths and symbolic links", () => {
  const temp = root();
  fs.writeFileSync(path.join(temp, "b.txt"), "b");
  fs.writeFileSync(path.join(temp, "a.txt"), "a");
  assert.deepEqual(service.collectDirectory(temp, "data").map((row) => row.path), ["data/a.txt", "data/b.txt"]);
  assert.throws(() => service.archivePath("../escape"), /unsafe/);
  assert.throws(() => service.archivePath("a//b"), /unsafe/);
  assert.throws(() => service.archivePath(""), /unsafe/);
  try {
    fs.symlinkSync(path.join(temp, "a.txt"), path.join(temp, "link.txt"));
    assert.throws(() => service.collectDirectory(temp, "data"), /symbolic link/);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
  }
  fs.rmSync(temp, { recursive: true, force: true });
});

test("creation rejects duplicate, missing, changing and oversized sources", async () => {
  const temp = root();
  const file = path.join(temp, "file.txt");
  fs.writeFileSync(file, "content");
  await assert.rejects(service.createSystemBackup({ sources: [] }), /source count/);
  await assert.rejects(service.createSystemBackup({ sources: [{ source: file, path: "same", kind: "file" }, { source: file, path: "same", kind: "file" }] }), /Duplicate/);
  await assert.rejects(service.createSystemBackup({ sources: [{ source: path.join(temp, "missing"), path: "missing", kind: "file" }] }), /ENOENT/);
  await assert.rejects(service.createSystemBackup({ sources: [{ source: file, path: "file", kind: "file" }], maxBytes: 2 }), /size limit/);
  assert.equal(service.collectDirectory(temp, "data", { excludeNames: ["file.txt"] }).length, 0);
  await assert.rejects(service.createSystemBackup({ sources: [{ source: file, path: "file" }], maxFiles: 0, maxBytes: -1 }), /limits/);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("validation fails closed for malformed archives, manifests and payloads", async () => {
  await assert.rejects(service.validateSystemBackup(Buffer.alloc(0)), /size/);
  await assert.rejects(service.validateSystemBackup(Buffer.from("not zip")), /valid ZIP/);
  const noManifest = new JSZip(); noManifest.file("payload/a", "a"); noManifest.file("payload/b", "b");
  await assert.rejects(service.validateSystemBackup(await noManifest.generateAsync({ type: "nodebuffer" })), /manifest is missing/);
  const badManifest = new JSZip(); badManifest.file("manifest.json", "{"); badManifest.file("payload/a", "a");
  await assert.rejects(service.validateSystemBackup(await badManifest.generateAsync({ type: "nodebuffer" })), /manifest is invalid/);
  const unsupported = new JSZip(); unsupported.file("manifest.json", JSON.stringify({ format: "other", files: [] })); unsupported.file("payload/a", "a");
  await assert.rejects(service.validateSystemBackup(await unsupported.generateAsync({ type: "nodebuffer" })), /Unsupported/);
});

test("tampered manifest, payload, totals, kinds and extra files are rejected", async () => {
  const temp = root();
  const file = path.join(temp, "a.txt"); fs.writeFileSync(file, "alpha");
  const valid = await service.createSystemBackup({ sources: [{ source: file, path: "data/a.txt", kind: "file" }], createdAt: 0 });
  async function mutate(change) {
    const zip = await JSZip.loadAsync(valid);
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    await change(zip, manifest);
    zip.file("manifest.json", JSON.stringify(manifest));
    return zip.generateAsync({ type: "nodebuffer" });
  }
  await assert.rejects(service.validateSystemBackup(await mutate((_z, m) => { m.createdBy = "attacker"; })), /manifest checksum/);
  await assert.rejects(service.validateSystemBackup(await mutate((z, m) => { z.file("payload/data/a.txt", "changed"); m.manifestSha256 = service.sha256(Buffer.from(JSON.stringify((({ manifestSha256, ...body }) => body)(m)))); })), /file checksum/);
  await assert.rejects(service.validateSystemBackup(await mutate((_z, m) => { m.files[0].kind = "unknown"; m.manifestSha256 = service.sha256(Buffer.from(JSON.stringify((({ manifestSha256, ...body }) => body)(m)))); })), /kind/);
  await assert.rejects(service.validateSystemBackup(await mutate((_z, m) => { m.totals.bytes += 1; m.manifestSha256 = service.sha256(Buffer.from(JSON.stringify((({ manifestSha256, ...body }) => body)(m)))); })), /totals/);
  await assert.rejects(service.validateSystemBackup(await mutate((z, m) => { z.file("payload/extra", "x"); m.manifestSha256 = service.sha256(Buffer.from(JSON.stringify((({ manifestSha256, ...body }) => body)(m)))); })), /unlisted/);
  await assert.rejects(service.restoreToNewDirectory(valid, temp), /must not already exist/);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("restore failure preserves an isolated staging directory for investigation", async () => {
  const temp = root();
  const file = path.join(temp, "a.txt"); fs.writeFileSync(file, "alpha");
  const archive = await service.createSystemBackup({ sources: [{ source: file, path: "data/a.txt", kind: "file" }] });
  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw new Error("simulated rename failure"); };
  try {
    await assert.rejects(service.restoreToNewDirectory(archive, path.join(temp, "target")), (error) => {
      assert.match(error.message, /simulated/);
      assert.ok(error.stagingDirectory.startsWith(path.join(temp, "target.restoring-")));
      assert.equal(fs.readFileSync(path.join(error.stagingDirectory, "data", "a.txt"), "utf8"), "alpha");
      return true;
    });
  } finally {
    fs.renameSync = originalRename;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
