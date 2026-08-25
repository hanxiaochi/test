const fs = require("fs");
const path = require("path");
const assert = require("assert");

const engine = require("../costEngine");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = process.env.APP_BASE_URL || "http://localhost:3100";
const CONTRACTS_PATH = path.resolve(ROOT, "..", "..", "work", "page_contracts.json");
let authCookieHeader = "";

function authenticatedOptions(options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authCookieHeader && !headers.Cookie) headers.Cookie = authCookieHeader;
  return { ...options, headers };
}

function round(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}

function moneyTextForVerify(value) {
  return Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function requestText(url, options = {}) {
  const response = await fetch(`${BASE_URL}${url}`, authenticatedOptions(options));
  const text = await response.text();
  return { response, text };
}

async function requestBuffer(url, options = {}) {
  const response = await fetch(`${BASE_URL}${url}`, authenticatedOptions(options));
  const buffer = Buffer.from(await response.arrayBuffer());
  return { response, buffer };
}

async function requestJson(url, options = {}) {
  const { response, text } = await requestText(url, {
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  try {
    return { response, json: JSON.parse(text), text };
  } catch (error) {
    throw new Error(`${url} did not return JSON: ${text.slice(0, 160)}`);
  }
}

async function postJson(url, body) {
  return requestJson(url, { method: "POST", body: JSON.stringify(body) });
}

function uniqueInternalContractUrls() {
  const contracts = JSON.parse(fs.readFileSync(CONTRACTS_PATH, "utf8"));
  return [...new Set(contracts.flatMap((item) => item.urls || []))]
    .filter(Boolean)
    .filter((url) => !/^https?:/i.test(url))
    .map((url) => url.replace(/^\/+/, ""));
}

async function verifyHealth() {
  const { json } = await requestJson("/api/debug/runtime");
  assert.strictEqual(json.code, 1, "runtime endpoint should report success");
  assert.ok(json.data && json.data.runtimeExists, "runtime DB should exist");
}

async function verifyUnauthenticatedAccess() {
  const protectedApi = await requestJson("/user/curr_user_info");
  assert.strictEqual(protectedApi.response.status, 401, "protected APIs should reject unauthenticated requests");
  assert.strictEqual(protectedApi.json.code, 0, "unauthenticated API response should use a failure envelope");
}

async function verifyLoginFlow() {
  const loginPage = await requestText("/login.html");
  assert.ok(loginPage.text.includes('name="user_account"') && loginPage.text.includes('name="password"'), "login page should expose account and password fields");
  assert.ok(loginPage.text.includes('window.location.replace("/")'), "successful login should redirect to the authenticated dashboard");
  const body = new URLSearchParams({
    user_account: "ys1",
    password: "000000",
    remember_me: "false"
  });
  const deniedBody = new URLSearchParams({ user_account: "ys1", password: "wrong-password", remember_me: "false" });
  const denied = await requestJson("/dologin", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: deniedBody.toString()
  });
  assert.strictEqual(denied.json.code, 0, "wrong passwords should be rejected");
  assert.ok(!denied.response.headers.get("set-cookie"), "failed login should not issue a session cookie");
  const { response, json } = await requestJson("/dologin", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  assert.ok(response.headers.get("set-cookie"), "login should set an auth cookie");
  authCookieHeader = response.headers.get("set-cookie").split(";")[0];
  assert.ok(authCookieHeader.startsWith("app_session="), "login should issue an opaque server-side session cookie");
  assert.strictEqual(json.code, 1, "ys1 / 000000 should authenticate successfully");
  assert.strictEqual(json.data.userAccount, "ys1", "login response should return the authenticated account");
}

async function verifyAuthorizationFlow() {
  const adminCookie = authCookieHeader;
  const project = await postJson("/api/admin/projects", {
    projectKey: "regression-project-2",
    name: "回归隔离项目"
  });
  assert.strictEqual(project.response.status, 200, "admin should create a tenant-scoped project directory entry");
  const created = await postJson("/api/admin/users", {
    account: "regression_viewer",
    displayName: "回归只读用户",
    password: "Viewer-Pass-42!",
    mustChangePassword: false,
    roleCodes: ["viewer"],
    projectIds: ["1"]
  });
  assert.strictEqual(created.response.status, 200, "admin should create a viewer account");
  assert.deepStrictEqual(created.json.data.permissions, ["data:read"], "viewer should receive read-only permission");

  authCookieHeader = "";
  const viewerBody = new URLSearchParams({
    user_account: "regression_viewer",
    password: "Viewer-Pass-42!",
    remember_me: "false"
  });
  const viewerLogin = await requestJson("/dologin", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: viewerBody.toString()
  });
  authCookieHeader = viewerLogin.response.headers.get("set-cookie").split(";")[0];
  assert.strictEqual(viewerLogin.json.code, 1, "viewer should authenticate");

  const readable = await requestJson("/api/cost/summary");
  assert.strictEqual(readable.response.status, 200, "viewer should read business data");
  const crossProjectDenied = await requestJson("/api/cost/summary?projectId=regression-project-2");
  assert.strictEqual(crossProjectDenied.response.status, 403, "viewer should not cross a project assignment boundary");
  assert.strictEqual(crossProjectDenied.json.requiredProjectId, "regression-project-2", "project denial should identify the rejected project scope");
  const writeDenied = await postJson("/bill_measure/save", { measureNo: "FORBIDDEN-WRITE" });
  assert.strictEqual(writeDenied.response.status, 403, "viewer should not mutate business data");
  assert.strictEqual(writeDenied.json.requiredPermission, "data:write", "write denial should name the required grant");
  const adminDenied = await requestJson("/api/admin/users");
  assert.strictEqual(adminDenied.response.status, 403, "viewer should not access user administration");

  authCookieHeader = adminCookie;
  const users = await requestJson("/api/admin/users");
  assert.ok(users.json.data.some((user) => user.account === "regression_viewer"), "admin user list should include the created viewer");
  const roles = await requestJson("/api/admin/roles");
  assert.deepStrictEqual(roles.json.data.map((role) => role.code), ["admin", "editor", "viewer"], "admin should list the three built-in roles");
  const projects = await requestJson("/api/admin/projects");
  assert.ok(projects.json.data.some((row) => row.projectId === "1") && projects.json.data.some((row) => row.projectId === "regression-project-2"), "admin should list tenant-scoped projects");
  const page = await requestText("/admin/users_page");
  assert.ok(page.text.includes("账号权限管理") && page.text.includes("create-user-form") && page.text.includes("安全审计"), "user administration page should expose user, role, and audit controls");
  assert.ok(page.text.includes("项目目录") && page.text.includes("create-project-form") && page.text.includes("保存项目"), "user administration page should expose project directory and assignment controls");
  const shell = await requestText("/index.html");
  assert.ok(shell.text.includes("app-project-switch") && shell.text.includes("/api/session/project"), "main shell should expose a persistent project switcher");
  const audit = await requestJson("/api/admin/security_audit?limit=50");
  assert.ok(audit.json.data.some((row) => row.action === "login" && row.result === "denied"), "security audit should retain failed login attempts");
  const mutationAudit = audit.json.data.find((row) => row.action === "http.mutation" && row.target_id === "POST /api/admin/projects");
  assert.ok(mutationAudit, "business audit should record authenticated mutation endpoints");
  const mutationDetails = JSON.parse(mutationAudit.details_json);
  assert.strictEqual(mutationDetails.beforeChecksum.length, 64, "business audit should record a before-state SHA-256 checksum");
  assert.strictEqual(mutationDetails.afterChecksum.length, 64, "business audit should record an after-state SHA-256 checksum");
  assert.strictEqual(mutationDetails.projectId, "1", "business audit should record the effective project scope");
  const backupCreated = await postJson("/api/admin/backups", {});
  assert.strictEqual(backupCreated.json.code, 1, "admin should create a managed runtime backup");
  assert.strictEqual(backupCreated.json.data.checksum.length, 64, "managed backup should expose a SHA-256 checksum");
  const backups = await requestJson("/api/admin/backups");
  assert.ok(backups.json.data.some((row) => row.fileName === backupCreated.json.data.fileName), "managed backup should appear in the backup catalog");
  const backupPage = await requestText("/admin/backups_page");
  assert.ok(backupPage.text.includes("备份恢复管理") && backupPage.text.includes("导入备份文件") && backupPage.text.includes("恢复前安全快照"), "backup administration page should expose create, import, download, and safe restore workflow");
  const downloaded = await requestBuffer(`/api/admin/backups/${encodeURIComponent(backupCreated.json.data.fileName)}/download`);
  assert.strictEqual(downloaded.response.status, 200, "managed backup should download");
  const downloadedEnvelope = JSON.parse(downloaded.buffer.toString("utf8"));
  assert.strictEqual(downloadedEnvelope.projectId, "1", "downloaded backup should identify its project scope");
  const imported = await postJson("/api/admin/backups/import", { originalName: "external-test.json", content: downloaded.buffer.toString("utf8") });
  assert.strictEqual(imported.json.code, 1, "validated local backup should import without overwriting an existing file");
  const crossProjectImport = await postJson("/api/admin/backups/import", { projectId: "regression-project-2", originalName: "wrong-project.json", content: downloaded.buffer.toString("utf8") });
  assert.strictEqual(crossProjectImport.response.status, 400, "backup import must reject a different project scope");
  assert.ok(crossProjectImport.json.msg.includes("different project"), "cross-project backup rejection should be explicit");
  const restoredBackup = await postJson(`/api/admin/backups/${encodeURIComponent(backupCreated.json.data.fileName)}/restore`, {});
  assert.strictEqual(restoredBackup.json.code, 1, "validated managed backup should restore successfully");
  assert.ok(restoredBackup.json.data.safetyBackup.fileName.startsWith("pre-restore-"), "restore should create a safety backup first");
}

async function verifyDataExchangeFlow() {
  const page = await requestText("/admin/data_exchange_page");
  assert.strictEqual(page.response.status, 200, "data exchange administration page should load");
  assert.ok(page.text.includes("数据导入导出") && page.text.includes("逐行校验结果") && page.text.includes("确认导入"), "data exchange page should expose export, validation, and import controls");

  const catalog = await requestJson("/api/admin/data_exchange");
  assert.deepStrictEqual(catalog.json.data.map((item) => item.code), ["bills", "materials", "measures", "manualMeasures", "variations"], "data exchange catalog should expose the supported business modules");
  const schema = await requestJson("/api/admin/data_exchange/materials/schema");
  assert.strictEqual(schema.json.data.key, "materialNo", "material exchange schema should expose its stable unique key");
  assert.ok(schema.json.data.fields.every((field) => field.name && field.label && field.type), "exchange schemas should expose stable field codes and human labels");

  const roundTripProjectId = "exchange-roundtrip-project";
  const project = await postJson("/api/admin/projects", { projectKey: roundTripProjectId, name: "导入导出回灌项目" });
  assert.strictEqual(project.json.code, 1, "admin should create a dedicated round-trip project");
  const defaultExport = await requestText("/api/admin/data_exchange/materials/export?format=json&projectId=1");
  const defaultRows = JSON.parse(defaultExport.text);
  assert.ok(defaultRows.length > 0, "default project should export material rows");
  const roundTripImport = await postJson("/api/admin/data_exchange/materials/import", {
    projectId: roundTripProjectId,
    format: "json",
    mode: "append",
    content: defaultExport.text
  });
  assert.strictEqual(roundTripImport.json.data.ok, true, "a JSON export should import into an empty authorized project");
  assert.strictEqual(roundTripImport.json.data.inserted, defaultRows.length, "round-trip import should retain every exported row");
  const roundTripExport = await requestText(`/api/admin/data_exchange/materials/export?format=json&projectId=${roundTripProjectId}`);
  assert.deepStrictEqual(JSON.parse(roundTripExport.text), defaultRows, "export-import-export should preserve all schema fields exactly");

  const projectId = "regression-project-2";
  const beforeInvalid = await requestText(`/api/admin/data_exchange/materials/export?format=json&projectId=${projectId}`);
  const invalid = await postJson("/api/admin/data_exchange/materials/import", {
    projectId,
    format: "json",
    mode: "append",
    content: JSON.stringify([{ materialNo: "INVALID", materialName: "", basePrice: "not-a-number" }])
  });
  assert.strictEqual(invalid.json.data.ok, false, "malformed rows should fail whole-file validation");
  assert.ok(invalid.json.data.errors.some((error) => error.field === "materialName") && invalid.json.data.errors.some((error) => error.field === "basePrice"), "validation should report row-level required and numeric failures");
  const afterInvalid = await requestText(`/api/admin/data_exchange/materials/export?format=json&projectId=${projectId}`);
  assert.strictEqual(afterInvalid.text, beforeInvalid.text, "failed imports must not mutate project state");

  const marker = `MAT-CSV-${Date.now()}`;
  const csvBody = `\ufeffmaterialNo,materialName,spec,unit,basePrice,currentPrice\r\n${marker},"测试,带逗号",S-1,t,"1,234.50",1300\r\n`;
  const appended = await postJson("/api/admin/data_exchange/materials/import", { projectId, format: "csv", mode: "append", content: csvBody });
  assert.strictEqual(appended.json.data.ok, true, "valid BOM-prefixed CSV should append atomically");
  assert.strictEqual(appended.json.data.inserted, 1, "CSV append should report one inserted row");
  const duplicate = await postJson("/api/admin/data_exchange/materials/import", { projectId, format: "csv", mode: "append", content: csvBody });
  assert.strictEqual(duplicate.json.data.ok, false, "append should reject an existing unique key");
  assert.ok(duplicate.json.data.errors.some((error) => error.code === "duplicate_existing"), "duplicate append should identify the unique-key conflict");

  const insertedExport = await requestText(`/api/admin/data_exchange/materials/export?format=json&projectId=${projectId}`);
  const insertedRow = JSON.parse(insertedExport.text).find((row) => row.materialNo === marker);
  assert.ok(insertedRow, "inserted row should be visible in its project export");
  const internalRowsBefore = await requestJson(`/secMateria/find_sec_materia_list?page=1&limit=1000&projectId=${projectId}`);
  const internalBefore = internalRowsBefore.json.data.find((row) => row.materialNo === marker);
  assert.ok(internalBefore && internalBefore.materialId, "a validated insert should receive an internal ID");
  const updated = await postJson("/api/admin/data_exchange/materials/import", {
    projectId,
    format: "json",
    mode: "upsert",
    content: JSON.stringify([{ materialNo: marker, materialName: "更新材料", spec: "S-2", unit: "t", basePrice: 1234.5, currentPrice: 1400 }])
  });
  assert.strictEqual(updated.json.data.updated, 1, "upsert should update the matching unique key");
  const internalRowsAfter = await requestJson(`/secMateria/find_sec_materia_list?page=1&limit=1000&projectId=${projectId}`);
  const internalAfter = internalRowsAfter.json.data.find((row) => row.materialNo === marker);
  assert.strictEqual(internalAfter.materialId, internalBefore.materialId, "upsert must preserve the existing internal ID");
  assert.strictEqual(internalAfter.currentPrice, 1400, "upsert should persist the updated value");

  const quotedCsv = await requestBuffer(`/api/admin/data_exchange/materials/export?format=csv&projectId=${projectId}`);
  assert.deepStrictEqual([...quotedCsv.buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf], "CSV exports should include a UTF-8 BOM for spreadsheet compatibility");
  assert.ok(quotedCsv.buffer.toString("utf8").includes(marker), "CSV export should contain the imported unique key");
  const defaultAfter = await requestText("/api/admin/data_exchange/materials/export?format=json&projectId=1");
  assert.ok(!JSON.parse(defaultAfter.text).some((row) => row.materialNo === marker), "data exchange writes must remain inside the selected project");

  const audit = await requestJson("/api/admin/security_audit?limit=200");
  assert.ok(audit.json.data.some((row) => row.action === "data_exchange.import" && row.result === "success"), "successful imports should be explicitly audited");
  assert.ok(audit.json.data.some((row) => row.action === "data_exchange.import" && row.result === "failure"), "failed imports should be explicitly audited");
}

async function verifyTenantBusinessIsolation() {
  const defaultCookie = authCookieHeader;
  const { SecurityStore } = require("../lib/security/security-store");
  const security = new SecurityStore(process.env.APP_SECURITY_DB_PATH);
  try {
    security.bootstrap({ tenantId: "regression-tenant", tenantName: "回归隔离租户", account: "tenant_admin", displayName: "租户管理员", password: "Tenant-Admin-42!" });
    security.ensureProject({ tenantId: "regression-tenant", projectId: "1", name: "租户独立项目" });
    security.ensureProject({ tenantId: "regression-tenant", projectId: "2", name: "租户第二项目" });
  } finally {
    security.close();
  }

  const tenantLoginBody = new URLSearchParams({
    tenant_id: "regression-tenant",
    user_account: "tenant_admin",
    password: "Tenant-Admin-42!",
    remember_me: "false"
  });
  const tenantLogin = await requestJson("/dologin", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tenantLoginBody.toString()
  });
  assert.strictEqual(tenantLogin.json.code, 1, "second tenant should authenticate through the real login contract");
  authCookieHeader = tenantLogin.response.headers.get("set-cookie").split(";")[0];
  const tenantSummary = await requestJson("/api/cost/summary");
  assert.strictEqual(Number(tenantSummary.json.data.contractSumMoney || 0), 0, "new tenant must not inherit the default tenant contract data");
  const tenantMaterialExport = await requestText("/api/admin/data_exchange/materials/export?format=json");
  assert.deepStrictEqual(JSON.parse(tenantMaterialExport.text), [], "new tenant must not inherit default-tenant data exchange rows");
  const tenantProjects = await requestJson("/api/session/projects");
  assert.deepStrictEqual(tenantProjects.json.data.projects.map((project) => project.projectId), ["1", "2"], "session should expose only the tenant user's accessible projects");
  assert.strictEqual(tenantProjects.json.data.currentProjectId, "1", "session should start in the first accessible project");
  const marker = `TENANT-ONLY-${Date.now()}`;
  const tenantWrite = await postJson("/billModel/save_model", { modelName: marker, modelType: "隔离验证" });
  assert.strictEqual(tenantWrite.json.code, 1, "tenant should persist its own business mutation");
  const tenantModels = await requestJson("/billModel/get_bill_model_list?page=1&limit=1000");
  assert.ok(tenantModels.json.data.some((row) => row.modelName === marker), `tenant should read back its own persisted row: ${JSON.stringify({ write: tenantWrite.json.data, rows: tenantModels.json.data })}`);
  const projectTwoModelsBefore = await requestJson("/billModel/get_bill_model_list?page=1&limit=1000&projectId=2");
  assert.ok(!projectTwoModelsBefore.json.data.some((row) => row.modelName === marker), "second project must not inherit the first project's rows");
  const secondMarker = `PROJECT-2-ONLY-${Date.now()}`;
  await postJson("/billModel/save_model", { projectId: "2", modelName: secondMarker, modelType: "项目隔离验证" });
  const projectTwoModelsAfter = await requestJson("/billModel/get_bill_model_list?page=1&limit=1000&projectId=2");
  assert.ok(projectTwoModelsAfter.json.data.some((row) => row.modelName === secondMarker), "second project should read back its own persisted row");
  const switched = await postJson("/api/session/project", { projectId: "2" });
  assert.strictEqual(switched.json.code, 1, "user should switch to an assigned project");
  const projectCookie = switched.response.headers.get("set-cookie").split(";")[0];
  authCookieHeader = `${authCookieHeader}; ${projectCookie}`;
  const cookieScopedModels = await requestJson("/billModel/get_bill_model_list?page=1&limit=1000");
  assert.ok(cookieScopedModels.json.data.some((row) => row.modelName === secondMarker), "project cookie should scope subsequent requests without query parameters");
  const projectOneModelsAgain = await requestJson("/billModel/get_bill_model_list?page=1&limit=1000&projectId=1");
  assert.ok(projectOneModelsAgain.json.data.some((row) => row.modelName === marker), "first project should retain its row after a second-project write");
  assert.ok(!projectOneModelsAgain.json.data.some((row) => row.modelName === secondMarker), "first project must not observe the second project's row");

  authCookieHeader = defaultCookie;
  const defaultModels = await requestJson("/billModel/get_bill_model_list?page=1&limit=1000");
  assert.ok(!defaultModels.json.data.some((row) => row.modelName === marker), "default tenant must not observe another tenant's row");
  const defaultSummary = await requestJson("/api/cost/summary");
  assert.ok(Number(defaultSummary.json.data.contractSumMoney) > 0, "default tenant state should remain intact after isolated tenant writes");
}

async function verifyContractUrls() {
  const urls = uniqueInternalContractUrls();
  const bad = [];
  for (const url of urls) {
    const { response, text } = await requestText(`/${url}`);
    const lower = text.toLowerCase();
    const problem = [];
    if (response.status >= 400) problem.push(`http-${response.status}`);
    if (text.includes("status\":404")) problem.push("404-body");
    if (lower.includes("not implemented") || text.includes("鍗犱綅") || text.includes("本地复刻未缓存") || lower.includes("placeholder")) problem.push("placeholder");
    if (/\bNaN\b/.test(text)) problem.push("NaN");
    if (!text.trim()) problem.push("empty");
    if (problem.length) bad.push({ url, problem: problem.join(","), sample: text.slice(0, 160) });
  }
  assert.deepStrictEqual(bad, [], `contract URL failures: ${JSON.stringify(bad.slice(0, 10), null, 2)}`);
  return urls.length;
}

async function verifyCachedPageActions() {
  const files = fs.readdirSync(path.join(ROOT, "data", "content"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => path.join(ROOT, "data", "content", file));
  const urls = new Set();
  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    for (const re of [/url\s*:\s*["']([^"']+)["']/g, /href\s*=\s*["']([^"']+)["']/g, /data-url\s*=\s*["']([^"']+)["']/g]) {
      for (const match of html.matchAll(re)) {
        let url = match[1].trim();
        if (!url || url === "GET" || /^https?:|^#|^javascript:|^data:|^\{|^\$|^\+/i.test(url)) continue;
        url = url.split("?")[0].replace(/^\/+/, "");
        if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|ico|html)$/i.test(url)) continue;
        if (url.includes("${") || url.includes("\"+") || url.includes("'+")) continue;
        urls.add(url);
      }
    }
  }
  const weak = [];
  for (const url of [...urls].sort()) {
    const { response, text } = await requestText(`/${url}`);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // HTML pages are valid here.
    }
    const data = json && json.data;
    if (
      response.status >= 400 ||
      text.includes("placeholder") ||
      text.includes("local-form-") ||
      (data && data.saved === true && data.path) ||
      (data && data.success === true && data.path && Array.isArray(data.rows))
    ) {
      weak.push({ url, status: response.status, sample: text.slice(0, 160) });
    }
  }
  assert.deepStrictEqual(weak, [], `weak cached page action responses: ${JSON.stringify(weak.slice(0, 10), null, 2)}`);
  return urls.size;
}

async function verifyOriginalFormPageCoverage() {
  const files = fs.readdirSync(path.join(ROOT, "data", "content"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => path.join(ROOT, "data", "content", file));
  const urls = new Set();
  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    for (const re of [/url\s*:\s*["']([^"']+)["']/g, /href\s*=\s*["']([^"']+)["']/g, /data-url\s*=\s*["']([^"']+)["']/g, /content:\s*\[["']([^"']+)["']/g]) {
      for (const match of html.matchAll(re)) {
        let url = match[1].trim();
        if (!url || /^https?:|^#|^javascript:|^data:/i.test(url)) continue;
        if (url.includes("${") || url.includes("\"+") || url.includes("'+")) continue;
        url = url.split("?")[0].replace(/^\/+/, "");
        if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|ico|html)$/i.test(url)) continue;
        if (/(edit|add|save|form|upload|import|create|update).*page|save_|_save|add_|edit_|upload|import|create_|update_/i.test(url)) urls.add(url);
      }
    }
  }
  const weak = [];
  for (const url of [...urls].sort()) {
    const shouldBePage = /(page|edit|add|import_model|import_analyze|upload_pic)/i.test(url)
      && !/(list|get_|delete|update_|save_|create_project_plan|import_excel|reload_import|upload_excel|delete_data|update_measure_state|update_gather_state)/i.test(url);
    if (!shouldBePage) continue;
    const { response, text } = await requestText(`/${url}`);
    if (response.status >= 400 || text.trim().startsWith("{") || text.includes("local-form-") || !text.includes("<form")) {
      weak.push({ url, status: response.status, sample: text.slice(0, 160) });
    }
  }
  assert.deepStrictEqual(weak, [], `weak original form page responses: ${JSON.stringify(weak.slice(0, 10), null, 2)}`);
}

async function verifyFallbackResponses() {
  const operation = await requestJson("/unmapped_local_operation/save", {
    method: "POST",
    body: JSON.stringify({ demo: true })
  });
  assert.strictEqual(operation.json.code, 1, "generic operation fallback should use the standard success envelope");
  assert.ok(operation.json.data.success && Array.isArray(operation.json.data.rows), "generic operation fallback should return usable structured data");
  assert.ok(!operation.text.includes("placeholder") && !operation.text.includes("本地复刻未缓存"), "generic operation fallback should not expose placeholder markers");

  const api = await requestJson("/unmapped_local_api", {
    headers: { Accept: "application/json" }
  });
  assert.strictEqual(api.json.code, 1, "generic JSON fallback should use the standard success envelope");
  assert.ok(api.json.data.success && Array.isArray(api.json.data.rows), "generic JSON fallback should return usable structured data");
  assert.ok(!api.text.includes("placeholder") && !api.text.includes("本地复刻未缓存"), "generic JSON fallback should not expose placeholder markers");

  const page = await requestText("/unmapped_local_page");
  assert.strictEqual(page.response.status, 200, "generic page fallback should render");
  assert.ok(page.text.includes("local-form-generic") && page.text.includes('name="quantity"') && page.text.includes('name="price"'), "generic page fallback should render a usable form shell");
  assert.ok(!page.text.includes("placeholder") && !page.text.includes("本地复刻未缓存"), "generic page fallback should not expose placeholder markers");
}

async function verifyAssets() {
  const files = [
    path.join(ROOT, "index.html"),
    path.join(ROOT, "login.html"),
    ...fs.readdirSync(path.join(ROOT, "data", "content"))
      .filter((file) => file.endsWith(".html"))
      .map((file) => path.join(ROOT, "data", "content", file))
  ];
  const assets = new Set();
  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    for (const match of html.matchAll(/<(?:script|link|img)[^>]+(?:src|href)=["']([^"']+)["']/gi)) {
      const asset = match[1].split("?")[0].replace(/^\/+/, "");
      if (!asset || /^https?:|^data:|^#|^javascript:/i.test(asset)) continue;
      if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot)$/i.test(asset)) assets.add(asset);
    }
  }
  const bad = [];
  for (const asset of assets) {
    const response = await fetch(`${BASE_URL}/${asset}`, authenticatedOptions());
    const sample = Buffer.from(await response.arrayBuffer()).slice(0, 120).toString("utf8");
    if (response.status >= 400) {
      bad.push({ asset, status: response.status, sample: sample.slice(0, 80) });
    }
  }
  assert.deepStrictEqual(bad, [], `asset failures: ${JSON.stringify(bad.slice(0, 10), null, 2)}`);
  return assets.size;
}

function verifyCostMath() {
  const bills = engine.billRows();
  const variations = engine.variationRows();
  const measures = engine.measureRows();
  const materialDias = engine.materialDiasRows();
  const materialArrival = engine.materialArrivalRows();
  const manual = engine.manualMeasureRows();
  const report = engine.reportProjectRows();
  const summary = engine.contractSummary();

  assert.strictEqual(round(bills.reduce((sum, item) => sum + item.contractMoney, 0)), summary.contractSumMoney);
  assert.strictEqual(round(bills.reduce((sum, item) => sum + item.finalMoney, 0)), summary.finalMoney);
  assert.strictEqual(round(variations.reduce((sum, item) => sum + item.varyMoney, 0)), summary.varyMoney);
  assert.strictEqual(round(measures.reduce((sum, item) => sum + item.measureMoney, 0)), summary.measuredMoney);
  assert.strictEqual(round(materialDias.reduce((sum, item) => sum + item.adjustMoney, 0)), summary.materialDiasMoney);
  assert.strictEqual(round(materialArrival.reduce((sum, item) => sum + item.money, 0)), summary.materialArrivalMoney);
  assert.strictEqual(round(manual.reduce((sum, item) => sum + item.measureMoney, 0)), summary.manualMoney);
  const expectedCertificate = engine.calculatePaymentCertificate({
    measuredMoney: summary.measuredMoney,
    materialDiasMoney: summary.materialDiasMoney,
    materialArrivalMoney: summary.materialArrivalMoney,
    manualMoney: summary.manualMoney,
    contractTotal: summary.finalMoney,
    cumulativeSubtotal: summary.measuredMoney + summary.manualMoney
  });
  assert.strictEqual(expectedCertificate.finalPayment, summary.payableMoney);
  assert.strictEqual(summary.paymentCertificate.retentionMoney, round((summary.measuredMoney + summary.materialDiasMoney + summary.manualMoney) * (summary.calculationRules.retentionRate / 100)));
  assert.strictEqual(round(report.reduce((sum, item) => sum + item.totalPayMoney, 0)), summary.payableMoney);
}

function verifyJlPaymentReferenceCases() {
  const rules = {
    ...engine.calculationRules(),
    moneyDigits: 0,
    includeBillMeasure: true,
    includeMaterialAdjust: true,
    includeManualMeasure: true,
    includeMaterialAdvance: true,
    includeRetention: true,
    materialAdvanceRate: 60,
    retentionRate: 10,
    mobilizationAdvanceRate: 10,
    mobilizationDeductionStartRate: 30,
    mobilizationDeductionEndRate: 80,
    materialDeductionMoney: 0,
    cumulativeMaterialDeductionMoney: 0,
    previousMaterialDeductionMoney: 0
  };

  const period12 = engine.calculatePaymentCertificate({
    measuredMoney: 5094708,
    materialDiasMoney: 0,
    materialAdvanceMoney: 4529717,
    materialDeductionMoney: 1415578,
    retentionMoney: 509471,
    contractTotal: 569846095,
    previousCumulativeSubtotal: 146206797,
    cumulativeSubtotal: 151301505
  }, rules);
  assert.strictEqual(period12.mobilizationDeductionMoney, 0, "period 12 should not deduct mobilization advance before 30% threshold");
  assert.strictEqual(period12.finalPayment, 7699376, "period 12 JL104 sample should calculate actual payment 7,699,376");

  const period14Mobilization = engine.cumulativeMobilizationDeduction(174060235, 569846095, rules);
  assert.strictEqual(period14Mobilization, 621281, "period 14 mobilization deduction should match (C-D)/A*2*B");
  const period14 = engine.calculatePaymentCertificate({
    measuredMoney: 20618620,
    materialDiasMoney: 2139953,
    materialAdvanceMoney: 5257494,
    materialDeductionMoney: 1093940,
    retentionMoney: 2275857,
    mobilizationDeductionMoney: period14Mobilization,
    contractTotal: 569846095,
    previousCumulativeSubtotal: 153441615,
    cumulativeSubtotal: 174060235
  }, rules);
  assert.strictEqual(period14.finalPayment, 24024989, "period 14 JL104 sample should calculate actual payment 24,024,989");

  const referenceCases = engine.jlPaymentReferenceCases();
  assert.ok(referenceCases.every((item) => item.passed), "JL payment reference cases should be exposed as passing validation cases");
}

