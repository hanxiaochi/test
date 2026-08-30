"use strict";

const { validatePasswordPolicy } = require("./auth-core");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function normalizedBoolean(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function normalizeHost(value) {
  const host = String(value || "127.0.0.1").trim().toLowerCase();
  if (!host || /[\s/\\]/.test(host)) throw new Error("APP_HOST is invalid");
  return host;
}

function isLoopbackHost(value) {
  return LOOPBACK_HOSTS.has(normalizeHost(value));
}

function deploymentSecurityPolicy(env = process.env) {
  const host = normalizeHost(env.APP_HOST || env.HOST);
  const production = String(env.NODE_ENV || "").trim().toLowerCase() === "production";
  const publicBinding = !isLoopbackHost(host);
  const secureCookie = normalizedBoolean(env.APP_COOKIE_SECURE);
  const trustProxy = String(env.APP_TRUST_PROXY || "").trim();
  const configuredBootstrapPassword = Object.prototype.hasOwnProperty.call(env, "APP_BOOTSTRAP_PASSWORD")
    ? String(env.APP_BOOTSTRAP_PASSWORD || "")
    : "";
  const passwordPolicy = validatePasswordPolicy(configuredBootstrapPassword);

  return {
    host,
    production,
    publicBinding,
    secureCookie,
    trustProxy,
    requireStrongBootstrap: production || publicBinding,
    bootstrapPasswordConfigured: Boolean(configuredBootstrapPassword),
    bootstrapPasswordStrong: passwordPolicy.ok,
    bootstrapPasswordFailures: passwordPolicy.failures
  };
}

function assertServerDeployment(policy) {
  if (!policy || typeof policy !== "object") throw new Error("Deployment security policy is required");
  if (policy.production && !policy.secureCookie) {
    throw new Error("Production startup requires APP_COOKIE_SECURE=true and HTTPS termination");
  }
  if (policy.production && !policy.trustProxy) {
    throw new Error("Production startup requires an explicit APP_TRUST_PROXY value");
  }
  return policy;
}

module.exports = { assertServerDeployment, deploymentSecurityPolicy, isLoopbackHost, normalizeHost, normalizedBoolean };
