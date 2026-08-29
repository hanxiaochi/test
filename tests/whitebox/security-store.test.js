"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { SecurityStore } = require("../../lib/security/security-store");

function withStore(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zwkjy-security-test-"));
  let now = Date.parse("2026-08-25T00:00:00.000Z");
  const store = new SecurityStore(path.join(root, "security.db"), { now: () => now });
  const clock = { advance(ms) { now += ms; } };
  try {
    return fn(store, clock);
  } finally {
    store.close();
    const resolved = path.resolve(root);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("zwkjy-security-test-")) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

test("bootstrap is idempotent and never resets an existing password", () => withStore((store) => {
  const first = store.bootstrap({ account: "YS1", password: "000000", tenantName: "测试组织" });
  const second = store.bootstrap({ account: "ys1", password: "changed-by-restart" });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.userId, second.userId);
  assert.ok(store.authenticate({ account: "ys1", password: "000000" }));
  assert.equal(store.authenticate({ account: "ys1", password: "changed-by-restart" }), null);
}));

test("security migration repairs certificate roles for every existing tenant", () => withStore((store) => {
  store.bootstrap({ tenantId: "legacy-tenant", account: "legacy-admin", password: "Legacy-Admin-42!" });
  const viewerRole = store.db.prepare("SELECT id FROM roles WHERE tenant_id = 'legacy-tenant' AND code = 'viewer'").get();
  store.db.prepare("DELETE FROM role_permissions WHERE role_id = ? AND permission_code = 'international:export'").run(viewerRole.id);
  store.db.prepare("DELETE FROM roles WHERE tenant_id = 'legacy-tenant' AND code = 'certificate_approver'").run();
  const reopened = new SecurityStore(store.file, { now: store.now });
  try {
    assert.deepEqual(reopened.listRoles("legacy-tenant").map((role) => role.code), ["admin", "certificate_approver", "editor", "viewer"]);
    assert.ok(reopened.listRoles("legacy-tenant").find((role) => role.code === "viewer").permissions.includes("international:export"));
    assert.ok(reopened.listRoles("legacy-tenant").find((role) => role.code === "certificate_approver").permissions.includes("international:issue"));
    assert.ok(reopened.db.prepare("SELECT 1 FROM security_migrations WHERE version = 5").get());
  } finally {
    reopened.close();
  }
}));

test("production bootstrap requires a strong password only for a new account", () => withStore((store) => {
  assert.throws(() => store.bootstrap({ account: "ys1", password: "000000", requireStrongPassword: true }), /Production bootstrap password is invalid/);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
  const created = store.bootstrap({ account: "ys1", password: "Bootstrap-Admin-42!", requireStrongPassword: true });
  assert.equal(created.created, true);
  const existing = store.bootstrap({ account: "ys1", password: "ignored-weak", requireStrongPassword: true });
  assert.equal(existing.created, false);
  assert.ok(store.authenticate({ account: "ys1", password: "Bootstrap-Admin-42!" }));
}));

test("login stores a hashed session, returns RBAC grants, and logout revokes it", () => withStore((store) => {
  store.bootstrap({ account: "ys1", password: "000000" });
  assert.equal(store.authenticate({ account: "missing", password: "wrong", ipAddress: "127.0.0.1" }), null);
  assert.equal(store.authenticate({ account: "ys1", password: "wrong" }), null);

  const login = store.authenticate({ account: "YS1", password: "000000", ipAddress: "127.0.0.1", userAgent: "test" });
  assert.ok(login.token);
  assert.equal(login.user.account, "ys1");
  assert.equal(login.user.mustChangePassword, true);
  assert.deepEqual(login.user.roles.map((role) => role.code), ["admin"]);
  assert.deepEqual(login.user.permissions, ["*"]);
  assert.equal(store.db.prepare("SELECT token_hash FROM sessions").get().token_hash === login.token, false);
  assert.ok(store.authorize(login.token, "admin:users"));
  assert.equal(store.logout(login.token, { ipAddress: "127.0.0.1" }), true);
  assert.equal(store.getSession(login.token), null);
  assert.equal(store.logout(login.token), false);

  const actions = store.auditRows(20).map((row) => `${row.action}:${row.result}`);
  assert.ok(actions.includes("login:success"));
  assert.ok(actions.includes("login:denied"));
  assert.ok(actions.includes("logout:success"));
}));

