"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SecurityStore } = require("../../lib/security/security-store");
const { boundedInteger, securityPolicy } = require("../../lib/security/account-security");

function withStore(run, policy = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zwkjy-account-security-"));
  let now = Date.parse("2026-08-30T00:00:00.000Z");
  const store = new SecurityStore(path.join(root, "security.db"), { now: () => now, policy: { ...securityPolicy({}), ...policy } });
  try { return run(store, { advance(ms) { now += ms; } }); }
  finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

test("security policy applies bounded MLPS level-two defaults", () => {
  assert.equal(boundedInteger("5", 9, 3, 10), 5);
  assert.equal(boundedInteger("99", 9, 3, 10), 9);
  assert.deepEqual(securityPolicy({}), {
    passwordMaxAgeDays: 90, passwordHistoryCount: 5, maxFailedAttempts: 5,
    lockMinutes: 30, idleSessionMinutes: 30, maxSessionHours: 8, auditRetentionDays: 180
  });
});

test("password history rejects reuse and password age forces replacement", () => withStore((store, clock) => {
  const boot = store.bootstrap({ account: "admin", password: "Admin-Start-42!" });
  store.changePassword({ userId: boot.userId, currentPassword: "Admin-Start-42!", newPassword: "Admin-Next-42!" });
  assert.throws(() => store.changePassword({ userId: boot.userId, currentPassword: "Admin-Next-42!", newPassword: "Admin-Start-42!" }), /最近5次密码/);
  clock.advance(90 * 86400000 + 1);
  const login = store.authenticate({ account: "admin", password: "Admin-Next-42!" });
  assert.equal(login.user.passwordExpired, true);
  assert.equal(login.user.mustChangePassword, true);
}));

test("failed passwords lock the account and an administrator can unlock it", () => withStore((store, clock) => {
  const boot = store.bootstrap({ account: "admin", password: "Admin-Start-42!" });
  for (let index = 0; index < 5; index += 1) assert.equal(store.authenticate({ account: "admin", password: "wrong" }), null);
  assert.ok(store.listUsers()[0].lockedUntil);
  assert.equal(store.authenticate({ account: "admin", password: "Admin-Start-42!" }), null);
  const unlocked = store.unlockUser({ userId: boot.userId, actorUserId: boot.userId });
  assert.equal(unlocked.lockedUntil, null);
  assert.ok(store.authenticate({ account: "admin", password: "Admin-Start-42!" }));
  clock.advance(1);
  assert.ok(store.auditRows().some((row) => row.action === "user.unlock"));
}));

test("idle sessions expire while active sessions refresh last-seen time", () => withStore((store, clock) => {
  store.bootstrap({ account: "admin", password: "Admin-Start-42!" });
  const login = store.authenticate({ account: "admin", password: "Admin-Start-42!", remember: true });
  clock.advance(29 * 60000);
  assert.ok(store.getSession(login.token));
  clock.advance(29 * 60000);
  assert.ok(store.getSession(login.token));
  clock.advance(31 * 60000);
  assert.equal(store.getSession(login.token), null);
}));

test("security posture detects orphan accounts and keeps database integrity visible", () => withStore((store) => {
  store.bootstrap({ account: "admin", password: "Admin-Start-42!" });
  const posture = store.securityPosture();
  assert.equal(posture.databaseOk, true);
  assert.equal(posture.activeAdministrators, 1);
  store.db.prepare("DELETE FROM user_roles").run();
  assert.equal(store.securityPosture().usersWithoutRoles, 1);
}));
