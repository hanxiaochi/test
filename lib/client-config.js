"use strict";

function clean(value) {
  return String(value || "").trim();
}

function mapClientConfig(env = process.env) {
  const apiKey = clean(env.APP_AMAP_KEY);
  const securityCode = clean(env.APP_AMAP_SECURITY_CODE);
  if (!apiKey || !securityCode) return { enabled: false };
  return { enabled: true, apiKey, securityCode, version: "2.0" };
}

module.exports = { mapClientConfig };