async function verifyStandaloneCostCalculator() {
  const { json } = await postJson("/api/cost/calculate", {
    bills: [{ billId: 1, billNo: "A-1", billName: "楠岃瘉娓呭崟", quantity: 10, price: 100 }],
    measures: [{ billId: 1, measureNum: 4 }],
    variations: [{ varyNo: "V-1", beforeNum: 10, beforePrice: 100, afterNum: 12, afterPrice: 100 }],
    materialAdjustments: [{ materialNo: "M-1", materialName: "楠岃瘉鏉愭枡", quantity: 5, basePrice: 10, currentPrice: 13 }],
    materialArrivals: [{ materialNo: "M-1", materialName: "楠岃瘉鏉愭枡", quantity: 8, price: 13 }],
    manualMeasures: [{ billNo: "S-1", billName: "楠岃瘉鎵嬪姩璁￠噺", quantity: 1, price: 50 }]
  });
  const data = json.data;
  assert.strictEqual(data.contractMoney, 1000, "calculator contract money should be quantity times price");
  assert.strictEqual(data.variationMoney, 200, "calculator variation money should be after minus before");
  assert.strictEqual(data.finalMoney, 1200, "calculator final money should equal contract plus variation");
  assert.strictEqual(data.measuredMoney, 400, "calculator measured money should use measured quantity");
  assert.strictEqual(data.materialAdjustMoney, 15, "calculator material adjustment should use price difference");
  assert.strictEqual(data.materialArrivalMoney, 104, "calculator material arrival should track quantity times price");
  assert.strictEqual(data.manualMoney, 50, "calculator manual money should use manual quantity times price");
  assert.strictEqual(data.paymentCertificate.materialAdvanceMoney, 62.4, "calculator should advance 60% of material arrival value");
  assert.strictEqual(data.paymentCertificate.retentionMoney, 46.5, "calculator should deduct 10% retention from subtotal plus price adjustment");
  assert.strictEqual(data.paymentCertificate.mobilizationDeductionMoney, 18, "calculator should deduct mobilization advance after 30% threshold");
  assert.strictEqual(data.payableMoney, 462.9, "calculator payable money should follow JL104 formula");
  assert.strictEqual(data.payRate, 38.57, "calculator pay rate should use payable divided by final money");
  assert.strictEqual(data.details.materialLedger[0].coverageRate, 160, "calculator material ledger should compare arrival quantity with adjustment quantity");
}

async function verifyFiveDCostModelLoop() {
  const { json } = await requestJson("/api/cost/5d_model");
  assert.strictEqual(json.code, 1, "5D cost model endpoint should succeed");
  const data = json.data;
  const summary = engine.contractSummary();
  assert.strictEqual(data.model, "BOQ-5D-COST", "5D model should declare BOQ cost model type");
  assert.strictEqual(round(data.totals.finalMoney), summary.finalMoney, "5D model final money should match contract summary");
  assert.strictEqual(round(data.totals.payableMoney), summary.payableMoney, "5D model payable money should match contract summary");
  const resourcePayable = data.resourceCosts.billMeasure + data.resourceCosts.materialDias + data.resourceCosts.materialAdvance + data.resourceCosts.manualMeasure
    - data.resourceCosts.materialDeduction - data.resourceCosts.retention - data.resourceCosts.mobilizationDeduction;
  assert.strictEqual(round(resourcePayable), summary.payableMoney, "5D payable formula should follow JL104 payment certificate");
  assert.ok(data.resourceCosts.materialArrivalTracking >= data.resourceCosts.materialAdvance, "5D model should expose raw arrival and 60% advance money");
  assert.ok(Array.isArray(data.boqBySection) && data.boqBySection.length > 0, "5D model should include BOQ section rollups");
  assert.ok(Array.isArray(data.takeoffRows) && data.takeoffRows.length === engine.billRows().length, "5D model should include takeoff rows for each bill");
  assert.ok(Array.isArray(data.sCurve) && data.sCurve.length === engine.planRows().length, "5D model should include plan S-curve rows");
  assert.ok(data.audit && data.audit.submit >= data.audit.final, "5D model should include audit deduction chain");
  assert.ok(data.formulas.payableMoney.includes("JL104"), "5D model should expose calculation formulas");

  const validation = await requestJson("/api/cost/boq_validation");
  assert.strictEqual(validation.json.code, 1, "BOQ validation endpoint should succeed");
  assert.ok(validation.json.data.formulas.contractMoney.includes("contractNum"), "BOQ validation should expose formulas");
  assert.strictEqual(validation.json.data.rows.length, engine.billRows().length, "BOQ validation should check every bill row");
  assert.strictEqual(validation.json.data.summary.billCount, engine.billRows().length, "BOQ validation summary should count bill rows");
  assert.ok(validation.json.data.summary.checkedCount >= engine.billRows().length * 4, "BOQ validation should run multiple checks per bill");
  const totalFromRows = round(validation.json.data.rows.reduce((sum, row) => sum + Number(row.finalMoney || 0), 0));
  assert.strictEqual(totalFromRows, round(validation.json.data.totals.finalMoney), "BOQ validation totals should equal row final money");
  assert.ok(validation.json.data.rows.every((row) => row.riskLevel), "BOQ validation rows should expose risk levels");
}

async function cleanupBillModelVerifyData() {
  const { json } = await requestJson("/billModel/get_bill_model_list?page=1&limit=1000");
  for (const item of json.data.filter((row) => String(row.billNo || "").includes("BM-VERIFY"))) {
    await postJson("/billModel/bill_model_delete", { billId: String(item.billId || item.id) });
  }
}

async function verifyBillModelImportLoop() {
  await cleanupBillModelVerifyData();
  const { json: billsBefore } = await requestJson("/secBill/bill_page_list?page=1&limit=1000");
  const importPage = await requestText("/billModel/import_model");
  assert.strictEqual(importPage.response.status, 200, "bill model import page should open");
  assert.ok(importPage.text.includes("bill-model-import-form"), "bill model import page should render a real import form");
  assert.ok(!importPage.text.includes("local-form-"), "bill model import page should not use the generic local form");
  const topImportPage = await requestText("/import_model");
  assert.strictEqual(topImportPage.response.status, 200, "top-level import_model page should open");
  assert.ok(topImportPage.text.includes("bill-model-import-form") && topImportPage.text.includes('name="billNo"'), "top-level import_model should render the bill model import form");
  assert.ok(!topImportPage.text.trim().startsWith("code,name"), "top-level import_model should not directly return CSV");

  const { json: saved } = await postJson("/billModel/import_bill_model_data", {
    billNo: "BM-VERIFY-001",
    billName: "楠岃瘉娓呭崟鑼冩湰",
    chapter: "900",
    measureUnit: "m3",
    contractNum: 12,
    correctedNum: 12,
    price: 34.5
  });
  const billId = saved.data.billId;
  const { json: list } = await requestJson("/billModel/get_bill_model_list?page=1&limit=1000");
  const imported = list.data.find((row) => Number(row.billId || row.id) === Number(billId));
  assert.ok(imported, "imported bill model row should appear in model list");
  assert.strictEqual(imported.billNo, "BM-VERIFY-001", "imported bill model should keep bill number");
  assert.strictEqual(imported.billName, "楠岃瘉娓呭崟鑼冩湰", "imported bill model should keep Chinese name");
  assert.strictEqual(imported.contractMoney, 414, "imported bill model should calculate contract money");

  const { json: billsAfter } = await requestJson("/secBill/bill_page_list?page=1&limit=1000");
  assert.strictEqual(billsAfter.count, billsBefore.count, "importing a bill model should not add a formal section bill");

  const editPage = await requestText(`/billModel/edit_model_page?billId=${billId}`);
  assert.ok(editPage.text.includes("bill-model-form") && editPage.text.includes('name="billNo"'), "bill model edit page should render the dedicated model form");

  const exported = await requestText("/billModel/export_model");
  assert.ok(exported.text.includes("BM-VERIFY-001") && exported.text.includes("楠岃瘉娓呭崟鑼冩湰"), "bill model export should include imported model row");
  const template = await requestText("/billModel/import_model_template");
  assert.ok(template.text.includes("billNo") && template.text.includes("MB-001"), "bill model template download should contain clean template columns");

  await cleanupBillModelVerifyData();
}

async function cleanupMaterialVerifyData() {
  const { json: materials } = await requestJson("/secMateria/find_sec_materia_list?page=1&limit=1000");
  for (const item of materials.data.filter((row) => String(row.materialNo || "").includes("CL-VERIFY"))) {
    await postJson("/secMateria/del_sec_materia", { secMaterialId: String(item.secMaterialId || item.materialId || item.id) });
  }
}

async function verifyMaterialImportExportLoop() {
  await cleanupMaterialVerifyData();
  const { json: saved } = await postJson("/secMateria/import_material_data", {
    materialNo: "CL-VERIFY-001",
    materialName: "楠岃瘉鏉愭枡",
    specType: "T-1",
    measureUnit: "t",
    basePrice: 100,
    currentPrice: 125,
    sendersRange: "按合同调差"
  });
  const materialId = saved.data.materialId;
  const { json: list } = await requestJson("/secMateria/find_sec_materia_list?page=1&limit=1000");
  const imported = list.data.find((row) => Number(row.materialId || row.secMaterialId || row.id) === Number(materialId));
  assert.ok(imported, "imported material should appear in section material list");
  assert.strictEqual(imported.materialNo, "CL-VERIFY-001", "imported material should keep material number");
  assert.strictEqual(imported.materialName, "楠岃瘉鏉愭枡", "imported material should keep Chinese name");
  assert.strictEqual(imported.basePrice, 100, "imported material should keep base price");
  assert.strictEqual(imported.currentPrice, 125, "imported material should keep current price");

  const { json: dias } = await postJson("/meterialdiasmeasure/save_detail", {
    measureNo: "BC-MATERIAL-VERIFY",
    sectionId: 101,
    materialId,
    quantity: 3,
    measureDate: "2026-05-01",
    states: "审核中"
  });
  const diasId = dias.data.meterialDiasMeasureId;
  assert.strictEqual(dias.data.row.adjustMoney, 75, "material adjustment should use imported material price difference");

  const exported = await requestText("/secMateria/export_sec_materia");
  assert.ok(exported.text.includes("CL-VERIFY-001") && exported.text.includes("楠岃瘉鏉愭枡"), "material export should include imported material");
  const template = await requestText("/manual_model/import_material_template");
  assert.ok(template.text.includes("materialNo") && template.text.includes("materialName") && template.text.includes("材料名称"), "material template should include expected columns");

  await postJson(`/meterialdiasmeasure/delete/${diasId}`, { ids: String(diasId) });

  const { json: manualSaved } = await postJson("/manual_model/save_material", {
    materialNo: "CL-VERIFY-MANUAL",
    materialName: "材料范本接口验证",
    spec: "M-1",
    unit: "kg",
    basePrice: 8,
    currentPrice: 10.5,
    sendersRange: "材料范本"
  });
  const manualMaterialId = manualSaved.data.materialId;
  const manualList = await requestJson("/manual_model/find_manual_model_page?page=1&limit=1000");
  const manualRow = manualList.json.data.find((row) => Number(row.materialId || row.secMaterialId || row.id) === Number(manualMaterialId));
  assert.ok(manualRow, "manual_model material list should include saved material");
  assert.strictEqual(manualRow.materialNo, "CL-VERIFY-MANUAL", "manual_model should keep material number");
  assert.strictEqual(Number(manualRow.currentPrice || manualRow.unitPrice || 0), 10.5, "manual_model should keep current price");
  const manualEdit = await requestText(`/manual_model/edit_manual_model_add_page?materialId=${manualMaterialId}`);
  assert.ok(manualEdit.text.includes("material-form") && manualEdit.text.includes("/manual_model/save_material"), "manual_model edit page should use manual_model save endpoint");
  const manualExport = await requestText("/manual_model/export_material");
  assert.ok(manualExport.text.includes("CL-VERIFY-MANUAL") && manualExport.text.includes("材料范本接口验证"), "manual_model export should include saved material");
  await postJson("/manual_model/del_MaterialModel", { ids: String(manualMaterialId) });

  await cleanupMaterialVerifyData();
}

async function verifyModelCenterDashboardLoop() {
  await cleanupBillModelVerifyData();
  await cleanupMaterialVerifyData();
  const { json: modelSaved } = await postJson("/billModel/import_bill_model_data", {
    billNo: "BM-VERIFY-DASH",
    billName: "范本看板验证清单",
    chapter: "800",
    measureUnit: "m3",
    contractNum: 10,
    price: 88.8
  });
  const { json: materialSaved } = await postJson("/secMateria/import_material_data", {
    materialNo: "CL-VERIFY-DASH",
    materialName: "范本看板验证材料",
    specType: "D-1",
    measureUnit: "t",
    basePrice: 100,
    currentPrice: 136,
    sendersRange: "按合同调差"
  });
  const modelId = modelSaved.data.billId || modelSaved.data.modelId;
  const materialId = materialSaved.data.materialId;

  try {
    const page = await requestText("/billModel/dashboard_page");
    assert.strictEqual(page.response.status, 200, "model center dashboard should load");
    assert.ok(page.text.includes("造价范本资料中心"), "model center dashboard should show title");
    assert.ok(page.text.includes("清单范本明细") && page.text.includes("材料范本明细") && page.text.includes("材料调差预警"), "model center dashboard should show expected panels");
    assert.ok(page.text.includes("BM-VERIFY-DASH") && page.text.includes("范本看板验证清单"), "model center dashboard should show saved bill model");
    assert.ok(page.text.includes("888.00"), "model center dashboard should calculate bill model money");
    assert.ok(page.text.includes("CL-VERIFY-DASH") && page.text.includes("范本看板验证材料"), "model center dashboard should show saved material");
    assert.ok(page.text.includes("36.00"), "model center dashboard should calculate material price difference");
    assert.ok(page.text.includes("/billModel/import_model") && page.text.includes("/billModel/export_model") && page.text.includes("/secMateria/export_sec_materia"), "model center dashboard should expose import/export actions");
    assert.ok(page.text.includes(`/billModel/edit_model_page?billId=${modelId}`), "model center dashboard should link to bill model editor");
    assert.ok(page.text.includes(`/secMateria/sec_materia_add_page?materialId=${materialId}`), "model center dashboard should link to material editor");

    const materialPage = await requestText("/secMateria/dashboard_page");
    assert.strictEqual(materialPage.response.status, 200, "material dashboard should load");
    assert.ok(materialPage.text.includes("材料范本管理看板"), "material dashboard should show material title");
    assert.ok(materialPage.text.includes("CL-VERIFY-DASH") && materialPage.text.includes("36.00"), "material dashboard should retain material price dashboard data");
  } finally {
    await cleanupBillModelVerifyData();
    await cleanupMaterialVerifyData();
  }
}

async function cleanupSecBillDashboardVerifyData() {
  const { json } = await requestJson("/secBill/bill_page_list?page=1&limit=1000");
  for (const item of json.data.filter((row) => String(row.billNo || "").includes("QB-DASH-VERIFY"))) {
    await postJson("/secBill/delete", { ids: String(item.billId || item.secBillId || item.id) });
  }
}

async function verifySecBillDashboardLoop() {
  await cleanupSecBillDashboardVerifyData();
  const { json: saved } = await postJson("/secBill/save_bill", {
    sectionId: 101,
    chapter: "880",
    billNo: "QB-DASH-VERIFY",
    billName: "清单看板验证工程",
    measureUnit: "m3",
    contractNum: 12,
    correctedNum: 12,
    price: 345.67
  });
  const billId = saved.data.billId;
  try {
    const page = await requestText("/secBill/dashboard_page");
    assert.strictEqual(page.response.status, 200, "section bill dashboard should load");
    assert.ok(page.text.includes("清单管理综合看板"), "section bill dashboard should show title");
    assert.ok(page.text.includes("QB-DASH-VERIFY") && page.text.includes("/secBill/export_sec_bill"), "section bill dashboard should show core panels");
    assert.ok(page.text.includes("QB-DASH-VERIFY") && page.text.includes("清单看板验证工程"), "section bill dashboard should show saved bill");
    assert.ok(page.text.includes("4,148.04"), "section bill dashboard should calculate final money");
    assert.ok(page.text.includes("/save_sec_bill_page") && page.text.includes("/import_sec_bill") && page.text.includes("/secBill/export_sec_bill"), "section bill dashboard should expose add/import/export actions");
    assert.ok(page.text.includes(`/save_sec_bill_page?billId=${billId}`), "section bill dashboard should link to bill editor");

    const filtered = await requestText("/secBill/dashboard_page?sectionId=101&chapter=880");
    assert.ok(filtered.text.includes("QB-DASH-VERIFY") && filtered.text.includes("880"), "section bill dashboard should support section and chapter filter");
    const editPage = await requestText(`/save_sec_bill_page?billId=${billId}`);
    assert.ok(editPage.text.includes("bill-form") && editPage.text.includes("/secBill/save_bill"), "section bill edit page should render a real save form");
    const importPage = await requestText("/import_sec_bill");
    assert.ok(importPage.text.includes("sec-bill-import-form") && importPage.text.includes("/secBill/import_bill_data"), "section bill import page should render a real import form");
    const collectPage = await requestText("/bill_collect");
    assert.ok(collectPage.text.includes("章节汇总") && collectPage.text.includes("QB-DASH-VERIFY"), "bill collect page should include saved bill in chapter summary");
    const collectList = await requestText("/secBill/sec_bill_collect_list_page");
    assert.ok(collectList.text.includes("章节汇总") && collectList.text.includes("合同金额"), "section bill collect list page should render chapter totals");
  } finally {
    await cleanupSecBillDashboardVerifyData();
  }
}

async function verifyCostBaseDashboardLoop() {
  const page = await requestText("/costBase/dashboard_page?sectionId=101");
  assert.strictEqual(page.response.status, 200, "cost base dashboard should load");
  assert.ok(page.text.includes("基础造价资料"), "cost base dashboard should show dedicated title");
  assert.ok(page.text.includes("/costBase/reconciliation_page") && page.text.includes("造价联动校核"), "cost base dashboard should link reconciliation page");
  assert.ok(page.text.includes("/costBase/boq_validation_page") && page.text.includes("BOQ校验"), "cost base dashboard should link BOQ validation page");
  assert.ok(page.text.includes("/costBase/5d_model_page") && page.text.includes("5D成本模型"), "cost base dashboard should link 5D cost model page");
  assert.ok(page.text.includes("/costBase/unit_price_analysis_page") && page.text.includes("综合单价分析"), "cost base dashboard should link unit price analysis page");
  assert.ok(page.text.includes("/costBase/calculator_page") && page.text.includes("造价计算器"), "cost base dashboard should link cost calculator page");
  assert.ok(page.text.includes("101-1") && page.text.includes("202-1"), "cost base dashboard should include selected section bill rows");
  assert.ok(page.text.includes("CL-001") || page.text.includes("CL-002"), "cost base dashboard should include material rows");
  const billArea = page.text.slice(page.text.indexOf("101-1"));
  assert.ok(billArea.includes("TJ-01"), "cost base dashboard should show selected section bills");
  assert.ok(!billArea.includes("<td>TJ-02"), "cost base dashboard section filter should exclude other section bill rows");
}

async function verifyCostReconciliationLoop() {
  const { json } = await requestJson("/api/cost/reconciliation");
  assert.strictEqual(json.code, 1, "cost reconciliation endpoint should succeed");
  assert.strictEqual(json.data.ok, true, "cost reconciliation should pass all formula checks");
  const checks = Object.fromEntries(json.data.checks.map((row) => [row.key, row]));
  assert.ok(checks["final-money"] && checks["final-money"].passed, "reconciliation should verify final money formula");
  assert.ok(checks["payable-money"] && checks["payable-money"].passed, "reconciliation should verify payable money formula");
  assert.ok(checks["section-payable"] && checks["section-payable"].passed, "reconciliation should verify section payable rollup");
  assert.ok(checks["material-arrival-tracking"] && checks["material-arrival-tracking"].passed, "reconciliation should verify material arrival is tracked outside payable formula");
  assert.ok(checks["material-quantity-coverage"] && checks["material-quantity-coverage"].passed, "reconciliation should verify material arrival/dias ledger exists");
  assert.ok(checks["audit-payable-coverage"] && checks["audit-payable-coverage"].passed, "reconciliation should verify audit submit covers full payable components");
  assert.ok(json.data.moduleTotals.billCount > 0 && json.data.moduleTotals.variationCount > 0, "reconciliation should include bill and variation totals");
  assert.ok(json.data.moduleTotals.materialArrivalCount >= 0, "reconciliation should include material arrival count");
  assert.ok(typeof json.data.moduleTotals.materialArrivalMoney === "number", "reconciliation should include material arrival money");
  assert.ok(Array.isArray(json.data.materialLinks) && json.data.materialLinks.length > 0, "reconciliation should include material ledger links");
  assert.ok(json.data.auditTotals.submit >= json.data.auditTotals.final, "reconciliation should expose audit deduction chain");
  assert.strictEqual(round(json.data.auditTotals.submit), round(json.data.moduleTotals.payableMoney), "audit submit total should equal payable money");

  const page = await requestText("/costBase/reconciliation_page");
  assert.strictEqual(page.response.status, 200, "cost reconciliation page should load");
  assert.ok(page.text.includes("造价联动校核"), "cost reconciliation page should show title");
  assert.ok(page.text.includes("最终金额 = 合同金额 + 工程变更"), "cost reconciliation page should show final money formula");
  assert.ok(page.text.includes("JL104") && page.text.includes("材料设备垫付款"), "cost reconciliation page should show JL104 payable money formula");
  assert.ok(page.text.includes("材料到场金额按预付率形成材料设备垫付款") || page.text.includes("材料到场金额独立跟踪，不计入应付公式"), "cost reconciliation page should show material arrival payment rule");
  assert.ok(page.text.includes("材料补差与到场台账") && page.text.includes("覆盖率"), "cost reconciliation page should show material ledger");
  assert.ok(page.text.includes("合同段联动明细") && page.text.includes("TJ-01"), "cost reconciliation page should show section linkage detail");

  const boqPage = await requestText("/costBase/boq_validation_page");
  assert.strictEqual(boqPage.response.status, 200, "BOQ validation page should load");
  assert.ok(boqPage.text.includes("BOQ清单校验"), "BOQ validation page should show title");
  assert.ok(boqPage.text.includes("校验公式") && boqPage.text.includes("异常清单") && boqPage.text.includes("清单逐项金额"), "BOQ validation page should show validation panels");
  assert.ok(boqPage.text.includes("contractNum * price") && boqPage.text.includes("finalMoney - measuredMoney"), "BOQ validation page should show formulas");
  assert.ok(boqPage.text.includes("101-1") || boqPage.text.includes("202-1"), "BOQ validation page should show bill rows");

  const fiveDPage = await requestText("/costBase/5d_model_page");
  assert.strictEqual(fiveDPage.response.status, 200, "5D cost model page should load");
  assert.ok(fiveDPage.text.includes("5D成本模型"), "5D cost model page should show title");
  assert.ok(fiveDPage.text.includes("S曲线与EVM") && fiveDPage.text.includes("合同段BOQ汇总"), "5D cost model page should show S-curve and BOQ panels");
  assert.ok(fiveDPage.text.includes("工程联系单估算影响") && fiveDPage.text.includes("资源成本构成"), "5D cost model page should show contact impact and resource panels");
  assert.ok(fiveDPage.text.includes("SPI") && fiveDPage.text.includes("CPI"), "5D cost model page should expose EVM indices");

  const unitApi = await requestJson("/api/cost/unit_price_analysis");
  assert.strictEqual(unitApi.json.code, 1, "unit price analysis endpoint should succeed");
  assert.ok(unitApi.json.data.formulas.labor.includes("15%") && unitApi.json.data.formulas.contractMoney.includes("合同数量"), "unit price analysis should expose formulas");
  assert.ok(unitApi.json.data.rows.length > 0 && unitApi.json.data.totals.contractMoney > 0, "unit price analysis should calculate bill rows and totals");
  const unitPage = await requestText("/costBase/unit_price_analysis_page");
  assert.strictEqual(unitPage.response.status, 200, "unit price analysis page should load");
  assert.ok(unitPage.text.includes("综合单价分析"), "unit price analysis page should show title");
  assert.ok(unitPage.text.includes("人工费") && unitPage.text.includes("材料费") && unitPage.text.includes("机械费"), "unit price analysis page should show direct cost components");
  assert.ok(unitPage.text.includes("管理费") && unitPage.text.includes("利润") && unitPage.text.includes("税金"), "unit price analysis page should show fee and tax components");
  assert.ok(unitPage.text.includes("清单综合单价明细") && (unitPage.text.includes("101-1") || unitPage.text.includes("202-1")), "unit price analysis page should show bill detail rows");
  assert.ok(unitPage.text.includes("/costBase/export_unit_price_analysis") && unitPage.text.includes("导出单价分析"), "unit price analysis page should expose export action");
  const unitExport = await requestText("/costBase/export_unit_price_analysis");
  assert.ok(unitExport.text.includes("unitPrice") && unitExport.text.includes("materialShare"), "unit price analysis export should include unit price component columns");

  const calculatorPage = await requestText("/costBase/calculator_page");
  assert.strictEqual(calculatorPage.response.status, 200, "cost calculator page should load");
  assert.ok(calculatorPage.text.includes("cost-calculator-form"), "cost calculator page should render form");
  assert.ok(calculatorPage.text.includes("造价计算器") && calculatorPage.text.includes("/api/cost/calculate"), "cost calculator page should expose calculation entry");
  assert.ok(calculatorPage.text.includes("清单计量") && calculatorPage.text.includes("工程变更"), "cost calculator page should include bill and variation inputs");
  assert.ok(calculatorPage.text.includes("材料补差/到场") && calculatorPage.text.includes("手动计量"), "cost calculator page should include material and manual inputs");
  assert.ok(calculatorPage.text.includes("载入当前台账") && calculatorPage.text.includes("材料联动台账"), "cost calculator page should calculate from current ledger and show material linkage");
  assert.ok(calculatorPage.text.includes("/vary_measure/list") && calculatorPage.text.includes("/manualMeasure/detail_list"), "cost calculator page should load current business ledgers");
}

async function verifyCalculationRulesAdminLoop() {
  const before = await requestJson("/api/admin/calculation_rules");
  assert.strictEqual(before.json.code, 1, "calculation rules endpoint should succeed");
  assert.ok(before.json.data.rules, "calculation rules endpoint should return rules");
  assert.ok(before.json.data.summary.payableFormula, "calculation rules endpoint should expose payable formula");

  const page = await requestText("/admin/calculation_rules_page");
  assert.strictEqual(page.response.status, 200, "calculation rules admin page should load");
  assert.ok(page.text.includes("计算规则管理后台"), "calculation rules admin page should show title");
  assert.ok(page.text.includes("材料到场进入应付"), "calculation rules admin page should expose material arrival toggle");
  assert.ok(page.text.includes("材料预付率") && page.text.includes("保留金率"), "calculation rules admin page should expose JL104 payment rules");
  assert.ok(page.text.includes("JL115出现至第几期") && page.text.includes("JL108/JL116调差月份"), "calculation rules admin page should expose JL form lifecycle rules");
  assert.ok(page.text.includes("JL108覆盖期数") && page.text.includes("JL108覆盖方式"), "calculation rules admin page should expose JL108 multi-period coverage rules");
  assert.ok(page.text.includes("JL116非调因子X"), "calculation rules admin page should expose JL116 price adjustment formula factor");
  assert.ok(page.text.includes("JL108-1原材料折算系数") && page.text.includes("JL116材料权重系数"), "calculation rules admin page should expose JL108/JL116 configurable factor maps");
  assert.ok(page.text.includes("规则变更原因（必填）") && page.text.includes("规则版本历史"), "calculation rules admin page should expose mandatory reason and immutable history");
  assert.ok(page.text.includes("当前规则版本") && page.text.includes("校验值"), "calculation rules admin page should expose active version metadata");

  const original = before.json.data.rules;
  const previousProjectVersion = before.json.data.history.length ? before.json.data.history[0].version : 0;
  const originalPayable = before.json.data.summary.payableMoney;
  let restoreVersionId = null;
  const missingReason = await postJson("/api/admin/calculation_rules", { ...original, changeReason: "" });
  assert.strictEqual(missingReason.response.status, 400, "calculation rules save should reject a missing change reason");
  assert.ok(missingReason.json.msg.includes("变更原因"), "missing change reason should return an actionable error");
  const toggledRules = {
    ...original,
    includeRetention: !original.includeRetention,
    jl115EndPeriod: Number(original.jl115EndPeriod || 2) + 1,
    jlPriceAdjustmentMonths: "2,5,8,11",
    jlPriceAdjustmentCoveragePeriods: 3,
    jlPriceAdjustmentCoverageMode: "previous",
    jl116NonAdjustableFactor: 0.4,
    jl108RawMaterialConversionFactors: "CL-001=1.05; 钢筋 HRB400=1.05",
    jl116MaterialWeights: "CL-001=0.35; CL-002=0.30",
    changeReason: "自动回归验证规则版本"
  };
  try {
    const toggled = await postJson("/api/admin/calculation_rules", toggledRules);
    assert.strictEqual(toggled.json.code, 1, "calculation rules save should succeed");
    assert.strictEqual(toggled.json.data.rules.includeRetention, toggledRules.includeRetention, "retention toggle should persist");
    assert.strictEqual(toggled.json.data.rules.jl115EndPeriod, toggledRules.jl115EndPeriod, "JL115 lifecycle end period should persist");
    assert.deepStrictEqual(toggled.json.data.rules.jlPriceAdjustmentMonths, [2, 5, 8, 11], "JL price adjustment months should parse and persist");
    assert.strictEqual(toggled.json.data.rules.jlPriceAdjustmentCoveragePeriods, 3, "JL108 coverage periods should persist");
    assert.strictEqual(toggled.json.data.rules.jlPriceAdjustmentCoverageMode, "previous", "JL108 coverage mode should persist");
    assert.strictEqual(toggled.json.data.rules.jl116NonAdjustableFactor, 0.4, "JL116 non-adjustable factor should persist");
    assert.strictEqual(toggled.json.data.rules.jl108RawMaterialConversionFactors["CL-001"], 1.05, "JL108-1 conversion factor map should parse and persist");
    assert.strictEqual(toggled.json.data.rules.jl116MaterialWeights["CL-001"], 0.35, "JL116 material weight map should parse and persist");
    assert.notStrictEqual(toggled.json.data.summary.payableMoney, originalPayable, "retention toggle should affect JL104 payable money");
    assert.ok(toggled.json.data.summary.payableFormula, "saved rules should update formula text");
    assert.strictEqual(toggled.json.data.version.version, previousProjectVersion + 1, "saving rules should create the next immutable project version");
    assert.strictEqual(toggled.json.data.version.changeReason, toggledRules.changeReason, "rule version should record its reason");
    assert.ok(Number.isInteger(toggled.json.data.version.createdBy), "rule version should record its authenticated creator");
    const historyAfterSave = await requestJson("/api/admin/calculation_rules");
    assert.strictEqual(historyAfterSave.json.data.history.filter((row) => row.status === "active").length, 1, "only one rule version should be active");
    assert.strictEqual(historyAfterSave.json.data.history[0].checksum.length, 64, "rule history should expose a SHA-256 checksum");
    const restoreSnapshot = await postJson("/api/admin/calculation_rules", { ...original, changeReason: "自动回归建立恢复版本" });
    restoreVersionId = restoreSnapshot.json.data.version.id;
    const restored = await postJson(`/api/admin/calculation_rules/${toggled.json.data.version.id}/activate`, {});
    assert.strictEqual(restored.json.code, 1, "an earlier rule version should be reactivatable");
    assert.strictEqual(restored.json.data.version.id, toggled.json.data.version.id, "reactivation should select the requested immutable project version");
    const afterActivation = await requestJson("/api/admin/calculation_rules");
    assert.strictEqual(afterActivation.json.data.activeVersion.id, toggled.json.data.version.id, "reactivated project version should become active");
    assert.strictEqual(afterActivation.json.data.history.filter((row) => row.status === "active").length, 1, "reactivation should preserve the one-active-version invariant");
  } finally {
    if (restoreVersionId) await postJson(`/api/admin/calculation_rules/${restoreVersionId}/activate`, {});
    else await postJson("/api/admin/calculation_rules", { ...original, changeReason: "自动回归异常恢复规则" });
  }
}

