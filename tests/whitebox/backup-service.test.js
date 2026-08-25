"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createBackup, validateBackup } = require("../../lib/backup/backup-service");

test("backup round trip is deterministic and preserves metadata", () => {
  const state = { projects: [{ projectId: 1, name: "A" }], rules: { b: 2, a: 1 } };
  const bytes = createBackup({ state, createdAt: "2026-08-26T00:00:00.000Z", createdBy: "admin", tenantId: "default", applicationVersion: "1.0.0" });
  const restored = validateBackup(bytes, { tenantId: "default" });
  assert.deepEqual(restored.state, { projects: [{ name: "A", projectId: 1 }], rules: { a: 1, b: 2 } });
  assert.equal(restored.createdBy, "admin");
  assert.equal(restored.checksum.length, 64);
});

test("invalid, cross-tenant, and tampered backups fail closed", () => {
  assert.throws(() => createBackup({ state: null }), /must be an object/);
  assert.throws(() => validateBackup("not-json"), /not valid JSON/);
  assert.throws(() => validateBackup(JSON.stringify({ format: "other" })), /Unsupported/);
  const parsed = JSON.parse(createBackup({ state: { value: 1 }, tenantId: "tenant-a" }).toString("utf8"));
  assert.throws(() => validateBackup(JSON.stringify(parsed), { tenantId: "tenant-b" }), /different tenant/);
  parsed.state.value = 2;
  assert.throws(() => validateBackup(JSON.stringify(parsed), { tenantId: "tenant-a" }), /checksum mismatch/);
});
