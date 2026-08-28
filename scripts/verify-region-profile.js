"use strict";

const assert = require("node:assert/strict");

const BASE_URL = process.env.APP_BASE_URL;
let cookie = "";

async function request(url, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${BASE_URL}${url}`, { ...options, headers });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body, text };
}

async function login(account, password) {
  const result = await request("/dologin", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user_account: account, password, remember_me: "false" }).toString()
  });
  assert.equal(result.body.code, 1);
  cookie = result.response.headers.get("set-cookie").split(";")[0];
  return result;
}

function menuIds(rows, result = []) {
  (rows || []).forEach((row) => {
    result.push(Number(row.resourceId));
    if (Array.isArray(row.sysBusinessResources)) menuIds(row.sysBusinessResources, result);
  });
  return result;
}

async function main() {
  const profile = process.env.APP_REGION_TEST_PROFILE;
  const expectedPacks = profile === "fidic-international-commercial"
    ? ["core-platform", "fidic-international"]
    : ["core-platform", "cn-mainland"];
  await login("ys1", "000000");
  const changed = await request("/api/account/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "000000", newPassword: "Region-Profile-42!", confirmPassword: "Region-Profile-42!" })
  });
  assert.equal(changed.body.code, 1);
  cookie = "";
  await login("ys1", "Region-Profile-42!");

  const modules = await request("/api/client/modules");
  assert.equal(modules.response.status, 200);
  assert.deepEqual(modules.body.data.packs.map((pack) => pack.id), expectedPacks);
  assert.equal(modules.body.data.profileId, profile);
  assert.equal(modules.body.data.checksum.length, 64);

  const top = await request("/sbr/sbr_find", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "type=menu" });
  assert.deepEqual(top.body.data.map((row) => Number(row.resourceId)), profile === "fidic-international-commercial" ? [9000] : [2, 3, 7, 409, 9000]);
  const admin = await request("/sbr/sbr_find", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "parentId=9000" });
  const ids = menuIds(admin.body.data);
  if (profile === "fidic-international-commercial") {
    assert.equal(ids.includes(9004), false);
    assert.equal(ids.includes(9001), false);
    assert.ok(ids.includes(9040));
    assert.ok(ids.includes(9041));
    assert.equal((await request("/international/certificates_page")).response.status, 200);
    for (const url of ["/payment/jl_report_page", "/bill_measure/dashboard_page", "/api/cost/summary", "/admin/calculation_rules_page", "/sbr/sbr_com/49"]) {
      const disabled = await request(url);
      assert.equal(disabled.response.status, 404, `${url} should be disabled in the international profile`);
      assert.equal(disabled.body.errorCode, "REGION_PACK_DISABLED");
    }
  } else {
    assert.ok(ids.includes(9004));
    assert.ok(ids.includes(9001));
    assert.equal(ids.includes(9040), false);
    assert.equal(ids.includes(9041), false);
    for (const url of ["/international/certificates_page", "/sbr/sbr_com/9040"]) {
      const disabled = await request(url);
      assert.equal(disabled.response.status, 404);
      assert.equal(disabled.body.errorCode, "REGION_PACK_DISABLED");
    }
    const fidicApi = await request("/api/international/certificate/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(fidicApi.response.status, 404);
    assert.equal(fidicApi.body.errorCode, "REGION_PACK_DISABLED");
    assert.equal((await request("/payment/jl_report_page")).response.status, 200);
  }

  console.log(JSON.stringify({ ok: true, testProfile: profile, runtimeProfileId: modules.body.data.profileId, packs: expectedPacks, menuIds: ids.length }));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