async function verifyContractSurveyDashboardLoop() {
  const summary = engine.contractSummary();
  const api = await requestJson("/contract_survey/find_other_mation");
  assert.strictEqual(api.json.code, 1, "contract survey summary endpoint should succeed");
  assert.strictEqual(api.json.data.contractSumMoney, summary.contractSumMoney, "contract survey endpoint should expose contract total");
  assert.strictEqual(api.json.data.payableMoney, summary.payableMoney, "contract survey endpoint should expose payable total");

  const page = await requestText("/contract_survey/dashboard_page?projectId=1");
  assert.strictEqual(page.response.status, 200, "contract survey dashboard should load");
  assert.ok(page.text.includes("合同概况"), "contract survey dashboard should show dedicated title");
  assert.ok(page.text.includes("HT-2026-001") && page.text.includes("TJ-01"), "contract survey dashboard should include project and section data");
  assert.ok(page.text.includes("101-1") || page.text.includes("202-1"), "contract survey dashboard should include bill rows");
  assert.ok(page.text.includes("材料到场") && (page.text.includes("到场跟踪不计入应付") || page.text.includes("材料设备垫付款") || page.text.includes("预付率")), "contract survey dashboard should show material arrival payment rule");
  assert.ok(page.text.includes("/costBase/dashboard_page") && page.text.includes("/reportManager/dashboard_page"), "contract survey dashboard should link to cost base and report center");
}

async function cleanupVariationMeetingVerifyData() {
  const { json } = await requestJson("/vary_measure/list?page=1&limit=1000");
  for (const item of json.data.filter((row) => String(row.varyNo || row.meetingNo || "").includes("VERIFY-MEETING"))) {
    await postJson(`/vary_measure/delete/${item.varyId || item.id}`, { varyIds: String(item.varyId || item.id) });
  }
}

async function verifyVariationMeetingLoop() {
  await cleanupVariationMeetingVerifyData();
  const { json: beforeSummary } = await requestJson("/api/cost/summary");
  const { json: saved } = await postJson("/vary_meeting/save_meeting", {
    meetingNo: "HY-VERIFY-MEETING",
    meetingTitle: "验证变更会议",
    meetingAddress: "TJ-01 合同段",
    meetingDate: "2026-05-12",
    meetingSummary: "验证会议形成工程数量增加",
    meetingUsers: "建设单位,监理单位,施工单位",
    varyNo: "BG-VERIFY-MEETING",
    billId: 1,
    beforeNum: 2.5,
    beforePrice: 185000,
    afterNum: 2.6,
    afterPrice: 185000,
    states: "审核中"
  });
  const varyId = saved.data.varyId;
  assert.strictEqual(saved.data.row.varyMoney, 18500, "meeting-created variation should calculate variation money");
  assert.strictEqual(saved.data.row.meetingUsers, "建设单位,监理单位,施工单位", "meeting should preserve attendees");

  const { json: meetings } = await requestJson("/vary_meeting/get_vary_meeting_data?page=1&limit=1000");
  const meeting = meetings.data.find((row) => Number(row.varyId) === Number(varyId));
  assert.ok(meeting, "saved meeting should appear in meeting list");
  assert.strictEqual(meeting.meetingTitle, "验证变更会议", "meeting list should keep meeting title");

  const userForm = await requestText(`/vary_meeting/vary_meeting_user_page?varyId=${varyId}`);
  assert.strictEqual(userForm.response.status, 200, "variation meeting user form should load");
  assert.ok(userForm.text.includes('id="vary-meeting-user-form"'), "variation meeting user page should expose a real attendees form");
  assert.ok(userForm.text.includes('name="meetingUsers"') && userForm.text.includes("建设单位,监理单位,施工单位"), "variation meeting user form should echo attendees");
  assert.ok(userForm.text.includes('name="beforeNum"') && userForm.text.includes('name="afterPrice"'), "variation meeting user form should expose cost-change fields");

  const { json: updatedUsers } = await postJson("/vary_meeting/save_meeting", {
    meetingId: varyId,
    varyId,
    meetingUsers: "建设单位,总监办,施工单位,造价咨询",
    meetingSummary: "验证会议参会人员补充造价咨询单位"
  });
  assert.strictEqual(updatedUsers.data.row.meetingUsers, "建设单位,总监办,施工单位,造价咨询", "meeting user form save should update attendees");

  const dashboard = await requestText("/vary_meeting/dashboard_page?sectionId=101");
  assert.strictEqual(dashboard.response.status, 200, "variation meeting dashboard should load");
  assert.ok(dashboard.text.includes("工程变更会议看板"), "variation meeting dashboard should show dedicated title");
  assert.ok(dashboard.text.includes("HY-VERIFY-MEETING") && dashboard.text.includes("验证变更会议"), "variation meeting dashboard should include saved meeting");
  assert.ok(dashboard.text.includes("18,500.00") && dashboard.text.includes("建设单位,总监办,施工单位,造价咨询"), "variation meeting dashboard should include variation money and updated attendees");
  const meetingDetailArea = dashboard.text.slice(dashboard.text.indexOf("会议变更明细"));
  assert.ok(meetingDetailArea.includes("TJ-01"), "variation meeting dashboard should show selected section rows");
  assert.ok(!meetingDetailArea.includes("<td>TJ-02"), "variation meeting dashboard section filter should exclude other section rows");

  const { json: payRows } = await requestJson("/varyMeasurePay/get_vary_measure_list?page=1&limit=1000");
  const payRow = payRows.data.find((row) => Number(row.varyId) === Number(varyId));
  assert.ok(payRow, "saved meeting variation should appear in variation pay list");
  assert.strictEqual(payRow.varyDetail.varyAfterMoney, 481000, "variation pay row should expose after-change money");
  assert.strictEqual(payRow.varyMoney, 18500, "variation pay row should expose variation delta money");

  const { json: afterSummary } = await requestJson("/api/cost/summary");
  assert.strictEqual(round(afterSummary.data.varyMoney - beforeSummary.data.varyMoney), 18500, "meeting variation should affect project variation summary");

  await cleanupVariationMeetingVerifyData();
  const { json: restoredSummary } = await requestJson("/api/cost/summary");
  assert.strictEqual(restoredSummary.data.varyMoney, beforeSummary.data.varyMoney, "variation summary should restore after meeting cleanup");
}

async function verifyCrudLoop() {
  const { json: beforeJson } = await requestJson("/api/cost/summary");
  const before = beforeJson.data;
  let measureId = 0;
  let manualId = 0;
  let diasId = 0;
  let varyId = 0;

  try {
    const { json: measureJson } = await postJson("/bill_measure/save_measure", {
      measureNo: "JL-VERIFY-TEMP",
      sectionId: 101,
      periodId: 2,
      measureDate: "2026-03-01",
      states: "待上报"
    });
    measureId = measureJson.data.billMeasureId;
    await postJson("/bill_measure/save_detail", { billMeasureId: measureId, billId: 1, measureNum: 0.01 });

    const { json: manualJson } = await postJson("/manualMeasure/save_measure", {
      measureNo: "SD-VERIFY-TEMP",
      sectionId: 101,
      billNo: "900-V",
      billName: "verify manual",
      measureUnit: "项",
      measureNum: 1,
      price: 1234,
      states: "待上报"
    });
    manualId = manualJson.data.manualMeasureId;

    const { json: materialJson } = await postJson("/meterialdiasmeasure/save_detail", {
      measureNo: "BC-VERIFY-TEMP",
      sectionId: 101,
      materialId: 1,
      quantity: 2,
      measureDate: "2026-03-01",
      states: "待上报"
    });
    diasId = materialJson.data.meterialDiasMeasureId;

    const { json: variationJson } = await postJson("/vary_measure/save_measure", {
      varyNo: "BG-VERIFY-TEMP",
      sectionId: 101,
      billId: 1,
      beforeNum: 2.5,
      beforePrice: 185000,
      afterNum: 2.51,
      afterPrice: 185000,
      varyReason: "verify",
      states: "待上报"
    });
    varyId = variationJson.data.varyId;

    const { json: changedJson } = await requestJson("/api/cost/summary");
    assert.ok(changedJson.data.payableMoney > before.payableMoney, "CRUD additions should change payable money");
    assert.ok(changedJson.data.finalMoney > before.finalMoney, "variation addition should change final money");

    const auditList = await requestJson("/measure_data/audit_money_list?page=1&limit=1000");
    const auditSubmit = round(auditList.json.data.reduce((sum, row) => sum + Number(row.usertask1 || row.submitMoney || 0), 0));
    assert.strictEqual(auditSubmit, changedJson.data.payableMoney, "audit submit total should track changed payable money");
    assert.ok(auditList.json.data.some((row) => row.auditType === "手动计量" && row.billNo === "900-V"), "temporary manual measure should enter audit rows");
    assert.ok(auditList.json.data.some((row) => row.auditType === "材料补差" && String(row.billNo || "").includes("BC-VERIFY-TEMP")), "temporary material adjustment should enter audit rows");

    const reconciliation = await requestJson("/api/cost/reconciliation");
    const checks = Object.fromEntries(reconciliation.json.data.checks.map((row) => [row.key, row]));
    assert.ok(checks["audit-payable-coverage"] && checks["audit-payable-coverage"].passed, "reconciliation should keep audit/payable coverage after CRUD additions");
  } finally {
    if (measureId) await postJson(`/bill_measure/delete/${measureId}`, { measureIds: String(measureId) });
    if (manualId) await postJson(`/manualMeasure/delete/${manualId}`, { ids: String(manualId) });
    if (diasId) await postJson(`/meterialdiasmeasure/delete/${diasId}`, { ids: String(diasId) });
    if (varyId) await postJson(`/vary_measure/delete/${varyId}`, { varyIds: String(varyId) });
  }

  const { json: afterJson } = await requestJson("/api/cost/summary");
  const after = afterJson.data;
  for (const key of ["finalMoney", "measuredMoney", "materialDiasMoney", "manualMoney", "payableMoney"]) {
    assert.strictEqual(after[key], before[key], `${key} should be restored after CRUD cleanup`);
  }
}

async function verifyBillMeasurePageLoop() {
  const addPage = await requestText("/bill_measure/add_page");
  assert.strictEqual(addPage.response.status, 200, "bill measure add page should load");
  assert.ok(addPage.text.includes("bill-measure-form") && addPage.text.includes("计量单号"), "bill measure add page should render a clean measure form");

  const { json: measureJson } = await postJson("/bill_measure/save_measure", {
    measureNo: "JL-PAGE-VERIFY",
    sectionId: 101,
    periodId: 1,
    measureDate: "2026-05-12",
    drawNo: "VERIFY-DRAW",
    pegNo: "K0+000",
    certifyNo: "VERIFY-CERT",
    position: "页面闭环验证",
    states: "审核中"
  });
  const measureId = measureJson.data.billMeasureId;

  let copiedId = 0;
  try {
    await postJson("/bill_measure/save_detail", { billMeasureId: measureId, billId: 1, measureNum: 0.03 });
    const detailPage = await requestText(`/bill_measure/detail_page?billMeasureId=${measureId}`);
    assert.ok(detailPage.text.includes("明细合计") && detailPage.text.includes("临时道路"), "bill measure detail page should show detail rows and total");

    const addDetailPage = await requestText(`/bill_measure/add_measure_page?billMeasureId=${measureId}`);
    assert.ok(addDetailPage.text.includes("bill-measure-detail-form") && addDetailPage.text.includes("保存明细"), "bill measure add detail page should render a clean detail form");
    const editPage = await requestText(`/bill_measure/edit_page?billMeasureId=${measureId}`);
    assert.ok(editPage.text.includes("bill-measure-form") && editPage.text.includes("审核中"), "bill measure edit page should echo saved state");

    const copyPage = await requestText(`/bill_measure/copy_page?billMeasureId=${measureId}`);
    assert.ok(copyPage.text.includes('name="sourceMeasureId"') && copyPage.text.includes("bill-measure-form"), "bill measure copy page should carry source measure id");

    const { json: copiedJson } = await postJson("/bill_measure/save_measure", {
      sourceMeasureId: measureId,
      measureNo: "JL-PAGE-VERIFY-COPY",
      sectionId: 101,
      periodId: 1,
      measureDate: "2026-05-13",
      position: "复制页面闭环验证"
    });
    copiedId = copiedJson.data.billMeasureId;
    assert.strictEqual(copiedJson.data.row.measureMoney, measureJson.data.row.measureMoney + 5550, "copied measure should copy source details and computed money");

    const preview = await requestText(`/bill_measure/render_order_page?billMeasureIds=${copiedId}`);
    assert.ok(preview.text.includes("JL-PAGE-VERIFY-COPY"), "bill measure render page should show printable preview title");
    assert.ok(preview.text.includes("JL-PAGE-VERIFY-COPY") && preview.text.includes("临时道路"), "bill measure render page should include copied measure and detail");

    const orderResult = await postJson("/bill_measure/order_measure_no", { periodId: 1 });
    assert.ok(orderResult.json.data.changed >= 2, "bill measure ordering should update current period rows");
    const orderedRows = await requestJson("/bill_measure/list?page=1&limit=1000");
    const originalOrdered = orderedRows.json.data.find((row) => Number(row.billMeasureId || row.measureId) === Number(measureId));
    const copyOrdered = orderedRows.json.data.find((row) => Number(row.billMeasureId || row.measureId) === Number(copiedId));
    assert.ok(Number(originalOrdered.sortNo || originalOrdered.orderNo || 0) > 0, "bill measure ordering should write original sort number");
    assert.ok(Number(copyOrdered.sortNo || copyOrdered.orderNo || 0) > 0, "bill measure ordering should write copied sort number");
  } finally {
    if (copiedId) await postJson(`/bill_measure/delete/${copiedId}`, { measureIds: String(copiedId) });
    await postJson(`/bill_measure/delete/${measureId}`, { measureIds: String(measureId) });
  }
}

async function verifyBillMeasureDashboardLoop() {
  const { json: measureJson } = await postJson("/bill_measure/save_measure", {
    measureNo: "JL-DASH-VERIFY",
    sectionId: 101,
    periodId: 1,
    measureDate: "2026-05-16",
    drawNo: "DASH-DRAW",
    pegNo: "K1+100",
    certifyNo: "DASH-CERT",
    position: "清单计量看板验证部位"
  });
  const measureId = measureJson.data.billMeasureId;
  try {
    await postJson("/bill_measure/save_detail", { billMeasureId: measureId, billId: 1, measureNum: 0.04 });
    await postJson("/bill_measure/up_order", { billMeasureIds: String(measureId) });
    await postJson("/bill_measure/agree_order", { billMeasureId: measureId });

    const page = await requestText("/bill_measure/dashboard_page?sectionId=101&periodId=1");
    assert.strictEqual(page.response.status, 200, "bill measure dashboard should load");
    assert.ok(page.text.includes("清单计量管理看板"), "bill measure dashboard should show title");
    assert.ok(page.text.includes("JL-DASH-VERIFY") && page.text.includes("/bill_measure/add_measure_page"), "bill measure dashboard should include core panels");
    assert.ok(page.text.includes("JL-DASH-VERIFY") && page.text.includes("清单计量看板验证部位"), "bill measure dashboard should include saved measure");
    assert.ok(page.text.includes("临时道路") && page.text.includes("7,400.00"), "bill measure dashboard should show detail and calculated money");
    assert.ok(page.text.includes("已审核"), "bill measure dashboard should show approved state");
    assert.ok(page.text.includes(`/bill_measure/edit_page?billMeasureId=${measureId}`), "bill measure dashboard should link edit page");
    assert.ok(page.text.includes(`/bill_measure/add_measure_page?billMeasureId=${measureId}`), "bill measure dashboard should link detail page");
    assert.ok(page.text.includes(`/bill_measure/render_order_page?billMeasureIds=${measureId}`), "bill measure dashboard should link printable preview");
    assert.ok(page.text.includes("/bill_measure/export_bill_measure"), "bill measure dashboard should expose export action");
    assert.ok(page.text.includes("/reportManager/dashboard_page") && page.text.includes("/import_measure/dashboard_page"), "bill measure dashboard should link reports and import records");

    const filtered = await requestText("/bill_measure/dashboard_page?sectionId=101&periodId=1&state=已审核");
    assert.ok(filtered.text.includes("JL-DASH-VERIFY") && filtered.text.includes("已审核"), "bill measure dashboard should filter by state");

    const menu = await requestJson("/menu/left_menu?parentId=2");
    const flatMenu = JSON.stringify(menu.json.data);
    assert.ok(flatMenu.includes("清单计量管理看板") && flatMenu.includes("bill_measure/dashboard_page"), "bill measure dashboard should be reachable from left menu");

    const menuPage = await requestText("/sbr/sbr_com/692");
    assert.ok(menuPage.text.includes("清单计量管理看板") && menuPage.text.includes("JL-DASH-VERIFY"), "bill measure dashboard should render through menu content route");
  } finally {
    await postJson(`/bill_measure/delete/${measureId}`, { measureIds: String(measureId) });
  }
}

async function verifyBusinessCrudLoop() {
  const count = async (url) => (await requestJson(url)).json.count;
  const before = {
    arrivals: await count("/meterialInMeasure/meterial_in_measure_list"),
    contacts: await count("/engineering_contact_bill/list"),
    documents: await count("/syzl/list"),
    gathers: await count("/sysGather/get_gather_data_list")
  };

  const { json: arrivalJson } = await postJson("/meterialInMeasure/save_detail", {
    measureNo: "DC-VERIFY-TEMP",
    sectionId: 101,
    materialId: 1,
    quantity: 3,
    measureDate: "2026-03-02"
  });
  const arrivalId = arrivalJson.data.meterialInMeasureId;

  const { json: contactJson } = await postJson("/engineering_contact_bill/save_bill", {
    contactNo: "LX-VERIFY-TEMP",
    sectionId: 101,
    title: "验证联系单",
    contactContent: "验证联系单内容"
  });
  const contactId = contactJson.data.contactId;

  const { json: documentJson } = await postJson("/syzl/save", {
    title: "楠岃瘉璧勬枡",
    type: "璇曢獙璧勬枡",
    fileCount: 1,
    formMode: "syzl"
  });
  const nodeId = documentJson.data.nodeId;

  const { json: gatherJson } = await postJson("/sysGather/save_gather", {
    periodDesc: "楠岃瘉宸ユ湡",
    startDate: "2026-03-01",
    endDate: "2026-03-31"
  });
  const gatherId = gatherJson.data.gatherId;

  const middle = {
    arrivals: await count("/meterialInMeasure/meterial_in_measure_list"),
    contacts: await count("/engineering_contact_bill/list"),
    documents: await count("/syzl/list"),
    gathers: await count("/sysGather/get_gather_data_list")
  };
  assert.strictEqual(middle.arrivals, before.arrivals + 1, "material arrival should be added");
  assert.strictEqual(middle.contacts, before.contacts + 1, "contact bill should be added");
  assert.strictEqual(middle.documents, before.documents + 1, "document should be added");
  assert.strictEqual(middle.gathers, before.gathers + 1, "gather period should be added");

  await postJson(`/meterialInMeasure/delete/${arrivalId}`, { ids: String(arrivalId) });
  await postJson("/engineering_contact_bill/del", { ids: String(contactId) });
  await postJson("/syzl/del", { ids: String(nodeId) });
  await postJson("/sysGather/del_gather", { ids: String(gatherId) });

  const after = {
    arrivals: await count("/meterialInMeasure/meterial_in_measure_list"),
    contacts: await count("/engineering_contact_bill/list"),
    documents: await count("/syzl/list"),
    gathers: await count("/sysGather/get_gather_data_list")
  };
  assert.deepStrictEqual(after, before, "business CRUD counts should be restored after cleanup");
}

async function verifyMaterialArrivalManagementDashboardLoop() {
  const { json } = await postJson("/meterialInMeasure/save_detail", {
    measureNo: "DC-ARRIVAL-DASH",
    sectionId: 101,
    materialId: 1,
    quantity: 2,
    measureDate: "2026-05-20",
    provider: "验证材料供应商",
    approveNo: "YS-ARRIVAL-001",
    states: "审核中"
  });
  const arrivalId = json.data.meterialInMeasureId;
  try {
    await postJson("/meterialInMeasure/up_order", { arrivalId });
    await postJson("/meterialInMeasure/update_measure_state", { arrivalId });
    assert.strictEqual(json.data.row.money, 8760, "material arrival should calculate quantity times current price");

    const page = await requestText("/meterialInMeasure/meterialInMeasureList?sectionId=101");
    assert.ok(page.text.includes("材料到场计量管理"), "material arrival management page should show title");
    assert.ok(page.text.includes("DC-ARRIVAL-DASH") && page.text.includes("/meterialInMeasure/record_page"), "material arrival management page should include core panels");
    assert.ok(page.text.includes("DC-ARRIVAL-DASH"), "material arrival dashboard should include saved arrival");
    assert.ok(page.text.includes("CL-001") && page.text.includes("8,760.00"), "material arrival dashboard should include computed material amount");
    assert.ok(page.text.includes(`/meterialInMeasure/detail_page?arrivalId=${arrivalId}`), "material arrival dashboard should link detail page");
    assert.ok(page.text.includes(`/meterialInMeasure/form_page?arrivalId=${arrivalId}`), "material arrival dashboard should link edit page");
    assert.ok(page.text.includes("/meterialInMeasure/up_order") && page.text.includes("/meterialInMeasure/update_measure_state"), "material arrival dashboard should expose workflow actions");
    assert.ok(page.text.includes("/meterialInMeasure/archive") && page.text.includes("/meterialInMeasure/record_page"), "material arrival dashboard should expose archive and track actions");
    assert.ok(page.text.includes("/meterialInMeasure/export_meterial_in_measure"), "material arrival dashboard should expose export action");
    assert.ok(page.text.includes("TJ-01"), "material arrival dashboard should show selected section rows");
    assert.ok(!page.text.includes("<td>TJ-02"), "material arrival dashboard section filter should exclude other section rows");
    const editPage = await requestText(`/meterialInMeasure/form_page?arrivalId=${arrivalId}`);
    assert.ok(editPage.text.includes("material-arrival-form"), "material arrival edit page should render form");
    assert.ok(editPage.text.includes("验证材料供应商") && editPage.text.includes("YS-ARRIVAL-001") && editPage.text.includes("已更新"), "material arrival edit page should echo provider, approval number and state");

    const filtered = await requestText("/meterialInMeasure/meterialInMeasureList?sectionId=101&state=已更新");
    assert.ok(filtered.text.includes("DC-ARRIVAL-DASH") && filtered.text.includes("已更新"), "material arrival dashboard should filter updated state");

    const menu = await requestJson("/menu/left_menu?parentId=2");
    const flatMenu = JSON.stringify(menu.json.data);
    assert.ok(flatMenu.includes("材料到场计量管理看板") && flatMenu.includes("meterialInMeasure/dashboard_page"), "material arrival dashboard should be reachable from left menu");

    const menuPage = await requestText("/sbr/sbr_com/694");
    assert.ok(menuPage.text.includes("material-arrival-dashboard"), "material arrival dashboard should render through menu content route");
  } finally {
    await postJson(`/meterialInMeasure/delete/${arrivalId}`, { ids: String(arrivalId) });
  }
}

async function verifyMaterialArrivalDashboardLoop() {
  const { json } = await postJson("/meterialInMeasure/save_detail", {
    measureNo: "DC-ARRIVAL-DASH",
    sectionId: 101,
    materialId: 1,
    quantity: 2,
    measureDate: "2026-05-20",
    states: "审核中"
  });
  const arrivalId = json.data.meterialInMeasureId;
  try {
    assert.strictEqual(json.data.row.money, 8760, "material arrival should calculate quantity times current price");
    const page = await requestText("/meterialInMeasure/dashboard_page?sectionId=101");
    assert.ok(page.text.includes("鏉愭枡鍒板満鐪嬫澘"), "material arrival dashboard should show dedicated title");
    assert.ok(page.text.includes("DC-ARRIVAL-DASH") && page.text.includes("/meterialInMeasure/record_page"), "material arrival dashboard should include summary and detail panels");
    assert.ok(page.text.includes("DC-ARRIVAL-DASH"), "material arrival dashboard should include saved arrival");
    assert.ok(page.text.includes("CL-001") && page.text.includes("8,760.00"), "material arrival dashboard should include computed material amount");
    const detailArea = page.text.slice(page.text.indexOf("DC-ARRIVAL-DASH"));
    assert.ok(detailArea.includes("TJ-01"), "material arrival dashboard should show selected section rows");
    assert.ok(!detailArea.includes("<td>TJ-02"), "material arrival dashboard section filter should exclude other section rows");
  } finally {
    await postJson(`/meterialInMeasure/delete/${arrivalId}`, { ids: String(arrivalId) });
  }
}

async function verifyMaterialDiasManagementDashboardLoop() {
  const { json } = await postJson("/meterialdiasmeasure/save_detail", {
    measureNo: "BC-DIAS-DASH",
    sectionId: 101,
    materialId: 1,
    quantity: 2,
    measureDate: "2026-05-21",
    provider: "验证补差供应商",
    approveNo: "YS-DIAS-001",
    states: "审核中"
  });
  const diasId = json.data.meterialDiasMeasureId;
  try {
    await postJson("/meterialdiasmeasure/up_order", { diasId });
    await postJson("/meterialdiasmeasure/agree_order", { diasId });
    assert.strictEqual(json.data.row.adjustMoney, 560, "material dias should calculate quantity times price difference");

    const page = await requestText("/meterialdiasmeasure/meterialdiasmeasurePage?sectionId=101");
    assert.ok(page.text.includes("材料补差计量管理"), "material dias management page should show title");
    assert.ok(page.text.includes("BC-DIAS-DASH") && page.text.includes("/meterialdiasmeasure/track_meterial_dias_reasoure_page"), "material dias management page should include core panels");
    assert.ok(page.text.includes("BC-DIAS-DASH"), "material dias dashboard should include saved adjustment");
    assert.ok(page.text.includes("CL-001") && page.text.includes("560.00"), "material dias dashboard should include computed adjustment amount");
    assert.ok(page.text.includes(`/meterialdiasmeasure/detail_page?diasId=${diasId}`), "material dias dashboard should link detail page");
    assert.ok(page.text.includes(`/meterialdiasmeasure/edit_meterial_dias_measure_page?diasId=${diasId}`), "material dias dashboard should link edit page");
    assert.ok(page.text.includes("/meterialdiasmeasure/up_order") && page.text.includes("/meterialdiasmeasure/agree_order"), "material dias dashboard should expose workflow actions");
    assert.ok(page.text.includes("/meterialdiasmeasure/archive") && page.text.includes("/meterialdiasmeasure/track_meterial_dias_reasoure_page"), "material dias dashboard should expose archive and track actions");
    assert.ok(page.text.includes("/meterialdiasmeasure/export_meterial_dias_measure"), "material dias dashboard should expose export action");
    const detailArea = page.text.slice(page.text.indexOf("BC-DIAS-DASH"));
    assert.ok(detailArea.includes("TJ-01"), "material dias dashboard should show selected section rows");
    assert.ok(!detailArea.includes("<td>TJ-02"), "material dias dashboard section filter should exclude other section rows");
    const editPage = await requestText(`/meterialdiasmeasure/edit_meterial_dias_measure_page?diasId=${diasId}`);
    assert.ok(editPage.text.includes("material-dias-form"), "material dias edit page should render form");
    assert.ok(editPage.text.includes("验证补差供应商") && editPage.text.includes("YS-DIAS-001") && editPage.text.includes("已审核"), "material dias edit page should echo provider, approval number and state");

    const filtered = await requestText("/meterialdiasmeasure/meterialdiasmeasurePage?sectionId=101&state=已审核");
    assert.ok(filtered.text.includes("BC-DIAS-DASH") && filtered.text.includes("已审核"), "material dias dashboard should filter approved state");

    const menu = await requestJson("/menu/left_menu?parentId=2");
    const flatMenu = JSON.stringify(menu.json.data);
    assert.ok(flatMenu.includes("材料补差计量管理看板") && flatMenu.includes("meterialdiasmeasure/dashboard_page"), "material dias dashboard should be reachable from left menu");

    const menuPage = await requestText("/sbr/sbr_com/695");
    assert.ok(menuPage.text.includes("material-dias-dashboard"), "material dias dashboard should render through menu content route");
  } finally {
    await postJson(`/meterialdiasmeasure/delete/${diasId}`, { ids: String(diasId) });
  }
}

