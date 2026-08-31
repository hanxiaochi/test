"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");

const storage = new AsyncLocalStorage();
const states = new Map();
let defaultState = null;
let loadTenant = null;
let stateProxy = null;

function configure(options = {}) {
  if (!options.defaultState || typeof options.defaultState !== "object") throw new Error("Default business state is required");
  defaultState = options.defaultState;
  loadTenant = typeof options.loadTenant === "function" ? options.loadTenant : null;
  states.set("default::1", defaultState);
}

function scopeKey(tenantId = "default", projectId = "1") {
  return `${String(tenantId || "default")}::${String(projectId || "1")}`;
}

function stateForScope(tenantId = "default", projectId = "1") {
  if (!defaultState) throw new Error("Business state context is not configured");
  const tenantKey = String(tenantId || "default");
  const projectKey = String(projectId || "1");
  const key = scopeKey(tenantKey, projectKey);
  if (!states.has(key)) {
    if (!loadTenant) throw new Error(`Business state for tenant ${key} is unavailable`);
    const loaded = loadTenant(tenantKey, projectKey, defaultState);
    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) throw new Error(`Invalid business state for tenant ${key}`);
    states.set(key, loaded);
  }
  return states.get(key);
}

function stateForTenant(tenantId = "default") {
  return stateForScope(tenantId, "1");
}

function current() {
  return storage.getStore() || { tenantId: "default", projectId: "1", state: stateForScope("default", "1") };
}

function runForScope(tenantId, projectId, callback) {
  const tenantKey = String(tenantId || "default");
  const projectKey = String(projectId || "1");
  return storage.run({ tenantId: tenantKey, projectId: projectKey, state: stateForScope(tenantKey, projectKey) }, callback);
}

function runForTenant(tenantId, callback) {
  return runForScope(tenantId, "1", callback);
}

function proxy() {
  if (stateProxy) return stateProxy;
  stateProxy = new Proxy({}, {
    get(_target, property) { return Reflect.get(current().state, property); },
    set(_target, property, value) { return Reflect.set(current().state, property, value); },
    deleteProperty(_target, property) { return Reflect.deleteProperty(current().state, property); },
    has(_target, property) { return Reflect.has(current().state, property); },
    ownKeys() { return Reflect.ownKeys(current().state); },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current().state, property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    }
  });
  return stateProxy;
}

function clearTenantCache(tenantId) {
  const tenantKey = String(tenantId || "default");
  for (const key of states.keys()) {
    if (tenantKey !== "default" && key.startsWith(`${tenantKey}::`)) states.delete(key);
  }
}

module.exports = { clearTenantCache, configure, current, proxy, runForScope, runForTenant, scopeKey, stateForScope, stateForTenant };
