"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");

const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(npmCli)) throw new Error("npm CLI entrypoint is unavailable");

const commands = [
  ["run", "test:whitebox"],
  ["run", "test:security"],
  ["run", "test:security-store"],
  ["run", "test:account-security"],
  ["run", "test:authorization-admin"],
  ["run", "test:mlps-baseline"],
  ["run", "verify:security-baseline"],
  ["run", "test:deployment-security"],
  ["run", "test:spreadsheet-safety"],
  ["run", "verify:commercial-security"],
  ["run", "test:login-rate-persistence"],
  ["run", "test:auth-config"],
  ["run", "test:client-config"],
  ["run", "test:region-packs"],
  ["run", "test:region-pages"],
  ["run", "verify:region-ownership"],
  ["run", "test:release-artifact"],
  ["run", "test:http-security"],
  ["run", "test:runtime"],
  ["run", "test:readiness"],
  ["run", "test:rules"],
  ["run", "test:storage"],
  ["run", "test:backup"],
  ["run", "test:system-backup"],
  ["run", "test:business-context"],
  ["run", "test:tenant-store"],
  ["run", "test:tabular"],
  ["run", "test:fidic"],
  ["run", "test:international-settings"],
  ["run", "test:international-certificates"],
  ["run", "test:international-certificate-applications"],
  ["run", "test:international-contract-events"],
  ["run", "test:international-event-allocation"],
  ["run", "test:international-event-export"],
  ["run", "test:international-certificate-export"],
  ["run", "test:attachments"],
  ["run", "test:attachment-consistency"],
  ["run", "test:measure-import"],
  ["run", "test:report-export"],
  ["run", "test:workflow"],
  ["run", "test:workflow-coordinator"],
  ["run", "test:workflow-consistency"],
  ["run", "test:payment-fixtures"],
  ["run", "sample:regression"],
  ["run", "verify"],
  ["run", "verify:sqlite"],
  ["run", "verify:region-profile"]
];

for (const args of commands) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
