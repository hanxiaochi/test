"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

const REQUIRED = ["server.js", "package.json", "package-lock.json", "DEPLOY.md", "REGION_MODULES.md", "config/region-profile.json"];
const FORBIDDEN = [
  /^\.env(?:\.|$)/, /^releases\//, /^tmp\//, /^logs\//, /^node_modules\//,
  /^data\/(?:attachments|exports|system-backups)\//, /^data\/.*\.(?:db|db-shm|db-wal)$/,
  /^data\/.*backup.*\.json$/i, /(?:^|\/)\.git(?:\/|$)/
];

function sha256(data) { return crypto.createHash("sha256").update(data).digest("hex"); }

function safePath(name) {
  const normalized = String(name || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..") || /^[A-Za-z]:/.test(normalized)) throw new Error(`unsafe ZIP path: ${name}`);
  if (FORBIDDEN.some((rule) => rule.test(normalized))) throw new Error(`forbidden release entry: ${normalized}`);
  return normalized;
}

async function main() {
  const archivePath = path.resolve(process.argv[2] || "");
  if (!process.argv[2] || !fs.existsSync(archivePath)) throw new Error("release ZIP path is required");
  const archive = fs.readFileSync(archivePath);
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true, createFolders: false });
  const manifestEntry = zip.file("RELEASE-MANIFEST.json");
  if (!manifestEntry) throw new Error("release manifest is missing");
  const manifest = JSON.parse(await manifestEntry.async("string"));
  if (manifest.schemaVersion !== 1 || manifest.product !== "zwkjy-clone" || !/^[0-9a-f]{40}$/.test(manifest.commit)) throw new Error("release manifest identity is invalid");
  Object.values(zip.files).forEach((entry) => safePath(entry.dir ? entry.name.replace(/\/$/, "") : entry.name));
  const actualNames = Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => safePath(entry.name)).filter((name) => name !== "RELEASE-MANIFEST.json").sort();
  const declaredNames = manifest.files.map((file) => safePath(file.path)).sort();
  if (new Set(declaredNames).size !== declaredNames.length || JSON.stringify(actualNames) !== JSON.stringify(declaredNames)) throw new Error("release manifest file list does not match ZIP entries");
  REQUIRED.forEach((name) => { if (!declaredNames.includes(name)) throw new Error(`required release file is missing: ${name}`); });
  let totalBytes = 0;
  for (const declared of manifest.files) {
    const data = await zip.file(declared.path).async("nodebuffer");
    totalBytes += data.length;
    if (declared.bytes !== data.length || declared.sha256 !== sha256(data)) throw new Error(`release entry checksum mismatch: ${declared.path}`);
  }
  if (manifest.fileCount !== manifest.files.length || manifest.totalBytes !== totalBytes || manifest.contentChecksum !== sha256(Buffer.from(JSON.stringify(manifest.files), "utf8"))) throw new Error("release manifest totals are invalid");
  const extractIndex = process.argv.indexOf("--extract");
  let extractedTo = "";
  if (extractIndex >= 0) {
    const targetArgument = process.argv[extractIndex + 1];
    if (!targetArgument) throw new Error("--extract requires a target directory");
    const target = path.resolve(targetArgument);
    if (fs.existsSync(target)) throw new Error(`extract target already exists: ${target}`);
    fs.mkdirSync(target, { recursive: true });
    for (const name of actualNames) {
      const destination = path.resolve(target, name);
      if (!destination.startsWith(`${target}${path.sep}`)) throw new Error(`entry escapes extract target: ${name}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, await zip.file(name).async("nodebuffer"));
    }
    fs.writeFileSync(path.join(target, "RELEASE-MANIFEST.json"), await manifestEntry.async("nodebuffer"));
    extractedTo = target;
  }
  console.log(JSON.stringify({ ok: true, archivePath, archiveBytes: archive.length, archiveSha256: sha256(archive), commit: manifest.commit, fileCount: manifest.fileCount, totalBytes, extractedTo }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });

module.exports = { FORBIDDEN, REQUIRED, safePath, sha256 };
