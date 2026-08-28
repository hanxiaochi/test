"use strict";

module.exports = Object.freeze({
  id: "core-platform",
  version: "1.1.0",
  displayName: { "zh-CN": "平台基础能力", "en-US": "Platform Core" },
  dependencies: [],
  capabilities: ["identity", "rbac", "audit", "backup", "workflow", "data-exchange"],
  frontend: {
    topMenuIds: [9000],
    resourceIds: [9003, 9010, 9020, 9030, 9050, 9060],
    topMenus: [
      {
        resourceId: 9000,
        parentId: 0,
        order: 9000,
        resourceCode: "9900",
        name: { "zh-CN": "后台管理", "en-US": "Administration" },
        description: { "zh-CN": "平台与地区模块管理", "en-US": "Platform and regional module administration" },
        resourceUrl: "",
        menuIcon: "layui-icon layui-icon-set",
        resourceNo: "root"
      }
    ],
    menuItems: [
      {
        resourceId: 9003, parentId: 9000, order: 10, resourceCode: "990000",
        name: { "zh-CN": "后台首页", "en-US": "Admin Dashboard" },
        description: { "zh-CN": "平台运行与工程造价后台首页", "en-US": "Platform operations and cost administration dashboard" },
        resourceUrl: "admin/dashboard_page", menuIcon: "layui-icon layui-icon-console", resourceNo: "model"
      },
      {
        resourceId: 9010, parentId: 9000, order: 40, resourceCode: "990002",
        name: { "zh-CN": "账号权限管理", "en-US": "Accounts and Access" },
        description: { "zh-CN": "账号、角色与安全审计", "en-US": "Accounts, roles and security audit" },
        resourceUrl: "admin/users_page", menuIcon: "layui-icon layui-icon-user", resourceNo: "model"
      },
      {
        resourceId: 9020, parentId: 9000, order: 50, resourceCode: "990003",
        name: { "zh-CN": "备份恢复管理", "en-US": "Backup and Recovery" },
        description: { "zh-CN": "项目数据备份、导入与恢复", "en-US": "Project backup, import and recovery" },
        resourceUrl: "admin/backups_page", menuIcon: "layui-icon layui-icon-file-b", resourceNo: "model"
      },
      {
        resourceId: 9030, parentId: 9000, order: 60, resourceCode: "990004",
        name: { "zh-CN": "数据导入导出", "en-US": "Data Exchange" },
        description: { "zh-CN": "核心业务数据批量校验、导入与导出", "en-US": "Validate, import and export business data" },
        resourceUrl: "admin/data_exchange_page", menuIcon: "layui-icon layui-icon-upload-drag", resourceNo: "model"
      },
      {
        resourceId: 9050, parentId: 9000, order: 80, resourceCode: "990006",
        name: { "zh-CN": "审批流程配置", "en-US": "Workflow Configuration" },
        description: { "zh-CN": "审批状态、跳转权限与流程版本管理", "en-US": "Workflow states, transition permissions and versions" },
        resourceUrl: "admin/workflows_page", menuIcon: "layui-icon layui-icon-chart-screen", resourceNo: "model"
      },
      {
        resourceId: 9060, parentId: 9000, order: 90, resourceCode: "990007",
        name: { "zh-CN": "审批一致性巡检", "en-US": "Workflow Consistency" },
        description: { "zh-CN": "业务状态、审批实例与事件修订一致性巡检", "en-US": "Audit business state, workflow instances and event revisions" },
        resourceUrl: "admin/workflow_consistency_page", menuIcon: "layui-icon layui-icon-vercode", resourceNo: "model"
      }
    ],
    pages: [
      { id: "admin-dashboard", titleKey: "modules.core.dashboard", href: "/admin/dashboard_page", permission: "admin:access" },
      { id: "admin-users", titleKey: "modules.core.users", href: "/admin/users_page", permission: "admin:users" },
      { id: "admin-backups", titleKey: "modules.core.backups", href: "/admin/backups_page", permission: "admin:access" },
      { id: "admin-workflows", titleKey: "modules.core.workflows", href: "/admin/workflows_page", permission: "admin:access" }
    ]
  },
  backend: { exactRoutes: [], routePrefixes: [], workflowModules: [] }
});
