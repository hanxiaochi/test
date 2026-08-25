"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
}

async function startServer(env) {
  const output = [];
  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})\n${output.join("").slice(-2000)}`);
    try {
      const response = await fetch(`${env.APP_BASE_URL}/api/health`);
      if (response.ok) return { child, output };
    } catch {
      // Binding the isolated port can take a moment on Windows.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready\n${output.join("").slice(-2000)}`);
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  server.child.send({ type: "shutdown" });
  const result = await waitForExit(server.child);
  assert.equal(result.code, 0, `server shutdown failed: ${server.output.join("").slice(-2000)}`);
}

async function failedLogin(baseUrl, account) {
  return fetch(`${baseUrl}/dologin`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user_account: account, password: "wrong-password" })
  });
}

test("login rate limit survives a real server restart", { timeout: 60_000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "zwkjy-login-rate-integration-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  fs.copyFileSync(path.join(root, "data", "runtime-db.json"), path.join(temp, "runtime-db.json"));
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    APP_BASE_URL: baseUrl,
    APP_STORAGE: "json",
    APP_RUNTIME_DB_PATH: path.join(temp, "runtime-db.json"),
    APP_SECURITY_DB_PATH: path.join(temp, "security.db"),
    APP_RULE_DB_PATH: path.join(temp, "rules.db"),
    APP_EXPORT_DIR: path.join(temp, "exports"),
    APP_BACKUP_DIR: path.join(temp, "backups"),
    APP_LOGIN_MAX_ATTEMPTS: "2",
    APP_LOGIN_WINDOW_MS: "60000",
    APP_LOGIN_MAX_ENTRIES: "100",
    APP_ENABLE_IPC_SHUTDOWN: "true"
  };
  let server;
  try {
    server = await startServer(env);
    assert.equal((await failedLogin(baseUrl, "restart-probe")).status, 200);
    assert.equal((await failedLogin(baseUrl, "restart-probe")).status, 200);
    await stopServer(server);

    server = await startServer(env);
    const blocked = await failedLogin(baseUrl, "restart-probe");
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    assert.equal((await failedLogin(baseUrl, "different-account")).status, 200);
  } finally {
    if (server) await stopServer(server);
    const resolved = path.resolve(temp);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("zwkjy-login-rate-integration-")) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
});
