"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const service = require("../../lib/import-export/tabular-service");

const schema = {
  key: "code",
  fields: [
    { name: "code", required: true },
    { name: "name", required: true },
    { name: "quantity", type: "number", defaultValue: 0 },
    { name: "sequence", type: "integer", defaultValue: 0 },
    { name: "enabled", type: "boolean", defaultValue: true }
  ]
};

test("CSV and JSON imports coerce values and apply append/upsert atomically", () => {
  const csv = "code,name,quantity,sequence,enabled\nA-1,Item A,1,2,是\n";
  const append = service.prepareImport({ content: csv, format: "csv", schema, existingRows: [], mode: "append" });
  assert.equal(append.ok, true);
  assert.deepEqual(append.nextRows[0], { code: "A-1", name: "Item A", quantity: 1, sequence: 2, enabled: true });
  assert.equal(append.inserted, 1);
  const upsert = service.prepareImport({ content: JSON.stringify([{ code: "A-1", name: "Updated", quantity: "2,500", sequence: 3, enabled: "false" }]), format: "json", schema, existingRows: append.nextRows, mode: "upsert" });
  assert.equal(upsert.updated, 1);
  assert.equal(upsert.nextRows[0].quantity, 2500);
  assert.equal(upsert.nextRows[0].enabled, false);
});

test("validation reports row-level required, numeric, boolean, and duplicate errors", () => {
  const result = service.prepareImport({
    content: JSON.stringify([
      { code: "X", name: "", quantity: "bad", sequence: "1.2", enabled: "maybe" },
      { code: "X", name: "duplicate", quantity: 1, sequence: 2, enabled: 1 }
    ]),
    format: "json",
    schema,
    existingRows: [{ code: "X" }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.nextRows, null);
  assert.ok(result.errors.some((error) => error.code === "duplicate_existing"));
  assert.ok(result.errors.some((error) => error.code === "duplicate_in_file"));
  assert.ok(result.errors.filter((error) => error.code === "invalid_value").length >= 4);
});

test("exports quote CSV safely and reject malformed contracts", () => {
  const rows = [{ code: "A", name: "Item, quoted", quantity: 1, sequence: 2, enabled: false }];
  const csv = service.exportRows(rows, schema, "csv");
  assert.ok(csv.startsWith("\ufeff"));
  assert.ok(csv.includes('"Item, quoted"'));
  assert.deepEqual(JSON.parse(service.exportRows(rows, schema, "json"))[0], rows[0]);
  assert.throws(() => service.decodeRows("{}", "json"), /array/);
  assert.throws(() => service.decodeRows("", "xml"), /Unsupported/);
  assert.throws(() => service.exportRows([], schema, "xml"), /Unsupported/);
  assert.throws(() => service.schemaFields({ fields: [] }), /define fields/);
  assert.throws(() => service.validateRows([], { fields: [{ name: "x" }] }), /valid key/);
  assert.throws(() => service.validateRows([], schema, [], "replace"), /append or upsert/);
});

test("defaults, boolean aliases, empty exports, and upsert inserts are covered", () => {
  assert.equal(service.coerce(null, {}), "");
  assert.equal(service.coerce("", { defaultValue: 7 }), 7);
  assert.equal(service.coerce("yes", { type: "boolean" }), true);
  assert.equal(service.coerce("否", { type: "boolean" }), false);
  assert.equal(service.coerce(0, { type: "boolean" }), false);
  const inserted = service.prepareImport({ content: JSON.stringify([{ code: "B", name: "B" }]), format: "json", schema, existingRows: [{ code: "A", name: "A" }], mode: "upsert" });
  assert.equal(inserted.inserted, 1);
  assert.equal(inserted.updated, 0);
  assert.equal(service.decodeRows("", "csv").length, 0);
  assert.equal(service.decodeRows().length, 0);
  assert.ok(service.exportRows(undefined, schema).includes("code"));
  assert.ok(service.exportRows([{ code: "C" }], { key: "code", fields: [{ name: "code", label: "编码" }] }).includes("code"));
});
