"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

function resolvedSecurityFile(env) {
  const childEnv = { ...process.env };
  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  });
  const result = spawnSync(process.execPath, [
    "-e",
    "const service=require('./lib/security/auth-service'); console.log(service.securityFile); service.store.close();"
  ], { cwd: root, env: childEnv, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return path.resolve(result.stdout.trim());
}

test("authentication storage follows the default SQLite mode and explicit overrides", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "zwkjy-auth-config-test-"));
  try {
    const sqliteFile = path.join(temp, "custom-runtime.db");
    const securityFile = path.join(temp, "custom-security.db");
    assert.equal(resolvedSecurityFile({ APP_STORAGE: undefined, APP_SQLITE_DB_PATH: sqliteFile, APP_SECURITY_DB_PATH: undefined }), path.resolve(sqliteFile));
    assert.equal(resolvedSecurityFile({ APP_STORAGE: "json", APP_SQLITE_DB_PATH: sqliteFile, APP_SECURITY_DB_PATH: securityFile }), path.resolve(securityFile));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
