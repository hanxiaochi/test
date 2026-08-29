"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SecurityStore } = require("../../lib/security/security-store");
const { AuthorizationAdmin, roleCode } = require("../../lib/security/authorization-admin");

test("custom roles enforce known least-privilege permissions and revoke sessions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zwkjy-role-admin-"));
  const store = new SecurityStore(path.join(root, "security.db"));
  try {
    const boot = store.bootstrap({ account: "admin", password: "Admin-Start-42!" });
    const admin = new AuthorizationAdmin(store);
    assert.ok(admin.listPermissions().some((item) => item.code === "data:read"));
    assert.throws(() => admin.saveRole({ code: "admin", name: "覆盖管理员", permissionCodes: ["data:read"] }), /内置角色/);
    assert.throws(() => admin.saveRole({ code: "bad role", name: "错误", permissionCodes: ["data:read"] }), /角色编码/);
    assert.throws(() => admin.saveRole({ code: "custom_a", name: "", permissionCodes: ["data:read"] }), /名称/);
    assert.throws(() => admin.saveRole({ code: "custom_a", name: "测试", permissionCodes: ["missing"] }), /不存在/);
    const role = admin.saveRole({ code: "cost_auditor", name: "造价审核员", permissionCodes: ["data:read", "international:read"], actorUserId: boot.userId });
    assert.deepEqual(role.permissions, ["data:read", "international:read"]);
    const user = store.createUser({ account: "auditor", password: "Auditor-Pass-42!", roleCodes: ["cost_auditor"] });
    const login = store.authenticate({ account: "auditor", password: "Auditor-Pass-42!" });
    admin.saveRole({ code: "cost_auditor", name: "造价复核员", permissionCodes: ["data:read"], actorUserId: boot.userId });
    assert.equal(store.getSession(login.token), null);
    assert.throws(() => admin.deleteRole({ code: "cost_auditor" }), /仍有用户/);
    store.setUserRoles({ userId: user.id, roleCodes: ["viewer"] });
    assert.equal(admin.deleteRole({ code: "cost_auditor", actorUserId: boot.userId }).deleted, true);
    assert.throws(() => admin.deleteRole({ code: "admin" }), /内置角色/);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(roleCode(" Cost_Auditor "), "cost_auditor");
});