async function verifyMaterialDiasDashboardLoop() {
  const { json } = await postJson("/meterialdiasmeasure/save_detail", {
    measureNo: "BC-DIAS-DASH",
    sectionId: 101,
    materialId: 1,
    quantity: 2,
    measureDate: "2026-05-21",
    states: "审核中"
  });
  const diasId = json.data.meterialDiasMeasureId;
  try {
    assert.strictEqual(json.data.row.adjustMoney, 560, "material dias should calculate quantity times price difference");
    const page = await requestText("/meterialdiasmeasure/dashboard_page?sectionId=101");
    assert.ok(page.text.includes("鏉愭枡琛ュ樊鐪嬫澘"), "material dias dashboard should show dedicated title");
    assert.ok(page.text.includes("BC-DIAS-DASH") && page.text.includes("/meterialdiasmeasure/track_meterial_dias_reasoure_page"), "material dias dashboard should include summary and detail panels");
    assert.ok(page.text.includes("BC-DIAS-DASH"), "material dias dashboard should include saved adjustment");
    assert.ok(page.text.includes("CL-001") && page.text.includes("560.00"), "material dias dashboard should include computed adjustment amount");
    const detailArea = page.text.slice(page.text.indexOf("BC-DIAS-DASH"));
    assert.ok(detailArea.includes("TJ-01"), "material dias dashboard should show selected section rows");
    assert.ok(!detailArea.includes("<td>TJ-02"), "material dias dashboard section filter should exclude other section rows");
  } finally {
    await postJson(`/meterialdiasmeasure/delete/${diasId}`, { ids: String(diasId) });
  }
}

async function verifyManualMeasureManagementDashboardLoop() {
  const { json } = await postJson("/manualMeasure/save_measure", {
    measureNo: "SD-MANUAL-DASH",
    sectionId: 101,
    billNo: "900-SD-DASH",
    billName: "现场签证排水沟",
    measureUnit: "m",
    measureNum: 12,
    price: 345,
    measureDate: "2026-05-22",
    certifyNo: "SD-YJ-001",
    position: "K1+200 排水沟",
    remark: "现场签证依据完整",
    states: "审核中"
  });
  const manualId = json.data.manualMeasureId;
  try {
    await postJson("/manualMeasure/up_order", { manualId });
    await postJson("/manualMeasure/update_measure_state", { manualId });
    assert.strictEqual(json.data.row.measureMoney, 4140, "manual measure should calculate quantity times price");

    const page = await requestText("/manualMeasure/manualMeasureList/0?sectionId=101");
    assert.ok(page.text.includes("手动计量管理"), "manual measure management page should show title");
    assert.ok(page.text.includes("SD-MANUAL-DASH") && page.text.includes("/manualMeasure/record_page"), "manual measure management page should include core panels");
    assert.ok(page.text.includes("SD-MANUAL-DASH"), "manual measure dashboard should include saved manual measure");
    assert.ok(page.text.includes("现场签证排水沟") && page.text.includes("4,140.00"), "manual measure dashboard should include computed manual amount");
    assert.ok(page.text.includes(`/manualMeasure/manualMeasure_edit_page?manualId=${manualId}`), "manual measure dashboard should link edit page");
    assert.ok(page.text.includes("/manualMeasure/up_order") && page.text.includes("/manualMeasure/update_measure_state"), "manual measure dashboard should expose workflow actions");
    assert.ok(page.text.includes("/manualMeasure/archive") && page.text.includes("/manualMeasure/record_page"), "manual measure dashboard should expose archive and track actions");
    assert.ok(page.text.includes("/manualMeasure/export_manual_measure"), "manual measure dashboard should expose export action");
    assert.ok(page.text.includes("TJ-01"), "manual measure dashboard should show selected section rows");
    assert.ok(!page.text.includes("<td>TJ-02"), "manual measure dashboard section filter should exclude other section rows");
    const editPage = await requestText(`/manualMeasure/manualMeasure_edit_page?manualId=${manualId}`);
    assert.ok(editPage.text.includes("manual-measure-form"), "manual measure edit page should render form");
    assert.ok(editPage.text.includes("SD-YJ-001") && editPage.text.includes("K1+200 排水沟") && editPage.text.includes("现场签证依据完整") && editPage.text.includes("已更新"), "manual measure edit page should echo evidence, position, remark and state");

    const filtered = await requestText("/manualMeasure/manualMeasureList/0?sectionId=101&state=已更新");
    assert.ok(filtered.text.includes("SD-MANUAL-DASH") && filtered.text.includes("已更新"), "manual measure dashboard should filter updated state");

    const menu = await requestJson("/menu/left_menu?parentId=2");
    const flatMenu = JSON.stringify(menu.json.data);
    assert.ok(flatMenu.includes("手动计量管理看板") && flatMenu.includes("manualMeasure/dashboard_page"), "manual measure dashboard should be reachable from left menu");

    const menuPage = await requestText("/sbr/sbr_com/696");
    assert.ok(menuPage.text.includes("manual-measure-dashboard"), "manual measure dashboard should render through menu content route");
  } finally {
    await postJson(`/manualMeasure/delete/${manualId}`, { ids: String(manualId) });
  }
}

async function verifyManualMeasureDashboardLoop() {
  const { json } = await postJson("/manualMeasure/save_measure", {
    measureNo: "SD-MANUAL-DASH",
    sectionId: 101,
    billNo: "900-SD-DASH",
    billName: "现场签证排水沟",
    measureUnit: "m",
    measureNum: 12,
    price: 345,
    measureDate: "2026-05-22",
    states: "审核中"
  });
  const manualId = json.data.manualMeasureId;
  try {
    assert.strictEqual(json.data.row.measureMoney, 4140, "manual measure should calculate quantity times price");
    const page = await requestText("/manualMeasure/dashboard_page?sectionId=101");
    assert.ok(page.text.includes("鎵嬪姩璁￠噺鐪嬫澘"), "manual measure dashboard should show dedicated title");
    assert.ok(page.text.includes("SD-MANUAL-DASH") && page.text.includes("/manualMeasure/record_page"), "manual measure dashboard should include summary and detail panels");
    assert.ok(page.text.includes("SD-MANUAL-DASH"), "manual measure dashboard should include saved manual measure");
    assert.ok(page.text.includes("现场签证排水沟") && page.text.includes("4,140.00"), "manual measure dashboard should include computed manual amount");
    const detailArea = page.text.slice(page.text.indexOf("SD-MANUAL-DASH"));
    assert.ok(detailArea.includes("TJ-01"), "manual measure dashboard should show selected section rows");
    assert.ok(!detailArea.includes("<td>TJ-02"), "manual measure dashboard section filter should exclude other section rows");
  } finally {
    await postJson(`/manualMeasure/delete/${manualId}`, { ids: String(manualId) });
  }
}

async function verifyWorkflowLoop() {
  const { json: contactJson } = await postJson("/engineering_contact_bill/save_bill", {
    contactNo: "LX-WORKFLOW-VERIFY",
    sectionId: 101,
    title: "流程验证联系单",
    contactContent: "流程验证联系单内容"
  });
  const contactId = contactJson.data.contactId;
  await postJson("/engineering_contact_bill/up_order", { contactId });
  await postJson("/engineering_contact_bill/agree_order", { contactId });
  const contactTrack = await requestText(`/engineering_contact_bill/track_engineering_contact_bill_page?contactId=${contactId}`);
  assert.ok(contactTrack.text.includes("LX-WORKFLOW-VERIFY"), "contact workflow track should include business number");
  assert.ok(contactTrack.text.includes("已审核"), "contact workflow track should include approved state");

  const { json: arrivalJson } = await postJson("/meterialInMeasure/save_detail", {
    measureNo: "DC-WORKFLOW-VERIFY",
    sectionId: 101,
    materialId: 1,
    quantity: 1,
    measureDate: "2026-03-03"
  });
  const arrivalId = arrivalJson.data.meterialInMeasureId;
  await postJson("/meterialInMeasure/up_order", { arrivalId });
  await postJson("/meterialInMeasure/update_measure_state", { arrivalId });
  const arrivalTrack = await requestText(`/meterialInMeasure/record_page?arrivalId=${arrivalId}`);
  assert.ok(arrivalTrack.text.includes("DC-WORKFLOW-VERIFY"), "material arrival workflow track should include business number");
  assert.ok(arrivalTrack.text.includes("已更新"), "material arrival workflow track should include updated state");

  await postJson("/engineering_contact_bill/del", { ids: String(contactId) });
  await postJson(`/meterialInMeasure/delete/${arrivalId}`, { ids: String(arrivalId) });
}

async function verifyWorkflowSmsLoop() {
  const form = await requestText("/workflow/isSendSMSpage");
  assert.ok(form.text.includes("workflow-sms-form"), "workflow sms form should render");
  assert.ok(form.text.includes("/workflow/send_sms"), "workflow sms form should show clean labels");

  const { json } = await postJson("/workflow/send_sms", {
    receivers: "ys1,supervisor",
    message: "VERIFY-SMS 工程计量流程通知"
  });
  const smsId = json.data.id;
  try {
    assert.strictEqual(json.data.row.state, "已发送", "workflow sms should expose sent state");
    const list = await requestJson("/workflow/sms_record_list?page=1&limit=1000");
    const row = list.json.data.find((item) => Number(item.smsId || item.id) === Number(smsId));
    assert.ok(row, "workflow sms record should appear in list");
    assert.strictEqual(row.receivers, "ys1,supervisor", "workflow sms should keep receivers");
    assert.strictEqual(row.message, "VERIFY-SMS 工程计量流程通知", "workflow sms should keep message");

    const page = await requestText("/workflow/sms_record_page");
    assert.ok(page.text.includes("流程通知记录"), "workflow sms record page should render");
    assert.ok(page.text.includes("VERIFY-SMS 工程计量流程通知") && page.text.includes("已发送"), "workflow sms record page should include sent message");
  } finally {
    await postJson("/workflow/delete_sms", { ids: String(smsId) });
  }
}

async function verifyContactReportAndBusinessInfoLoop() {
  const { json: contactJson } = await postJson("/engineering_contact_bill/save_bill", {
    contactNo: "LX-REPORT-VERIFY",
    sectionId: 101,
    title: "联系单报表验证",
    contactContent: "路基施工现场技术联系内容验证",
    changeMeetingText: "会议纪要验证：按工程量清单和变更流程同步处理"
  });
  const contactId = contactJson.data.contactId;
  try {
    const report = await requestText(`/reportManager/reportViewSecurity?reportCode=vary_skill_contact&ids=${contactId}`);
    assert.ok(report.text.includes("工程技术联系单"), "contact printable report should show clean report title");
    assert.ok(report.text.includes("LX-REPORT-VERIFY"), "contact printable report should include contact number");
    assert.ok(report.text.includes("路基施工现场技术联系内容验证"), "contact printable report should include contact content");
    assert.ok(report.text.includes("会议纪要验证"), "contact printable report should include meeting text");

    const dashboard = await requestText("/busineInfo/busine_info_page?projectId=1");
    assert.ok(dashboard.text.includes("业务信息") && dashboard.text.includes("LX-REPORT-VERIFY"), "business info page should render dedicated dashboard");
    assert.ok(dashboard.text.includes("工程联系单") && dashboard.text.includes("变更动态"), "business info page should show contact and variation panels");
    assert.ok(dashboard.text.includes("材料到场") && (dashboard.text.includes("到场跟踪不计入应付") || dashboard.text.includes("材料设备垫付款") || dashboard.text.includes("预付率")), "business info page should show material arrival payment rule");
    assert.ok(dashboard.text.includes("/reportManager/reportViewSecurity?reportCode=MEASUREREOPORT"), "business info page should link payment report preview");
    assert.ok(dashboard.text.includes("LX-REPORT-VERIFY"), "business info page should include newly saved contact bill");
  } finally {
    await postJson("/engineering_contact_bill/del", { ids: String(contactId) });
  }
}

async function verifyEngineeringContactDashboardLoop() {
  const { json } = await postJson("/engineering_contact_bill/save_bill", {
    contactNo: "LX-DASH-VERIFY",
    sectionId: 101,
    title: "联系单看板验证",
    contactContent: "联系单看板验证内容",
    changeMeetingText: "会议纪要看板验证",
    costImpactType: "建议变更",
    estimateMoney: 12345.67
  });
  const contactId = json.data.contactId;
  try {
    assert.strictEqual(json.data.row.costImpactType, "建议变更", "engineering contact should persist cost impact type");
    assert.strictEqual(json.data.row.estimateMoney, 12345.67, "engineering contact should persist estimate money");
    const form = await requestText(`/engineering_contact_bill/edit_page?contactId=${contactId}`);
    assert.ok(form.text.includes('name="costImpactType"') && form.text.includes('name="estimateMoney"'), "engineering contact form should include cost impact fields");
    assert.ok(form.text.includes("建议变更") && form.text.includes("12345.67"), "engineering contact form should echo saved cost impact values");

    await postJson("/engineering_contact_bill/up_order", { contactId });
    await postJson("/engineering_contact_bill/agree_order", { contactId });

    const page = await requestText("/engineering_contact_bill/dashboard_page?sectionId=101");
    assert.strictEqual(page.response.status, 200, "engineering contact dashboard should load");
    assert.ok(page.text.includes("工程技术联系单管理看板"), "engineering contact dashboard should show title");
    assert.ok(page.text.includes("LX-DASH-VERIFY") && page.text.includes("/engineering_contact_bill/track_engineering_contact_bill_page"), "engineering contact dashboard should include core panels");
    assert.ok(page.text.includes("LX-DASH-VERIFY") && page.text.includes("联系单看板验证"), "engineering contact dashboard should include saved contact");
    assert.ok(page.text.includes("联系单看板验证内容") && page.text.includes("会议纪要看板验证"), "engineering contact dashboard should include content and meeting text");
    assert.ok(page.text.includes("建议金额") && page.text.includes("12,345.67"), "engineering contact dashboard should show estimated cost impact");
    assert.ok(page.text.includes("已审核"), "engineering contact dashboard should include approved state");
    assert.ok(page.text.includes(`/engineering_contact_bill/edit_page?contactId=${contactId}`), "engineering contact dashboard should link editor");
    assert.ok(page.text.includes(`/engineering_contact_bill/track_engineering_contact_bill_page?contactId=${contactId}`), "engineering contact dashboard should link workflow track");
    assert.ok(page.text.includes(`/reportManager/reportViewSecurity?reportCode=vary_skill_contact&ids=${contactId}`), "engineering contact dashboard should link printable report");
    assert.ok(page.text.includes("/workflow/dashboard_page?module=engineeringcontactbill"), "engineering contact dashboard should link workflow dashboard");

    const report = await requestText(`/reportManager/reportViewSecurity?reportCode=vary_skill_contact&ids=${contactId}`);
    assert.ok(report.text.includes("工程技术联系单") && report.text.includes("LX-DASH-VERIFY"), "engineering contact printable report should include dashboard contact");
    assert.ok(report.text.includes("影响类型") && report.text.includes("建议变更") && report.text.includes("12,345.67"), "engineering contact printable report should include cost impact fields");
    const fiveD = await requestJson("/api/cost/5d_model");
    const contactImpact = fiveD.json.data.contactCostImpacts.find((row) => Number(row.contactId) === Number(contactId));
    assert.ok(contactImpact, "5D cost model should include engineering contact cost impact rows");
    assert.strictEqual(contactImpact.estimateMoney, 12345.67, "5D cost model should preserve contact estimate money");

    const menu = await requestJson("/menu/left_menu?parentId=3");
    const flatMenu = JSON.stringify(menu.json.data);
    assert.ok(flatMenu.includes("工程技术联系单看板") && flatMenu.includes("engineering_contact_bill/dashboard_page"), "engineering contact dashboard should be reachable from left menu");

    const menuPage = await requestText("/sbr/sbr_com/690");
    assert.ok(menuPage.text.includes("工程技术联系单管理看板") && menuPage.text.includes("LX-DASH-VERIFY"), "engineering contact dashboard should render through menu content route");
  } finally {
    await postJson("/engineering_contact_bill/del", { ids: String(contactId) });
  }
}

async function verifySecondPaymentReportLoop() {
  const report = await requestText("/reportManager/reportPreviewSecond?sectionId=101");
  assert.strictEqual(report.response.status, 200, "second payment report should load");
  assert.ok(report.text.includes("二级计量支付报表"), "second payment report should show dedicated title");
  assert.ok(report.text.includes("HT-2026-001") && report.text.includes("101-1"), "second payment report should include section and bill panels");
  assert.ok(report.text.includes("TJ-01") && report.text.includes("HT-2026-001"), "second payment report should include selected section");
  assert.ok(report.text.includes("202-1") || report.text.includes("304-1"), "second payment report should include selected section bill rows");
  assert.ok(report.text.includes("材料到场") && (report.text.includes("到场跟踪不计入应付") || report.text.includes("材料设备垫付款") || report.text.includes("预付率")), "second payment report should include material arrival payment rule");
  assert.ok(!report.text.includes("TJ-02"), "section filter should exclude other sections");
}

async function verifyReportManagerDashboardLoop() {
  const tree = await requestJson("/reportManager/report_project_list");
  assert.strictEqual(tree.json.code, 1, "report tree endpoint should succeed");
  assert.ok(tree.json.data.reportName === "计量支付报表", "report tree should expose payment report root");
  assert.ok(tree.json.data.children.some((row) => String(row.reportName || "").includes("TJ-01")), "report tree should include section reports");

  const lastGather = await requestJson("/reportManager/findReportBillPayLastGather?page=1&limit=1000");
  assert.strictEqual(lastGather.json.code, 0, "last-gather payment ledger should keep Layui table response format");
  assert.ok(lastGather.json.data.length > 0, "last-gather payment ledger should expose bill rows");
  const payableBill = lastGather.json.data.find((row) => Number(row.afterFinishNumSum || row.measureNum || 0) > 0) || lastGather.json.data[0];
  const allGather = await postJson("/reportManager/findReportBillPayAllGather", { billPayId: payableBill.billPayId });
  assert.strictEqual(allGather.json.code, 1, "all-gather payment ledger should use original AJAX success response");
  assert.ok(allGather.json.data.length >= 1, "all-gather payment ledger should expose period rows for charting");
  let runningMeasureNum = 0;
  for (const row of allGather.json.data) {
    runningMeasureNum = round(runningMeasureNum + Number(row.currentFinishNumSum || 0), 3);
    assert.strictEqual(round(row.afterFinishNumSum || row.measureNum || 0, 3), runningMeasureNum, "period payment ledger cumulative quantity should equal sum of current period quantities");
    assert.ok(row.gatherNo || row.periodDesc, "period payment ledger should expose gather label for charts");
  }

  const page = await requestText("/reportManager/dashboard_page?sectionId=101");
  assert.strictEqual(page.response.status, 200, "report manager dashboard should load");
  assert.ok(page.text.includes("计量支付报表中心"), "report manager dashboard should show dedicated title");
  assert.ok(page.text.includes("reportManager/reportViewSecurity") && page.text.includes("reportManager/exportReport"), "report dashboard should include directory, summary and ledger panels");
  assert.ok(page.text.includes("TJ-01") && page.text.includes("HT-2026-001"), "report dashboard should include selected section");
  assert.ok(page.text.includes("101-1") || page.text.includes("202-1"), "report dashboard should include selected section bill ledger rows");
  assert.ok(page.text.includes("材料到场") && (page.text.includes("到场跟踪不计入应付") || page.text.includes("材料设备垫付款") || page.text.includes("预付率")), "report dashboard should include material arrival payment amount");
  assert.ok(page.text.includes("reportManager/exportReport") && page.text.includes("exportType=excel") && page.text.includes("exportType=pdf") && page.text.includes("exportType=word") && page.text.includes("exportType=all"), "report dashboard should expose all original export links");
  assert.ok(page.text.includes("reportManager/export_report_project_page/0?bdCode=MEASUREREOPORT"), "report dashboard should link to batch export page");
  const summaryArea = page.text.slice(page.text.indexOf("HT-2026-001"));
  assert.ok(!summaryArea.includes("<td>TJ-02"), "report dashboard section filter should exclude other sections");

  const exportPage = await requestText("/reportManager/export_report_project_page/0?bdCode=MEASUREREOPORT&sectionId=101");
  assert.strictEqual(exportPage.response.status, 200, "report batch export page should load");
  assert.ok(exportPage.text.includes("计量报表导出页面") && exportPage.text.includes("批量导出"), "report batch export page should match original export screen");
  assert.ok(["exportType=pdf", "exportType=word", "exportType=excel", "exportType=all"].every((type) => exportPage.text.includes(type)), "report batch export page should expose PDF, Word, Excel and one-click export");
  assert.ok(exportPage.text.includes("TJ-01") && exportPage.text.includes("HT-2026-001") && !exportPage.text.includes("TJ-02"), "report batch export page should honor section filter");

  const printable = await requestText("/reportManager/reportViewSecurity?reportCode=MEASUREREOPORT&rpId=101");
  assert.ok(printable.text.includes("TJ-01") && printable.text.includes("HT-2026-001"), "report printable view should render selected section");
  assert.ok(printable.text.includes("清单计量") && printable.text.includes("材料补差") && printable.text.includes("材料到场") && printable.text.includes("手动计量"), "report printable view should include full payment components");
  const defaultPrintable = await requestText("/reportManager/reportViewSecurity");
  assert.ok(defaultPrintable.text.includes("清单计量") && defaultPrintable.text.includes("材料到场") && defaultPrintable.text.includes("手动计量"), "default printable payment report should include full payment components");

  const detailPage = await requestText("/reportManager/reoirtMangerDetail");
  assert.ok(detailPage.text.includes("材料到场") && detailPage.text.includes("到场规则"), "report detail page should use expanded payment component columns");
  assert.ok(detailPage.text.includes("export_project_measure_pay") && detailPage.text.includes("导出Excel"), "report detail page should expose original project payment ledger export action");

  const directExcel = await requestText("/reportManager/exportReport?rpIds=101&exportType=excel");
  assert.ok(directExcel.text.includes("TJ-01") && directExcel.text.includes("totalPayMoney"), "direct report export should include selected section and payment columns");
  assert.ok(directExcel.text.includes("materialArrivalMoney") && directExcel.text.includes("payableFormula"), "direct report export should include expanded payment component columns");
  const directBundle = await requestText("/reportManager/exportReports");
  assert.ok(directBundle.text.includes("materialArrivalMoney") && directBundle.text.includes("arrivalRule"), "bulk report export should use expanded payment component columns");
  const menu = await requestJson("/menu/left_menu?parentId=2");
  const flatMenu = JSON.stringify(menu.json.data);
  assert.ok(flatMenu.includes("reportManager/dashboard_page") && flatMenu.includes("measure_data/audit_money_page"), "payment and audit dashboards should be reachable from left menu");
  const menuPage = await requestText("/sbr/sbr_com/6998");
  assert.strictEqual(menuPage.response.status, 200, "report dashboard should render through menu content route");
  assert.ok(menuPage.text.includes("reportManager/exportReport") && menuPage.text.includes("reportManager/reportViewSecurity"), "report menu page should expose print and export actions");
  const exportMenuPage = await requestText("/sbr/sbr_com/64");
  assert.strictEqual(exportMenuPage.response.status, 200, "report export page should render through original menu content route");
  assert.ok(["导出PDF格式报表", "导出WORD格式报表", "导出EXCEL格式报表", "一键打印"].every((label) => exportMenuPage.text.includes(label)), "report export menu page should expose original export choices");
}

