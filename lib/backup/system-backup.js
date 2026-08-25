"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const JSZip = require("jszip");
const { DatabaseSync, backup } = require("node:sqlite");

const FORMAT = "zwkjy-system-backup-v1";
const DEFAULT_LIMITS = Object.freeze({ maxFiles: 100000, maxBytes: 2 * 1024 * 1024 * 1024 });

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function archivePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Backup entry path is unsafe");
  }
  return normalized;
}

function limits(options = {}) {
  const maxFiles = Number(options.maxFiles ?? DEFAULT_LIMITS.maxFiles);
  const maxBytes = Number(options.maxBytes ?? DEFAULT_LIMITS.maxBytes);
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Backup limits are invalid");
  return { maxFiles, maxBytes };
}

function collectDirectory(root, prefix, options = {}) {
  const sourceRoot = path.resolve(root);
  const excluded = new Set((options.excludeNames || []).map(String));
  const rows = [];
  function walk(directory, relative = "") {
    fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach((entry) => {
      if (!relative && excluded.has(entry.name)) return;
      const source = path.join(directory, entry.name);
      const nextRelative = relative ? path.join(relative, entry.name) : entry.name;
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) throw new Error(`Backup source contains a symbolic link: ${nextRelative}`);
      if (stat.isDirectory()) walk(source, nextRelative);
      else if (stat.isFile() && !/-wal$|-shm$|\.tmp$/i.test(entry.name)) {
        rows.push({ source, path: archivePath(path.posix.join(prefix, nextRelative.replace(/\\/g, "/"))), kind: /\.db$/i.test(entry.name) ? "sqlite" : "file" });
      }
    });
  }
  if (fs.existsSync(sourceRoot)) walk(sourceRoot);
  return rows;
}