test("login rate limits persist across connections, expire, and retain only bounded identity hashes", () => withStore((store, clock) => {
  const policy = { maxAttempts: 2, windowMs: 5000, maxEntries: 2 };
  const identity = { ip: "127.0.0.1", tenantId: "Default", account: " Admin " };
  assert.deepEqual(store.loginRateStatus(identity, policy), { allowed: true, remaining: 2, retryAfterSeconds: 0 });
  assert.deepEqual(store.recordLoginFailure(identity, policy), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
  assert.deepEqual(store.recordLoginFailure({ ip: "127.0.0.1", tenantId: "default", account: "admin" }, policy), { allowed: false, remaining: 0, retryAfterSeconds: 5 });

  const peer = new SecurityStore(store.file, { now: store.now });
  try {
    assert.deepEqual(peer.loginRateStatus(identity, policy), { allowed: false, remaining: 0, retryAfterSeconds: 5 });
    const persisted = peer.db.prepare("SELECT identity_hash, attempts FROM login_failures").get();
    assert.equal(persisted.identity_hash.length, 64);
    assert.equal(persisted.identity_hash.includes("admin"), false);
    assert.equal(persisted.attempts, 2);
  } finally {
    peer.close();
  }

  clock.advance(1250);
  assert.equal(store.loginRateStatus(identity, policy).retryAfterSeconds, 4);
  clock.advance(3750);
  assert.deepEqual(store.loginRateStatus(identity, policy), { allowed: true, remaining: 2, retryAfterSeconds: 0 });

  store.recordLoginFailure({ account: "first" }, policy);
  clock.advance(1);
  store.recordLoginFailure({ account: "second" }, policy);
  clock.advance(1);
  store.recordLoginFailure({ account: "third" }, policy);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM login_failures").get().count, 2);
  assert.equal(store.recordLoginSuccess({ account: "second" }), true);
  assert.equal(store.recordLoginSuccess({ account: "second" }), false);
  assert.deepEqual(store.loginRateStatus({}, { maxAttempts: 0, windowMs: "bad", maxEntries: -1 }), { allowed: true, remaining: 10, retryAfterSeconds: 0 });
}));

test("sessions expire and disabled users or tenants fail closed", () => withStore((store, clock) => {
  const boot = store.bootstrap({ account: "ys1", password: "000000" });
  const short = store.authenticate({ account: "ys1", password: "000000" });
  clock.advance(8 * 60 * 60 * 1000 + 1);
  assert.equal(store.getSession(short.token), null);

  const remembered = store.authenticate({ account: "ys1", password: "000000", remember: true });
  assert.ok(remembered);
  store.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(boot.userId);
  assert.equal(store.getSession(remembered.token), null);
  assert.equal(store.authenticate({ account: "ys1", password: "000000" }), null);

  store.db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(boot.userId);
  store.db.prepare("UPDATE tenants SET status = 'disabled' WHERE id = 'default'").run();
  assert.equal(store.authenticate({ account: "ys1", password: "000000" }), null);
}));

test("password change validates the current secret, enforces policy, and revokes sessions", () => withStore((store) => {
  const boot = store.bootstrap({ account: "ys1", password: "000000" });
  const login = store.authenticate({ account: "ys1", password: "000000" });
  assert.throws(() => store.changePassword({ tenantId: "default", userId: boot.userId, currentPassword: "wrong", newPassword: "New-Password-42!" }), /当前密码不正确/);
  assert.throws(() => store.changePassword({ tenantId: "default", userId: boot.userId, currentPassword: "000000", newPassword: "weak" }), /密码/);
  assert.throws(() => store.changePassword({ tenantId: "default", userId: boot.userId, currentPassword: "000000", newPassword: "000000" }), /密码/);
  assert.throws(() => store.changePassword({ tenantId: "default", userId: 9999, currentPassword: "000000", newPassword: "New-Password-42!" }), /当前密码不正确/);

  const changed = store.changePassword({
    tenantId: "default",
    userId: boot.userId,
    currentPassword: "000000",
    newPassword: "New-Password-42!",
    ipAddress: "127.0.0.1",
    userAgent: "test"
  });
  assert.equal(changed.mustChangePassword, false);
  assert.equal(store.getSession(login.token), null);
  assert.equal(store.authenticate({ account: "ys1", password: "000000" }), null);
  assert.ok(store.authenticate({ account: "ys1", password: "New-Password-42!" }));
  const passwordAudits = store.auditRows().filter((row) => row.action === "password.change");
  assert.ok(passwordAudits.some((row) => row.result === "denied"));
  assert.ok(passwordAudits.some((row) => row.result === "success"));
}));

test("user creation validates password and roles transactionally", () => withStore((store) => {
  store.bootstrap({ account: "ys1", password: "000000" });
  assert.throws(() => store.createUser({ account: "", password: "Strong-Pass-42!" }), /Account is required/);
  assert.throws(() => store.createUser({ account: "weak", password: "123" }), /密码/);
  assert.throws(() => store.createUser({ account: "norole", password: "Strong-Pass-42!", roleCodes: ["missing"] }), /roles do not exist/);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM users WHERE account = 'norole'").get().count, 0);

  const user = store.createUser({ account: " Auditor ", displayName: "审核员", password: "Strong-Pass-42!", roleCodes: ["admin"] });
  assert.equal(user.account, "auditor");
  assert.equal(user.mustChangePassword, false);
  assert.ok(store.authenticate({ account: "auditor", password: "Strong-Pass-42!" }));
  assert.throws(() => store.createUser({ account: "auditor", password: "Another-Pass-42!" }), /UNIQUE/);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM users WHERE account = 'auditor'").get().count, 1);
  assert.ok(store.auditRows().some((row) => row.action === "user.create"));

  const viewer = store.createUser({ account: "viewer", password: "Viewer-Pass-42!", roleCodes: ["viewer"] });
  assert.deepEqual(viewer.permissions, ["data:read", "international:calculate", "international:export", "international:read"]);
  const viewerLogin = store.authenticate({ account: "viewer", password: "Viewer-Pass-42!" });
  assert.ok(store.authorize(viewerLogin.token, "data:read"));
  assert.ok(store.authorize(viewerLogin.token, "international:export"));
  assert.equal(store.authorize(viewerLogin.token, "international:issue"), null);
  assert.equal(store.authorize(viewerLogin.token, "data:write"), null);
  assert.equal(store.authorize(viewerLogin.token, "admin:access"), null);

  const approver = store.createUser({ account: "approver", password: "Approver-Pass-42!", roleCodes: ["certificate_approver"] });
  assert.deepEqual(approver.permissions, ["data:read", "international:calculate", "international:export", "international:issue", "international:read", "international:review", "international:void"]);
  const approverLogin = store.authenticate({ account: "approver", password: "Approver-Pass-42!" });
  assert.ok(store.authorize(approverLogin.token, "international:issue"));
  assert.ok(store.authorize(approverLogin.token, "international:void"));
  assert.ok(store.authorize(approverLogin.token, "international:review"));
  assert.equal(store.authorize(approverLogin.token, "international:submit"), null);
  assert.equal(store.authorize(approverLogin.token, "data:write"), null);
}));

test("invalid database path and permission denials are explicit", () => {
  assert.throws(() => new SecurityStore(""), /path is required/);
  withStore((store) => {
    store.bootstrap({ account: "ys1", password: "000000" });
    assert.equal(store.getSession(""), null);
    assert.equal(store.authorize("missing", "data:read"), null);
    assert.deepEqual(store.auditRows(0), []);
  });
});

test("administration lists users, changes roles, disables users, and revokes sessions", () => withStore((store) => {
  const admin = store.bootstrap({ account: "ys1", password: "000000" });
  assert.throws(() => store.setUserStatus({ userId: admin.userId, status: "disabled" }), /最后一个有效系统管理员/);
  assert.throws(() => store.setUserRoles({ userId: admin.userId, roleCodes: ["viewer"] }), /最后一个有效系统管理员/);
  assert.deepStrictEqual(store.listRoles().map((role) => role.code), ["admin", "certificate_approver", "editor", "viewer"]);
  assert.deepStrictEqual(store.listRoles().find((role) => role.code === "viewer").permissions, ["data:read", "international:calculate", "international:export", "international:read"]);
  assert.deepStrictEqual(store.listRoles().find((role) => role.code === "editor").permissions, ["data:read", "data:write", "international:calculate", "international:export", "international:read", "international:submit"]);
  assert.deepStrictEqual(store.listRoles().find((role) => role.code === "certificate_approver").permissions, ["data:read", "international:calculate", "international:export", "international:issue", "international:read", "international:review", "international:void"]);
  const created = store.createUser({ account: "worker", password: "Worker-Pass-42!", roleCodes: ["editor"] });
  assert.deepEqual(store.listUsers().map((user) => user.account), ["worker", "ys1"]);
  const login = store.authenticate({ account: "worker", password: "Worker-Pass-42!" });
  assert.ok(store.authorize(login.token, "data:write"));

  const viewer = store.setUserRoles({ userId: created.id, roleCodes: ["viewer", "viewer"], actorUserId: admin.userId });
  assert.deepEqual(viewer.roles.map((role) => role.code), ["viewer"]);
  assert.equal(store.getSession(login.token), null);
  assert.throws(() => store.setUserRoles({ userId: created.id, roleCodes: [] }), /At least one role/);
  assert.throws(() => store.setUserRoles({ userId: created.id, roleCodes: ["missing"] }), /roles do not exist/);
  assert.throws(() => store.setUserRoles({ userId: 9999, roleCodes: ["viewer"] }), /User does not exist/);

  const relogin = store.authenticate({ account: "worker", password: "Worker-Pass-42!" });
  const disabled = store.setUserStatus({ userId: created.id, status: "disabled", actorUserId: admin.userId });
  assert.equal(disabled.status, "disabled");
  assert.equal(store.getSession(relogin.token), null);
  assert.throws(() => store.setUserStatus({ userId: created.id, status: "unknown" }), /Invalid user status/);
  assert.throws(() => store.setUserStatus({ userId: 9999, status: "active" }), /User does not exist/);
  assert.ok(store.auditRows().some((row) => row.action === "user.roles"));
  assert.ok(store.auditRows().some((row) => row.action === "user.status"));
}));

test("administrator password reset is tenant scoped, revokes sessions, and forces replacement", () => withStore((store) => {
  const admin = store.bootstrap({ account: "ys1", password: "Admin-Start-42!" });
  const worker = store.createUser({ account: "worker", password: "Worker-Start-42!", roleCodes: ["viewer"] });
  const login = store.authenticate({ account: "worker", password: "Worker-Start-42!" });
  assert.throws(() => store.resetUserPassword({ tenantId: "default", userId: 9999, password: "Worker-Reset-42!" }), /User does not exist/);
  assert.throws(() => store.resetUserPassword({ tenantId: "default", userId: worker.id, password: "weak" }), /密码/);
  const reset = store.resetUserPassword({
    tenantId: "default",
    userId: worker.id,
    password: "Worker-Reset-42!",
    actorUserId: admin.userId,
    ipAddress: "127.0.0.1",
    userAgent: "test"
  });
  assert.equal(reset.mustChangePassword, true);
  assert.equal(store.getSession(login.token), null);
  assert.equal(store.authenticate({ account: "worker", password: "Worker-Start-42!" }), null);
  assert.equal(store.authenticate({ account: "worker", password: "Worker-Reset-42!" }).user.mustChangePassword, true);
  const audit = store.auditRows().find((row) => row.action === "user.password.reset");
  assert.equal(audit.user_id, admin.userId);
  assert.equal(audit.target_id, String(worker.id));
}));

test("project assignments are tenant scoped and revoke sessions when changed", () => withStore((store) => {
  store.bootstrap({ tenantId: "default", account: "admin", password: "Admin-Pass-42!" });
  store.ensureProject({ tenantId: "default", projectId: "p-2", name: "二号项目" });
  const user = store.createUser({
    tenantId: "default",
    account: "project_user",
    password: "Project-Pass-42!",
    roleCodes: ["viewer"],
    projectIds: ["1"]
  });
  assert.deepEqual(user.projects.map((project) => project.projectId), ["1"]);
  assert.equal(store.canAccessProject(user.id, "default", "1"), true);
  assert.equal(store.canAccessProject(user.id, "default", "p-2"), false);
  const login = store.authenticate({ tenantId: "default", account: "project_user", password: "Project-Pass-42!" });
  const changed = store.setUserProjects({ tenantId: "default", userId: user.id, projectIds: ["p-2"], actorUserId: 1 });
  assert.deepEqual(changed.projects.map((project) => project.projectId), ["p-2"]);
  assert.equal(store.getSession(login.token), null);
  assert.throws(() => store.setUserProjects({ tenantId: "default", userId: user.id, projectIds: ["missing"] }), /projects do not exist/);

  store.bootstrap({ tenantId: "other", account: "other_admin", password: "Other-Pass-42!" });
  assert.ok(store.auditRows(100, "default").every((row) => row.tenant_id === "default"), "tenant audit reads must not expose other tenants");
  assert.throws(() => store.ensureProject({ tenantId: "missing", projectId: "1" }), /Tenant does not exist/);
  assert.throws(() => store.ensureProject({ tenantId: "other", projectId: "x", status: "unknown" }), /Invalid project status/);
  assert.equal(store.canAccessProject(user.id, "default", "x"), false);
}));

test("security audit queries are tenant scoped, filterable, paged, exportable, and safely retained", () => withStore((store, clock) => {
  const admin = store.bootstrap({ tenantId: "tenant-a", account: "admin-a", password: "Admin-A-42!" });
  store.bootstrap({ tenantId: "tenant-b", account: "admin-b", password: "Admin-B-42!" });
  store.audit({ tenantId: "tenant-a", userId: admin.userId, action: "document.update", result: "success", targetType: "document", targetId: "DOC-100%", ipAddress: "10.0.0.1", details: { note: "alpha_beta" } });
  clock.advance(24 * 60 * 60 * 1000);
  store.audit({ tenantId: "tenant-a", userId: admin.userId, action: "document.update", result: "failure", targetType: "document", targetId: "DOC-200", ipAddress: "10.0.0.2", details: { note: "second" } });
  store.audit({ tenantId: "tenant-b", action: "document.update", result: "success", targetType: "document", targetId: "OTHER" });

  const tenantRows = store.queryAudit({ tenantId: "tenant-a", action: "document.update", page: 1, limit: 1 });
  assert.equal(tenantRows.total, 2);
  assert.equal(tenantRows.rows.length, 1);
  assert.equal(tenantRows.pages, 2);
  assert.equal(tenantRows.rows[0].result, "failure");
  assert.equal(store.queryAudit({ tenantId: "tenant-a", result: "success", userId: admin.userId, targetType: "document" }).total, 1);
  assert.equal(store.queryAudit({ tenantId: "tenant-a", keyword: "100%" }).total, 1);
  assert.equal(store.queryAudit({ tenantId: "tenant-a", keyword: "alpha_beta" }).total, 1);
  assert.equal(store.queryAudit({ tenantId: "tenant-a", from: "2026-08-26T00:00:00.000Z" }).total, 1);
  assert.equal(store.queryAudit({ tenantId: "tenant-a", to: "2026-08-25T23:59:59.999Z" }).total >= 1, true);
  assert.equal(store.auditExportRows({ tenantId: "tenant-a", action: "document.update" }).length, 2);
  assert.throws(() => store.queryAudit({ userId: "invalid" }), /userId is invalid/);
  assert.throws(() => store.queryAudit({ from: "invalid" }), /from is invalid/);
  assert.throws(() => store.queryAudit({ from: "2026-08-27", to: "2026-08-26" }), /from must not be later/);
  assert.throws(() => store.pruneAudit({ tenantId: "tenant-a" }), /before is required/);

  const retained = store.pruneAudit({ tenantId: "tenant-a", before: "2026-08-26T00:00:00.000Z", actorUserId: admin.userId });
  assert.equal(retained.deleted, 1);
  assert.equal(store.queryAudit({ tenantId: "tenant-a", action: "document.update" }).total, 1);
  assert.equal(store.queryAudit({ tenantId: "tenant-b", action: "document.update" }).total, 1);
  const marker = store.queryAudit({ tenantId: "tenant-a", action: "security.audit.retention" }).rows[0];
  assert.equal(marker.user_id, admin.userId);
  assert.equal(JSON.parse(marker.details_json).deleted, retained.deleted);
}));
