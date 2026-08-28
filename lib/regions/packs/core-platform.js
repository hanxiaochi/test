"use strict";

module.exports = Object.freeze({
  id: "core-platform",
  version: "1.0.0",
  displayName: { "zh-CN": "平台基础能力", "en-US": "Platform Core" },
  dependencies: [],
  capabilities: ["identity", "rbac", "audit", "backup", "workflow", "data-exchange"],
  frontend: {
    topMenuIds: [9000],
    resourceIds: [9003, 9010, 9020, 9030, 9050, 9060],
    pages: [
      { id: "admin-dashboard", titleKey: "modules.core.dashboard", href: "/admin/dashboard_page", permission: "admin:access" },
      { id: "admin-users", titleKey: "modules.core.users", href: "/admin/users_page", permission: "admin:users" },
      { id: "admin-backups", titleKey: "modules.core.backups", href: "/admin/backups_page", permission: "admin:access" },
      { id: "admin-workflows", titleKey: "modules.core.workflows", href: "/admin/workflows_page", permission: "admin:access" }
    ]
  },
  backend: { exactRoutes: [], routePrefixes: [] }
});
