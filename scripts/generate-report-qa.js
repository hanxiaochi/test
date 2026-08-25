"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.env.APP_BASE_URL || "http://127.0.0.1:3100";
const outputDir = path.resolve(__dirname, "..", "tmp", "report-export-qa");

async function json(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const body = await response.json();
  return { response, body };
}

async function login(password) {
  const body = new URLSearchParams({ user_account: "ys1", password, remember_me: "false" });
  const result = await json("/dologin", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  assert.equal(result.body.code, 1);
  return result.response.headers.get("set-cookie").split(";")[0];
}

async function main() {
  let cookie = await login("000000");
  const changed = await json("/api/account/password", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "000000", newPassword: "Report-QA-42!", confirmPassword: "Report-QA-42!" })
  });
  assert.equal(changed.body.code, 1);
  cookie = await login("Report-QA-42!");
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [type, extension] of [["excel", "xlsx"], ["pdf", "pdf"], ["word", "docx"]]) {
    const response = await fetch(`${baseUrl}/reportManager/exportReport?rpIds=101,102&exportType=${type}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (extension === "pdf") assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    else assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
    fs.writeFileSync(path.join(outputDir, `payment-report.${extension}`), buffer);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, outputDir })}\n`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
