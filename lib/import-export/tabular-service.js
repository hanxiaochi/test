"use strict";

const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");

function schemaFields(schema) {
  if (!schema || !Array.isArray(schema.fields) || !schema.fields.length) throw new Error("Import schema must define fields");
  return schema.fields;
}

function decodeRows(content, format) {
  const kind = String(format || "csv").toLowerCase();
  if (kind === "json") {
    const rows = JSON.parse(String(content || "[]"));
    if (!Array.isArray(rows)) throw new Error("JSON import must contain an array");
    return rows;
  }
  if (kind !== "csv") throw new Error(`Unsupported import format: ${kind}`);
  return parse(String(content || ""), { bom: true, columns: true, skip_empty_lines: true, trim: true, relax_column_count: false });
}

function coerce(value, field) {
  if (value === undefined || value === null || value === "") return field.defaultValue ?? "";
  if (field.type === "number" || field.type === "integer") {
    const number = Number(String(value).replace(/,/g, ""));
    if (!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number))) throw new Error(field.type === "integer" ? "必须是整数" : "必须是数字");
    return number;
  }
  if (field.type === "boolean") {
    if ([true, 1, "1", "true", "是", "yes"].includes(value)) return true;
    if ([false, 0, "0", "false", "否", "no"].includes(value)) return false;
    throw new Error("必须是布尔值");
  }
  return String(value).trim();
}

function validateRows(rawRows, schema, existingRows = [], mode = "append") {
  const fields = schemaFields(schema);
  const key = String(schema.key || "");
  if (!key || !fields.some((field) => field.name === key)) throw new Error("Import schema must define a valid key");
  if (!["append", "upsert"].includes(mode)) throw new Error("Import mode must be append or upsert");
  const errors = [];
  const rows = [];
  const incomingKeys = new Set();
  const existingKeys = new Set(existingRows.map((row) => String(row[key] ?? "")).filter(Boolean));
  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const result = {};
    fields.forEach((field) => {
      try {
        result[field.name] = coerce(raw[field.name], field);
        if (field.required && (result[field.name] === "" || result[field.name] === null || result[field.name] === undefined)) throw new Error("不能为空");
      } catch (error) {
        errors.push({ row: rowNumber, field: field.name, code: "invalid_value", message: error.message });
      }
    });
    const keyValue = String(result[key] ?? "");
    if (keyValue) {
      if (incomingKeys.has(keyValue)) errors.push({ row: rowNumber, field: key, code: "duplicate_in_file", message: "导入文件内唯一键重复" });
      if (mode === "append" && existingKeys.has(keyValue)) errors.push({ row: rowNumber, field: key, code: "duplicate_existing", message: "唯一键已存在" });
      incomingKeys.add(keyValue);
    }
    rows.push(result);
  });
  return { ok: errors.length === 0, rows, errors, total: rawRows.length };
}

function prepareImport(options = {}) {
  const rawRows = decodeRows(options.content, options.format);
  const validation = validateRows(rawRows, options.schema, options.existingRows || [], options.mode || "append");
  if (!validation.ok) return { ...validation, nextRows: null, inserted: 0, updated: 0 };
  const key = options.schema.key;
  const nextRows = (options.existingRows || []).map((row) => ({ ...row }));
  const index = new Map(nextRows.map((row, position) => [String(row[key]), position]));
  let inserted = 0;
  let updated = 0;
  validation.rows.forEach((row) => {
    const rowKey = String(row[key]);
    if ((options.mode || "append") === "upsert" && index.has(rowKey)) {
      const position = index.get(rowKey);
      nextRows[position] = { ...nextRows[position], ...row };
      updated += 1;
    } else {
      nextRows.push(row);
      index.set(rowKey, nextRows.length - 1);
      inserted += 1;
    }
  });
  return { ...validation, nextRows, inserted, updated };
}

function exportRows(rows, schema, format = "csv") {
  const fields = schemaFields(schema);
  const normalized = (rows || []).map((row) => fields.reduce((result, field) => {
    result[field.name] = row[field.name] ?? "";
    return result;
  }, {}));
  if (String(format).toLowerCase() === "json") return JSON.stringify(normalized, null, 2);
  if (String(format).toLowerCase() !== "csv") throw new Error(`Unsupported export format: ${format}`);
  return stringify(normalized, { header: true, columns: fields.map((field) => field.name), bom: true });
}

module.exports = { coerce, decodeRows, exportRows, prepareImport, schemaFields, validateRows };
