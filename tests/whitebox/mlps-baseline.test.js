"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { assessMlpsBaseline } = require("../../lib/security/mlps-baseline");

const policy = { passwordMaxAgeDays: 90, passwordHistoryCount: 5, maxFailedAttempts: 5, lockMinutes: 30, idleSessionMinutes: 30, maxSessionHours: 8, auditRetentionDays: 180 };

test("production baseline passes without claiming formal certification", () => {
  const report = assessMlpsBaseline({ env: { NODE_ENV: "production", APP_COOKIE_SECURE: "true" }, policy, stats: { databaseOk: true, usersWithoutRoles: 0, activeAdministrators: 1 }, now: 0 });
  assert.equal(report.ok, true);
  assert.equal(report.productionReady, true);
  assert.equal(report.certificationClaim, false);
  assert.equal(report.counts.fail, 0);
});

test("runtime deployment warnings and control failures are explicit", () => {
  const report = assessMlpsBaseline({ env: {}, policy: { ...policy, passwordHistoryCount: 2 }, stats: { databaseOk: false, usersWithoutRoles: 1, activeAdministrators: 0 } });
  assert.equal(report.ok, false);
  assert.equal(report.productionReady, false);
  assert.ok(report.checks.some((item) => item.status === "warn" && item.id === "transport"));
  assert.ok(report.checks.some((item) => item.status === "fail" && item.id === "integrity"));
});
