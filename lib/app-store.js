"use strict";

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { SqliteRuntimeStore } = require("./storage/sqlite-runtime-store");
const businessContext = require("./business-state-context");

const ROOT = path.resolve(__dirname, "..");
const mode = String(process.env.APP_STORAGE || "sqlite").trim().toLowerCase();
const jsonFile = path.resolve(process.env.APP_RUNTIME_DB_PATH || path.join(ROOT, "data", "runtime-db.json"));
const sqliteFile = path.resolve(process.env.APP_SQLITE_DB_PATH || path.join(ROOT, "data", "runtime.db"));

if (!["json", "sqlite"].includes(mode)) throw new Error(`Unsupported APP_STORAGE mode: ${mode}`);

const sqliteStores = new Map();

function tenantKey(tenantId) {
  return crypto.createHash("sha256").update(String(tenantId || "default"), "utf8").digest("hex").slice(0, 24);
}

function tenantJsonFile(tenantId, projectId = "1") {
  if (String(tenantId || "default") === "default" && String(projectId || "1") === "1") return jsonFile;
  return path.join(path.dirname(jsonFile), "tenants", tenantKey(tenantId), "projects", `${tenantKey(projectId)}.json`);
}

function tenantSqliteFile(tenantId, projectId = "1") {
  if (String(tenantId || "default") === "default" && String(projectId || "1") === "1") return sqliteFile;
  const parsed = path.parse(sqliteFile);
  return path.join(parsed.dir, "tenants", tenantKey(tenantId), "projects", `${parsed.name}-${tenantKey(projectId)}${parsed.ext || ".db"}`);
}

function sqliteStoreFor(tenantId, projectId = "1") {
  const key = `${String(tenantId || "default")}::${String(projectId || "1")}`;
  if (!sqliteStores.has(key)) sqliteStores.set(key, new SqliteRuntimeStore(tenantSqliteFile(tenantId, projectId)));
  return sqliteStores.get(key);
}

function emptyTenantSeed(template, tenantId) {
  const seed = {};
  Object.entries(template || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) seed[key] = [];
    else if (key === "calculationRules" && value && typeof value === "object") seed[key] = JSON.parse(JSON.stringify(value));
    else if (key === "client") seed[key] = { clientId: 0, clientName: String(tenantId), deptName: "", roleTypeName: "" };
    else if (value && typeof value === "object") seed[key] = {};
    else seed[key] = value;
  });
  return seed;
}

function readJsonSeed(fallback) {
  if (!fs.existsSync(jsonFile)) return fallback;
  return JSON.parse(fs.readFileSync(jsonFile, "utf8"));
}

function initializeSqliteScope(store, fallback, legacyFile, emptyAction) {
  if (store.status().version > 0) return store.load();
  const hasLegacyJson = fs.existsSync(legacyFile);
  const seed = hasLegacyJson ? JSON.parse(fs.readFileSync(legacyFile, "utf8")) : fallback;
  return store.initialize(seed, {
    actor: "system",
    action: hasLegacyJson ? "migrate-json" : emptyAction,
    checkpoint: true
  });
}

function loadScope(tenantId, projectId = "1", template = {}) {
  const key = String(tenantId || "default");
  const projectKey = String(projectId || "1");
  if (key === "default" && projectKey === "1") return load(template);
  const seed = emptyTenantSeed(template, key);
  if (mode === "json") {
    const file = tenantJsonFile(key, projectKey);
    if (!fs.existsSync(file)) return seed;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  const legacyFile = tenantJsonFile(key, projectKey);
  return initializeSqliteScope(sqliteStoreFor(key, projectKey), seed, legacyFile, "scope-initialize");
}

function loadTenant(tenantId, template = {}) {
  return loadScope(tenantId, "1", template);
}

function load(fallback = {}) {
  if (mode === "json") return readJsonSeed(fallback);
  return initializeSqliteScope(sqliteStoreFor("default"), fallback, jsonFile, "initialize");
}

function save(state, metadata = {}) {
  const tenantId = String(metadata.tenantId || businessContext.current().tenantId || "default");
  const projectId = String(metadata.projectId || businessContext.current().projectId || "1");
  if (mode === "json") {
    const file = tenantJsonFile(tenantId, projectId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temporary, file);
    return { mode, file, tenantId, projectId };
  }
  const store = sqliteStoreFor(tenantId, projectId);
  try {
    return store.save(state, metadata);
  } catch (error) {
    if (error && error.code === "SQLITE_RUNTIME_CONFLICT") {
      const current = businessContext.current();
      const fresh = store.load();
      if (current.state && String(current.tenantId) === tenantId && String(current.projectId) === projectId) {
        Reflect.ownKeys(current.state).forEach((key) => Reflect.deleteProperty(current.state, key));
        Object.assign(current.state, fresh);
      }
    }
    throw error;
  }
}

function status() {
  const tenantId = businessContext.current().tenantId || "default";
  const projectId = businessContext.current().projectId || "1";
  if (mode === "json") {
    const file = tenantJsonFile(tenantId, projectId);
    return { mode, file, exists: fs.existsSync(file), version: 0, checksum: "", tenantId, projectId };
  }
  return { ...sqliteStoreFor(tenantId, projectId).status(), tenantId, projectId };
}

function history(limit) {
  if (mode !== "sqlite") return [];
  return sqliteStoreFor(businessContext.current().tenantId, businessContext.current().projectId).history(limit);
}

function restore(version, metadata) {
  if (mode !== "sqlite") throw new Error("Revision restore requires APP_STORAGE=sqlite");
  return sqliteStoreFor(businessContext.current().tenantId, businessContext.current().projectId).restore(version, metadata);
}

function close() {
  sqliteStores.forEach((store) => store.close());
  sqliteStores.clear();
}

module.exports = { close, emptyTenantSeed, history, load, loadScope, loadTenant, mode, restore, save, status, tenantJsonFile, tenantSqliteFile };