async function verifyJlPaymentReportPageLoop() {
  const certificate = await requestJson("/api/payment/certificate?periodId=2");
  assert.strictEqual(certificate.response.status, 200, "JL payment certificate API should load");
  assert.strictEqual(certificate.json.code, 1, "JL payment certificate API should return success");
  const data = certificate.json.data;
  const expectedFinal = round(
    Number(data.subtotal || 0) +
      Number(data.priceAdjustment || 0) +
      Number(data.materialAdvanceMoney || 0) +
      Number(data.mobilizationAdvanceMoney || 0) +
      Number(data.claimsMoney || 0) +
      Number(data.interestMoney || 0) +
      Number(data.otherAdjustmentMoney || 0) -
      Number(data.penaltyMoney || 0) -
      Number(data.materialDeductionMoney || 0) -
      Number(data.retentionMoney || 0) -
      Number(data.mobilizationDeductionMoney || 0)
  );
  assert.strictEqual(round(data.finalPayment), expectedFinal, "JL certificate API should follow JL104 payment formula for current local period");

  const validation = await requestJson("/api/payment/jl_validation?periodId=2");
  assert.strictEqual(validation.response.status, 200, "JL payment validation API should load");
  assert.strictEqual(validation.json.code, 1, "JL payment validation API should return success");
  assert.ok(validation.json.data.ok, "JL payment validation should pass current local period");
  assert.strictEqual(validation.json.data.summary.failedChecks, 0, "JL payment validation should have no failed checks");
  assert.ok(validation.json.data.summary.totalChecks >= 20, "JL payment validation should run horizontal, vertical, period and sample checks");
  assert.ok(["横向校验", "纵向校验", "期次校验", "样表校验"].every((group) => validation.json.data.summary.groups[group]), "JL payment validation should summarize all required validation groups");
  assert.ok(validation.json.data.formulas.jl104Payment.includes("实际支付"), "JL payment validation should expose JL104 payment formula");
  assert.ok(validation.json.data.formulas.jl101Payment.includes("JL104"), "JL payment validation should expose JL101 linkage formula");
  assert.ok(validation.json.data.formulas.jl106Jl107Variation.includes("JL104"), "JL payment validation should expose JL106/JL107 variation formula");
  assert.ok(validation.json.data.formulas.jl108RawMaterial.includes("JL108-1"), "JL payment validation should expose JL108-1 raw material formula");
  assert.ok(validation.json.data.formulas.jl112Compilation.includes("JL112"), "JL payment validation should expose JL112 compilation formula");
  assert.ok(validation.json.data.formulas.jl115MobilizationAdvance.includes("JL115"), "JL payment validation should expose JL115 mobilization advance formula");
  assert.ok(validation.json.data.formulas.jl109Jl110Cumulative.includes("JL110"), "JL payment validation should expose JL109 to JL110 cumulative formula");
  assert.ok(validation.json.data.formulas.retentionContinuity.includes("保留金"), "JL payment validation should expose retention continuity formula");
  assert.ok(validation.json.data.checks.some((row) => row.name === "JL104→JL101支付金额" && row.passed), "JL validation should check JL104 to JL101 payment amount");
  assert.ok(validation.json.data.checks.some((row) => row.name.includes("JL106/JL107→JL104变更金额") && row.passed), "JL validation should check JL106/JL107 variation amounts against JL104");
  assert.ok(validation.json.data.checks.some((row) => row.name === "JL108-1→JL108原材料调差" && row.passed), "JL validation should check JL108-1 raw material rows against JL108");
  assert.ok(validation.json.data.checks.some((row) => row.name === "JL112→JL113工程量汇编金额" && row.passed), "JL validation should check JL112 compilation rows against JL113");
  assert.ok(validation.json.data.checks.some((row) => row.name === "JL115动员预付款总额" && row.passed), "JL validation should check JL115 mobilization advance amount");
  assert.ok(validation.json.data.referenceCases.some((row) => row.item === "JL106/JL107变更金额" && row.expected === 0 && row.passed), "JL validation should record the period 12 sample JL106/JL107 empty variation case");

  const inheritance = await requestJson("/api/payment/jl_period_inheritance?periodId=2");
  assert.strictEqual(inheritance.response.status, 200, "JL period inheritance API should load");
  assert.strictEqual(inheritance.json.code, 1, "JL period inheritance API should return success");
  assert.ok(inheritance.json.data.ok, "JL period inheritance should pass for current local period");
  assert.strictEqual(inheritance.json.data.summary.failedRows, 0, "JL period inheritance should have no failed rows");
  assert.ok(inheritance.json.data.summary.totalRows >= 1, "JL period inheritance should compare JL105 rows");
  assert.ok(inheritance.json.data.rows.some((row) => row.formula.includes("第N期到上期末")), "JL period inheritance should expose the continuity formula");

  const financialContinuity = await requestJson("/api/payment/jl_financial_continuity?periodId=2");
  assert.strictEqual(financialContinuity.response.status, 200, "JL financial continuity API should load");
  assert.strictEqual(financialContinuity.json.code, 1, "JL financial continuity API should return success");
  assert.ok(financialContinuity.json.data.ok, "JL financial continuity should pass for current local period");
  assert.strictEqual(financialContinuity.json.data.summary.failedChecks, 0, "JL financial continuity should have no failed checks");
  assert.ok(financialContinuity.json.data.summary.totalChecks >= 12, "JL financial continuity should check material, mobilization and retention continuity");
  assert.ok(financialContinuity.json.data.formulas.jl109ToJl110.includes("JL110"), "JL financial continuity should expose JL109 to JL110 formula");
  assert.ok(financialContinuity.json.data.checks.some((row) => row.name.includes("JL109→JL110累计预付") && row.passed), "JL financial continuity should check cumulative material advances");
  assert.ok(financialContinuity.json.data.checks.some((row) => row.name.includes("保留金累计") && row.passed), "JL financial continuity should check retention cumulative continuity");
  assert.ok(financialContinuity.json.data.referenceCases.some((row) => row.item === "材料未扣回余额" && row.expected === 6400483 && row.passed), "JL financial continuity should record the period 12 material outstanding reference");

  const jl101 = await requestJson("/api/payment/jl101?periodId=2");
  assert.strictEqual(jl101.response.status, 200, "JL101 monthly report API should load");
  assert.strictEqual(jl101.json.code, 1, "JL101 monthly report API should return success");
  assert.strictEqual(round(jl101.json.data.currentPayment), round(data.finalPayment), "JL101 current payment should match JL104 final payment");

  const jl102 = await requestJson("/api/payment/jl102?periodId=2");
  assert.strictEqual(jl102.response.status, 200, "JL102 transfer API should load");
  assert.strictEqual(jl102.json.code, 0, "JL102 transfer table API should return Layui success");
  assert.ok(Array.isArray(jl102.json.data) && jl102.json.data.length >= 1, "JL102 transfer API should expose workflow rows");

  const jl103 = await requestJson("/api/payment/jl103?periodId=2");
  assert.strictEqual(jl103.response.status, 200, "JL103 progress API should load");
  assert.strictEqual(jl103.json.code, 0, "JL103 progress table API should return Layui success");
  assert.ok(Array.isArray(jl103.json.data) && jl103.json.data.some((row) => Object.prototype.hasOwnProperty.call(row, "progressPct")), "JL103 progress API should expose progress rows");

  const jl106 = await requestJson("/api/payment/jl106?periodId=2");
  assert.strictEqual(jl106.response.status, 200, "JL106 variation quantity API should load");
  assert.strictEqual(jl106.json.code, 0, "JL106 variation quantity table API should return Layui success");
  assert.ok(Array.isArray(jl106.json.data), "JL106 variation quantity API should expose table rows");

  const jl107 = await requestJson("/api/payment/jl107?periodId=2");
  assert.strictEqual(jl107.response.status, 200, "JL107 unit price variation API should load");
  assert.strictEqual(jl107.json.code, 0, "JL107 unit price variation table API should return Layui success");
  assert.ok(Array.isArray(jl107.json.data), "JL107 unit price variation API should expose table rows");

  const jl108Raw = await requestJson("/api/payment/jl108_raw_material?periodId=2");
  assert.strictEqual(jl108Raw.response.status, 200, "JL108-1 raw material API should load");
  assert.strictEqual(jl108Raw.json.code, 0, "JL108-1 raw material table API should return Layui success");
  assert.ok(Array.isArray(jl108Raw.json.data), "JL108-1 raw material API should expose table rows");

  const jl112 = await requestJson("/api/payment/jl112?periodId=2");
  assert.strictEqual(jl112.response.status, 200, "JL112 compilation API should load");
  assert.strictEqual(jl112.json.code, 0, "JL112 compilation table API should return Layui success");
  assert.ok(Array.isArray(jl112.json.data) && jl112.json.data.length >= 1, "JL112 compilation API should expose measure rows");

  const jl114 = await requestJson("/api/payment/jl114?periodId=2");
  assert.strictEqual(jl114.response.status, 200, "JL114 measure form API should load");
  assert.strictEqual(jl114.json.code, 0, "JL114 measure form table API should return Layui success");
  assert.ok(Array.isArray(jl114.json.data) && jl114.json.data.length >= 1, "JL114 measure form API should expose base measure detail rows");
  assert.ok(jl114.json.data.some((row) => row.formCode === "JL114" && row.formula && row.formula.includes("金额")), "JL114 rows should expose form code and amount formula");

  const jl115 = await requestJson("/api/payment/jl115?periodId=2");
  assert.strictEqual(jl115.response.status, 200, "JL115 mobilization advance API should load");
  assert.strictEqual(jl115.json.code, 1, "JL115 mobilization advance API should return success");
  assert.strictEqual(round(jl115.json.data.totalAdvance), round(jl115.json.data.contractTotal * (jl115.json.data.advanceRate / 100)), "JL115 total advance should equal contract total times configured rate");

  const support = await requestJson("/api/payment/jl_support?periodId=2");
  assert.strictEqual(support.response.status, 200, "JL support report API should load");
  assert.strictEqual(support.json.code, 1, "JL support report API should return success");
  assert.ok(support.json.data.jl102Rows.length >= 1 && support.json.data.jl112Rows.length >= 1 && support.json.data.jl115Certificate.formCode === "JL115", "JL support report should bundle auxiliary JL forms");

  const lifecycle = await requestJson("/api/payment/jl_lifecycle?periodId=2");
  assert.strictEqual(lifecycle.response.status, 200, "JL form lifecycle API should load");
  assert.strictEqual(lifecycle.json.code, 1, "JL form lifecycle API should return success");
  assert.ok(lifecycle.json.data.forms.length >= 16, "JL form lifecycle should cover JL101-JL116 forms");
  assert.ok(lifecycle.json.data.forms.some((row) => row.code === "JL115" && row.expected), "JL115 should be expected in the configured startup periods");
  assert.ok(lifecycle.json.data.forms.some((row) => row.code === "JL108" && row.expected), "JL108 should be expected when current period has price adjustment");
  assert.ok(lifecycle.json.data.forms.some((row) => row.code === "JL116" && row.expected), "JL116 should follow price adjustment lifecycle");
  assert.ok(lifecycle.json.data.forms.some((row) => row.code === "JL111" && !row.expected), "JL111 should stay hidden before mobilization deduction threshold");
  assert.ok(lifecycle.json.data.summary.lifecycleRules.jlPriceAdjustmentMonths.length > 0, "JL lifecycle summary should expose configured price adjustment months");
  assert.ok(Object.prototype.hasOwnProperty.call(lifecycle.json.data.summary.lifecycleRules, "jl116NonAdjustableFactor"), "JL lifecycle summary should expose JL116 formula factor");
  assert.ok(Object.prototype.hasOwnProperty.call(lifecycle.json.data.summary.lifecycleRules, "jl108RawMaterialConversionFactorCount"), "JL lifecycle summary should expose JL108-1 conversion factor config count");
  assert.ok(Object.prototype.hasOwnProperty.call(lifecycle.json.data.summary.lifecycleRules, "jl116MaterialWeightCount"), "JL lifecycle summary should expose JL116 material weight config count");

  const priceAdjustment = await requestJson("/api/payment/jl_price_adjustment?periodId=2");
  assert.strictEqual(priceAdjustment.response.status, 200, "JL price adjustment API should load");
  assert.strictEqual(priceAdjustment.json.code, 1, "JL price adjustment API should return success");
  assert.ok(Array.isArray(priceAdjustment.json.data.detailRows), "JL108 price adjustment report should expose detail rows");
  assert.ok(priceAdjustment.json.data.formula && priceAdjustment.json.data.formula.formula.includes("T = F"), "JL116 price adjustment report should expose formula");
  assert.ok(Array.isArray(priceAdjustment.json.data.formula.materialWeights), "JL116 price adjustment report should expose material weight rows");
  assert.ok(priceAdjustment.json.data.coverage && Array.isArray(priceAdjustment.json.data.coverage.sourcePeriodIds), "JL108 price adjustment report should expose settlement coverage periods");
  assert.ok(Object.prototype.hasOwnProperty.call(priceAdjustment.json.data.formula, "formulaAdjustment"), "JL116 formula summary should expose formula adjustment amount");
  assert.strictEqual(round(priceAdjustment.json.data.formula.certificatePriceAdjustment), round(data.priceAdjustment), "JL116 formula summary should reconcile to JL104 price adjustment");

  const deductions = await requestJson("/api/payment/jl_deductions?periodId=2");
  assert.strictEqual(deductions.response.status, 200, "JL deduction ledger API should load");
  assert.strictEqual(deductions.json.code, 1, "JL deduction ledger API should return success");
  assert.ok(Array.isArray(deductions.json.data.materialDeductionLedger) && deductions.json.data.materialDeductionLedger.length >= 1, "JL110 ledger should expose period rows");
  assert.ok(Array.isArray(deductions.json.data.mobilizationDeductionLedger) && deductions.json.data.mobilizationDeductionLedger.length >= 1, "JL111 ledger should expose period rows");
  assert.ok(deductions.json.data.materialDeductionLedger.some((row) => Object.prototype.hasOwnProperty.call(row, "remainingAdvance")), "JL110 ledger should expose remaining material advance");
  assert.ok(deductions.json.data.mobilizationDeductionLedger.some((row) => row.formula && row.formula.includes("C-D")), "JL111 ledger should expose mobilization deduction formula");

  const page = await requestText("/payment/jl_report_page?periodId=2");
  assert.strictEqual(page.response.status, 200, "JL payment report page should load");
  assert.ok(page.text.includes("JL计量支付报表核对"), "JL payment report page should show dedicated title");
  assert.ok(page.text.includes("JL101 计量支付月报表") && page.text.includes("/api/payment/jl101"), "JL payment report page should show JL101 monthly report and JSON link");
  assert.ok(page.text.includes("JL102 计量支付报表传递单") && page.text.includes("JL103 施工进度表") && page.text.includes("JL115 开工动员预付款支付证书"), "JL payment report page should show JL102/JL103/JL115 auxiliary forms");
  assert.ok(["JL104", "JL114", "JL113", "JL105", "JL109"].every((label) => page.text.includes(label)), "JL payment report page should include core JL tables");
  assert.ok(page.text.includes("JL106 清单工程量变更表") && page.text.includes("JL107 清单单价变更一览表"), "JL payment report page should show JL106/JL107 variation tables");
  assert.ok(page.text.includes("JL108-1 原材料明细表") && page.text.includes("JL112 工程量表汇编"), "JL payment report page should show JL108-1 and JL112 forms");
  assert.ok(page.text.includes(moneyTextForVerify(data.finalPayment)) && page.text.includes(moneyTextForVerify(data.subtotal)), "JL payment report page should show current API values");
  assert.ok(page.text.includes("7,699,376.00") && page.text.includes("24,024,989.00") && page.text.includes("621,281.00"), "JL payment report page should show PDF reference validation values");
  assert.ok(page.text.includes("JL106/JL107变更金额") && page.text.includes("JL106/JL107样表仅表头无变更明细"), "JL payment report page should show the period 12 empty variation reference");
  assert.ok(page.text.includes("JL表单校验结果") && page.text.includes("当前期横向、纵向、期次和样表基准校验全部通过"), "JL payment report page should show validation results");
  assert.ok(page.text.includes("JL105期次继承校验") && page.text.includes("/api/payment/jl_period_inheritance"), "JL payment report page should show period inheritance validation and JSON link");
  assert.ok(page.text.includes("JL资金连续性校验") && page.text.includes("/api/payment/jl_financial_continuity"), "JL payment report page should show financial continuity validation and JSON link");
  assert.ok(page.text.includes("材料未扣回余额") && page.text.includes("保留金连续性"), "JL payment report page should show material outstanding and retention continuity");
  assert.ok(page.text.includes("JL表单生命周期") && page.text.includes("JL115") && page.text.includes("JL116"), "JL payment report page should show lifecycle table");
  assert.ok(page.text.includes("JL108 永久性工程材料差价金额一览表") && page.text.includes("JL116 合同价格调表"), "JL payment report page should show JL108/JL116 price adjustment ledgers");
  assert.ok(page.text.includes("覆盖方式") && page.text.includes("来源期次"), "JL payment report page should show JL108 settlement coverage metadata");
  assert.ok(page.text.includes("JL110 扣回材料垫付款一览表") && page.text.includes("JL111 扣回动员预付款一览表"), "JL payment report page should show JL110 and JL111 ledgers");
  assert.ok(page.text.includes("/api/payment/certificate") && page.text.includes("/api/payment/jl_validation") && page.text.includes("/api/payment/jl_lifecycle") && page.text.includes("/api/payment/jl_period_inheritance") && page.text.includes("/api/payment/jl_financial_continuity"), "JL payment report page should link certificate, validation, lifecycle, inheritance and financial continuity JSON");
  assert.ok(page.text.includes("/api/payment/jl114") && page.text.includes("JL114 工程计量表"), "JL payment report page should show and link JL114 base measure form");
  assert.ok(page.text.includes("/api/payment/jl106") && page.text.includes("/api/payment/jl107"), "JL payment report page should link JL106/JL107 JSON");
  assert.ok(page.text.includes("/api/payment/jl102") && page.text.includes("/api/payment/jl103") && page.text.includes("/api/payment/jl108_raw_material") && page.text.includes("/api/payment/jl112") && page.text.includes("/api/payment/jl115"), "JL payment report page should link auxiliary JL JSON APIs");
  assert.ok(page.text.includes("/api/payment/jl_price_adjustment"), "JL payment report page should link price adjustment JSON");
  assert.ok(page.text.includes("/api/payment/jl_deductions"), "JL payment report page should link deduction ledger JSON");
  assert.ok(page.text.includes("/payment/jl_print_page") && page.text.includes("/payment/export_jl_report") && page.text.includes("/payment/export_jl_report_pdf"), "JL payment report page should link print preview, CSV export and PDF export");
  assert.ok(page.text.includes("/payment/export_jl_form_pdf?formCode=JL101") && page.text.includes("/payment/export_jl_form_pdf?formCode=JL114") && page.text.includes("逐表PDF导出"), "JL payment report page should expose per-form JL PDF exports");

  const printPage = await requestText("/payment/jl_print_page?periodId=2");
  assert.strictEqual(printPage.response.status, 200, "JL payment print page should load");
  assert.ok(printPage.text.includes("JL计量支付报表打印预览"), "JL payment print page should show dedicated title");
  assert.ok(["JL101 计量支付月报表", "JL102/JL103 流转与施工进度", "JL104 中期财务支付证书", "JL115 开工动员预付款支付证书", "JL106/JL107 变更明细", "JL108/JL116 价格调差", "JL108-1 原材料明细表", "JL112 工程量表汇编", "JL114 工程计量表", "JL113 计量支付数量汇总表", "JL105 清单中期财务支付报表", "JL表单校验与生命周期", "JL105期次继承校验", "JL资金连续性校验", "JL110/JL111 专项扣款台账"].every((label) => printPage.text.includes(label)), "JL payment print page should include printable core sections");

  const exportCsv = await requestText("/payment/export_jl_report?periodId=2");
  assert.strictEqual(exportCsv.response.status, 200, "JL payment CSV export should load");
  assert.ok(exportCsv.text.includes("JL101月报摘要") && exportCsv.text.includes("JL104支付证书") && exportCsv.text.includes("JL114工程计量表") && exportCsv.text.includes("JL113数量汇总") && exportCsv.text.includes("JL表单生命周期"), "JL payment CSV export should include JL101, certificate, JL114, JL113 and lifecycle rows");
  assert.ok(exportCsv.text.includes("JL102计量支付报表传递单") && exportCsv.text.includes("JL103施工进度表") && exportCsv.text.includes("JL112工程量表汇编") && exportCsv.text.includes("JL115开工动员预付款支付证书"), "JL payment CSV export should include auxiliary JL form rows");
  assert.ok(exportCsv.text.includes("JL106清单工程量变更表") && exportCsv.text.includes("JL107清单单价变更一览表"), "JL payment CSV export should include JL106/JL107 variation rows");
  assert.ok(exportCsv.text.includes("JL108材料调差明细") && exportCsv.text.includes("JL108-1原材料明细表") && exportCsv.text.includes("JL116合同价格调表"), "JL payment CSV export should include JL108/JL108-1/JL116 price adjustment rows");
  assert.ok(exportCsv.text.includes("JL110材料扣回台账") && exportCsv.text.includes("JL111动员扣回台账"), "JL payment CSV export should include JL110 and JL111 ledgers");
  assert.ok(exportCsv.text.includes("JL105期次继承校验"), "JL payment CSV export should include JL105 period inheritance rows");
  assert.ok(exportCsv.text.includes("JL资金连续性校验") && exportCsv.text.includes("JL104保留金连续台账"), "JL payment CSV export should include financial continuity and retention ledger rows");

  const exportPdf = await requestBuffer("/payment/export_jl_report_pdf?periodId=2");
  assert.strictEqual(exportPdf.response.status, 200, "JL payment PDF export should load");
  assert.ok((exportPdf.response.headers.get("content-type") || "").includes("application/pdf"), "JL payment PDF export should use application/pdf content type");
  assert.strictEqual(exportPdf.buffer.slice(0, 5).toString("latin1"), "%PDF-", "JL payment PDF export should return a real PDF file");
  assert.ok(exportPdf.buffer.includes(Buffer.from("/STSong-Light")), "JL payment PDF export should include a CJK-capable PDF font resource");

  for (const code of ["JL101", "JL108-1", "JL114", "JL116"]) {
    const formPdf = await requestBuffer(`/payment/export_jl_form_pdf?formCode=${encodeURIComponent(code)}&periodId=2`);
    assert.strictEqual(formPdf.response.status, 200, `${code} per-form PDF export should load`);
    assert.ok((formPdf.response.headers.get("content-type") || "").includes("application/pdf"), `${code} per-form PDF should use application/pdf content type`);
    assert.strictEqual(formPdf.buffer.slice(0, 5).toString("latin1"), "%PDF-", `${code} per-form export should return a real PDF file`);
    assert.ok(formPdf.buffer.includes(Buffer.from("/STSong-Light")), `${code} per-form PDF should include a CJK-capable PDF font resource`);
  }
  const badFormPdf = await requestJson("/payment/export_jl_form_pdf?formCode=JL999&periodId=2");
  assert.strictEqual(badFormPdf.response.status, 400, "unknown JL per-form PDF export should reject the request");
  assert.strictEqual(badFormPdf.json.code, 0, "unknown JL per-form PDF export should return a business error");

  const menuPage = await requestText("/sbr/sbr_com/9004");
  assert.strictEqual(menuPage.response.status, 200, "JL payment report menu page should load");
  assert.ok(menuPage.text.includes("JL计量支付报表核对") && menuPage.text.includes("JL104"), "JL payment report menu page should render the report page");

  const reportDashboard = await requestText("/reportManager/dashboard_page");
  assert.ok(reportDashboard.text.includes("/payment/jl_report_page"), "report manager dashboard should link JL payment report");
  const adminDashboard = await requestText("/admin/dashboard_page");
  assert.ok(adminDashboard.text.includes("/payment/jl_report_page") && adminDashboard.text.includes("JL计量支付报表"), "admin dashboard should link JL payment report");
}

async function verifyAuditMoneyDashboardLoop() {
  const list = await requestJson("/measure_data/audit_money_list?page=1&limit=1000");
  assert.ok(list.json.data.length > 0, "audit money list should expose rows");
  const first = list.json.data[0];
  assert.ok(Number(first.usertask1 || 0) >= Number(first.usertask2 || 0), "audit money row should include submit and supervisor audit amounts");
  const summary = engine.contractSummary();
  const submitTotal = round(list.json.data.reduce((sum, row) => sum + Number(row.usertask1 || row.submitMoney || 0), 0));
  const manualMoney = round(engine.manualMeasureRows().reduce((sum, row) => sum + Number(row.measureMoney || 0), 0));
  assert.strictEqual(submitTotal, summary.payableMoney, "audit money list should cover bill measures, material adjustments and manual measures");
  assert.ok(list.json.data.some((row) => row.auditType === "材料补差"), "audit money list should include material adjustment audit rows");
  if (manualMoney > 0) {
    assert.ok(list.json.data.some((row) => row.auditType === "手动计量"), "audit money list should include manual measure audit rows when manual money exists");
  }

  const page = await requestText("/measure_data/audit_money_page");
  assert.strictEqual(page.response.status, 200, "audit money dashboard should load");
  assert.ok(page.text.includes("measure_data/audit_money_list") || page.text.includes("最终审核金额"), "audit money dashboard should show dedicated title");
  assert.ok(page.text.includes("施工单位") || page.text.includes("usertask1"), "audit money dashboard should include grouped audit headers");
  assert.ok(page.text.includes("最终审核金额") || page.text.includes("监理核减") || page.text.includes("业主核减"), "audit money dashboard should include final and deduction columns");
  assert.ok(page.text.includes("材料补差") && (manualMoney <= 0 || page.text.includes("手动计量")), "audit money dashboard should show non-bill payable audit rows");
  assert.ok(page.text.includes("101-1") || page.text.includes("202-1") || page.text.includes("临时道路"), "audit money dashboard should include bill rows");
  const menuPage = await requestText("/sbr/sbr_com/699");
  assert.strictEqual(menuPage.response.status, 200, "audit money dashboard should render through menu content route");
  assert.ok(menuPage.text.includes("/measure_data/audit_money_list"), "audit menu page should expose audit list action");
}

async function verifyProjectPlanDashboardLoop() {
  const { json } = await postJson("/secProjectPlan/save_plan", {
    planName: "计划看板验证",
    sectionId: 101,
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    amount: 123456,
    status: "执行中"
  });
  const planId = json.data.planId;
  try {
    assert.strictEqual(json.data.row.finishMoney, 123456, "saved project plan should expose finish money");
    assert.ok(String(json.data.row.finishPercent || "").endsWith("%"), "saved project plan should expose finish percent");

    const list = await requestJson("/secProjectPlan/get_plan_list?page=1&limit=1000");
    const saved = list.json.data.find((row) => Number(row.planId || row.id) === Number(planId));
    assert.ok(saved, "saved project plan should appear in plan list");
    assert.strictEqual(saved.planName, "计划看板验证", "project plan list should keep plan name");

    const dashboard = await requestText("/secProjectPlan/plan_dashboard_page?sectionId=101");
    assert.ok(dashboard.text.includes("项目计划执行看板"), "project plan dashboard should show dedicated title");
    assert.ok(dashboard.text.includes("123,456.00") && dashboard.text.includes("TJ-01"), "project plan dashboard should include value schedule columns");
    assert.ok(dashboard.text.includes("计划看板验证"), "project plan dashboard should include newly saved plan");
    assert.ok(dashboard.text.includes("123,456.00"), "project plan dashboard should format planned amount");
    assert.ok(dashboard.text.includes("TJ-01"), "project plan dashboard should show selected section rows");
    assert.ok(!dashboard.text.includes("<td>TJ-02"), "project plan dashboard section filter should exclude other section rows");
  } finally {
    await postJson("/secProjectPlan/delete_plan", { ids: String(planId) });
  }
}

async function verifyWorkflowAdjustReturnLoop() {
  const adjustRemark = "调整为现场确认数量";
  const returnReason = "资料需补充";
  const { json: manualJson } = await postJson("/manualMeasure/save_measure", {
    measureNo: "SD-WORKFLOW-ADJUST",
    sectionId: 101,
    billNo: "900-WF",
    billName: "流程调整验证",
    measureUnit: "项",
    measureNum: 1,
    price: 100,
    states: "审核中"
  });
  const manualId = manualJson.data.manualMeasureId;

  const adjustPage = await requestText(`/manualMeasure/adjust_page?manualId=${manualId}`);
  assert.ok(adjustPage.text.includes("workflow-adjust-form"), "manual measure adjust page should render a workflow adjustment form");
  assert.ok(adjustPage.text.includes("手动计量") && adjustPage.text.includes("当前金额") && adjustPage.text.includes("保存调整"), "manual measure adjust page should expose business type, current money and save action");
  assert.ok(adjustPage.text.includes("/workflow/adjust_order") && !adjustPage.text.includes("local-form-"), "manual measure adjust page should use workflow adjustment endpoint, not generic local form");

  const { json: adjusted } = await postJson("/workflow/adjust_order", {
    businessType: "manualmeasure",
    businessId: manualId,
    quantity: 3,
    price: 120,
    remark: adjustRemark
  });
  assert.strictEqual(adjusted.data.changed, 1, "workflow adjustment should find target by businessType/businessId");
  const { json: afterAdjust } = await requestJson("/manualMeasure/detail_list?page=1&limit=1000");
  const adjustedRow = afterAdjust.data.find((row) => Number(row.manualId || row.manualMeasureId || row.id) === Number(manualId));
  assert.ok(adjustedRow, "adjusted manual measure should remain in list");
  assert.strictEqual(adjustedRow.measureNum, 3, "workflow adjustment should update quantity");
  assert.strictEqual(adjustedRow.price, 120, "workflow adjustment should update price");
  assert.strictEqual(adjustedRow.measureMoney, 360, "workflow adjustment should update computed money");
  assert.strictEqual(adjustedRow.states, "已调整", "workflow adjustment should set clean Chinese state");

  const { json: returned } = await postJson("/workflow/withdraw_order", {
    businessType: "manualmeasure",
    businessId: manualId,
    returnReason
  });
  assert.strictEqual(returned.data.changed, 1, "workflow return should find target by businessType/businessId");
  assert.strictEqual(returned.data.state, "已退回", "workflow return should expose clean returned state");

  const returnPage = await requestText(`/manualMeasure/return_order_page?manualId=${manualId}`);
  assert.ok(returnPage.text.includes("workflow-return-form"), "manual measure return page should render a workflow return form");
  assert.ok(returnPage.text.includes("手动计量") && returnPage.text.includes("退回原因") && returnPage.text.includes("确认退回"), "manual measure return page should expose business type and return action");
  assert.ok(returnPage.text.includes("/workflow/withdraw_order") && !returnPage.text.includes("local-form-"), "manual measure return page should use workflow return endpoint, not generic local form");

  const track = await requestText(`/manualMeasure/record_page?measureType=manualmeasure&ids=${manualId}`);
  assert.ok(track.text.includes("SD-WORKFLOW-ADJUST"), "workflow track should include adjusted business number");
  assert.ok(track.text.includes(adjustRemark), "workflow track should include adjustment remark");
  assert.ok(track.text.includes(returnReason), "workflow track should include return reason");
  assert.ok(track.text.includes("已退回"), "workflow track should include returned state");

  await postJson(`/manualMeasure/delete/${manualId}`, { ids: String(manualId) });
}

async function verifyWorkflowAdjustReturnAcrossModulesLoop() {
  const created = [];
  try {
    const { json: billJson } = await postJson("/bill_measure/save_measure", {
      measureNo: "WF-MODULE-BILL",
      sectionId: 101,
      periodId: 1,
      states: "审核中"
    });
    const billMeasureId = billJson.data.billMeasureId;
    created.push(["/bill_measure/delete", { billMeasureIds: String(billMeasureId) }]);
    await postJson("/bill_measure/save_detail", { billMeasureId, billId: 1, measureNum: 0.01 });

    const { json: diasJson } = await postJson("/meterialdiasmeasure/save_detail", {
      measureNo: "WF-MODULE-DIAS",
      sectionId: 101,
      materialId: 1,
      quantity: 1,
      states: "审核中"
    });
    const diasId = diasJson.data.meterialDiasMeasureId;
    created.push(["/meterialdiasmeasure/delete", { meterialDiasMeasureIds: String(diasId) }]);

    const { json: arrivalJson } = await postJson("/meterialInMeasure/save_detail", {
      measureNo: "WF-MODULE-ARRIVAL",
      sectionId: 101,
      materialId: 1,
      quantity: 1,
      states: "审核中"
    });
    const arrivalId = arrivalJson.data.meterialInMeasureId;
    created.push(["/meterialInMeasure/delete", { meterialInMeasureIds: String(arrivalId) }]);

    const { json: varyJson } = await postJson("/vary_measure/save_measure", {
      varyNo: "WF-MODULE-VARY",
      sectionId: 101,
      billId: 1,
      beforeNum: 1,
      beforePrice: 100,
      afterNum: 2,
      afterPrice: 120,
      varyReason: "多模块流程调整验证",
      states: "审核中"
    });
    const varyId = varyJson.data.varyId;
    created.push(["/vary_measure/delete", { varyIds: String(varyId) }]);

    const cases = [
      {
        type: "billmeasure",
        id: billMeasureId,
        adjustUrl: `/bill_measure/adjust_page?billMeasureId=${billMeasureId}`,
        returnUrl: `/bill_measure/return_order_page?billMeasureId=${billMeasureId}`,
        listUrl: "/bill_measure/list?page=1&limit=1000",
        find: (rows) => rows.find((row) => Number(row.billMeasureId || row.measureId) === Number(billMeasureId)),
        expectedMoney: 370000,
        trackUrl: `/bill_measure/track_bill_measure_page?measureType=billmeasure&ids=${billMeasureId}`
      },
      {
        type: "meterialdiasmeasure",
        id: diasId,
        adjustUrl: `/meterialdiasmeasure/adjust_page?diasId=${diasId}`,
        returnUrl: `/meterialdiasmeasure/return_order_page?diasId=${diasId}`,
        listUrl: "/meterialdiasmeasure/meterial_dias_measure_list?page=1&limit=1000",
        find: (rows) => rows.find((row) => Number(row.meterialDiasMeasureId || row.diasId) === Number(diasId)),
        expectedMoney: 560,
        trackUrl: `/meterialdiasmeasure/track_meterial_dias_reasoure_page?measureType=meterialdiasmeasure&ids=${diasId}`
      },
      {
        type: "meterialinmeasure",
        id: arrivalId,
        adjustUrl: `/meterialInMeasure/adjust_page?arrivalId=${arrivalId}`,
        returnUrl: `/meterialInMeasure/return_order_page?arrivalId=${arrivalId}`,
        listUrl: "/meterialInMeasure/meterial_in_measure_list?page=1&limit=1000",
        find: (rows) => rows.find((row) => Number(row.meterialInMeasureId || row.arrivalId) === Number(arrivalId)),
        expectedMoney: 8760,
        trackUrl: `/meterialInMeasure/record_page?measureType=meterialinmeasure&ids=${arrivalId}`
      },
      {
        type: "varyapplication",
        id: varyId,
        adjustUrl: `/vary_measure/adjust_page?varyId=${varyId}`,
        returnUrl: `/vary_measure/return_order_page?varyId=${varyId}`,
        listUrl: "/vary_measure/list?page=1&limit=1000",
        find: (rows) => rows.find((row) => Number(row.varyId) === Number(varyId)),
        expectedMoney: 60,
        trackUrl: `/vary_measure/track_page?measureType=varyapplication&ids=${varyId}`
      }
    ];

    for (const item of cases) {
      const adjustPage = await requestText(item.adjustUrl);
      assert.ok(adjustPage.text.includes("workflow-adjust-form") && adjustPage.text.includes("/workflow/adjust_order"), `${item.type} adjust page should use workflow adjustment form`);
      const adjustRemark = `ADJUST-${item.type}`;
      const adjusted = await postJson("/workflow/adjust_order", {
        businessType: item.type,
        businessId: item.id,
        quantity: 2,
        price: 80,
        remark: adjustRemark
      });
      assert.strictEqual(adjusted.json.data.changed, 1, `${item.type} adjustment should update target row`);
      const list = await requestJson(item.listUrl);
      const row = item.find(list.json.data);
      assert.ok(row, `${item.type} adjusted row should remain queryable`);
      const money = Number(row.measureMoney || row.adjustMoney || row.money || row.varyMoney || 0);
      assert.strictEqual(round(money), item.expectedMoney, `${item.type} adjustment should recalculate business money`);
      assert.strictEqual(row.states, "已调整", `${item.type} adjustment should set adjusted state`);

      const returnReason = `RETURN-${item.type}`;
      const returned = await postJson("/workflow/withdraw_order", {
        businessType: item.type,
        businessId: item.id,
        returnReason
      });
      assert.strictEqual(returned.json.data.changed, 1, `${item.type} return should update target row`);
      const returnPage = await requestText(item.returnUrl);
      assert.ok(returnPage.text.includes("workflow-return-form") && returnPage.text.includes("/workflow/withdraw_order"), `${item.type} return page should use workflow return form`);
      const track = await requestText(item.trackUrl);
      assert.ok(track.text.includes(adjustRemark) && track.text.includes(returnReason), `${item.type} workflow track should include adjust and return logs`);
    }
  } finally {
    for (const [url, body] of created.reverse()) {
      await postJson(url, body);
    }
  }
}

