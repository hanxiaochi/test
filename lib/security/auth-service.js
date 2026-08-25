"use strict";

const path = require("path");
const { SecurityStore } = require("./security-store");

const ROOT = path.resolve(__dirname, "..", "..");
const securityFile = path.resolve(
  process.env.APP_SECURITY_DB_PATH ||
  (String(process.env.APP_STORAGE || "sqlite").toLowerCase() === "sqlite" && process.env.APP_SQLITE_DB_PATH) ||
  path.join(ROOT, "data", "security.db")
);

const store = new SecurityStore(securityFile);
const bootstrap = store.bootstrap({
  tenantId: process.env.APP_BOOTSTRAP_TENANT_ID || "default",
  tenantName: process.env.APP_BOOTSTRAP_TENANT_NAME || "默认组织",
  account: process.env.APP_BOOTSTRAP_ACCOUNT || "ys1",
  displayName: process.env.APP_BOOTSTRAP_DISPLAY_NAME || "系统管理员",
  password: process.env.APP_BOOTSTRAP_PASSWORD || "000000",
  requireStrongPassword: String(process.env.NODE_ENV || "").toLowerCase() === "production"
});

module.exports = { bootstrap, securityFile, store };
