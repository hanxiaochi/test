"use strict";

const fs = require("fs");
const path = require("path");
const service = require("../lib/backup/system-backup");

async function main() {
  const source = path.resolve(process.argv[2] || "");
  const target = path.resolve(process.argv[3] || "");
  if (!process.argv[2] || !fs.existsSync(source)) throw new Error("System backup file does not exist");
  if (!process.argv[3]) throw new Error("A new restore target directory is required");
  const result = await service.restoreToNewDirectory(fs.readFileSync(source), target);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.message}${error.stagingDirectory ? `; incomplete staging retained at ${error.stagingDirectory}` : ""}\n`); process.exitCode = 1; });
