"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const JSZip = require("jszip");

const ROOT = path.resolve(__dirname, "..");
const FIXED_DATE = new Date("2000-01-01T00:00:00.000Z");
const FORBIDDEN = [
  /^\.env(?:\.|$)/,
  /^releases\//,
  /^tmp\//,
  /^logs\//,
  /^node_modules\//,
  /^data\/(?:attachments|exports|system-backups)\//,
  /^data\/.*\.(?:db|db-shm|db-wal)$/,
  /^data\/.*backup.*\.json$/i,
  /(?:^|\/)\.git(?:\/|$)/
];

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT })
    .toString("utf8").split("\0").filter(Boolean).sort();
}

function assertTrackedTreeClean() {
  try {
    execFileSync("git", ["diff", "--quiet"], { cwd: ROOT, stdio: "ignore" });
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: ROOT, stdio: "ignore" });
  } catch {
    throw new Error("release build requires all tracked changes to be committed");
  }
}

function safeTrackedFile(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error(`unsafe release path: ${relativePath}`);
  if (FORBIDDEN.some((rule) => rule.test(normalized))) throw new Error(`forbidden tracked release path: ${normalized}`);
  const absolute = path.resolve(ROOT, normalized);
  if (!absolute.startsWith(`${ROOT}${path.sep}`)) throw new Error(`release path escapes project: ${normalized}`);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`release source must be a regular file: ${normalized}`);
  return { normalized, absolute };
}

async function main() {
  assertTrackedTreeClean();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const output = path.resolve(process.argv[2] || path.join(ROOT, "releases", `zwkjy-clone-${commit.slice(0, 12)}.zip`));
  const zip = new JSZip();
  const manifestFiles = [];
  let totalBytes = 0;
  for (const file of trackedFiles().map(safeTrackedFile)) {
    const data = fs.readFileSync(file.absolute);
    totalBytes += data.length;
    manifestFiles.push({ path: file.normalized, bytes: data.length, sha256: sha256(data) });
    zip.file(file.normalized, data, { date: FIXED_DATE, createFolders: false });
  }
  const manifest = {
    schemaVersion: 1, product: "zwkjy-clone", commit, files: manifestFiles,
    fileCount: manifestFiles.length, totalBytes,
    contentChecksum: sha256(Buffer.from(JSON.stringify(manifestFiles), "utf8"))
  };
  zip.file("RELEASE-MANIFEST.json", `${JSON.stringify(manifest, null, 2)}\n`, { date: FIXED_DATE, createFolders: false });
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, archive);
  fs.renameSync(temporary, output);
  console.log(JSON.stringify({ ok: true, output, archiveBytes: archive.length, archiveSha256: sha256(archive), ...manifest }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });

module.exports = { FORBIDDEN, assertTrackedTreeClean, safeTrackedFile, sha256, trackedFiles };
