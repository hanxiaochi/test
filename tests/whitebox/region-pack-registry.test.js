"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const regions = require("../../lib/regions/pack-registry");
const frontendMenu = require("../../lib/regions/frontend-menu");

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
  assert.deepEqual(first.workflowModules(), ["billmeasure", "meterialdiasmeasure", "meterialinmeasure", "manualmeasure", "varyapplication", "engineeringcontactbill", "internationalcertificate", "internationalcontractevent"]);
  assert.deepEqual(first.assembledTopMenus("en-US").map((item) => item.resourceId), [2, 3, 7, 409, 9000]);
  assert.equal(first.assembledTopMenus("en-US").find((item) => item.resourceId === 9000).resourceName, "Administration");
  assert.deepEqual(first.assembledMenu(2).map((item) => item.resourceId), [28, 39, 46, 60]);
  const adminMenu = first.assembledMenu(9000);
  assert.deepEqual(adminMenu.map((item) => item.resourceId), [9003, 9041, 9001, 9010, 9020, 9030, 9040, 9050, 9060]);
  assert.deepEqual(adminMenu.find((item) => item.resourceId === 9001).sysBusinessResources.map((item) => item.resourceId), [9002, 9004]);
  assert.equal(manifest.packs.find((pack) => pack.id === "core-platform").frontend.topMenus[0].name["en-US"], "Administration");
  assert.deepEqual(manifest.packs.find((pack) => pack.id === "cn-mainland").frontend.navigation.topMenuIds, [2, 3, 7, 409]);
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
  assert.deepEqual(domestic.workflowModules(), ["billmeasure", "meterialdiasmeasure", "meterialinmeasure", "manualmeasure", "varyapplication", "engineeringcontactbill"]);
  assert.deepEqual(domestic.assembledMenu(9000).map((item) => item.resourceId), [9003, 9001, 9010, 9020, 9030, 9050, 9060]);
  assert.deepEqual(domestic.assembledTopMenus().map((item) => item.resourceId), [2, 3, 7, 409, 9000]);
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
  assert.deepEqual(international.workflowModules(), ["internationalcertificate", "internationalcontractevent"]);
  assert.deepEqual(international.assembledMenu(9000, "en-US").map((item) => item.resourceId), [9003, 9041, 9010, 9020, 9030, 9040, 9050, 9060]);
  assert.deepEqual(international.assembledTopMenus().map((item) => item.resourceId), [9000]);
});

