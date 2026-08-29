"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { securityPolicy } = require("../lib/security/account-security");
const { assessMlpsBaseline } = require("../lib/security/mlps-baseline");

const ROOT = path.resolve(__dirname, "..");
const sources = [
  "lib/security/auth-core.js", "lib/security/account-security.js", "lib/security/security-store.js",
  "lib/security/http-security.js", "lib/security/authorization-admin.js", "server.js"
].map((name) => [name, fs.readFileSync(path.join(ROOT, name), "utf8")]);

const requiredEvidence = [
  ["lib/security/auth-core.js", "crypto.scryptSync"],
  ["lib/security/account-security.js", "password_history"],
  ["lib/security/account-security.js", "locked_until"],
  ["lib/security/account-security.js", "last_seen_at"],
  ["lib/security/security-store.js", "requireStrongPassword"],
  ["lib/security/security-store.js", "security_audit"],
  ["lib/security/http-security.js", "Content-Security-Policy"],
  ["lib/security/http-security.js", "Strict-Transport-Security"],
  ["lib/security/authorization-admin.js", "role_permissions"],
  ["server.js", "browserMutationGuard"],
  ["server.js", "/api/admin/security_baseline"]
];

requiredEvidence.forEach(([file, marker]) => {
  const source = sources.find(([name]) => name === file);
  assert.ok(source && source[1].includes(marker), `missing security control ${marker} in ${file}`);
});

const report = assessMlpsBaseline({
  env: { NODE_ENV: "production", APP_COOKIE_SECURE: "true" },
  policy: securityPolicy({}),
  stats: { databaseOk: true, usersWithoutRoles: 0, activeAdministrators: 1 }
});
assert.equal(report.productionReady, true, "default production security policy should satisfy the technical baseline");
console.log(JSON.stringify({ ok: true, baseline: report.baseline, controls: requiredEvidence.length, counts: report.counts, certificationClaim: false }, null, 2));
