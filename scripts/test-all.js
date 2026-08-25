"use strict";

const { spawnSync } = require("child_process");

const commands = [
  ["run", "test:whitebox"],
  ["run", "test:security"],
  ["run", "test:security-store"],
  ["run", "test:rules"],
  ["run", "test:storage"],
  ["run", "test:backup"],
  ["run", "test:payment-fixtures"],
  ["run", "sample:regression"],
  ["run", "verify"],
  ["run", "verify:sqlite"]
];

for (const args of commands) {
  const result = spawnSync("npm.cmd", args, { stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
