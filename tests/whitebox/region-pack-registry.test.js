"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const regions = require("../../lib/regions/pack-registry");

function registry(packs = ["core-platform", "cn-mainland", "fidic-international"]) {
  return new regions.RegionPackRegistry(regions.BUILTIN_PACKS, { profileId: "test-profile", packs });
}

test("builds a deterministic full frontend and backend module manifest", () => {
  const first = registry();
  const second = registry();
  const manifest = first.publicManifest({ hasPermission: (permission) => permission !== "admin:access" });
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.profileId, "test-profile");
  assert.equal(manifest.checksum, second.publicManifest().checksum);
  assert.deepEqual(manifest.packs.map((pack) => pack.id), ["core-platform", "cn-mainland", "fidic-international"]);
  assert.deepEqual(manifest.packs.find((pack) => pack.id === "fidic-international").frontend.pages.map((page) => page.id), ["fidic-workbench"]);
  assert.equal(first.isEnabled("cn-mainland"), true);
  assert.equal(first.hasCapability("fidic-certificates"), true);
  assert.equal(first.hasCapability("missing-capability"), false);
  assert.equal(first.routeOwner("/api/international/contract_events/1"), "fidic-international");
  assert.equal(first.routeOwner("/payment/jl_report_page"), "cn-mainland");
  assert.equal(first.routeOwner("/api/health"), null);
});

test("one profile filters matching frontend menus and backend routes together", () => {
  const domestic = registry(["core-platform", "cn-mainland"]);
  const menu = [
    { resourceId: 2, resourceName: "CN", sysBusinessResources: [] },
    { resourceId: 9000, resourceName: "Admin", sysBusinessResources: [
      { resourceId: 9003, resourceName: "Core", sysBusinessResources: [] },
      { resourceId: 9004, resourceName: "JL", sysBusinessResources: [] },
      { resourceId: 9040, resourceName: "FIDIC", sysBusinessResources: [] }
    ] }
  ];
  const filtered = domestic.filterMenu(menu);
  assert.deepEqual(filtered.map((item) => item.resourceId), [2, 9000]);
  assert.deepEqual(filtered[1].sysBusinessResources.map((item) => item.resourceId), [9003, 9004]);
  assert.equal(domestic.requireRoute("/payment/jl_report_page"), "cn-mainland");
  assert.throws(() => domestic.requireRoute("/international/certificates_page"), (error) => error.status === 404 && error.code === "REGION_PACK_DISABLED");
  assert.equal(domestic.requireResource(9004), "cn-mainland");
  assert.equal(domestic.requireResource(49), "cn-mainland");
  assert.throws(() => domestic.requireResource(9040), (error) => error.status === 404 && error.code === "REGION_PACK_DISABLED");
  assert.equal(domestic.requireResource(123456), null);
  assert.equal(domestic.hasCapability("multi-currency"), false);
  assert.equal(domestic.requireRoute("/api/health"), null);
  assert.deepEqual(domestic.publicManifest().packs.map((pack) => pack.id), ["core-platform", "cn-mainland"]);
});

test("profile and pack validation fail closed", () => {
  assert.throws(() => registry(["cn-mainland"]), /requires core-platform/);
  assert.throws(() => registry(["core-platform", "unknown-pack"]), /unknown region pack/);
  assert.throws(() => new regions.RegionPackRegistry([], { profileId: "test-profile", packs: [] }), /definitions are required/);
  assert.throws(() => new regions.RegionPackRegistry([regions.BUILTIN_PACKS[0], regions.BUILTIN_PACKS[0]], { profileId: "test-profile", packs: ["core-platform"] }), /ids are duplicated/);
  const conflicting = structuredClone(regions.BUILTIN_PACKS[1]);
  conflicting.id = "cn-conflict";
  conflicting.frontend.topMenuIds = [9000];
  assert.throws(() => new regions.RegionPackRegistry([regions.BUILTIN_PACKS[0], conflicting], { profileId: "test-profile", packs: ["core-platform"] }), /owned by multiple packs/);
  assert.throws(() => regions.normalizePack({}), /pack id/);
  assert.throws(() => regions.normalizePack({ ...structuredClone(regions.BUILTIN_PACKS[0]), version: "1" }), /version/);
  assert.throws(() => regions.normalizePack({ ...structuredClone(regions.BUILTIN_PACKS[0]), displayName: {} }), /display names/);
  assert.throws(() => regions.normalizePack({ ...structuredClone(regions.BUILTIN_PACKS[0]), capabilities: ["audit", "audit"] }), /duplicate/);
  assert.throws(() => regions.normalizePack({ ...structuredClone(regions.BUILTIN_PACKS[0]), dependencies: {} }), /must be an array/);
  assert.throws(() => regions.normalizePack({ ...structuredClone(regions.BUILTIN_PACKS[0]), frontend: { topMenuIds: {}, resourceIds: [], pages: [] } }), /top menu ids must be an array/);
  assert.throws(() => regions.normalizePack({ ...structuredClone(regions.BUILTIN_PACKS[0]), frontend: { topMenuIds: [0], resourceIds: [], pages: [] } }), /top menu ids/);
  assert.throws(() => regions.normalizePack({ ...structuredClone(regions.BUILTIN_PACKS[0]), frontend: { topMenuIds: [], resourceIds: [1, 1], pages: [] } }), /resource ids/);
  assert.throws(() => regions.normalizePack({ ...structuredClone(regions.BUILTIN_PACKS[0]), frontend: { topMenuIds: [], resourceIds: [], pages: [{ id: "bad", titleKey: "bad", href: "/ok" }] } }), /title key/);
  assert.throws(() => regions.normalizePack({ ...structuredClone(regions.BUILTIN_PACKS[0]), frontend: { topMenuIds: [], resourceIds: [], pages: [{ id: "bad", titleKey: "bad.key", href: "bad" }] } }), /page route/);
  assert.throws(() => regions.normalizePack({ ...structuredClone(regions.BUILTIN_PACKS[0]), frontend: { topMenuIds: [], resourceIds: [], pages: [{ id: "same", titleKey: "same.key", href: "/one" }, { id: "same", titleKey: "same.key", href: "/two" }] } }), /page ids are duplicated/);
  assert.throws(() => regions.normalizePack({ ...structuredClone(regions.BUILTIN_PACKS[0]), backend: [] }), /backend must be an object/);
  assert.throws(() => registry().filterMenu({}), /menu rows/);
  assert.throws(() => registry().routeOwner("invalid"), /request route/);
  assert.throws(() => registry().hasCapability("invalid capability"), /region capability/);
});

