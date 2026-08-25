"use strict";

const fs = require("fs");
const path = require("path");
const service = require("../lib/backup/system-backup");
const pkg = require("../package.json");

async function main() {
  const root = path.resolve(__dirname, "..");
  const dataDir = path.resolve(process.env.APP_DATA_DIR || path.join(root, "data"));
  const sources = service.collectDirectory(dataDir, "data", { excludeNames: ["exports", "system-backups"] });
  const createdAt = new Date();
  const output = path.resolve(process.argv[2] || path.join(dataDir, "system-backups", `system-${createdAt.toISOString().replace(/[:.]/g, "-")}.zip`));
  if (fs.existsSync(output)) throw new Error("Backup output already exists");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const bytes = await service.createSystemBackup({ sources, createdAt, createdBy: process.env.USERNAME || "system", applicationVersion: pkg.version });
  fs.writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
  const verified = await service.validateSystemBackup(bytes);
  process.stdout.write(`${JSON.stringify({ ok: true, output, files: verified.manifest.totals.files, bytes: verified.manifest.totals.bytes, manifestSha256: verified.manifest.manifestSha256 }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
