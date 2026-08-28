"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { BUILTIN_PACKS, RegionPackRegistry, checksum } = require("../lib/regions/pack-registry");

const ROOT = path.resolve(__dirname, "..");
const registry = new RegionPackRegistry(BUILTIN_PACKS, {
  profileId: "ownership-audit",
  packs: BUILTIN_PACKS.map((pack) => pack.id)
});

function menuUrls(rows) {
  return (rows || []).flatMap((row) => {
    const own = String(row.resourceUrl || "").trim();
    return [...(own ? [own] : []), ...menuUrls(row.children || row.sysBusinessResources)];
  });
}

function routePath(value) {
  const clean = String(value || "").trim().split(/[?#]/, 1)[0].replace(/^\/+/, "");
  return clean ? `/${clean}` : "";
}

const frontendRows = [];
for (const pack of registry.packs) {
  const urls = [
    ...pack.frontend.pages.map((page) => page.href),
    ...menuUrls(pack.frontend.topMenus),
    ...menuUrls(pack.frontend.menuItems),
    ...menuUrls(pack.frontend.navigation.topMenus),
    ...pack.frontend.navigation.menuGroups.flatMap((group) => menuUrls(group.rows))
  ].map(routePath).filter(Boolean);
  for (const route of urls) {
    const owner = registry.routeOwner(route);
    if (pack.id === "core-platform") {
      assert.ok(owner === null || owner === pack.id, `core frontend route ${route} is owned by ${owner}`);
    } else {
      assert.equal(owner, pack.id, `${pack.id} frontend route ${route} has owner ${owner || "none"}`);
    }
    frontendRows.push({ packId: pack.id, route, owner: owner || "core-platform" });
  }
}

const source = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const expressRoutes = [...source.matchAll(/app\.(?:get|post|put|patch|delete|all)\(\s*["']([^"']+)["']/g)]
  .map((match) => match[1])
  .filter((route) => route.startsWith("/") && route !== "*");
const explicitRows = expressRoutes.map((route) => {
  try {
    const ownershipRoute = route.replace(/:([A-Za-z0-9_]+)\?/g, ":$1");
    return { route, owner: registry.routeOwner(ownershipRoute) || "core-platform" };
  } catch (error) {
    throw new Error(`invalid explicit server route ${JSON.stringify(route)}: ${error.message}`);
  }
});
const regionalExplicitRows = explicitRows.filter((row) => row.owner !== "core-platform");

for (const page of registry.mountedPages()) {
  assert.equal(registry.routeOwner(page.route), page.packId, `runtime page ${page.route} is not owned by ${page.packId}`);
  assert.ok(!expressRoutes.includes(page.route), `runtime page ${page.route} is also registered directly in server.js`);
}

const report = {
  ok: true,
  schemaVersion: 1,
  packs: registry.packs.map((pack) => pack.id),
  frontendRoutes: frontendRows.length,
  explicitServerRoutes: explicitRows.length,
  regionalExplicitRoutes: regionalExplicitRows.length,
  runtimePages: registry.mountedPages().map(({ packId, route, method }) => ({ packId, route, method })),
  ownershipChecksum: checksum({ frontendRows, explicitRows, runtimePages: registry.mountedPages().map(({ packId, route, method }) => ({ packId, route, method })) })
};

console.log(JSON.stringify(report, null, 2));
