"use strict";

const http = require("node:http");

function requestJson(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? "" : String(options.body);
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (body && headers["Content-Length"] === undefined) headers["Content-Length"] = Buffer.byteLength(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, payload: JSON.parse(text) });
        } catch (error) {
          reject(new Error(`${pathname} returned invalid JSON: ${text.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error(`${pathname} timed out`)));
    req.end(body);
  });
}

async function login(port, options) {
  const body = new URLSearchParams({
    tenant_id: options.tenantId || "default",
    user_account: options.account,
    password: options.password,
    remember_me: "false"
  }).toString();
  const result = await requestJson(port, "/dologin", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const setCookie = result.headers["set-cookie"] || [];
  if (result.status !== 200 || result.payload.code !== 1 || !setCookie.length) throw new Error(result.payload.msg || "login failed");
  return { cookie: setCookie[0].split(";")[0], payload: result.payload };
}

async function authenticateTestSession(port, options = {}) {
  const account = options.account || "ys1";
  const password = options.password || "000000";
  const replacementPassword = options.replacementPassword || "Regression-Admin-42!";
  let session = await login(port, { tenantId: options.tenantId, account, password });
  if (!session.payload.data.mustChangePassword) return session.cookie;

  const changed = await requestJson(port, "/api/account/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: session.cookie },
    body: JSON.stringify({ currentPassword: password, newPassword: replacementPassword, confirmPassword: replacementPassword })
  });
  if (changed.status !== 200 || changed.payload.code !== 1 || changed.payload.data.reauthenticationRequired !== true) {
    throw new Error(changed.payload.msg || "forced password change failed");
  }
  session = await login(port, { tenantId: options.tenantId, account, password: replacementPassword });
  if (session.payload.data.mustChangePassword) throw new Error("forced password flag was not cleared");
  return session.cookie;
}

module.exports = { authenticateTestSession, requestJson };