test("international-only assembly rejects domestic routes and resources", () => {
  const international = registry(["core-platform", "fidic-international"]);
  assert.equal(international.requireRoute("/api/international/certificate/calculate"), "fidic-international");
  assert.equal(international.requireResource(9041), "fidic-international");
  assert.throws(() => international.requireRoute("/api/cost/summary"), (error) => error.code === "REGION_PACK_DISABLED");
  assert.throws(() => international.requireRoute("/bill_measure/dashboard_page"), (error) => error.code === "REGION_PACK_DISABLED");
  assert.throws(() => international.requireRoute("/admin/calculation_rules_page"), (error) => error.code === "REGION_PACK_DISABLED");
  assert.throws(() => international.requireResource(49), (error) => error.code === "REGION_PACK_DISABLED");
  assert.deepEqual(international.publicManifest().packs.map((pack) => pack.id), ["core-platform", "fidic-international"]);
});

test("loads the checked-in deployment profile and supports an explicit pack override", () => {
  const profile = regions.readProfile({ env: {} });
  assert.equal(profile.profileId, "full-commercial");
  assert.deepEqual(profile.packs, ["core-platform", "cn-mainland", "fidic-international"]);
  const overridden = regions.readProfile({ env: { APP_REGION_PACKS: "core-platform, cn-mainland" } });
  assert.deepEqual(overridden.packs, ["core-platform", "cn-mainland"]);
  assert.equal(regions.createRegistry({ profile: overridden }).isEnabled("fidic-international"), false);
  assert.equal(regions.checksum({ b: 2, a: 1 }), regions.checksum({ a: 1, b: 2 }));
  assert.notEqual(regions.checksum([1, { a: true }]), regions.checksum([1, { a: false }]));
  assert.throws(() => regions.readProfile({ profilePath: "missing-region-profile.json", env: {} }), /could not be loaded/);
});

test("default construction, exact routes, leaf menus and optional permissions remain deterministic", () => {
  const defaults = new regions.RegionPackRegistry();
  assert.equal(defaults.profileId, "full-commercial");
  assert.equal(regions.createRegistry().manifestChecksum, defaults.manifestChecksum);
  assert.equal(defaults.requireRoute("/api/international"), "fidic-international");
  assert.equal(defaults.resourceOwner(9041), "fidic-international");
  assert.equal(defaults.requireRoute("/admin/international_settings_page"), "fidic-international");
  defaults.routeOwners.push({ type: "prefix", route: "/api", packId: "core-platform" });
  assert.equal(defaults.routeOwner("/api/international/contract_events"), "fidic-international");
  const leaf = defaults.filterMenu([{ resourceId: 123456, resourceName: "Unowned extension", sysBusinessResources: "" }]);
  assert.equal(leaf[0].sysBusinessResources, "");

  const custom = structuredClone(regions.BUILTIN_PACKS[0]);
  custom.frontend.pages.push({ id: "public-page", titleKey: "modules.core.publicPage", href: "/public-page", permission: "" });
  const customRegistry = new regions.RegionPackRegistry([custom], { profileId: "custom-profile", packs: ["core-platform"] });
  assert.ok(customRegistry.publicManifest({ hasPermission: "invalid" }).packs[0].frontend.pages.some((item) => item.id === "public-page"));
});
