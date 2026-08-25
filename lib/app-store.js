"use strict";

const fs = require("fs");
const path = require("path");
const { SqliteRuntimeStore } = require("./storage/sqlite-runtime-store");

const ROOT = path.resolve(__dirname, "..");
const mode = String(process.env.APP_STORAGE || "json").trim().toLowerCase();
const jsonFile = path.resolve(process.env.APP_RUNTIME_DB_PATH || path.join(ROOT, "data", "runtime-db.json"));
const sqliteFile = path.resolve(process.env.APP_SQLITE_DB_PATH || path.join(ROOT, "data", "runtime.db"));

if (!["json", "sqlite"].includes(mode)) throw new Error(`Unsupported APP_STORAGE mode: ${mode}`);

let sqliteStore = null;

function readJsonSeed(fallback) {
  if (!fs.existsSync(jsonFile)) return fallback;
  return JSON.parse(fs.readFileSync(jsonFile, "utf8"));
}

function load(fallback = {}) {
  const seed = readJsonSeed(fallback);
  if (mode === "json") return seed;
  sqliteStore = sqliteStore || new SqliteRuntimeStore(sqliteFile);
  return sqliteStore.initialize(seed, { action: "migrate-json" });
}

function save(state, metadata = {}) {
  if (mode === "json") {
    fs.writeFileSync(jsonFile, JSON.stringify(state, null, 2), "utf8");
    return { mode, file: jsonFile };
  }
  sqliteStore = sqliteStore || new SqliteRuntimeStore(sqliteFile);
  return sqliteStore.save(state, metadata);
}

function status() {
  if (mode === "json") return { mode, file: jsonFile, exists: fs.existsSync(jsonFile), version: 0, checksum: "" };
  sqliteStore = sqliteStore || new SqliteRuntimeStore(sqliteFile);
  return sqliteStore.status();
}

function history(limit) {
  if (mode !== "sqlite") return [];
  sqliteStore = sqliteStore || new SqliteRuntimeStore(sqliteFile);
  return sqliteStore.history(limit);
}

function restore(version, metadata) {
  if (mode !== "sqlite") throw new Error("Revision restore requires APP_STORAGE=sqlite");
  sqliteStore = sqliteStore || new SqliteRuntimeStore(sqliteFile);
  return sqliteStore.restore(version, metadata);
}

function close() {
  if (sqliteStore) {
    sqliteStore.close();
    sqliteStore = null;
  }
}

module.exports = { close, history, load, mode, restore, save, status };
