"use strict";

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const verifyScript = path.resolve(ROOT, process.argv[2] || "scripts/verify.js");

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

function directorySize(root) {
  if (!fs.existsSync(root)) return 0;
  return fs.readdirSync(root, { withFileTypes: true }).reduce((total, entry) => {
    const target = path.join(root, entry.name);
    try {
      return total + (entry.isDirectory() ? directorySize(target) : fs.statSync(target).size);
    } catch (error) {
      if (error && error.code === "ENOENT") return total;
      throw error;
    }
  }, 0);
}

function largestFiles(root, limit = 8) {
  const rows = [];
  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const target = path.join(directory, entry.name);
      try {
        if (entry.isDirectory()) walk(target);
        else rows.push({ file: path.relative(root, target), bytes: fs.statSync(target).size });
      } catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
      }
    });
  }
  walk(root);
  return rows.sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}

async function waitForReady(baseUrl, child, diagnostics) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`isolated test server exited early (${child.exitCode})\n${diagnostics()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The server may still be binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`isolated test server did not become ready\n${diagnostics()}`);
}

async function main() {
  if (!fs.existsSync(verifyScript)) throw new Error(`verification script not found: ${verifyScript}`);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zwkjy-verify-"));
  const runtimeFile = path.join(tempRoot, "runtime-db.json");
  const sqliteFile = path.join(tempRoot, "runtime.db");
  const securityFile = path.join(tempRoot, "security.db");
  const ruleFile = path.join(tempRoot, "rules.db");
  const exportDir = path.join(tempRoot, "exports");
  const backupDir = path.join(tempRoot, "backups");
  const attachmentDir = path.join(tempRoot, "attachments");
  const attachmentDbFile = path.join(tempRoot, "attachments.db");
  fs.copyFileSync(path.join(ROOT, "data", "runtime-db.json"), runtimeFile);
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    APP_BASE_URL: baseUrl,
    APP_EXPORT_DIR: exportDir,
    APP_BACKUP_DIR: backupDir,
    APP_ATTACHMENT_DIR: attachmentDir,
    APP_ATTACHMENT_DB_PATH: attachmentDbFile,
    APP_ATTACHMENT_MAX_BYTES: "1048576",
    APP_RUNTIME_DB_PATH: runtimeFile,
    APP_SECURITY_DB_PATH: securityFile,
    APP_RULE_DB_PATH: ruleFile,
    APP_SQLITE_DB_PATH: sqliteFile,
    APP_STORAGE: process.argv.includes("--storage=sqlite") ? "sqlite" : "json",
    APP_ENABLE_IPC_SHUTDOWN: "true",
    APP_LOGIN_MAX_ATTEMPTS: "3",
    APP_VERIFY_LOGIN_RATE_LIMIT: "true",
    PORT: String(port)
  };
  const output = [];
  const storageLimitBytes = 128 * 1024 * 1024;
  let storagePeakBytes = 0;
  let storageFailure = null;
  const server = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  server.stdout.on("data", (chunk) => output.push(chunk.toString()));
  server.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const storageMonitor = setInterval(() => {
    try {
      storagePeakBytes = Math.max(storagePeakBytes, directorySize(tempRoot));
      if (storagePeakBytes > storageLimitBytes) {
        storageFailure = new Error(`isolated test storage exceeded 128 MB (${(storagePeakBytes / 1024 / 1024).toFixed(2)} MB); largest files: ${JSON.stringify(largestFiles(tempRoot))}`);
      }
    } catch (error) {
      storageFailure = error;
    }
  }, 200);
  storageMonitor.unref();

  try {
    await waitForReady(baseUrl, server, () => output.join("").slice(-4000));
    const verification = spawn(process.execPath, [verifyScript], {
      cwd: ROOT,
      env,
      stdio: "inherit"
    });
    const result = await waitForExit(verification);
    storagePeakBytes = Math.max(storagePeakBytes, directorySize(tempRoot));
    if (storageFailure) throw storageFailure;
    if (result.code !== 0) process.exitCode = result.code || 1;
    console.log(JSON.stringify({ isolatedStoragePeakMb: Number((storagePeakBytes / 1024 / 1024).toFixed(2)) }));
  } finally {
    clearInterval(storageMonitor);
    if (server.exitCode === null) {
      server.send({ type: "shutdown" });
      const stopped = await waitForExit(server);
      if (stopped.code !== 0) throw new Error(`isolated test server did not shut down cleanly (${JSON.stringify(stopped)})\n${output.join("").slice(-4000)}`);
    }
    const resolvedTemp = path.resolve(tempRoot);
    if (path.dirname(resolvedTemp) === path.resolve(os.tmpdir()) && path.basename(resolvedTemp).startsWith("zwkjy-verify-")) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