async function verifyWorkflowDashboardLoop() {
  const adjustRemark = "流程工作台调整验证";
  const returnReason = "流程工作台退回验证";
  const { json: manualJson } = await postJson("/manualMeasure/save_measure", {
    measureNo: "WF-DASH-VERIFY",
    sectionId: 101,
    billNo: "900-WFD",
    billName: "流程工作台验证",
    measureUnit: "项",
    measureNum: 2,
    price: 150,
    states: "待审核"
  });
  const manualId = manualJson.data.manualMeasureId;
  try {
    await postJson("/workflow/adjust_order", {
      businessType: "manualmeasure",
      businessId: manualId,
      quantity: 4,
      price: 180,
      remark: adjustRemark
    });
    await postJson("/workflow/withdraw_order", {
      businessType: "manualmeasure",
      businessId: manualId,
      returnReason
    });

    const page = await requestText("/workflow/dashboard_page");
    assert.strictEqual(page.response.status, 200, "workflow dashboard should load");
    assert.ok(page.text.includes("流程审核工作台"), "workflow dashboard should show title");
    assert.ok(page.text.includes("业务类型汇总") && page.text.includes("最近处理记录") && page.text.includes("流程业务清单"), "workflow dashboard should include summary, logs and business list");
    assert.ok(page.text.includes("WF-DASH-VERIFY") && page.text.includes("流程工作台验证"), "workflow dashboard should show saved workflow business");
    assert.ok(page.text.includes("720.00"), "workflow dashboard should show adjusted manual measure money");
    assert.ok(page.text.includes(adjustRemark) && page.text.includes(returnReason), "workflow dashboard should show recent workflow logs");
    assert.ok(page.text.includes("/workflow/isSendSMSpage") && page.text.includes("/workflow/sms_record_page") && page.text.includes("/workflow/see_process_img"), "workflow dashboard should expose notification and process actions");
    assert.ok(page.text.includes("/manualMeasure/record_page") && page.text.includes("/manualMeasure/adjust_page") && page.text.includes("/manualMeasure/return_order_page"), "workflow dashboard should expose row actions");

    const filtered = await requestText("/workflow/dashboard_page?module=manualmeasure&state=退回");
    assert.ok(filtered.text.includes("WF-DASH-VERIFY") && filtered.text.includes("手动计量"), "workflow dashboard should filter by module and state");
  } finally {
    await postJson(`/manualMeasure/delete/${manualId}`, { ids: String(manualId) });
  }
}

async function verifyVariationArchiveLoop() {
  const archivePage = await requestText("/vary_measure/archive_upload_pic_page");
  assert.strictEqual(archivePage.response.status, 200, "variation archive page should load");
  assert.ok(archivePage.text.includes("archive-upload-form") && archivePage.text.includes("附件名称"), "variation archive page should render a clean archive form");

  const { json: varyJson } = await postJson("/vary_measure/save_measure", {
    varyNo: "BG-ARCHIVE-VERIFY",
    sectionId: 101,
    billId: 1,
    beforeNum: 1,
    beforePrice: 100,
    afterNum: 2,
    afterPrice: 150,
    varyReason: "归档验证",
    states: "审核中"
  });
  const varyId = varyJson.data.varyId;

  try {
    const { json: archiveJson } = await postJson("/vary_measure/save_archive_pic", {
      varyId,
      fileName: "归档照片-验证.jpg",
      remark: "现场签认资料"
    });
    assert.strictEqual(archiveJson.data.changed, 1, "archive save should update the selected variation");
    assert.strictEqual(archiveJson.data.state, "已归档", "archive save should expose clean archived state");

    const { json: listJson } = await requestJson("/vary_measure/list?page=1&limit=1000");
    const archived = listJson.data.find((row) => Number(row.varyId || row.id) === Number(varyId));
    assert.ok(archived, "archived variation should remain in list");
    assert.strictEqual(archived.states, "已归档", "archived variation should show clean archived state");
    assert.strictEqual(archived.archivePicName, "归档照片-验证.jpg", "archived variation should keep attachment name");

    const track = await requestText(`/vary_measure/track_page?measureType=varyapplication&ids=${varyId}`);
    assert.ok(track.text.includes("BG-ARCHIVE-VERIFY"), "archive workflow track should include variation number");
    assert.ok(track.text.includes("归档附件"), "archive workflow track should include archive action");
    assert.ok(track.text.includes("归档照片-验证.jpg"), "archive workflow track should include attachment name");
  } finally {
    await postJson(`/vary_measure/delete/${varyId}`, { varyIds: String(varyId) });
  }
}

async function verifyVariationDetailCrudLoop() {
  const { json } = await postJson("/vary_measure/save_measure", {
    varyNo: "BG-DETAIL-VERIFY",
    sectionId: 101,
    billId: 2,
    beforeNum: 100,
    beforePrice: 18.5,
    afterNum: 105,
    afterPrice: 19,
    varyReason: "变更明细验证"
  });
  const varyId = json.data.varyId;
  try {
    const detailForm = await requestText(`/vary_measure/edit_detail_page?varyId=${varyId}`);
    assert.strictEqual(detailForm.response.status, 200, "variation detail form should load");
    assert.ok(detailForm.text.includes("vary-detail-form") && detailForm.text.includes("/vary_detail/save"), "variation detail page should render a real save form");

    const savedDetail = await postJson("/vary_detail/save", {
      varyId,
      billId: 2,
      beforeNum: 100,
      beforePrice: 18.5,
      afterNum: 108,
      afterPrice: 20,
      varyReason: "变更明细保存验证"
    });
    assert.strictEqual(savedDetail.json.data.changed, 1, "variation detail save should update selected variation");
    assert.strictEqual(savedDetail.json.data.varyMoney, 310, "variation detail save should recalculate delta money");

    const listBeforeDelete = await requestJson(`/vary_detail/list?varyId=${varyId}&page=1&limit=100`);
    assert.ok(listBeforeDelete.json.data.some((row) => Number(row.varyId) === Number(varyId) && row.varyReason === "变更明细保存验证"), "variation detail list should include saved detail");

    const deleted = await postJson(`/vary_detail/delete/${varyId}`, {});
    assert.strictEqual(deleted.json.data.changed, 1, "variation detail delete should accept original delete URL style");
    const listAfterDelete = await requestJson(`/vary_detail/list?varyId=${varyId}&page=1&limit=100`);
    assert.ok(!listAfterDelete.json.data.some((row) => Number(row.varyId) === Number(varyId)), "deleted variation detail should be hidden from detail list");
  } finally {
    await postJson(`/vary_measure/delete/${varyId}`, { varyIds: String(varyId) });
  }
}

async function verifyOriginalWorkflowBatchSemanticsLoop() {
  const billNext = await postJson("/bill_measure/next_task_list", { billMeasureIds: "*" });
  assert.strictEqual(billNext.json.data, 3, "bill measure next_task_list should return original numeric task count");
  const billTaskRows = await requestJson("/bill_measure/next_task_rows");
  assert.ok(Array.isArray(billTaskRows.json.data) && billTaskRows.json.data.length >= 3, "bill measure task row endpoint should expose task details");

  const varyNext = await postJson("/vary_measure/next_task_list", { varyIds: "*" });
  assert.strictEqual(varyNext.json.data, 3, "variation next_task_list should return original numeric task count");
  const varyTaskRows = await requestJson("/vary_measure/next_task_rows");
  assert.ok(Array.isArray(varyTaskRows.json.data) && varyTaskRows.json.data.some((row) => row.taskName === "变更审批"), "variation task row endpoint should expose task details");

  const { json } = await postJson("/vary_measure/save_measure", {
    varyNo: "BG-WILDCARD-SAFE",
    sectionId: 101,
    billId: 2,
    beforeNum: 1,
    beforePrice: 100,
    afterNum: 2,
    afterPrice: 100,
    varyReason: "通配符删除保护验证"
  });
  const varyId = json.data.varyId;
  try {
    const deleted = await postJson("/vary_measure/delete/*", {});
    assert.strictEqual(deleted.json.data.changed, 0, "wildcard delete should not remove rows implicitly");
    const list = await requestJson("/vary_measure/list?page=1&limit=1000");
    assert.ok(list.json.data.some((row) => Number(row.varyId) === Number(varyId)), "temporary variation should survive wildcard delete protection");
  } finally {
    await postJson(`/vary_measure/delete/${varyId}`, { varyIds: String(varyId) });
  }
}

async function verifyVariationOrderReportLoop() {
  const { json } = await postJson("/vary_measure/save_measure", {
    varyNo: "BG-REPORT-VERIFY",
    sectionId: 101,
    billId: 2,
    beforeNum: 100,
    beforePrice: 18.5,
    afterNum: 112,
    afterPrice: 19,
    varyReason: "报表验证：现场工程量和综合单价同步调整"
  });
  const varyId = json.data.varyId;
  try {
    assert.strictEqual(json.data.row.varyMoney, 278, "temporary variation should calculate expected delta money");
    const report = await requestText(`/vary_measure/render_order_page?varyIds=${varyId}`);
    assert.ok(report.text.includes("工程变更申请报表"), "variation render page should show dedicated report title");
    assert.ok(report.text.includes("BG-REPORT-VERIFY"), "variation report should include variation number");
    assert.ok(report.text.includes("报表验证：现场工程量和综合单价同步调整"), "variation report should include reason");
    assert.ok(report.text.includes("278.00"), "variation report should include calculated variation money");
    assert.ok(report.text.includes("变更前数量") && report.text.includes("变更后金额"), "variation report should include before/after cost columns");
  } finally {
    await postJson(`/vary_measure/delete/${varyId}`, { varyIds: String(varyId) });
  }
}

async function verifyVariationPaymentDashboardLoop() {
  const { json } = await postJson("/vary_measure/save_measure", {
    varyNo: "BG-PAY-VERIFY",
    sectionId: 101,
    billId: 2,
    beforeNum: 100,
    beforePrice: 18.5,
    afterNum: 112,
    afterPrice: 19,
    varyReason: "变更支付验证"
  });
  const varyId = json.data.varyId;
  try {
    const dashboard = await requestText("/varyMeasurePay/dashboard_page?sectionId=101");
    assert.ok(dashboard.text.includes("变更支付看板"), "variation payment dashboard should show dedicated title");
    assert.ok(dashboard.text.includes("变更支付明细") && dashboard.text.includes("剩余变更支付"), "variation payment dashboard should include payment detail columns");
    assert.ok(dashboard.text.includes("BG-PAY-VERIFY"), "variation payment dashboard should include saved variation");
    assert.ok(dashboard.text.includes("278.00"), "variation payment dashboard should include variation delta money");
    assert.ok(dashboard.text.includes("已计变更支付") && dashboard.text.includes("支付比例"), "variation payment dashboard should expose paid amount and rate");
    const payList = await requestJson("/varyMeasurePay/get_vary_measure_list?page=1&limit=1000");
    const payRow = payList.json.data.find((row) => row.varyNo === "BG-PAY-VERIFY");
    assert.ok(payRow, "variation payment list should include saved variation");
    const gatherData = await requestJson(`/varyMeasurePay/get_gather_data?varyDetailId=${payRow.varyDetailId}`);
    assert.strictEqual(gatherData.json.code, 1, "variation gather data should use operation success response");
    const periodMoney = round(gatherData.json.data.reduce((sum, row) => sum + Number(row[2] || 0), 0));
    assert.strictEqual(periodMoney, 278, "variation gather period money should be paid variation delta, not measured quantity times after price");
    assert.ok(gatherData.json.data.some((row) => Number(row[1] || 0) > 0), "variation gather data should expose period quantity for charting");
    const detailArea = dashboard.text.slice(dashboard.text.indexOf("变更支付明细"));
    assert.ok(detailArea.includes("TJ-01 合同段"), "variation payment dashboard should show selected section rows");
    assert.ok(!detailArea.includes("<td>TJ-02 合同段</td>"), "variation payment dashboard section filter should exclude other section rows");
    const menu = await requestJson("/menu/left_menu?parentId=3");
    const flatMenu = JSON.stringify(menu.json.data);
    assert.ok(flatMenu.includes("varyMeasurePay/dashboard_page"), "variation payment dashboard should be reachable from left menu");
    const menuPage = await requestText("/sbr/sbr_com/700");
    assert.strictEqual(menuPage.response.status, 200, "variation payment dashboard should render through menu content route");
    assert.ok(menuPage.text.includes("varyMeasurePay/export_vary_measure_pay"), "variation payment menu page should expose export action");
  } finally {
    await postJson(`/vary_measure/delete/${varyId}`, { varyIds: String(varyId) });
  }
}

async function verifyVariationManagementDashboardLoop() {
  const { json } = await postJson("/vary_measure/save_measure", {
    varyNo: "BG-DASH-VERIFY",
    sectionId: 101,
    billId: 2,
    beforeNum: 100,
    beforePrice: 18.5,
    afterNum: 113,
    afterPrice: 20,
    varyReason: "工程变更管理看板验证"
  });
  const varyId = json.data.varyId;
  try {
    assert.strictEqual(json.data.row.varyMoney, 410, "variation dashboard seed should calculate expected delta");
    await postJson("/vary_measure/up_order", { varyIds: String(varyId) });
    await postJson("/vary_measure/agree_order", { varyId });

    const page = await requestText("/vary_measure/dashboard_page?sectionId=101");
    assert.strictEqual(page.response.status, 200, "variation management dashboard should load");
    assert.ok(page.text.includes("工程变更管理看板"), "variation management dashboard should show title");
    assert.ok(page.text.includes("变更令清单") && page.text.includes("变更清单明细") && page.text.includes("最近流程记录"), "variation management dashboard should include core panels");
    assert.ok(page.text.includes("BG-DASH-VERIFY") && page.text.includes("工程变更管理看板验证"), "variation management dashboard should include saved variation");
    assert.ok(page.text.includes("410.00"), "variation management dashboard should include calculated variation money");
    assert.ok(page.text.includes("已审核"), "variation management dashboard should show approved state");
    assert.ok(page.text.includes(`/vary_measure/edit_page?varyId=${varyId}`), "variation management dashboard should link edit page");
    assert.ok(page.text.includes(`/vary_measure/edit_detail_page?varyId=${varyId}`), "variation management dashboard should link detail page");
    assert.ok(page.text.includes(`/vary_measure/render_order_page?varyIds=${varyId}`), "variation management dashboard should link printable variation report");
    assert.ok(page.text.includes("/varyMeasurePay/dashboard_page") && page.text.includes("/bigVaryQuery/dashboard_page"), "variation management dashboard should link payment and major variation dashboards");

    const filtered = await requestText("/vary_measure/dashboard_page?sectionId=101&state=已审核");
    assert.ok(filtered.text.includes("BG-DASH-VERIFY") && filtered.text.includes("已审核"), "variation management dashboard should filter by state");

    const menu = await requestJson("/menu/left_menu?parentId=3");
    const flatMenu = JSON.stringify(menu.json.data);
    assert.ok(flatMenu.includes("工程变更管理看板") && flatMenu.includes("vary_measure/dashboard_page"), "variation management dashboard should be reachable from left menu");

    const menuPage = await requestText("/sbr/sbr_com/691");
    assert.ok(menuPage.text.includes("工程变更管理看板") && menuPage.text.includes("BG-DASH-VERIFY"), "variation management dashboard should render through menu content route");
  } finally {
    await postJson(`/vary_measure/delete/${varyId}`, { varyIds: String(varyId) });
  }
}

async function verifyQueryLedgerLoop() {
  const ledger = await requestText("/leaderquery/find_sub_item_page?nodeId=0");
  assert.strictEqual(ledger.response.status, 200, "leader sub-item ledger should load");
  assert.ok(ledger.text.includes("sub-item-ledger-table"), "leader sub-item ledger should render the dedicated ledger table");
  assert.ok(ledger.text.includes("分项台账") && ledger.text.includes("计量比例"), "leader sub-item ledger should expose summary columns");
  assert.ok(ledger.text.includes("合计"), "leader sub-item ledger should include totals");

  const tree = await requestJson("/billAnalyzeNode/tree");
  const node = tree.json.data.find((item) => Number(item.billCount || 0) > 0) || tree.json.data[0];
  assert.ok(node, "bill analyze tree should have at least one node");
  const filtered = await requestText(`/leaderquery/find_sub_item_page?nodeId=${node.nodeId}`);
  assert.ok(filtered.text.includes("sub-item-ledger-table"), "filtered sub-item ledger should render");
  assert.ok(filtered.text.includes(node.nodeName || node.name), "filtered sub-item ledger should include selected node name");
}

async function verifyBillAnalyzeDashboardLoop() {
  const treeBefore = await requestJson("/billAnalyzeNode/tree");
  const importForm = await requestText("/billAnalyze/import_analyze");
  assert.strictEqual(importForm.response.status, 200, "bill analyze import page should load");
  assert.ok(importForm.text.includes("bill-analyze-import-form") && importForm.text.includes('name="nodeNames"'), "bill analyze import should render a real import form");
  assert.ok(!importForm.text.includes("local-form-") && !importForm.text.trim().startsWith("{"), "bill analyze import page should not return generic form or raw JSON");

  const importResult = await postJson("/billAnalyze/import_analyze", {
    mode: "custom",
    nodeNames: "验证导入分项",
    assignBills: ""
  });
  assert.strictEqual(importResult.json.code, 1, "bill analyze import form submit should succeed");
  const treeAfterImport = await requestJson("/billAnalyzeNode/tree");
  const importedNode = treeAfterImport.json.data.find((row) => row.nodeName === "验证导入分项" || row.name === "验证导入分项");
  assert.ok(importedNode, "bill analyze custom import should create a node");
  await postJson("/billAnalyzeNode/delete_node", { ids: String(importedNode.nodeId || importedNode.id) });

  const originalBill = (await requestJson("/billAnalyze/get_bill_analyze_by_node_id?page=1&limit=1000")).json.data.find((row) => row.billNo === "101-1") || (await requestJson("/billAnalyze/get_bill_analyze_by_node_id?page=1&limit=1000")).json.data[0];
  assert.ok(originalBill, "bill analyze dashboard test needs at least one bill");
  const hangForm = await requestText(`/billAnalyze/edit_analyze?analyzeId=${originalBill.billId || originalBill.analyzeId}`);
  assert.ok(hangForm.text.includes("bill-analyze-hang-form") && hangForm.text.includes('name="nodeId"') && hangForm.text.includes('name="billIds"'), "bill analyze edit should render a real single-bill hang form");
  const originalNodeId = Number(originalBill.analyzeNodeId || 0);

  const { json: nodeJson } = await postJson("/billAnalyzeNode/save_node", {
    nodeName: "验证分项节点",
    parentId: 0,
    remark: "dashboard verify"
  });
  const nodeId = nodeJson.data.nodeId;
  try {
    const batchHangForm = await requestText(`/billAnalyze/edit_analyze?nodeId=${nodeId}`);
    assert.ok(batchHangForm.text.includes("bill-analyze-batch-hang-form") && batchHangForm.text.includes('name="billIds"'), "bill analyze node edit should render a batch hang form");
    await postJson("/billAnalyze/hang_bill", { nodeId, billIds: String(originalBill.billId || originalBill.analyzeId) });
    const page = await requestText(`/billAnalyze/dashboard_page?nodeId=${nodeId}`);
    assert.strictEqual(page.response.status, 200, "bill analyze dashboard should load");
    assert.ok(page.text.includes("分部分项管理"), "bill analyze dashboard should show dedicated title");
    assert.ok(page.text.includes("分项节点树") && page.text.includes("挂接清单") && page.text.includes("分项金额汇总"), "bill analyze dashboard should include tree, bill and ledger panels");
    assert.ok(page.text.includes("验证分项节点"), "bill analyze dashboard should include saved node");
    assert.ok(page.text.includes(originalBill.billNo) && page.text.includes(originalBill.billName), "bill analyze dashboard should include reassigned bill");
    assert.ok(page.text.includes("合同金额") && page.text.includes("计量比例"), "bill analyze dashboard should expose amount summary");
  } finally {
    if (originalNodeId > 0) {
      await postJson("/billAnalyze/hang_bill", { nodeId: originalNodeId, billIds: String(originalBill.billId || originalBill.analyzeId) });
    }
    await postJson("/billAnalyzeNode/delete_node", { ids: String(nodeId) });
  }

  const treeAfter = await requestJson("/billAnalyzeNode/tree");
  assert.ok(!treeAfter.json.data.some((row) => Number(row.nodeId) === Number(nodeId)), "temporary analyze node should be deleted");
  assert.ok(treeBefore.json.data.length <= treeAfter.json.data.length + 1, "bill analyze tree should remain available after cleanup");
}

async function verifyBigVaryQueryLoop() {
  const before = await requestJson("/bigVaryQuery/getBigVarQueryData?page=1&limit=100");
  const project = before.json.data[0];
  assert.ok(project, "big variation query should return at least one project row");
  const beforeMoney = Number(project.varyMoney || 0);
  const projectId = project.projectId;

  const chart = await requestJson(`/bigVaryQuery/get_vary_data_by_project?projectId=${projectId}`);
  assert.strictEqual(chart.json.code, 1, "big variation chart endpoint should succeed");
  assert.strictEqual(Number((Number(chart.json.data["一般变更"] || 0) + Number(chart.json.data["重大变更"] || 0)).toFixed(2)), beforeMoney, "big variation chart data should sum to project variation total");

  const detail = await requestText(`/bigVaryQuery/varyQueryDetial?projectId=${projectId}`);
  assert.ok(detail.text.includes("重大变更明细"), "big variation detail page should render title");
  assert.ok(detail.text.includes("变更等级") && detail.text.includes("变更前金额") && detail.text.includes("变更后金额"), "big variation detail page should include enhanced columns");

  const dashboard = await requestText(`/bigVaryQuery/dashboard_page?projectId=${projectId}`);
  assert.strictEqual(dashboard.response.status, 200, "big variation dashboard should load");
  assert.ok(dashboard.text.includes("重大变更查询看板"), "big variation dashboard should show title");
  assert.ok(dashboard.text.includes("项目变更汇总") && dashboard.text.includes("变更明细"), "big variation dashboard should show summary and detail panels");
  assert.ok(dashboard.text.includes("/bigVaryQuery/varyQueryDetial") && dashboard.text.includes("/mtilProjectQuer/dashboard_page"), "big variation dashboard should link to details and leadership query");

  const { json: saved } = await postJson("/vary_measure/save_measure", {
    varyNo: "BG-BIG-VERIFY",
    sectionId: 101,
    billId: 1,
    beforeNum: 1,
    beforePrice: 100000,
    afterNum: 5,
    afterPrice: 150000,
    varyReason: "重大变更查询验证",
    states: "审核中"
  });
  const varyId = saved.data.varyId;
  try {
    const after = await requestJson("/bigVaryQuery/getBigVarQueryData?page=1&limit=100");
    const afterProject = after.json.data.find((row) => Number(row.projectId) === Number(projectId));
    assert.ok(afterProject, "project should remain in big variation query after adding variation");
    assert.ok(Number(afterProject.majorVaryMoney || 0) > Number(project.majorVaryMoney || 0), "major variation money should increase after adding a major variation");

    const afterDetail = await requestText(`/bigVaryQuery/varyQueryDetial?projectId=${projectId}`);
    const afterDashboard = await requestText(`/bigVaryQuery/dashboard_page?projectId=${projectId}`);
    assert.ok(afterDashboard.text.includes("BG-BIG-VERIFY") && afterDashboard.text.includes("650,000.00"), "big variation dashboard should include newly added major variation and money");
    assert.ok(afterDetail.text.includes("BG-BIG-VERIFY") && afterDetail.text.includes("重大变更"), "big variation detail should include newly added major variation");

    const payList = await requestJson("/varyMeasurePay/get_vary_measure_list?page=1&limit=1000");
    const payRow = payList.json.data.find((row) => row.varyNo === "BG-BIG-VERIFY");
    assert.ok(payRow, "variation payment list should include newly added variation");
    assert.strictEqual(Number(payRow.varyMoney || 0), 650000, "variation payment list should keep variation delta money");
    assert.ok(Object.prototype.hasOwnProperty.call(payRow, "paidMoney") && Object.prototype.hasOwnProperty.call(payRow, "remainMoney"), "variation payment list should expose paid and remaining variation money");
    assert.ok(String(payRow.paymentFormula || "").includes("已计变更支付"), "variation payment list should explain payment formula");

    const payDashboard = await requestText("/varyMeasurePay/dashboard_page?sectionId=101");
    assert.ok(payDashboard.text.includes("BG-BIG-VERIFY") && payDashboard.text.includes("650,000.00"), "variation payment dashboard should include newly added variation");

    const gatherData = await requestJson(`/varyMeasurePay/get_gather_data?varyDetailId=${payRow.varyDetailId}`);
    assert.ok(Array.isArray(gatherData.json.data) && gatherData.json.data.length > 0, "variation gather data should return quantity and money curve data");

    const exportCsv = await requestText("/varyMeasurePay/export_vary_measure_pay");
    assert.ok(exportCsv.text.includes("BG-BIG-VERIFY") && exportCsv.text.includes("paidMoney") && exportCsv.text.includes("remainMoney"), "variation payment export should include progress columns");

    const orderReport = await requestText(`/vary_measure/render_order_page?varyIds=${varyId}`);
    assert.ok(orderReport.text.includes("BG-BIG-VERIFY") && orderReport.text.includes("650,000.00"), "variation order report should print the newly added variation");
  } finally {
    await postJson(`/vary_measure/delete/${varyId}`, { varyIds: String(varyId) });
  }
}

async function verifyMultiProjectQueryLoop() {
  const projects = await requestJson("/mtilProjectQuer/get_project_list_by_user?page=1&limit=20");
  assert.ok(projects.json.data.length > 0, "multi-project query should return project rows");
  const project = projects.json.data[0];

  const sections = await requestJson(`/mtilProjectQuer/query_section_list?page=1&limit=20&projectId=${project.projectId}`);
  assert.ok(sections.json.data.length > 0, "multi-project query should return section rows");
  const section = sections.json.data[0];

  const chart = await requestJson(`/mtilProjectQuer/get_section_data_by_project?projectId=${project.projectId}`);
  assert.strictEqual(chart.json.code, 1, "section chart data should succeed");
  assert.ok(Object.keys(chart.json.data).some((key) => key.includes("TJ-")), "section chart data should be keyed by section names");
  const chartTotal = Object.values(chart.json.data).reduce((sum, value) => sum + Number(value || 0), 0);
  const sectionTotal = sections.json.data.reduce((sum, row) => sum + Number(row.contractSumMoney || 0), 0);
  assert.strictEqual(Number(chartTotal.toFixed(2)), Number(sectionTotal.toFixed(2)), "section chart data should sum to section final money");

  const detail = await requestText(`/mtilProjectQuer/get_mutil_detail?sectionId=${section.sectionId}`);
  assert.ok(detail.text.includes("section-detail-dashboard"), "section detail should render a dedicated dashboard");
  assert.ok(detail.text.includes("标段详情") && detail.text.includes("累计支付") && detail.text.includes("支付比例"), "section detail should include business summary fields");
  assert.ok(detail.text.includes("材料到场") && (detail.text.includes("到场跟踪不计入应付") || detail.text.includes("材料设备垫付款") || detail.text.includes("预付率")), "section detail should include material arrival payment rule");
  assert.ok(detail.text.includes(section.sectionName), "section detail should include selected section name");

  const dashboard = await requestText(`/mtilProjectQuer/dashboard_page?projectId=${project.projectId}`);
  assert.strictEqual(dashboard.response.status, 200, "leadership query dashboard should load");
  assert.ok(dashboard.text.includes("多项目领导查询看板"), "leadership query dashboard should show title");
  assert.ok(dashboard.text.includes("项目列表") && dashboard.text.includes("标段信息") && dashboard.text.includes("项目变更概览"), "leadership query dashboard should show project, section, and variation panels");
  assert.ok(dashboard.text.includes(project.projectName) && dashboard.text.includes(section.sectionName), "leadership query dashboard should show selected project and section");
  assert.ok(dashboard.text.includes("/bigVaryQuery/dashboard_page") && dashboard.text.includes("/reportManager/dashboard_page"), "leadership query dashboard should link to variation and payment dashboards");
}

async function cleanupGatherVerifyData() {
  const isGatherVerifyRow = (row) => [
    row.periodDesc,
    row.gatherNo,
    row.gatherFileNo,
    row.gatherShow
  ].some((value) => /GQ-(VERIFY|DASH)|验证专用|楠岃瘉/.test(String(value || "")));
  const [measures, materialDias, arrivals, manuals, gathers] = await Promise.all([
    requestJson("/bill_measure/list?page=1&limit=500"),
    requestJson("/meterialdiasmeasure/meterial_dias_measure_list?page=1&limit=500"),
    requestJson("/meterialInMeasure/meterial_in_measure_list?page=1&limit=500"),
    requestJson("/manualMeasure/detail_list?page=1&limit=500"),
    requestJson("/sysGather/get_gather_data_list?page=1&limit=500")
  ]);
  for (const item of measures.json.data.filter((row) => String(row.measureNo || "").includes("GATHER-VERIFY"))) {
    await postJson(`/bill_measure/delete/${item.billMeasureId || item.measureId}`, { measureIds: String(item.billMeasureId || item.measureId) });
  }
  for (const item of materialDias.json.data.filter((row) => String(row.measureNo || "").includes("GATHER-VERIFY"))) {
    await postJson(`/meterialdiasmeasure/delete/${item.meterialDiasMeasureId || item.diasId || item.id}`, { ids: String(item.meterialDiasMeasureId || item.diasId || item.id) });
  }
  for (const item of arrivals.json.data.filter((row) => String(row.measureNo || "").includes("GATHER-VERIFY"))) {
    await postJson(`/meterialInMeasure/delete/${item.meterialInMeasureId || item.arrivalId || item.id}`, { ids: String(item.meterialInMeasureId || item.arrivalId || item.id) });
  }
  for (const item of manuals.json.data.filter((row) => String(row.measureNo || "").includes("GATHER-VERIFY"))) {
    await postJson(`/manualMeasure/delete/${item.manualMeasureId || item.manualId || item.id}`, { ids: String(item.manualMeasureId || item.manualId || item.id) });
  }
  for (const item of gathers.json.data.filter(isGatherVerifyRow)) {
    await postJson("/sysGather/del_gather", { ids: String(item.gatherId || item.id) });
  }
}

