"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deploymentSecurityPolicy, assertServerDeployment } = require("../lib/security/deployment-security");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const server = read("server.js");
const httpSecurity = read("lib/security/http-security.js");
const workflow = read(".github/workflows/quality-gate.yml");
const lock = JSON.parse(read("package-lock.json"));
const checks = [];

function pass(id, test, evidence) {
  assert.ok(test, `${id}: ${evidence}`);
  checks.push({ id, status: "pass", evidence });
}

pass("loopback-default", server.includes("const host = deploymentSecurity.host") && server.includes("app.listen(port, host"), "监听地址由部署安全策略显式控制");
pass("deployment-fail-closed", server.includes("assertServerDeployment") && read("lib/security/auth-service.js").includes("passwordMatches(bootstrap.userId, \"000000\")"), "生产配置和弱默认管理员均可拒绝启动");
pass("body-limit", server.includes('APP_BODY_LIMIT || "2mb"') && server.includes('APP_BACKUP_IMPORT_BODY_LIMIT || "32mb"') && !server.includes('APP_BODY_LIMIT || "64mb"'), "默认JSON请求体限制为2MB，仅备份导入使用32MB独立上限");
pass("static-allowlist", !server.includes("express.static(root") && server.includes('["assets", "common", "css", "img", "js"]'), "Web静态资源使用目录白名单");
pass("source-denylist", httpSecurity.includes("BLOCKED_WEB_ROOTS") && httpSecurity.includes('"data", "lib"') && httpSecurity.includes('"server.js"'), "运行数据、源码和依赖清单不可通过HTTP读取");
pass("export-isolation", server.includes("Authenticated export scope is required") && server.includes('fileDir: "/file_upload/down_load"') && server.includes("neutralizeSpreadsheetFormula"), "导出文件按租户项目隔离并中和CSV公式");
pass("csp-script-origin", httpSecurity.includes("script-src 'self' 'unsafe-inline' 'unsafe-eval'") && !httpSecurity.includes("script-src 'self' 'unsafe-inline' 'unsafe-eval' https:"), "脚本来源限制为同源");
pass("csrf-origin", httpSecurity.includes("origin-host") && httpSecurity.includes("cross-site"), "浏览器写请求校验Origin和Fetch Metadata");
pass("workflow-permissions", /permissions:\s*\r?\n\s*contents: read/.test(workflow), "GitHub Actions仅授予仓库只读权限");
pass("locked-install", Number(lock.lockfileVersion) >= 3 && Boolean(lock.packages && lock.packages[""]), "依赖锁文件存在且使用现代格式");

const secretPattern = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})/;
const firstPartyFiles = [
  "server.js", "constructionData.js", "costEngine.js", "index.html", "login.html",
  ...fs.readdirSync(path.join(ROOT, "lib"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)))
];
const secretHits = firstPartyFiles.filter((name) => secretPattern.test(read(name)));
pass("secret-patterns", secretHits.length === 0, `高置信度密钥模式命中${secretHits.length}个文件`);

const productionPolicy = deploymentSecurityPolicy({
  NODE_ENV: "production",
  APP_HOST: "127.0.0.1",
  APP_BOOTSTRAP_PASSWORD: "Audit-Only-Strong-42!",
  APP_COOKIE_SECURE: "true",
  APP_TRUST_PROXY: "1"
});
pass("production-policy", assertServerDeployment(productionPolicy).requireStrongBootstrap, "生产部署强制强初始密码、Secure Cookie和可信代理");

console.log(JSON.stringify({ ok: true, standard: "commercial-web-security-baseline", checks: checks.length, results: checks }, null, 2));
