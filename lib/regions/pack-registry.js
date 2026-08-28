"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { assembleMenu, menuResourceIds, normalizeMenuItem } = require("./frontend-menu");

const BUILTIN_PACKS = Object.freeze([
  require("./packs/core-platform"),
  require("./packs/cn-mainland"),
  require("./packs/fidic-international")
]);
const DEFAULT_PROFILE_PATH = path.resolve(__dirname, "..", "..", "config", "region-profile.json");

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function identifier(value, label) {
  const result = String(value || "").trim();
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function stringList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const rows = value.map((item) => String(item || "").trim());
  if (rows.some((item) => !item) || new Set(rows).size !== rows.length) throw new Error(`${label} contains invalid or duplicate values`);
  return rows;
}

function integerList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const rows = value.map(Number);
  if (rows.some((item) => !Number.isSafeInteger(item) || item < 1) || new Set(rows).size !== rows.length) throw new Error(`${label} contains invalid or duplicate values`);
  return rows;
}

function route(value, label) {
  const result = String(value || "").trim();
  if (!result.startsWith("/") || result.includes("?") || result.includes("#") || result.includes("//")) throw new Error(`${label} is invalid`);
  return result.length > 1 ? result.replace(/\/$/, "") : result;
}

function translationKey(value, label) {
  const result = String(value || "").trim();
  if (!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function page(value, packId) {
  const source = plainObject(value, `region pack ${packId} page`);
  return {
    id: identifier(source.id, `region pack ${packId} page id`),
    titleKey: translationKey(source.titleKey, `region pack ${packId} page title key`),
    href: route(source.href, `region pack ${packId} page route`),
    permission: String(source.permission || "").trim()
  };
}

function menuList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => normalizeMenuItem(item, `${label} item ${index + 1}`));
}