async function verifyGatherPeriodCalculationLoop() {
  await cleanupGatherVerifyData();
  const gatherForm = await requestText("/extend_gather");
  assert.ok(gatherForm.text.includes("gather-form") && gatherForm.text.includes("/sysGather/save_gather"), "extend gather page should render a real gather save form");

  const { json: gatherJson } = await postJson("/sysGather/save_gather", {
    periodDesc: "验证专用 4 月期",
    gatherFileNo: "GQ-VERIFY-APR",
    startDate: "2026-04-01",
    endDate: "2026-04-30"
  });
  const gatherId = gatherJson.data.gatherId;

  const { json: measureJson } = await postJson("/bill_measure/save_measure", {
    measureNo: "JL-GATHER-VERIFY",
    sectionId: 101,
    periodId: gatherId,
    measureDate: "2026-04-15",
    states: "审核中"
  });
  const measureId = measureJson.data.billMeasureId;
  await postJson("/bill_measure/save_detail", { billMeasureId: measureId, billId: 1, measureNum: 0.02 });

  const { json: materialJson } = await postJson("/meterialdiasmeasure/save_detail", {
    measureNo: "BC-GATHER-VERIFY",
    sectionId: 101,
    materialId: 1,
    quantity: 2,
    measureDate: "2026-04-16",
    states: "审核中"
  });
  const diasId = materialJson.data.meterialDiasMeasureId;

  const { json: arrivalJson } = await postJson("/meterialInMeasure/save_detail", {
    measureNo: "DC-GATHER-VERIFY",
    sectionId: 101,
    materialId: 1,
    quantity: 0.5,
    measureDate: "2026-04-18",
    states: "审核中"
  });
  assert.strictEqual(arrivalJson.data.row.money, 2190, "period material arrival should calculate quantity times current price");

  const { json: manualJson } = await postJson("/manualMeasure/save_measure", {
    measureNo: "SD-GATHER-VERIFY",
    sectionId: 101,
    billNo: "900-GQ",
    billName: "验证期次手动计量",
    measureUnit: "项",
    measureNum: 1,
    price: 321,
    measureDate: "2026-04-17",
    states: "审核中"
  });
  const manualId = manualJson.data.manualMeasureId;

  const { json: checkJson } = await postJson("/dataGather/data_check_gather", { gatherId });
  const summary = checkJson.data.summary;
  assert.strictEqual(summary.billMeasureCount, 1, "gather should include only one bill measure in this period");
  assert.strictEqual(summary.materialAdjustCount, 1, "gather should include only one material adjustment in this period");
  assert.strictEqual(summary.materialArrivalCount, 1, "gather should include one material arrival in this period");
  assert.strictEqual(summary.manualMeasureCount, 1, "gather should include only one manual measure in this period");
  assert.strictEqual(summary.billMeasureMoney, 3700, "period bill measure money should match bill detail");
  assert.strictEqual(summary.materialAdjustMoney, 560, "period material adjustment should use quantity times price difference");
  assert.strictEqual(summary.materialArrivalMoney, 2190, "period material arrival should be tracked separately");
  assert.strictEqual(summary.materialAdvanceMoney, 1314, "period material arrival should create 60% material advance");
  assert.strictEqual(summary.retentionMoney, 458.1, "period should deduct 10% retention from subtotal plus price adjustment");
  assert.strictEqual(summary.manualMoney, 321, "period manual measure money should match manual detail");
  assert.strictEqual(summary.payableMoney, 5436.9, "period payable money should follow JL104 formula");
  assert.strictEqual(summary.auditSubmitMoney, 5436.9, "period audit submit money should start from payable money");
  assert.strictEqual(summary.auditFinalMoney, round(5436.9 * 0.985), "period audit final money should apply the audit chain");
  assert.strictEqual(summary.auditDeductionMoney, round(5436.9 - (5436.9 * 0.985)), "period audit deduction should equal submit minus final audit");

  const { json: collectJson } = await postJson("/dataGather/data_collect_gather", { gatherId });
  assert.strictEqual(collectJson.data.collected, true, "gather collection should create a snapshot");
  assert.strictEqual(collectJson.data.snapshot.materialArrivalMoney, 2190, "collected snapshot should keep material arrival tracking money");
  assert.strictEqual(collectJson.data.snapshot.materialAdvanceMoney, 1314, "collected snapshot should keep material advance money");
  assert.strictEqual(collectJson.data.snapshot.auditFinalMoney, round(5436.9 * 0.985), "collected snapshot should keep final audit money");
  assert.strictEqual(collectJson.data.snapshot.auditDeductionMoney, round(5436.9 - (5436.9 * 0.985)), "collected snapshot should keep audit deduction");
  const gatherRowsAfterCollect = await requestJson("/sysGather/get_gather_data_list?page=1&limit=1000");
  const collectedGather = gatherRowsAfterCollect.json.data.find((row) => Number(row.gatherId || row.id) === Number(gatherId));
  assert.ok(collectedGather, "collected gather period should remain queryable");
  assert.strictEqual(Number(collectedGather.auditFinalMoney || 0), round(5436.9 * 0.985), "gather period row should persist final audit money");

  const { json: nextGatherJson } = await postJson("/sysGather/save_gather", {
    periodDesc: "验证专用 5 月期",
    gatherFileNo: "GQ-VERIFY-MAY",
    startDate: "2026-05-01",
    endDate: "2026-05-31"
  });
  const nextGatherId = nextGatherJson.data.gatherId;
  const nextInheritance = await requestJson(`/api/payment/jl_period_inheritance?periodId=${nextGatherId}&sectionId=101`);
  assert.strictEqual(nextInheritance.json.code, 1, "new gather period inheritance API should return success");
  assert.ok(nextInheritance.json.data.ok, "new gather period should inherit previous cumulative JL105 values");
  assert.strictEqual(Number(nextInheritance.json.data.previousPeriodId), Number(gatherId), "new gather period should compare against the immediately previous gather period");
  const inheritedBill = nextInheritance.json.data.rows.find((row) => Number(row.billId) === 1);
  assert.ok(inheritedBill, "new gather period inheritance should include the measured bill row");
  assert.strictEqual(round(inheritedBill.actualPreviousQuantity, 3), round(inheritedBill.expectedPreviousQuantity, 3), "new gather period should inherit previous cumulative quantity");
  assert.strictEqual(round(inheritedBill.actualPreviousAmount), round(inheritedBill.expectedPreviousAmount), "new gather period should inherit previous cumulative amount");

  const rulesBeforeCoverage = await requestJson("/api/admin/calculation_rules");
  const originalCoverageRules = rulesBeforeCoverage.json.data.rules;
  try {
    await postJson("/api/admin/calculation_rules", {
      ...originalCoverageRules,
      jlPriceAdjustmentCoverageMode: "previous",
      jlPriceAdjustmentCoveragePeriods: 1,
      changeReason: "自动回归验证跨期调差覆盖"
    });
    const coveredAdjustment = await requestJson(`/api/payment/jl_price_adjustment?periodId=${nextGatherId}&sectionId=101`);
    assert.strictEqual(coveredAdjustment.json.code, 1, "previous-period JL108 coverage API should succeed");
    assert.strictEqual(round(coveredAdjustment.json.data.totalAdjustment), 560, "previous-period JL108 coverage should settle April material adjustment into May");
    assert.strictEqual(coveredAdjustment.json.data.coverage.mode, "previous", "previous-period JL108 coverage should report previous mode");
    assert.ok(coveredAdjustment.json.data.coverage.sourcePeriodIds.map(Number).includes(Number(gatherId)), "previous-period JL108 coverage should include the April source period");
    const coveredCertificate = await requestJson(`/api/payment/certificate?periodId=${nextGatherId}&sectionId=101`);
    assert.strictEqual(round(coveredCertificate.json.data.priceAdjustment), 560, "JL104 price adjustment should use the same JL108 coverage window");
  } finally {
    await postJson("/api/admin/calculation_rules", { ...originalCoverageRules, changeReason: "自动回归恢复跨期调差规则" });
  }

  const dashboard = await requestText(`/dataGather/gather_dashboard_page?gatherId=${gatherId}`);
  assert.ok(dashboard.text.includes("期次数据汇总"), "gather dashboard should show dedicated title");
  assert.ok(dashboard.text.includes("清单计量") && dashboard.text.includes("材料补差") && dashboard.text.includes("材料到场") && dashboard.text.includes("手动计量"), "gather dashboard should include current-period components");
  assert.ok(dashboard.text.includes("2,190.00"), "gather dashboard should show period material arrival tracking money");
  assert.ok(dashboard.text.includes("最近采集快照") && dashboard.text.includes("材料到场"), "gather snapshot table should include material arrival tracking column");
  assert.ok(dashboard.text.includes("5,436.90"), "gather dashboard should show period payable money");
  assert.ok(dashboard.text.includes("最终审核") && dashboard.text.includes("本期核减"), "gather dashboard should show audit cards");
  assert.ok(dashboard.text.includes(moneyTextForVerify(round(5436.9 * 0.985))), "gather dashboard should show final audit money");
  assert.ok(dashboard.text.includes("最近采集快照") && dashboard.text.includes(String(collectJson.data.snapshotId)), "gather dashboard should show latest snapshot");

  await cleanupGatherVerifyData();
}

async function verifySysGatherDashboardLoop() {
  await cleanupGatherVerifyData();
  const { json: gatherJson } = await postJson("/sysGather/save_gather", {
    gatherNo: "GQ-DASH-NO",
    periodDesc: "验证专用工期看板",
    gatherFileNo: "GQ-DASH-VERIFY",
    startDate: "2026-05-01",
    endDate: "2026-05-31",
    collectTime: "2026-06-01",
    gatherShow: "工期看板说明",
    remark: "工期备注验证"
  });
  const gatherId = gatherJson.data.gatherId;
  try {
    const editPage = await requestText(`/sysGather/edit_gatherData_page?gatherId=${gatherId}`);
    assert.ok(editPage.text.includes("gather-form"), "system gather edit page should render a real form");
    assert.ok(editPage.text.includes('name="gatherNo"') && editPage.text.includes('name="collectTime"') && editPage.text.includes('name="remark"'), "system gather edit page should include original period number, collect time and remark fields");
    assert.ok(editPage.text.includes("GQ-DASH-NO") && editPage.text.includes("2026-06-01") && editPage.text.includes("工期备注验证"), "system gather edit page should echo saved period metadata");
    await postJson("/sysGather/updateGatherNo", { gatherId, gatherFileNo: "GQ-DASH-VERIFY-UPDATED" });
    await postJson("/sysGather/updateGatherShow", { gatherId, gatherShow: "工期看板说明已更新" });
    await postJson("/sysGather/update_gather_state", { gatherId, gatherState: 0 });
    const listAfterUpdate = await requestJson("/sysGather/get_gather_data_list?page=1&limit=1000");
    const savedGather = listAfterUpdate.json.data.find((row) => Number(row.gatherId || row.id) === Number(gatherId));
    assert.ok(savedGather, "system gather list should include saved period");
    assert.strictEqual(savedGather.gatherNo, "GQ-DASH-NO", "system gather list should keep period number");
    assert.strictEqual(savedGather.collectTime, "2026-06-01", "system gather list should keep collect time");
    assert.strictEqual(savedGather.remark, "工期备注验证", "system gather list should keep remark");
    let page = await requestText("/sysGather/dashboard_page");
    assert.strictEqual(page.response.status, 200, "system gather dashboard should load");
    assert.ok(page.text.includes("工期汇总管理看板"), "system gather dashboard should show title");
    assert.ok(page.text.includes("工期列表") && page.text.includes("采集快照"), "system gather dashboard should include period and snapshot panels");
    assert.ok(page.text.includes("材料到场") && page.text.includes("到场数"), "system gather dashboard should include material arrival snapshot columns");
    assert.ok(page.text.includes("最终审核") && page.text.includes("累计核减"), "system gather dashboard should include audit summary cards");
    assert.ok(page.text.includes("验证专用工期看板") && page.text.includes("GQ-DASH-VERIFY-UPDATED"), "system gather dashboard should show saved period and updated file number");
    assert.ok(page.text.includes("工期看板说明已更新") && page.text.includes("锁定"), "system gather dashboard should show updated description and locked state");
    assert.ok(page.text.includes("/sysGather/edit_gatherData_page") && page.text.includes("/dataGather/gather_dashboard_page") && page.text.includes("/reportManager/dashboard_page"), "system gather dashboard should expose period, collect and report actions");
    const menu = await requestJson("/menu/left_menu?parentId=2");
    const flatMenu = JSON.stringify(menu.json.data);
    assert.ok(flatMenu.includes("sysGather/dashboard_page") && flatMenu.includes("dataGather/gather_dashboard_page"), "gather dashboards should be reachable from left menu");
    const sysMenuPage = await requestText("/sbr/sbr_com/697");
    assert.strictEqual(sysMenuPage.response.status, 200, "system gather dashboard should render through menu content route");
    assert.ok(sysMenuPage.text.includes("/sysGather/edit_gatherData_page") && sysMenuPage.text.includes("/dataGather/gather_dashboard_page"), "system gather menu page should expose gather actions");
    const dataMenuPage = await requestText("/sbr/sbr_com/698");
    assert.strictEqual(dataMenuPage.response.status, 200, "data gather dashboard should render through menu content route");
    assert.ok(dataMenuPage.text.includes("/dataGather/data_collect_gather") && dataMenuPage.text.includes("/reportManager/dashboard_page"), "data gather menu page should expose collect and report actions");

    await postJson("/sysGather/update_gather_state", { gatherId, gatherState: 1 });
    await postJson("/dataGather/data_collect_gather", { gatherId });
    page = await requestText("/sysGather/dashboard_page");
    assert.ok(page.text.includes("启用") && page.text.includes("验证专用工期看板"), "system gather dashboard should show enabled state after update");
    assert.ok(page.text.includes("采集快照") && page.text.includes("GQ-DASH-VERIFY") && page.text.includes("材料到场"), "system gather dashboard should show collected snapshot with material arrival tracking");
    assert.ok(page.text.includes("最终审核") && page.text.includes("累计核减"), "system gather dashboard should keep audit cards after collection");
  } finally {
    await postJson("/sysGather/del_gather", { ids: String(gatherId) });
  }
}

async function cleanupFinancialChainVerifyData() {
  const [measures, materialDias, arrivals, manuals, variations, gathers] = await Promise.all([
    requestJson("/bill_measure/list?page=1&limit=1000"),
    requestJson("/meterialdiasmeasure/meterial_dias_measure_list?page=1&limit=1000"),
    requestJson("/meterialInMeasure/meterial_in_measure_list?page=1&limit=1000"),
    requestJson("/manualMeasure/detail_list?page=1&limit=1000"),
    requestJson("/vary_measure/list?page=1&limit=1000"),
    requestJson("/sysGather/get_gather_data_list?page=1&limit=1000")
  ]);
  for (const item of measures.json.data.filter((row) => String(row.measureNo || "").includes("CHAIN-VERIFY"))) {
    await postJson("/bill_measure/delete", { billMeasureIds: String(item.billMeasureId || item.measureId) });
  }
  for (const item of materialDias.json.data.filter((row) => String(row.measureNo || "").includes("CHAIN-VERIFY"))) {
    await postJson("/meterialdiasmeasure/delete", { meterialDiasMeasureIds: String(item.meterialDiasMeasureId || item.diasId || item.id) });
  }
  for (const item of arrivals.json.data.filter((row) => String(row.measureNo || "").includes("CHAIN-VERIFY"))) {
    await postJson("/meterialInMeasure/delete", { meterialInMeasureIds: String(item.meterialInMeasureId || item.arrivalId || item.id) });
  }
  for (const item of manuals.json.data.filter((row) => String(row.measureNo || "").includes("CHAIN-VERIFY"))) {
    await postJson("/manualMeasure/delete", { manualMeasureIds: String(item.manualMeasureId || item.manualId || item.id) });
  }
  for (const item of variations.json.data.filter((row) => String(row.varyNo || "").includes("CHAIN-VERIFY"))) {
    await postJson("/vary_measure/delete", { varyIds: String(item.varyId || item.id) });
  }
  for (const item of gathers.json.data.filter((row) => String(row.gatherFileNo || row.gatherNo || row.periodDesc || "").includes("CHAIN-VERIFY"))) {
    await postJson("/sysGather/del_gather", { ids: String(item.gatherId || item.id) });
  }
}

function sectionReconcile(data, sectionId) {
  return (data.sections || []).find((row) => Number(row.sectionId || 0) === Number(sectionId)) || {};
}

async function verifyFinancialChainIntegrationLoop() {
  await cleanupFinancialChainVerifyData();
  const before = (await requestJson("/api/cost/reconciliation")).json.data;
  const beforeSection = sectionReconcile(before, 101);
  const beforeAudit = Number(before.auditTotals.submit || 0);

  const { json: gatherJson } = await postJson("/sysGather/save_gather", {
    periodDesc: "CHAIN-VERIFY 2036-01",
    gatherFileNo: "CHAIN-VERIFY-GQ",
    startDate: "2036-01-01",
    endDate: "2036-01-31"
  });
  const gatherId = gatherJson.data.gatherId;

  const expected = {
    billMeasureMoney: 1850,
    materialAdjustMoney: 280,
    materialArrivalMoney: 1095,
    manualMoney: 123,
    varyMoney: 560
  };
  expected.materialAdvanceMoney = round(expected.materialArrivalMoney * 0.6);
  expected.retentionMoney = round((expected.billMeasureMoney + expected.materialAdjustMoney + expected.manualMoney) * 0.1);
  expected.payableMoney = round(expected.billMeasureMoney + expected.materialAdjustMoney + expected.manualMoney + expected.materialAdvanceMoney - expected.retentionMoney);

  let measureId = 0;
  let diasId = 0;
  let arrivalId = 0;
  let manualId = 0;
  let varyId = 0;
  try {
    const { json: measureJson } = await postJson("/bill_measure/save_measure", {
      measureNo: "CHAIN-VERIFY-BILL",
      sectionId: 101,
      periodId: gatherId,
      measureDate: "2036-01-10",
      states: "已审核"
    });
    measureId = measureJson.data.billMeasureId;
    await postJson("/bill_measure/save_detail", { billMeasureId: measureId, billId: 1, measureNum: 0.01 });

    const { json: diasJson } = await postJson("/meterialdiasmeasure/save_detail", {
      measureNo: "CHAIN-VERIFY-DIAS",
      sectionId: 101,
      materialId: 1,
      quantity: 1,
      measureDate: "2036-01-11",
      states: "已审核"
    });
    diasId = diasJson.data.meterialDiasMeasureId;

    const { json: arrivalJson } = await postJson("/meterialInMeasure/save_detail", {
      measureNo: "CHAIN-VERIFY-ARRIVAL",
      sectionId: 101,
      materialId: 1,
      quantity: 0.25,
      measureDate: "2036-01-12",
      states: "已更新"
    });
    arrivalId = arrivalJson.data.meterialInMeasureId;

    const { json: manualJson } = await postJson("/manualMeasure/save_measure", {
      measureNo: "CHAIN-VERIFY-MANUAL",
      sectionId: 101,
      billNo: "CHAIN-MANUAL",
      billName: "联动验证手动计量",
      measureUnit: "项",
      measureNum: 1,
      price: 123,
      measureDate: "2036-01-13",
      states: "已更新"
    });
    manualId = manualJson.data.manualMeasureId;

    const { json: varyJson } = await postJson("/vary_measure/save_measure", {
      varyNo: "CHAIN-VERIFY-VARY",
      sectionId: 101,
      billId: 1,
      beforeNum: 10,
      beforePrice: 100,
      afterNum: 12,
      afterPrice: 130,
      varyReason: "联动验证工程变更",
      measureDate: "2036-01-14",
      states: "已审核"
    });
    varyId = varyJson.data.varyId;
    assert.strictEqual(varyJson.data.row.varyMoney, expected.varyMoney, "variation should calculate before/after delta money");

    const { json: checkJson } = await postJson("/dataGather/data_check_gather", { gatherId });
    const gather = checkJson.data.summary;
    assert.strictEqual(gather.billMeasureMoney, expected.billMeasureMoney, "financial chain gather should include bill measure money");
    assert.strictEqual(gather.materialAdjustMoney, expected.materialAdjustMoney, "financial chain gather should include material adjustment money");
    assert.strictEqual(gather.materialArrivalMoney, expected.materialArrivalMoney, "financial chain gather should track material arrival money");
    assert.strictEqual(gather.materialAdvanceMoney, expected.materialAdvanceMoney, "financial chain gather should include material advance money");
    assert.strictEqual(gather.retentionMoney, expected.retentionMoney, "financial chain gather should deduct retention money");
    assert.strictEqual(gather.manualMoney, expected.manualMoney, "financial chain gather should include manual measure money");
    assert.strictEqual(gather.varyMoney, expected.varyMoney, "financial chain gather should include variation money by business date");
    assert.strictEqual(gather.payableMoney, expected.payableMoney, "financial chain gather payable should follow JL104 formula and exclude variation");

    const { json: collectJson } = await postJson("/dataGather/data_collect_gather", { gatherId });
    assert.strictEqual(collectJson.data.snapshot.payableMoney, expected.payableMoney, "financial chain snapshot should persist payable money");
    assert.strictEqual(collectJson.data.snapshot.materialArrivalMoney, expected.materialArrivalMoney, "financial chain snapshot should persist material arrival tracking");
    assert.strictEqual(collectJson.data.snapshot.varyMoney, expected.varyMoney, "financial chain snapshot should persist variation money");

    const after = (await requestJson("/api/cost/reconciliation")).json.data;
    const afterSection = sectionReconcile(after, 101);
    assert.strictEqual(round(afterSection.totalPayMoney - beforeSection.totalPayMoney), expected.payableMoney, "section payment summary should increase by payable components only");
    assert.strictEqual(round(afterSection.materialArrivalMoney - beforeSection.materialArrivalMoney), expected.materialArrivalMoney, "section summary should track material arrival outside payable");
    assert.strictEqual(round(after.auditTotals.submit - beforeAudit), expected.payableMoney, "audit submit total should increase by payable components");
    assert.strictEqual(round(after.moduleTotals.payableMoney - before.moduleTotals.payableMoney), expected.payableMoney, "global payable should increase by payable components");
    assert.strictEqual(round(after.moduleTotals.materialArrivalMoney - before.moduleTotals.materialArrivalMoney), expected.materialArrivalMoney, "global material arrival tracking should increase separately");
    assert.strictEqual(round(after.moduleTotals.varyMoney - before.moduleTotals.varyMoney), expected.varyMoney, "global variation money should increase by engineering variation");
    assert.strictEqual(after.ok, true, "reconciliation should remain valid after cross-module additions");
  } finally {
    if (measureId) await postJson("/bill_measure/delete", { billMeasureIds: String(measureId) });
    if (diasId) await postJson("/meterialdiasmeasure/delete", { meterialDiasMeasureIds: String(diasId) });
    if (arrivalId) await postJson("/meterialInMeasure/delete", { meterialInMeasureIds: String(arrivalId) });
    if (manualId) await postJson("/manualMeasure/delete", { manualMeasureIds: String(manualId) });
    if (varyId) await postJson("/vary_measure/delete", { varyIds: String(varyId) });
    if (gatherId) await postJson("/sysGather/del_gather", { ids: String(gatherId) });
  }
}

async function verifyChineseSamples() {
  const samples = [
    "/bill_measure/list?page=1&limit=2",
    "/meterialdiasmeasure/meterial_dias_measure_list?page=1&limit=2",
    "/manualMeasure/detail_list?page=1&limit=2",
    "/vary_measure/list?page=1&limit=2",
    "/engineering_contact_bill/list?page=1&limit=2",
    "/mtilProjectQuer/get_project_list_by_user?page=1&limit=2",
    "/mtilProjectQuer/query_section_list?page=1&limit=2",
    "/syzl/list?page=1&limit=2"
  ];
  const mojibakeTokens = ["閸", "閺", "瀹", "瀵", "鐎", "缁", "缂", "濞", "鐠", "闁"];
  const bad = [];
  for (const url of samples) {
    const { text } = await requestText(url);
    if (mojibakeTokens.some((token) => text.includes(token))) bad.push({ url, sample: text.slice(0, 240) });
  }
  assert.deepStrictEqual(bad, [], `Chinese sample responses contain mojibake: ${JSON.stringify(bad, null, 2)}`);
}

async function verifyDocumentNodeLoop() {
  const addPage = await requestText("/oaDataNode/add_data_node_page");
  assert.strictEqual(addPage.response.status, 200, "document add page should load");
  assert.ok(addPage.text.includes("document-form") && addPage.text.includes("资料名称"), "document add page should render a real Chinese form");

  const hangPage = await requestText("/projectInformationNode/hang_page");
  assert.strictEqual(hangPage.response.status, 200, "project information hang page should load");
  assert.ok(hangPage.text.includes("project-information-hang-form"), "hang page should render a real form");

  const first = await postJson("/oaDataNode/save_data_node", {
    title: "验证资料节点A",
    dataNo: "ZL-DOC-A",
    type: "工程资料",
    parentId: 0,
    fileCount: 2,
    remark: "document loop"
  });
  const second = await postJson("/oaDataNode/save_data_node", {
    title: "验证资料节点B",
    dataNo: "ZL-DOC-B",
    type: "工程资料",
    parentId: 0,
    fileCount: 1,
    remark: "document loop"
  });
  const firstId = first.json.data.nodeId;
  const secondId = second.json.data.nodeId;

  try {
    const treeBefore = await requestJson("/projectInformationNode/get_node_tree");
    const idsBefore = treeBefore.json.data.map((item) => Number(item.nodeId || item.id));
    assert.ok(idsBefore.includes(firstId) && idsBefore.includes(secondId), "saved document nodes should appear in project tree");
    assert.ok(idsBefore.indexOf(firstId) < idsBefore.indexOf(secondId), "document nodes should be appended in save order");

    const hangRows = await requestJson("/projectInformationNode/find_hang_param?page=1&limit=500");
    const savedHang = hangRows.json.data.find((item) => Number(item.hangId || item.nodeId) === Number(secondId));
    assert.ok(savedHang, "saved document should appear in hang rows");
    assert.strictEqual(savedHang.projectInformationParam.dataName, "验证资料节点B", "hang row should expose saved document name");

    const attachmentPage = await requestText(`/project_information_hang_file/page?id=${secondId}`);
    assert.strictEqual(attachmentPage.response.status, 200, "project information attachment page should load");
    assert.ok(attachmentPage.text.includes("document-attachment-form") && attachmentPage.text.includes("附件名称"), "project information attachment page should render upload form");

    const attachment = await postJson("/projectInformationNode/upload_attachment", {
      hangId: secondId,
      fileName: "验证资料附件.docx",
      size: 2048,
      remark: "资料附件验证"
    });
    assert.strictEqual(attachment.json.data.changed, 1, "project information attachment upload should save metadata");
    const attachmentId = attachment.json.data.attachmentId;
    const attachmentRows = await requestJson(`/projectInformationNode/attachment_list?hangId=${secondId}&page=1&limit=100`);
    assert.ok(attachmentRows.json.data.some((row) => Number(row.attachmentId) === Number(attachmentId) && row.fileName === "验证资料附件.docx"), "project information attachment list should include uploaded file");
    const hangRowsAfterAttachment = await requestJson("/projectInformationNode/find_hang_param?page=1&limit=500");
    const hangWithAttachment = hangRowsAfterAttachment.json.data.find((item) => Number(item.hangId || item.nodeId) === Number(secondId));
    assert.ok(Number(hangWithAttachment.fileCount || 0) >= 1, "project information hang row should reflect attachment count");
    const zipWithAttachment = await requestBuffer(`/oaDataNode/downLoadZipFile?nodeId=${secondId}`);
    assert.ok(zipWithAttachment.buffer.toString("utf8").includes("验证资料附件.docx"), "selected document ZIP should include uploaded attachment metadata");

    const deletedAttachment = await postJson("/projectInformationNode/delete_attachment", { hangId: secondId, attachmentId });
    assert.strictEqual(deletedAttachment.json.data.changed, 1, "project information attachment delete should remove metadata");
    const attachmentRowsAfterDelete = await requestJson(`/projectInformationNode/attachment_list?hangId=${secondId}&page=1&limit=100`);
    assert.ok(!attachmentRowsAfterDelete.json.data.some((row) => Number(row.attachmentId) === Number(attachmentId)), "deleted project information attachment should disappear from list");

    const powerPage = await requestText(`/oaDataNode/get_node_user_power_page?nodeId=${secondId}`);
    assert.strictEqual(powerPage.response.status, 200, "document power page should load");
    assert.ok(powerPage.text.includes('id="document-power-form"'), "document power page should render a real permissions form");
    assert.ok(powerPage.text.includes('name="powerUsers"') && powerPage.text.includes("权限项"), "document power page should expose users and permission items");

    const savedPower = await postJson("/oaDataNode/save_node_user_power", {
      nodeId: secondId,
      powerUsers: "ys1,资料员,项目经理",
      permissions: ["上传", "下载", "编辑", "删除"],
      powerRemark: "验证资料节点权限"
    });
    assert.strictEqual(savedPower.json.data.changed, 1, "document power save should update selected node");
    assert.strictEqual(savedPower.json.data.row.permissions, "上传,下载,编辑,删除", "document row should expose saved permissions");

    await postJson("/oaDataNode/move_node", { nodeId: secondId, type: 1 });
    const treeAfterMove = await requestJson("/projectInformationNode/get_node_tree");
    const idsAfterMove = treeAfterMove.json.data.map((item) => Number(item.nodeId || item.id));
    assert.ok(idsAfterMove.indexOf(secondId) < idsAfterMove.indexOf(firstId), "move_node type=1 should move the node up among siblings");

    const selectedZip = await requestBuffer(`/oaDataNode/downLoadZipFile?nodeId=${secondId}`);
    assert.strictEqual(selectedZip.response.status, 200, "selected document ZIP should download");
    assert.strictEqual(selectedZip.buffer.slice(0, 2).toString("ascii"), "PK", "selected document ZIP should have ZIP header");
    const zipText = selectedZip.buffer.toString("utf8");
    assert.ok(zipText.includes("documents/") && zipText.includes("验证资料节点B"), "selected ZIP should include exported document detail file");
    assert.ok(!zipText.includes("验证资料节点A"), "selected ZIP should only include requested document");
  } finally {
    await postJson("/oaDataNode/delete_data_node", { ids: `${firstId},${secondId}` });
  }
}

