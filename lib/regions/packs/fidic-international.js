"use strict";

module.exports = Object.freeze({
  id: "fidic-international",
  version: "1.1.0",
  displayName: { "zh-CN": "FIDIC 国际合同", "en-US": "FIDIC International" },
  dependencies: ["core-platform"],
  capabilities: ["fidic-certificates", "multi-currency", "multi-language", "contract-events", "notice-deadlines"],
  frontend: {
    topMenuIds: [],
    resourceIds: [9040, 9041],
    menuItems: [
      {
        resourceId: 9041, parentId: 9000, order: 20, resourceCode: "990008",
        name: { "zh-CN": "国际证书工作台", "en-US": "International Certificates" },
        description: { "zh-CN": "国际付款证书试算、签发、作废与下载", "en-US": "Calculate, issue, void and export payment certificates" },
        resourceUrl: "international/certificates_page", menuIcon: "layui-icon layui-icon-form", resourceNo: "model"
      },
      {
        resourceId: 9040, parentId: 9000, order: 70, resourceCode: "990005",
        name: { "zh-CN": "国际合同设置", "en-US": "International Contract Settings" },
        description: { "zh-CN": "多语言、多币种与FIDIC付款证书设置", "en-US": "Languages, currencies and FIDIC certificate settings" },
        resourceUrl: "admin/international_settings_page", menuIcon: "layui-icon layui-icon-engine", resourceNo: "model"
      }
    ],
    pages: [
      { id: "fidic-workbench", titleKey: "modules.fidic.workbench", href: "/international/certificates_page", permission: "international:read" },
      { id: "fidic-settings", titleKey: "modules.fidic.settings", href: "/admin/international_settings_page", permission: "admin:access" }
    ]
  },
  backend: {
    exactRoutes: ["/admin/international_settings_page", "/sbr/sbr_com/9040", "/sbr/sbr_com/9041"],
    routePrefixes: ["/api/international", "/api/admin/international_settings", "/international"],
    workflowModules: ["internationalcertificate", "internationalcontractevent"]
  }
});
