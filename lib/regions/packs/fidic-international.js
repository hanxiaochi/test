"use strict";

module.exports = Object.freeze({
  id: "fidic-international",
  version: "1.0.0",
  displayName: { "zh-CN": "FIDIC 国际合同", "en-US": "FIDIC International" },
  dependencies: ["core-platform"],
  capabilities: ["fidic-certificates", "multi-currency", "multi-language", "contract-events", "notice-deadlines"],
  frontend: {
    topMenuIds: [],
    resourceIds: [9040, 9041],
    pages: [
      { id: "fidic-workbench", titleKey: "modules.fidic.workbench", href: "/international/certificates_page", permission: "international:read" },
      { id: "fidic-settings", titleKey: "modules.fidic.settings", href: "/admin/international_settings_page", permission: "admin:access" }
    ]
  },
  backend: {
    exactRoutes: ["/admin/international_settings_page", "/sbr/sbr_com/9040", "/sbr/sbr_com/9041"],
    routePrefixes: ["/api/international", "/api/admin/international_settings", "/international"]
  }
});
