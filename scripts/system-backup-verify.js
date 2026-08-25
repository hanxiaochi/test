"use strict";

const fs = require("fs");
const path = require("path");
const service = require("../lib/backup/system-backup");

async function main() {
  const source = path.resolve(process.argv[2] || "");
  if (!process.argv[2] || !fs.existsSync(source)) throw new Error("System backup file does not exist");
  const result = await service.validateSystemBackup(fs.readFileSync(source));
  process.stdout.write(`${JSON.stringify({ ok: true, source, ...result.manifest.totals, manifestSha256: result.manifest.manifestSha256 }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