async function verifyDocumentDashboardLoop() {
  const projectDoc = await postJson("/oaDataNode/save_data_node", {
    title: "资料看板验证",
    dataNo: "ZL-DASH-VERIFY",
    type: "工程资料",
    parentId: 0,
    fileCount: 2,
    remark: "document dashboard verify"
  });
  const testDoc = await postJson("/syzl/save", {
    title: "试验资料看板验证",
    dataNo: "SY-DASH-VERIFY",
    type: "试验资料",
    testHouseName: "中心试验室",
    testName: "混凝土抗压强度",
    fileCount: 3,
    formMode: "syzl"
  });
  const ids = [projectDoc.json.data.nodeId, testDoc.json.data.nodeId].filter(Boolean);

  try {
    const dashboard = await requestText("/projectInformationNode/dashboard_page");
    assert.strictEqual(dashboard.response.status, 200, "project document dashboard should load");
    assert.ok(dashboard.text.includes("项目资料管理看板"), "document dashboard should have a Chinese title");
    assert.ok(dashboard.text.includes("资料节点树") && dashboard.text.includes("资料挂接明细") && dashboard.text.includes("试验资料"), "document dashboard should show core document panels");
    assert.ok(dashboard.text.includes("资料看板验证") && dashboard.text.includes("ZL-DASH-VERIFY"), "document dashboard should show saved project document");
    assert.ok(dashboard.text.includes("试验资料看板验证") && dashboard.text.includes("SY-DASH-VERIFY"), "document dashboard should show saved test document");
    assert.ok(dashboard.text.includes("中心试验室") && dashboard.text.includes("混凝土抗压强度"), "document dashboard should show test metadata");
    assert.ok(dashboard.text.includes("/oaDataNode/downLoadZipFile") && dashboard.text.includes("/oaDataNode/add_data_node_page") && dashboard.text.includes("/syzl/edit_page"), "document dashboard should expose expected actions");

    const syzlDashboard = await requestText("/syzl/dashboard_page");
    assert.strictEqual(syzlDashboard.response.status, 200, "test document dashboard should load");
    assert.ok(syzlDashboard.text.includes("试验资料管理看板"), "syzl dashboard should have a test-document title");
    assert.ok(syzlDashboard.text.includes("试验资料看板验证") && syzlDashboard.text.includes("SY-DASH-VERIFY"), "syzl dashboard should show saved test document");
    assert.ok(!syzlDashboard.text.includes("ZL-DASH-VERIFY"), "syzl dashboard recent list should focus on test documents");

    const documentMenuPages = [
      { url: "/sbr/sbr_com/411", title: "建设单位工程资料", marker: "开工报告", view: "unit-建设单位工程资料" },
      { url: "/sbr/sbr_com/568", title: "试验室内部资料", marker: "试验检测资料", view: "syzl" },
      { url: "/sbr/sbr_com/640", title: "施工质检类资料", marker: "路基压实度检验评定表", view: "quality-施工质检类资料" },
      { url: "/sbr/sbr_com/641", title: "监理质检类资料", marker: "监理抽检记录", view: "quality-监理质检类资料" },
      { url: "/sbr/sbr_com/642", title: "资料综合查询台帐", marker: "施工组织设计报审资料", view: "ledger" },
      { url: "/sbr/sbr_com/670", title: "施工单位工程资料", marker: "施工组织设计报审资料", view: "unit-施工单位工程资料" },
      { url: "/sbr/sbr_com/671", title: "监理单位工程资料", marker: "监理规划及旁站记录", view: "unit-监理单位工程资料" },
      { url: "/sbr/sbr_com/672", title: "审计单位工程资料", marker: "计量支付审计底稿", view: "unit-审计单位工程资料" },
      { url: "/sbr/sbr_com/673", title: "设计单位工程资料", marker: "施工图设计交底记录", view: "unit-设计单位工程资料" }
    ];
    const signatures = new Set();
    for (const item of documentMenuPages) {
      const page = await requestText(item.url);
      assert.strictEqual(page.response.status, 200, `${item.title} menu page should load`);
      assert.ok(page.text.includes(item.title), `${item.title} menu page should have its own title`);
      assert.ok(page.text.includes(item.marker), `${item.title} menu page should show its category-specific document rows`);
      assert.ok(page.text.includes(`data-document-view="${item.view}"`), `${item.title} menu page should carry a distinct document view key`);
      assert.ok(["编辑", "附件", "权限"].every((label) => page.text.includes(label)), `${item.title} menu page should expose document operations`);
      signatures.add(page.text.slice(0, 1200));
    }
    assert.strictEqual(signatures.size, documentMenuPages.length, "engineering document left menu pages should not all render the same content");
  } finally {
    if (ids.length) await postJson("/oaDataNode/delete_data_node", { ids: ids.join(",") });
  }
}

async function verifyImportExportDownloadLoop() {
  const csvExportBytes = await requestBuffer("/reportManager/export_project_measure_pay");
  const csvExport = { response: csvExportBytes.response, text: csvExportBytes.buffer.toString("utf8") };
  assert.strictEqual(csvExport.response.status, 200, "direct CSV export should succeed");
  assert.ok((csvExport.response.headers.get("content-type") || "").includes("text/csv"), "direct export should be CSV");
  assert.ok(csvExportBytes.buffer.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), "CSV export should include UTF-8 BOM for Excel");
  assert.ok(csvExport.text.includes("billNo") && csvExport.text.includes("measureMoney"), "CSV export should include payment columns");
  assert.ok(!/\bNaN\b/.test(csvExport.text), "CSV export should not contain NaN");

  const ticket = await requestJson("/reportManager/export_project_measure_pay", {
    method: "POST",
    headers: { "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify({})
  });
  assert.strictEqual(ticket.json.code, 1, "AJAX export ticket should succeed");
  assert.ok(typeof ticket.json.data === "string" && ticket.json.data.includes("/data/exports/"), "AJAX export should return saved export URL");

  const downloaded = await requestText(`/file_upload/down_load?url=${encodeURIComponent(ticket.json.data)}`);
  assert.strictEqual(downloaded.response.status, 200, "saved export download should succeed");
  assert.ok(downloaded.text.includes("billNo") && downloaded.text.includes("measureMoney"), "saved export download should return CSV content");

  const moduleExports = [
    {
      url: "/bill_measure/export_bill_measure",
      columns: ["measureNo", "measureMoney", "sectionName"],
      label: "bill measure"
    },
    {
      url: "/meterialdiasmeasure/export_meterial_dias_measure",
      columns: ["materialName", "priceDiff", "adjustMoney"],
      label: "material dias"
    },
    {
      url: "/meterialInMeasure/export_meterial_in_measure",
      columns: ["materialName", "measureNum", "money"],
      label: "material arrival"
    },
    {
      url: "/manualMeasure/export_manual_measure",
      columns: ["billName", "measureNum", "measureMoney"],
      label: "manual measure"
    }
  ];
  for (const item of moduleExports) {
    const direct = await requestBuffer(item.url);
    const text = direct.buffer.toString("utf8");
    assert.strictEqual(direct.response.status, 200, `${item.label} direct export should succeed`);
    assert.ok((direct.response.headers.get("content-type") || "").includes("text/csv"), `${item.label} direct export should be CSV`);
    assert.ok(direct.buffer.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `${item.label} CSV should include UTF-8 BOM`);
    assert.ok(item.columns.every((column) => text.includes(column)), `${item.label} CSV should include computed/list columns`);
    assert.ok(!/\bNaN\b/.test(text), `${item.label} CSV should not contain NaN`);

    const ajaxTicket = await requestJson(item.url, {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify({})
    });
    assert.strictEqual(ajaxTicket.json.code, 1, `${item.label} AJAX export ticket should succeed`);
    assert.ok(typeof ajaxTicket.json.data === "string" && ajaxTicket.json.data.includes("/data/exports/"), `${item.label} AJAX export should return saved file URL`);
    const ajaxDownload = await requestText(`/file_upload/down_load?url=${encodeURIComponent(ajaxTicket.json.data)}`);
    assert.strictEqual(ajaxDownload.response.status, 200, `${item.label} saved export should download`);
    assert.ok(item.columns.every((column) => ajaxDownload.text.includes(column)), `${item.label} saved export should preserve columns`);
  }

  const excelTicket = await requestJson("/reportManager/exportReport", {
    method: "POST",
    body: JSON.stringify({ rpIds: "101,102", exportType: "excel" })
  });
  assert.strictEqual(excelTicket.json.code, 1, "payment report excel export ticket should succeed");
  assert.ok(Array.isArray(excelTicket.json.data) && excelTicket.json.data[1].endsWith(".csv"), "excel export should return a CSV file ticket");
  const excelDownload = await requestText(`/reportManager/exportReports?file_name=${encodeURIComponent(excelTicket.json.data[1])}`);
  assert.ok(excelDownload.text.includes("sectionName") && excelDownload.text.includes("totalPayMoney"), "excel report download should contain report columns");
  assert.ok(excelDownload.text.includes("billMeasureMoney") && excelDownload.text.includes("materialDiasMoney") && excelDownload.text.includes("materialArrivalMoney") && excelDownload.text.includes("manualMoney"), "excel report download should include full payable component columns");
  assert.ok(excelDownload.text.includes("材料到场仅跟踪，不计入应付") || excelDownload.text.includes("JL109材料到场按预付率形成材料设备垫付款"), "excel report download should state material arrival payment rule");

  const pdfTicket = await requestJson("/reportManager/exportReport", {
    method: "POST",
    body: JSON.stringify({ rpIds: "101", exportType: "pdf" })
  });
  assert.strictEqual(pdfTicket.json.code, 1, "payment report pdf export ticket should succeed");
  assert.ok(pdfTicket.json.data[1].endsWith(".html"), "pdf export should return a printable HTML ticket");
  const pdfDownload = await requestText(`/reportManager/exportReports?file_name=${encodeURIComponent(pdfTicket.json.data[1])}`);
  assert.ok(pdfDownload.text.includes("计量支付报表") && pdfDownload.text.includes("累计支付"), "pdf-style report download should be printable HTML");
  assert.ok(pdfDownload.text.includes("清单计量") && pdfDownload.text.includes("材料补差") && pdfDownload.text.includes("材料到场") && pdfDownload.text.includes("手动计量"), "pdf-style report should show payable components");

  const wordTicket = await requestJson("/reportManager/exportReport", {
    method: "POST",
    body: JSON.stringify({ rpIds: "101", exportType: "word" })
  });
  assert.strictEqual(wordTicket.json.code, 1, "payment report word export ticket should succeed");
  assert.ok(wordTicket.json.data[1].endsWith(".doc"), "word export should return a Word-compatible document ticket");
  const wordDownload = await requestText(`/reportManager/exportReports?file_name=${encodeURIComponent(wordTicket.json.data[1])}`);
  assert.ok(wordDownload.text.includes("计量支付报表") && wordDownload.text.includes("累计支付"), "word report download should be Word-compatible HTML");
  assert.ok(wordDownload.text.includes("清单计量") && wordDownload.text.includes("材料补差") && wordDownload.text.includes("材料到场") && wordDownload.text.includes("手动计量"), "word report should show payable components");

  const allTicket = await requestJson("/reportManager/exportReport", {
    method: "POST",
    body: JSON.stringify({ rpIds: "101,102", exportType: "all" })
  });
  assert.strictEqual(allTicket.json.code, 1, "payment report bundle export ticket should succeed");
  assert.ok(allTicket.json.data[1].endsWith(".zip"), "all export should return a ZIP ticket");
  const allDownload = await requestBuffer(`/reportManager/exportReports?file_name=${encodeURIComponent(allTicket.json.data[1])}`);
  assert.strictEqual(allDownload.buffer.slice(0, 2).toString("ascii"), "PK", "all export download should be a ZIP archive");
  assert.ok(allDownload.buffer.toString("utf8").includes("materialArrivalMoney"), "all export bundle should include expanded payment CSV columns");
  assert.ok(allDownload.buffer.toString("utf8").includes("payment-report-word.doc"), "all export bundle should include Word-compatible report");

  const zip = await requestBuffer("/oaDataNode/downLoadZipFile");
  assert.strictEqual(zip.response.status, 200, "document ZIP download should succeed");
  assert.ok((zip.response.headers.get("content-type") || "").includes("zip"), "document download should be a ZIP");
  assert.strictEqual(zip.buffer.slice(0, 2).toString("ascii"), "PK", "document download should have ZIP header");

  const upload = await postJson("/import_measure/upload_excel", {
    fileName: "验证导入文件.xlsx",
    size: 4096
  });
  assert.strictEqual(upload.json.code, 1, "import upload should succeed");
  const attId = upload.json.data.attId;

  const afterUpload = await requestJson("/import_measure/get_attachment_list?page=1&limit=200");
  const uploaded = afterUpload.json.data.find((item) => Number(item.attId || item.attachmentId || item.id) === Number(attId));
  assert.ok(uploaded, "uploaded import attachment should appear in list");
  assert.strictEqual(uploaded.fileName, "验证导入文件.xlsx", "uploaded attachment should keep Chinese file name");
  assert.strictEqual(uploaded.state, "已解析", "uploaded attachment should be parsed");

  await postJson("/import_measure/reload_import", { attId });
  const afterReload = await requestJson("/import_measure/get_attachment_list?page=1&limit=200");
  const reloaded = afterReload.json.data.find((item) => Number(item.attId || item.attachmentId || item.id) === Number(attId));
  assert.ok(reloaded, "reloaded import attachment should remain in list");
  assert.strictEqual(reloaded.state, "已重新解析", "reload should update attachment state");

  await postJson("/import_measure/delete", { attIds: String(attId) });
  const afterDelete = await requestJson("/import_measure/get_attachment_list?page=1&limit=200");
  assert.ok(!afterDelete.json.data.some((item) => Number(item.attId || item.attachmentId || item.id) === Number(attId)), "deleted import attachment should be removed");
}

async function verifyImportMeasureDashboardLoop() {
  const importBill = engine.billRows()[0];
  const importNum = 3;
  const expectedImportMoney = round(importNum * Number(importBill.price || 0));
  const upload = await postJson("/import_measure/upload_excel", {
    fileName: "IMPORT-DASH-VERIFY.xlsx",
    size: 8192,
    rows: [{ billNo: importBill.billNo, measureNum: importNum }]
  });
  assert.strictEqual(upload.json.data.parsedRows, 1, "upload should parse provided measure detail rows");
  const attId = upload.json.data.attId;
  try {
    const beforeMeasures = await requestJson("/bill_measure/list?page=1&limit=1000");
    const beforeCount = beforeMeasures.json.count;

    let page = await requestText(`/import_measure/dashboard_page?attId=${attId}`);
    assert.strictEqual(page.response.status, 200, "import measure dashboard should load");
    assert.ok(page.text.includes("清单计量导入管理"), "import measure dashboard should show title");
    assert.ok(page.text.includes("导入附件") && page.text.includes("解析预览") && page.text.includes("已生成计量单"), "import measure dashboard should include core panels");
    assert.ok(page.text.includes("IMPORT-DASH-VERIFY.xlsx"), "import measure dashboard should show uploaded file");
    assert.ok(page.text.includes(importBill.billNo) && page.text.includes(moneyTextForVerify(expectedImportMoney)), "import dashboard preview should show uploaded detail money");
    assert.ok(page.text.includes("/import_measure/import_excel") && page.text.includes("/import_measure/reload_import") && page.text.includes("/import_measure/delete_data"), "import measure dashboard should expose import actions");
    const preview = await requestJson(`/import_measure/get_measure_by_att?attId=${attId}&page=1&limit=10`);
    const previewRow = preview.json.data.find((row) => String(row.billNo || "") === String(importBill.billNo));
    assert.ok(previewRow, "preview endpoint should return uploaded measure detail");
    assert.strictEqual(round(previewRow.money), expectedImportMoney, "preview endpoint should calculate uploaded detail money");

    await postJson("/import_measure/import_excel", { attIds: String(attId) });
    const imported = await requestJson("/bill_measure/list?page=1&limit=1000");
    assert.ok(imported.json.count > beforeCount, "importing attachment should create bill measure rows");
    const importedRow = imported.json.data.find((row) => Number(row.sourceAttId || 0) === Number(attId));
    assert.ok(importedRow, "imported measure should keep source attachment id");
    assert.ok(importedRow.measureNo && importedRow.measureNo.includes("JL-IMPORT"), "imported measure should use import measure number");
    assert.strictEqual(round(importedRow.measureMoney), expectedImportMoney, "imported measure should use parsed upload detail quantity and bill price");

    page = await requestText(`/import_measure/dashboard_page?attId=${attId}`);
    assert.ok(page.text.includes(importedRow.measureNo) && page.text.includes("计量看板"), "import measure dashboard should show generated measure and link dashboard");

    const menu = await requestJson("/menu/left_menu?parentId=2");
    const flatMenu = JSON.stringify(menu.json.data);
    assert.ok(flatMenu.includes("清单计量导入管理") && flatMenu.includes("import_measure/dashboard_page"), "import measure dashboard should be reachable from left menu");

    const menuPage = await requestText("/sbr/sbr_com/693");
    assert.ok(menuPage.text.includes("清单计量导入管理") && menuPage.text.includes("导入附件"), "import measure dashboard should render through menu content route");

    await postJson("/import_measure/delete_data", { attId });
    const afterClear = await requestJson("/bill_measure/list?page=1&limit=1000");
    assert.ok(!afterClear.json.data.some((row) => Number(row.sourceAttId || 0) === Number(attId)), "clearing import data should remove generated measures");
  } finally {
    await postJson("/import_measure/delete", { attIds: String(attId) });
  }
}

async function verifyOriginalParameterAliasesLoop() {
  const { json: measureJson } = await postJson("/bill_measure/save_measure", {
    measureNo: "ALIAS-BILL-MEASURE",
    sectionId: 101,
    measureDate: "2026-06-01"
  });
  const measureId = measureJson.data.billMeasureId;
  const { json: diasJson } = await postJson("/meterialdiasmeasure/save_detail", {
    measureNo: "ALIAS-DIAS-MEASURE",
    sectionId: 101,
    materialId: 1,
    quantity: 1
  });
  const diasId = diasJson.data.meterialDiasMeasureId;
  const { json: arrivalJson } = await postJson("/meterialInMeasure/save_detail", {
    measureNo: "ALIAS-ARRIVAL-MEASURE",
    sectionId: 101,
    materialId: 1,
    quantity: 1
  });
  const arrivalId = arrivalJson.data.meterialInMeasureId;
  const { json: manualJson } = await postJson("/manualMeasure/save_measure", {
    measureNo: "ALIAS-MANUAL-MEASURE",
    sectionId: 101,
    billNo: "ALIAS-MANUAL",
    billName: "参数别名手动计量",
    measureNum: 1,
    price: 10
  });
  const manualId = manualJson.data.manualMeasureId;
  const { json: varyJson } = await postJson("/vary_measure/save_measure", {
    varyNo: "ALIAS-VARY-MEASURE",
    sectionId: 101,
    billId: 1,
    beforeNum: 1,
    beforePrice: 100,
    afterNum: 2,
    afterPrice: 120,
    varyReason: "参数别名变更"
  });
  const varyId = varyJson.data.varyId;
  try {
    assert.ok((await postJson("/bill_measure/up_order", { billMeasureIds: String(measureId) })).json.data.changed >= 1, "bill measure should accept billMeasureIds");
    assert.ok((await postJson("/meterialdiasmeasure/up_order", { mdmIds: String(diasId) })).json.data.changed >= 1, "material dias should accept mdmIds");
    assert.ok((await postJson("/meterialInMeasure/update_measure_state", { meterialInMeasureIds: String(arrivalId) })).json.data.changed >= 1, "material arrival should accept meterialInMeasureIds");
    assert.ok((await postJson("/manualMeasure/update_measure_state", { manualMeasureIds: String(manualId) })).json.data.changed >= 1, "manual measure should accept manualMeasureIds");
    assert.ok((await postJson("/vary_measure/agree_order", { varyIds: String(varyId) })).json.data.changed >= 1, "variation should accept varyIds on agree");

    const billList = await requestJson("/bill_measure/list?page=1&limit=1000");
    assert.strictEqual(billList.json.data.find((row) => Number(row.billMeasureId) === Number(measureId)).states, "审核中", "bill measure alias update should persist state");
    const diasList = await requestJson("/meterialdiasmeasure/meterial_dias_measure_list?page=1&limit=1000");
    assert.strictEqual(diasList.json.data.find((row) => Number(row.meterialDiasMeasureId) === Number(diasId)).states, "审核中", "material dias alias update should persist state");
    const arrivalList = await requestJson("/meterialInMeasure/meterial_in_measure_list?page=1&limit=1000");
    assert.strictEqual(arrivalList.json.data.find((row) => Number(row.meterialInMeasureId) === Number(arrivalId)).states, "已更新", "material arrival alias update should persist state");
    const manualList = await requestJson("/manualMeasure/detail_list?page=1&limit=1000");
    assert.strictEqual(manualList.json.data.find((row) => Number(row.manualId) === Number(manualId)).states, "已更新", "manual measure alias update should persist state");
    const varyList = await requestJson("/vary_measure/list?page=1&limit=1000");
    assert.strictEqual(varyList.json.data.find((row) => Number(row.varyId) === Number(varyId)).states, "已审核", "variation alias update should persist state");
  } finally {
    if (measureId) await postJson("/bill_measure/delete", { billMeasureIds: String(measureId) });
    if (diasId) await postJson("/meterialdiasmeasure/delete", { meterialDiasMeasureIds: String(diasId) });
    if (arrivalId) await postJson("/meterialInMeasure/delete", { meterialInMeasureIds: String(arrivalId) });
    if (manualId) await postJson("/manualMeasure/delete", { manualMeasureIds: String(manualId) });
    if (varyId) await postJson("/vary_measure/delete", { varyIds: String(varyId) });
  }
}

async function verifyOriginalMenuUrlAliasesLoop() {
  const pages = [
    ["/billModel/billModel_page", "清单范本"],
    ["/manual_model/manual_model_page", "材料范本"],
    ["/contract_survey/contract_survey_page/0", "合同概况"],
    ["/secProjectPlan/plan_list_page", "工程计划"],
    ["/secBill/sec_bill_page", "清单管理"],
    ["/secMateria/sec_materia_page", "材料"],
    ["/billAnalyzeNode/designBillList_page", "分部分项"],
    ["/sysGather/gatherData_page/0", "工期"],
    ["/bill_measure/page", "清单计量管理"],
    ["/meterialdiasmeasure/meterialdiasmeasurePage", "材料补差计量管理"],
    ["/meterialInMeasure/meterialInMeasureList", "材料到场计量管理"],
    ["/manualMeasure/manualMeasureList/0", "手动计量管理"],
    ["/reportManager/report_project_page/0?bdCode=MEASUREREOPORT", "计量支付报表中心"],
    ["/reportManager/export_report_project_page/0?bdCode=MEASUREREOPORT", "计量报表导出页面"],
    ["/engineering_contact_bill/page", "工程技术联系单"],
    ["/vary_meeting/vary_meeting_page", "变更会议"],
    ["/vary_measure/page", "工程变更"],
    ["/mtilProjectQuer/page", "多项目"],
    ["/bigVaryQuery/getBigVaryQueryPage", "重大变更"],
    ["/leaderquery/sub_item_page", "分项"],
    ["/leaderquery/project_measure_pay_ledger", "导出Excel"],
    ["/varyMeasurePay/get_vary_measure_page", "变更支付"],
    ["/oaDataNode/get_data_manage_page?type=2", "资料"],
    ["/syzl/page", "试验资料"],
    ["/projectInformationNode/page/0", "资料"],
    ["/projectInformationParam/page", "资料"],
    ["/admin/dashboard_page", "后台管理"],
    ["/admin/calculation_rules_page", "计算规则管理后台"],
    ["/admin/users_page", "账号权限管理"]
  ];
  for (const [url, expected] of pages) {
    const page = await requestText(url);
    assert.strictEqual(page.response.status, 200, `original menu URL ${url} should load`);
    assert.ok(page.text.includes(expected), `original menu URL ${url} should render dynamic ${expected} page`);
    assert.ok(!page.text.includes('"status":404'), `original menu URL ${url} should not fall back to cached 404`);
  }

  const menuIds = [
    ["46", "data-gather-dashboard"],
    ["47", "清单计量管理"],
    ["48", "材料补差计量管理"],
    ["49", "材料到场计量管理"],
    ["50", "手动计量管理"],
    ["355", "工期管理"],
    ["376", "sub-item-ledger-table"],
    ["377", "export_project_measure_pay"],
    ["378", "varyMeasurePay/export_vary_measure_pay"],
    ["411", "oaDataNode/downLoadZipFile"],
    ["568", "试验资料"],
    ["9001", "后台管理"],
    ["9002", "计算规则管理后台"],
    ["9004", "JL计量支付报表核对"],
    ["9010", "账号权限管理"]
  ];
  for (const [id, expected] of menuIds) {
    const page = await requestText(`/sbr/sbr_com/${id}`);
    assert.strictEqual(page.response.status, 200, `legacy menu id ${id} should load`);
    assert.ok(page.text.includes(expected), `legacy menu id ${id} should render dynamic local page`);
    assert.ok(!page.text.includes('"status":404'), `legacy menu id ${id} should not use cached 404`);
  }

  const header = await requestJson("/menu/header_menu?href=sbr/sbr_com/9002");
  assert.ok(header.json.data.some((row) => Number(row.id) === 9000 && row.title === "后台管理"), "header menu should include backend management");
  assert.strictEqual(Number(header.json.other.id), 9000, "calculation rules menu should select backend management top menu");
  const systemMenu = await requestJson("/menu/left_menu?parentId=9000");
  const systemMenuText = JSON.stringify(systemMenu.json.data);
  assert.ok(systemMenuText.includes("后台首页") && systemMenuText.includes("admin/dashboard_page"), "backend menu should expose backend dashboard");
  assert.ok(systemMenuText.includes("计算规则后台") && systemMenuText.includes("admin/calculation_rules_page"), "backend menu should expose calculation rules admin");
  assert.ok(systemMenuText.includes("JL计量支付报表") && systemMenuText.includes("payment/jl_report_page"), "backend menu should expose JL payment report");
  assert.ok(systemMenuText.includes("账号权限管理") && systemMenuText.includes("admin/users_page"), "backend menu should expose user and role administration");
  assert.ok(systemMenuText.includes("备份恢复管理") && systemMenuText.includes("admin/backups_page"), "backend menu should expose project-scoped backup administration");
  assert.ok(systemMenuText.includes("数据导入导出") && systemMenuText.includes("admin/data_exchange_page"), "backend menu should expose validated business data exchange");
}

async function main() {
  const started = Date.now();
  await verifyHealth();
  await verifyUnauthenticatedAccess();
  await verifyLoginFlow();
  await verifyAuthorizationFlow();
  await verifyDataExchangeFlow();
  await verifyTenantBusinessIsolation();
  const contractUrls = await verifyContractUrls();
  const actionUrls = await verifyCachedPageActions();
  await verifyOriginalFormPageCoverage();
  await verifyOriginalMenuUrlAliasesLoop();
  await verifyFallbackResponses();
  const assets = await verifyAssets();
  verifyCostMath();
  verifyJlPaymentReferenceCases();
  await verifyStandaloneCostCalculator();
  await verifyFiveDCostModelLoop();
  await verifyBillModelImportLoop();
  await verifyMaterialImportExportLoop();
  await verifyModelCenterDashboardLoop();
  await verifySecBillDashboardLoop();
  await verifyCostBaseDashboardLoop();
  await verifyCostReconciliationLoop();
  await verifyCalculationRulesAdminLoop();
  await verifyContractSurveyDashboardLoop();
  await verifyVariationMeetingLoop();
  await verifyCrudLoop();
  await verifyBillMeasurePageLoop();
  await verifyBillMeasureDashboardLoop();
  await verifyBusinessCrudLoop();
  await verifyMaterialArrivalManagementDashboardLoop();
  await verifyMaterialDiasManagementDashboardLoop();
  await verifyManualMeasureManagementDashboardLoop();
  await verifyWorkflowLoop();
  await verifyWorkflowSmsLoop();
  await verifyContactReportAndBusinessInfoLoop();
  await verifyEngineeringContactDashboardLoop();
  await verifySecondPaymentReportLoop();
  await verifyReportManagerDashboardLoop();
  await verifyJlPaymentReportPageLoop();
  await verifyAuditMoneyDashboardLoop();
  await verifyProjectPlanDashboardLoop();
  await verifyWorkflowAdjustReturnLoop();
  await verifyWorkflowAdjustReturnAcrossModulesLoop();
  await verifyWorkflowDashboardLoop();
  await verifyVariationArchiveLoop();
  await verifyVariationDetailCrudLoop();
  await verifyOriginalWorkflowBatchSemanticsLoop();
  await verifyVariationOrderReportLoop();
  await verifyVariationPaymentDashboardLoop();
  await verifyVariationManagementDashboardLoop();
  await verifyQueryLedgerLoop();
  await verifyBillAnalyzeDashboardLoop();
  await verifyBigVaryQueryLoop();
  await verifyMultiProjectQueryLoop();
  await verifyGatherPeriodCalculationLoop();
  await verifySysGatherDashboardLoop();
  await verifyFinancialChainIntegrationLoop();
  await verifyDocumentNodeLoop();
  await verifyDocumentDashboardLoop();
  await verifyImportExportDownloadLoop();
  await verifyImportMeasureDashboardLoop();
  await verifyOriginalParameterAliasesLoop();
  await verifyChineseSamples();
  console.log(JSON.stringify({
    ok: true,
    contractUrls,
    actionUrls,
    assets,
    elapsedMs: Date.now() - started
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
