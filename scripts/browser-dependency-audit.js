"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const checks = [];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sha256(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relativePath))).digest("hex");
}

function pass(id, condition, evidence) {
  assert.ok(condition, `${id}: ${evidence}`);
  checks.push({ id, status: "pass", evidence });
}

const jqueryPaths = [
  "assets/bower_components/jquery/dist/jquery.min.js",
  "assets/layui/modules/jquery.js",
  "assets/layui/lay/modules/jquery.js"
];
const momentPaths = [
  "assets/bower_components/moment/min/moment.min.js",
  "assets/fullcalendar/js/moment.min.js"
];

pass("jquery-version", jqueryPaths.every((name) => read(name).includes("jQuery v3.7.1")), "所有公开 jQuery 副本均为 3.7.1");
pass("jquery-identical", new Set(jqueryPaths.map(sha256)).size === 1, "jQuery 副本校验和一致");
pass("jquery-ui-version", read("assets/bower_components/jquery-ui/jquery-ui.min.js").includes("jQuery UI - v1.13.3"), "jQuery UI 为 1.13.3");
pass("moment-version", momentPaths.every((name) => read(name).includes('_.version="2.30.1"')), "所有 Moment.js 副本均为 2.30.1");
pass("moment-identical", new Set(momentPaths.map(sha256)).size === 1, "Moment.js 副本校验和一致");
pass("select2-version", read("assets/bower_components/select2/dist/js/select2.js").includes("Select2 4.1.0-rc.0"), "Select2 为 4.1.0-rc.0");
pass("bootstrap-safe-compat", read("assets/bower_components/bootstrap/dist/js/bootstrap.min.js").includes("Project-local Bootstrap 3 behavior compatibility layer"), "旧 Bootstrap 可执行代码已由最小兼容层替代");

const removedBundles = [
  "assets/bower_components/ckeditor/ckeditor.js",
  "assets/data-tables/datatables.min.js"
];
pass("unused-bundles-removed", removedBundles.every((name) => !fs.existsSync(path.join(ROOT, name))), "未使用的 CKEditor 与 DataTables 漏洞包未随产品交付");

const index = read("index.html");
pass("unused-bundles-unreferenced", removedBundles.every((name) => !index.includes(name)), "入口页不再引用已移除漏洞包");

console.log(JSON.stringify({ ok: true, standard: "browser-dependency-security-baseline", checks: checks.length, results: checks }, null, 2));
