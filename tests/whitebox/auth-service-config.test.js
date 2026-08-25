"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

function runAuthService(env, script = "console.log(service.securityFile)") {
  const childEnv = { ...process.env };
  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  });
  const result = spawnSync(process.execPath, [
    "-e",
    `const service=require('./lib/security/auth-service'); try { ${script} } finally { service.store.close(); }`
  ], { cwd: root, env: childEnv, encoding: "utf8" });
  return result;
}

function resolvedSecurityFile(env) {
  const result = runAuthService(env);
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

test("production authentication bootstrap rejects weak new credentials without resetting existing users", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "zwkjy-auth-production-test-"));
  const securityFile = path.join(temp, "security.db");
  const baseEnv = {
    NODE_ENV: "production",
    APP_STORAGE: "json",
    APP_SECURITY_DB_PATH: securityFile,
    APP_BOOTSTRAP_ACCOUNT: "production-admin"
  };
  try {
    const weak = runAuthService({ ...baseEnv, APP_BOOTSTRAP_PASSWORD: "000000" });
    assert.notEqual(weak.status, 0);
    assert.match(weak.stderr, /Production bootstrap password is invalid/);

    const strong = runAuthService(
      { ...baseEnv, APP_BOOTSTRAP_PASSWORD: "Bootstrap-Admin-42!" },
      "console.log(JSON.stringify(service.bootstrap))"
    );
    assert.equal(strong.status, 0, strong.stderr);
    assert.equal(JSON.parse(strong.stdout).created, true);

    const restart = runAuthService(
      { ...baseEnv, APP_BOOTSTRAP_PASSWORD: "ignored-weak" },
      "console.log(JSON.stringify({ bootstrap: service.bootstrap, authenticated: Boolean(service.store.authenticate({ account: 'production-admin', password: 'Bootstrap-Admin-42!' })) }))"
    );
    assert.equal(restart.status, 0, restart.stderr);
    const result = JSON.parse(restart.stdout);
    assert.equal(result.bootstrap.created, false);
    assert.equal(result.authenticated, true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