test("frontend menu declarations validate ownership, hierarchy and presentation", () => {
  const valid = {
    resourceId: 10,
    parentId: 0,
    order: 2,
    resourceCode: "menu.10",
    name: { "zh-CN": "菜单", "en-US": "Menu" },
    description: { "zh-CN": "说明", "en-US": "Description" },
    resourceUrl: "admin/page",
    menuIcon: "layui-icon layui-icon-set",
    resourceNo: "root",
    children: [
      {
        resourceId: 11,
        parentId: 10,
        order: 1,
        resourceCode: "menu.11",
        name: { "zh-CN": "子项", "en-US": "Child" },
        description: { "zh-CN": "子项说明", "en-US": "Child description" },
        resourceUrl: "admin/child",
        resourceNo: "model"
      }
    ]
  };
  const normalized = frontendMenu.normalizeMenuItem(valid, "test menu");
  assert.deepEqual(frontendMenu.menuResourceIds(normalized), [10, 11]);
  assert.equal(frontendMenu.selectLocale("ar"), "zh-CN");
  assert.equal(frontendMenu.legacyMenuRow(normalized, "en-US").sysBusinessResources[0].resourceLevel, 1);
  assert.deepEqual(frontendMenu.assembleMenu([normalized], 999), []);
  assert.throws(() => frontendMenu.normalizeMenuItem(null, "test menu"), /must be an object/);
  assert.throws(() => frontendMenu.normalizeMenuItem({ ...valid, resourceId: 0 }, "test menu"), /resource id/);
  assert.throws(() => frontendMenu.normalizeMenuItem({ ...valid, parentId: -1 }, "test menu"), /parent id/);
  assert.throws(() => frontendMenu.normalizeMenuItem({ ...valid, order: 1.5 }, "test menu"), /order/);
  assert.throws(() => frontendMenu.normalizeMenuItem({ ...valid, resourceCode: "bad code" }, "test menu"), /resource code/);
  assert.throws(() => frontendMenu.normalizeMenuItem({ ...valid, resourceUrl: "/absolute" }, "test menu"), /resource URL/);
  assert.throws(() => frontendMenu.normalizeMenuItem({ ...valid, resourceNo: "invalid" }, "test menu"), /presentation/);
  assert.throws(() => frontendMenu.normalizeMenuItem({ ...valid, name: { "zh-CN": "菜单" } }, "test menu"), /requires zh-CN and en-US/);
  assert.throws(() => frontendMenu.normalizeMenuItem({ ...valid, description: [] }, "test menu"), /must be an object/);
  assert.throws(() => frontendMenu.normalizeMenuItem({ ...valid, children: [{ ...valid.children[0], parentId: 9 }] }, "test menu"), /child parent id/);
  assert.throws(() => frontendMenu.normalizeMenuItem({ ...valid, children: [valid.children[0], valid.children[0]] }, "test menu"), /duplicate child resources/);
  assert.throws(() => frontendMenu.assembleMenu([normalized], -1), /parent id/);

  const legacy = {
    resourceId: 20,
    parentId: "",
    resourceName: "旧菜单",
    resourceUrl: "",
    sysBusinessResources: [
      { resourceId: 21, parentId: 20, resourceName: "旧子项", resourceUrl: "legacy/page", sysBusinessResources: [] }
    ]
  };
  const normalizedLegacy = frontendMenu.normalizeLegacyMenuRow(legacy, "legacy menu", 0);
  assert.deepEqual(frontendMenu.legacyMenuResourceIds(normalizedLegacy), [20, 21]);
  assert.equal(normalizedLegacy.parentId, 0);
  assert.equal(frontendMenu.normalizeLegacyMenuRow({ ...legacy, resourceUrl: "legacy/page?type=2" }, "legacy menu", 0).resourceUrl, "legacy/page?type=2");
  assert.throws(() => frontendMenu.normalizeLegacyMenuRow({ ...legacy, resourceName: "" }, "legacy menu", 0), /resource name/);
  assert.throws(() => frontendMenu.normalizeLegacyMenuRow({ ...legacy, resourceUrl: "/legacy" }, "legacy menu", 0), /resource URL/);
  assert.throws(() => frontendMenu.normalizeLegacyMenuRow({ ...legacy, parentId: 2 }, "legacy menu", 0), /parent id/);
  assert.throws(() => frontendMenu.normalizeLegacyMenuRow({ ...legacy, sysBusinessResources: {} }, "legacy menu", 0), /children/);

  const badTopOwner = structuredClone(regions.BUILTIN_PACKS[0]);
  badTopOwner.frontend.topMenus[0].resourceId = 9999;
  assert.throws(() => new regions.RegionPackRegistry([badTopOwner], { profileId: "test-profile", packs: ["core-platform"] }), /top menu ownership/);
  const badItemOwner = structuredClone(regions.BUILTIN_PACKS[0]);
  badItemOwner.frontend.menuItems[0].resourceId = 9998;
  assert.throws(() => new regions.RegionPackRegistry([badItemOwner], { profileId: "test-profile", packs: ["core-platform"] }), /menu item ownership/);
  const duplicateMenu = structuredClone(regions.BUILTIN_PACKS[0]);
  duplicateMenu.frontend.menuItems.push(structuredClone(duplicateMenu.frontend.menuItems[0]));
  assert.throws(() => new regions.RegionPackRegistry([duplicateMenu], { profileId: "test-profile", packs: ["core-platform"] }), /menu resources are duplicated/);
  const invalidList = structuredClone(regions.BUILTIN_PACKS[0]);
  invalidList.frontend.menuItems = {};
  assert.throws(() => regions.normalizePack(invalidList), /menu items must be an array/);
  const duplicateWorkflow = structuredClone(regions.BUILTIN_PACKS[2]);
  duplicateWorkflow.id = "fidic-conflict";
  duplicateWorkflow.frontend.resourceIds = [];
  duplicateWorkflow.frontend.menuItems = [];
  duplicateWorkflow.backend.exactRoutes = [];
  duplicateWorkflow.backend.routePrefixes = [];
  assert.throws(() => new regions.RegionPackRegistry([regions.BUILTIN_PACKS[0], regions.BUILTIN_PACKS[2], duplicateWorkflow], { profileId: "test-profile", packs: ["core-platform", "fidic-international"] }), /workflow module .* owned by multiple packs/);
  const invalidNavigation = structuredClone(regions.BUILTIN_PACKS[1]);
  invalidNavigation.frontend.navigation = {};
  assert.throws(() => regions.normalizePack(invalidNavigation), /top menus and groups must be arrays/);
  const duplicateGroups = structuredClone(regions.BUILTIN_PACKS[1]);
  duplicateGroups.frontend.navigation.menuGroups.push(structuredClone(duplicateGroups.frontend.navigation.menuGroups[0]));
  assert.throws(() => regions.normalizePack(duplicateGroups), /group parent ids are duplicated/);
  const badNavigationOwner = structuredClone(regions.BUILTIN_PACKS[1]);
  badNavigationOwner.frontend.navigation.topMenus[0].resourceId = 9997;
  assert.throws(() => new regions.RegionPackRegistry([regions.BUILTIN_PACKS[0], badNavigationOwner], { profileId: "test-profile", packs: ["core-platform", "cn-mainland"] }), /navigation top menu ownership/);
  const badNavigationItemOwner = structuredClone(regions.BUILTIN_PACKS[1]);
  badNavigationItemOwner.frontend.navigation.menuGroups[0].rows[0].sysBusinessResources[0].resourceId = 9996;
  assert.throws(() => new regions.RegionPackRegistry([regions.BUILTIN_PACKS[0], badNavigationItemOwner], { profileId: "test-profile", packs: ["core-platform", "cn-mainland"] }), /navigation item ownership/);
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
