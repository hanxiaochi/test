"use strict";

const BUILTIN_ROLES = new Set(["admin", "editor", "viewer", "certificate_approver"]);

function roleCode(value) {
  const code = String(value || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{2,39}$/.test(code)) throw new Error("角色编码需为3-40位小写字母、数字、下划线或连字符");
  return code;
}

class AuthorizationAdmin {
  constructor(store) {
    if (!store || !store.db) throw new Error("Security store is required");
    this.store = store;
    this.db = store.db;
  }

  listPermissions() {
    return this.db.prepare("SELECT code, name FROM permissions ORDER BY code").all();
  }

  saveRole(options = {}) {
    const tenantId = String(options.tenantId || "default");
    const code = roleCode(options.code);
    if (BUILTIN_ROLES.has(code)) throw new Error("内置角色不可修改，请创建自定义角色");
    const name = String(options.name || "").trim().slice(0, 80);
    if (!name) throw new Error("角色名称不能为空");
    const permissionCodes = [...new Set((Array.isArray(options.permissionCodes) ? options.permissionCodes : []).map(String))];
    if (!permissionCodes.length) throw new Error("角色至少需要一个权限");
    if (permissionCodes.includes("*")) throw new Error("全部权限仅允许内置系统管理员角色使用");
    const known = this.db.prepare(`SELECT code FROM permissions WHERE code IN (${permissionCodes.map(() => "?").join(",")})`).all(...permissionCodes);
    if (known.length !== permissionCodes.length) throw new Error("包含不存在的权限项");
    const tenant = this.db.prepare("SELECT id FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) throw new Error("Tenant does not exist");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO roles(tenant_id, code, name, built_in) VALUES(?, ?, ?, 0)
        ON CONFLICT(tenant_id, code) DO UPDATE SET name = excluded.name
      `).run(tenantId, code, name);
      const role = this.db.prepare("SELECT id, built_in FROM roles WHERE tenant_id = ? AND code = ?").get(tenantId, code);
      if (role.built_in) throw new Error("内置角色不可修改");
      this.db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(role.id);
      permissionCodes.forEach((permission) => this.db.prepare("INSERT INTO role_permissions(role_id, permission_code) VALUES(?, ?)").run(role.id, permission));
      this.db.prepare(`
        UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND user_id IN (
          SELECT user_id FROM user_roles WHERE role_id = ?
        )
      `).run(this.store.nowIso(), role.id);
      this.store.audit({
        tenantId, userId: options.actorUserId, action: "role.permissions", result: "success",
        targetType: "role", targetId: code, details: { name, permissionCodes }
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.store.listRoles(tenantId).find((item) => item.code === code);
  }

  deleteRole(options = {}) {
    const tenantId = String(options.tenantId || "default");
    const code = roleCode(options.code);
    if (BUILTIN_ROLES.has(code)) throw new Error("内置角色不可删除");
    const role = this.db.prepare("SELECT id, built_in FROM roles WHERE tenant_id = ? AND code = ?").get(tenantId, code);
    if (!role) throw new Error("角色不存在");
    if (role.built_in) throw new Error("内置角色不可删除");
    const assigned = Number(this.db.prepare("SELECT COUNT(*) AS count FROM user_roles WHERE role_id = ?").get(role.id).count);
    if (assigned) throw new Error("角色仍有用户使用，不能删除");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM roles WHERE id = ?").run(role.id);
      this.store.audit({ tenantId, userId: options.actorUserId, action: "role.delete", result: "success", targetType: "role", targetId: code });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { code, deleted: true };
  }
}

module.exports = { AuthorizationAdmin, BUILTIN_ROLES, roleCode };