function normalizePack(value) {
  const source = plainObject(value, "region pack");
  const id = identifier(source.id, "region pack id");
  const displayName = plainObject(source.displayName, `region pack ${id} display name`);
  if (!String(displayName["zh-CN"] || "").trim() || !String(displayName["en-US"] || "").trim()) throw new Error(`region pack ${id} display names are required`);
  if (!/^\d+\.\d+\.\d+$/.test(String(source.version || ""))) throw new Error(`region pack ${id} version is invalid`);
  const frontend = plainObject(source.frontend, `region pack ${id} frontend`);
  const backend = plainObject(source.backend, `region pack ${id} backend`);
  const pages = Array.isArray(frontend.pages) ? frontend.pages.map((item) => page(item, id)) : [];
  const topMenus = menuList(frontend.topMenus, `region pack ${id} top menus`);
  const menuItems = menuList(frontend.menuItems, `region pack ${id} menu items`);
  if (new Set(pages.map((item) => item.id)).size !== pages.length) throw new Error(`region pack ${id} page ids are duplicated`);
  return {
    id,
    version: source.version,
    displayName: { "zh-CN": String(displayName["zh-CN"]).trim(), "en-US": String(displayName["en-US"]).trim() },
    dependencies: stringList(source.dependencies || [], `region pack ${id} dependencies`).map((item) => identifier(item, `region pack ${id} dependency`)),
    capabilities: stringList(source.capabilities || [], `region pack ${id} capabilities`).map((item) => identifier(item, `region pack ${id} capability`)),
    frontend: { topMenuIds: integerList(frontend.topMenuIds || [], `region pack ${id} top menu ids`), resourceIds: integerList(frontend.resourceIds || [], `region pack ${id} resource ids`), topMenus, menuItems, pages },
    backend: {
      exactRoutes: stringList(backend.exactRoutes || [], `region pack ${id} exact routes`).map((item) => route(item, `region pack ${id} exact route`)),
      routePrefixes: stringList(backend.routePrefixes || [], `region pack ${id} route prefixes`).map((item) => route(item, `region pack ${id} route prefix`)),
      workflowModules: stringList(backend.workflowModules || [], `region pack ${id} workflow modules`).map((item) => identifier(item, `region pack ${id} workflow module`))
    }
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function checksum(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readProfile(options = {}) {
  const env = options.env || process.env;
  const profilePath = path.resolve(options.profilePath || env.APP_REGION_PROFILE_PATH || DEFAULT_PROFILE_PATH);
  let source;
  try {
    source = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  } catch (error) {
    throw new Error(`region profile could not be loaded: ${error.message}`);
  }
  plainObject(source, "region profile");
  const configured = String(env.APP_REGION_PACKS || "").trim();
  const packs = configured ? configured.split(",").map((item) => item.trim()).filter(Boolean) : source.packs;
  return { profileId: identifier(source.profileId, "region profile id"), packs: stringList(packs, "region profile packs"), profilePath };
}

class RegionPackRegistry {
  constructor(definitions = BUILTIN_PACKS, profile = readProfile()) {
    if (!Array.isArray(definitions) || !definitions.length) throw new Error("region pack definitions are required");
    this.packs = definitions.map(normalizePack);
    this.byId = new Map(this.packs.map((pack) => [pack.id, pack]));
    if (this.byId.size !== this.packs.length) throw new Error("region pack ids are duplicated");
    this.profileId = identifier(profile.profileId, "region profile id");
    this.enabledIds = stringList(profile.packs, "region profile packs").map((item) => identifier(item, "region profile pack id"));
    this.enabled = new Set(this.enabledIds);
    this.enabledIds.forEach((id) => { if (!this.byId.has(id)) throw new Error(`unknown region pack: ${id}`); });
    this.enabledIds.forEach((id) => this.byId.get(id).dependencies.forEach((dependency) => {
      if (!this.enabled.has(dependency)) throw new Error(`region pack ${id} requires ${dependency}`);
    }));
    this.resourceOwners = new Map();
    this.topMenuOwners = new Map();
    this.workflowModuleOwners = new Map();
    this.routeOwners = [];
    this.packs.forEach((pack) => {
      pack.frontend.resourceIds.forEach((id) => this.claim(this.resourceOwners, id, pack.id, "resource"));
      pack.frontend.topMenuIds.forEach((id) => this.claim(this.topMenuOwners, id, pack.id, "top menu"));
      const topMenuIds = pack.frontend.topMenus.flatMap(menuResourceIds);
      const menuItemIds = pack.frontend.menuItems.flatMap(menuResourceIds);
      if (new Set(topMenuIds).size !== topMenuIds.length || new Set(menuItemIds).size !== menuItemIds.length) throw new Error(`region pack ${pack.id} menu resources are duplicated`);
      pack.frontend.topMenus.forEach((item) => {
        if (item.parentId !== 0 || this.topMenuOwners.get(item.resourceId) !== pack.id) throw new Error(`region pack ${pack.id} top menu ownership is invalid`);
      });
      menuItemIds.forEach((id) => {
        if (this.resourceOwners.get(id) !== pack.id) throw new Error(`region pack ${pack.id} menu item ownership is invalid`);
      });
      pack.backend.workflowModules.forEach((module) => this.claim(this.workflowModuleOwners, module, pack.id, "workflow module"));
      pack.backend.exactRoutes.forEach((item) => this.routeOwners.push({ type: "exact", route: item, packId: pack.id }));
      pack.backend.routePrefixes.forEach((item) => this.routeOwners.push({ type: "prefix", route: item, packId: pack.id }));
    });
    this.manifestChecksum = checksum({ schemaVersion: 1, profileId: this.profileId, packs: this.enabledIds.map((id) => this.byId.get(id)) });
  }

  claim(target, key, packId, label) {
    if (target.has(key)) throw new Error(`region ${label} ${key} is owned by multiple packs`);
    target.set(key, packId);
  }

  isEnabled(packId) {
    return this.enabled.has(packId);
  }

  hasCapability(capability) {
    const key = identifier(capability, "region capability");
    return this.enabledIds.some((id) => this.byId.get(id).capabilities.includes(key));
  }

  resourceOwner(resourceId) {
    const id = Number(resourceId);
    return this.resourceOwners.get(id) || this.topMenuOwners.get(id) || null;
  }

  requireResource(resourceId) {
    const owner = this.resourceOwner(resourceId);
    if (owner && !this.isEnabled(owner)) {
      const error = new Error("requested regional module is not enabled");
      error.status = 404;
      error.code = "REGION_PACK_DISABLED";
      throw error;
    }
    return owner;
  }

  filterMenu(rows) {
    if (!Array.isArray(rows)) throw new Error("region menu rows must be an array");
    const visit = (row) => {
      const id = Number(row.resourceId);
      const owner = this.topMenuOwners.get(id) || this.resourceOwners.get(id);
      if (owner && !this.isEnabled(owner)) return null;
      const children = Array.isArray(row.sysBusinessResources) ? row.sysBusinessResources.map(visit).filter(Boolean) : row.sysBusinessResources;
      return { ...row, sysBusinessResources: children };
    };
    return rows.map(visit).filter(Boolean);
  }

  assembledTopMenus(locale = "zh-CN") {
    return assembleMenu(this.enabledIds.flatMap((id) => this.byId.get(id).frontend.topMenus), 0, locale);
  }

  assembledMenu(parentId, locale = "zh-CN") {
    return assembleMenu(this.enabledIds.flatMap((id) => this.byId.get(id).frontend.menuItems), parentId, locale);
  }

  workflowModules() {
    return this.enabledIds.flatMap((id) => this.byId.get(id).backend.workflowModules);
  }

  routeOwner(pathname) {
    const target = route(pathname, "request route");
    const matches = this.routeOwners.filter((entry) => entry.type === "exact" ? target === entry.route : target === entry.route || target.startsWith(`${entry.route}/`));
    if (!matches.length) return null;
    matches.sort((a, b) => b.route.length - a.route.length);
    return matches[0].packId;
  }

  requireRoute(pathname) {
    const owner = this.routeOwner(pathname);
    if (owner && !this.isEnabled(owner)) {
      const error = new Error("requested regional module is not enabled");
      error.status = 404;
      error.code = "REGION_PACK_DISABLED";
      throw error;
    }
    return owner;
  }

  publicManifest(options = {}) {
    const hasPermission = typeof options.hasPermission === "function" ? options.hasPermission : () => true;
    return {
      schemaVersion: 1,
      profileId: this.profileId,
      checksum: this.manifestChecksum,
      packs: this.enabledIds.map((id) => {
        const pack = this.byId.get(id);
        return {
          id: pack.id,
          version: pack.version,
          displayName: clone(pack.displayName),
          dependencies: [...pack.dependencies],
          capabilities: [...pack.capabilities],
          frontend: {
            topMenuIds: [...pack.frontend.topMenuIds],
            resourceIds: [...pack.frontend.resourceIds],
            topMenus: clone(pack.frontend.topMenus),
            menuItems: clone(pack.frontend.menuItems),
            pages: pack.frontend.pages.filter((item) => !item.permission || hasPermission(item.permission)).map(clone)
          }
        };
      })
    };
  }
}

function createRegistry(options = {}) {
  return new RegionPackRegistry(options.definitions || BUILTIN_PACKS, options.profile || readProfile(options));
}

module.exports = { BUILTIN_PACKS, DEFAULT_PROFILE_PATH, RegionPackRegistry, checksum, createRegistry, normalizePack, readProfile };