async function sqliteBytes(source, openDatabase) {
  const temporary = path.join(os.tmpdir(), `zwkjy-db-snapshot-${process.pid}-${crypto.randomUUID()}.db`);
  let db = openDatabase;
  let owned = false;
  try {
    if (!db) {
      db = new DatabaseSync(path.resolve(source), { readOnly: true });
      owned = true;
    }
    await backup(db, temporary);
    const snapshot = fs.readFileSync(temporary);
    await verifySqlite(snapshot);
    return snapshot;
  } finally {
    if (owned && db) db.close();
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function verifySqlite(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer.subarray(0, 16).toString("binary") !== "SQLite format 3\0") throw new Error("Backup SQLite file is invalid");
  const temporary = path.join(os.tmpdir(), `zwkjy-db-verify-${process.pid}-${crypto.randomUUID()}.db`);
  try {
    fs.writeFileSync(temporary, buffer, { flag: "wx", mode: 0o600 });
    const db = new DatabaseSync(temporary, { readOnly: true });
    try {
      const values = db.prepare("PRAGMA quick_check").all().flatMap((row) => Object.values(row)).map(String);
      if (!values.length || values.some((value) => value.toLowerCase() !== "ok")) throw new Error("Backup SQLite integrity check failed");
    } finally {
      db.close();
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function sourceBytes(source) {
  if (source.kind === "sqlite") return sqliteBytes(source.source, source.db);
  const before = fs.statSync(source.source);
  if (!before.isFile()) throw new Error("Backup source is not a regular file");
  const bytes = fs.readFileSync(source.source);
  const after = fs.statSync(source.source);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("Backup source changed while it was read");
  return bytes;
}

async function createSystemBackup(options = {}) {
  const bounded = limits(options);
  const sources = Array.isArray(options.sources) ? options.sources : [];
  if (!sources.length || sources.length > bounded.maxFiles) throw new Error("Backup source count is invalid");
  const seen = new Set();
  const files = [];
  const zip = new JSZip();
  const timestamp = options.createdAt ?? Date.now();
  let totalBytes = 0;
  for (const source of sources) {
    const target = archivePath(source.path);
    if (seen.has(target)) throw new Error(`Duplicate backup entry: ${target}`);
    seen.add(target);
    const bytes = await sourceBytes({ ...source, path: target });
    totalBytes += bytes.length;
    if (totalBytes > bounded.maxBytes) throw new Error("Backup exceeds the configured size limit");
    const row = { path: target, kind: source.kind === "sqlite" ? "sqlite" : "file", bytes: bytes.length, sha256: sha256(bytes) };
    files.push(row);
    zip.file(`payload/${target}`, bytes, { date: new Date(timestamp) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifestBody = {
    format: FORMAT,
    createdAt: new Date(timestamp).toISOString(),
    createdBy: String(options.createdBy || "system"),
    applicationVersion: String(options.applicationVersion || "unknown"),
    files,
    totals: { files: files.length, bytes: totalBytes }
  };
  const canonical = JSON.stringify(manifestBody);
  const manifest = { ...manifestBody, manifestSha256: sha256(Buffer.from(canonical)) };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2), { date: new Date(timestamp) });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "UNIX" });
}

async function validateSystemBackup(input, options = {}) {
  const bounded = limits(options);
  if (!Buffer.isBuffer(input) || !input.length || input.length > bounded.maxBytes) throw new Error("System backup archive size is invalid");
  let zip;
  try {
    zip = await JSZip.loadAsync(input, { checkCRC32: true, createFolders: false });
  } catch (_error) {
    throw new Error("System backup is not a valid ZIP archive");
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length < 2 || entries.length > bounded.maxFiles + 1) throw new Error("System backup entry count is invalid");
  entries.forEach((entry) => {
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) throw new Error("System backup contains an unsafe path");
    archivePath(entry.name);
  });
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) throw new Error("System backup manifest is missing");
  let manifest;
  try {
    manifest = JSON.parse(await manifestEntry.async("string"));
  } catch (_error) {
    throw new Error("System backup manifest is invalid");
  }
  if (!manifest || manifest.format !== FORMAT || !Array.isArray(manifest.files)) throw new Error("Unsupported system backup format");
  const { manifestSha256, ...body } = manifest;
  if (sha256(Buffer.from(JSON.stringify(body))) !== manifestSha256) throw new Error("System backup manifest checksum mismatch");
  if (manifest.files.length < 1 || manifest.files.length > bounded.maxFiles) throw new Error("System backup file count is invalid");
  const expectedEntries = new Set(["manifest.json"]);
  const files = new Map();
  let totalBytes = 0;
  for (const row of manifest.files) {
    const target = archivePath(row && row.path);
    const zipPath = `payload/${target}`;
    if (expectedEntries.has(zipPath)) throw new Error("System backup manifest contains duplicate files");
    expectedEntries.add(zipPath);
    const entry = zip.file(zipPath);
    if (!entry) throw new Error(`System backup file is missing: ${target}`);
    const bytes = await entry.async("nodebuffer");
    totalBytes += bytes.length;
    if (totalBytes > bounded.maxBytes || bytes.length !== row.bytes || sha256(bytes) !== row.sha256) throw new Error(`System backup file checksum mismatch: ${target}`);
    if (row.kind === "sqlite") await verifySqlite(bytes);
    else if (row.kind !== "file") throw new Error("System backup file kind is invalid");
    files.set(target, bytes);
  }
  if (entries.some((entry) => !expectedEntries.has(entry.name))) throw new Error("System backup contains unlisted files");
  if (!manifest.totals || manifest.totals.files !== files.size || manifest.totals.bytes !== totalBytes) throw new Error("System backup totals mismatch");
  return { manifest, files };
}

async function restoreToNewDirectory(input, targetDirectory, options = {}) {
  const target = path.resolve(targetDirectory);
  if (fs.existsSync(target)) throw new Error("Restore target must not already exist");
  const verified = await validateSystemBackup(input, options);
  const staging = `${target}.restoring-${crypto.randomUUID()}`;
  fs.mkdirSync(staging, { recursive: false });
  try {
    for (const [relative, bytes] of verified.files) {
      const output = path.resolve(staging, ...relative.split("/"));
      const inside = path.relative(staging, output);
      if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("Restore path escaped the target directory");
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
    }
    fs.renameSync(staging, target);
    return { target, files: verified.manifest.totals.files, bytes: verified.manifest.totals.bytes, manifestSha256: verified.manifest.manifestSha256 };
  } catch (error) {
    error.stagingDirectory = staging;
    throw error;
  }
}

module.exports = { FORMAT, archivePath, collectDirectory, createSystemBackup, restoreToNewDirectory, sha256, sqliteBytes, validateSystemBackup, verifySqlite };
