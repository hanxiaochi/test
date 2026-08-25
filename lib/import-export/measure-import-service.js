"use strict";

const path = require("node:path");
const { TextDecoder } = require("node:util");
const JSZip = require("jszip");
const readExcelFile = require("read-excel-file/node");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");

const DEFAULT_LIMITS = Object.freeze({ maxBytes: 10 * 1024 * 1024, maxRows: 5000, maxSheets: 5 });
const FIELDS = Object.freeze([
  { name: "billNo", label: "清单编号", required: true, aliases: ["billno", "bill_no", "itemno", "item_no", "清单编号", "清单号", "子目号"] },
  { name: "measureNum", label: "计量数量", required: true, aliases: ["measurenum", "measure_num", "quantity", "currentnum", "current_num", "计量数量", "本期计量数量", "本期数量", "工程量"] },
  { name: "measureNo", label: "计量单号", aliases: ["measureno", "measure_no", "计量单号", "计量编号"] },
  { name: "sectionId", label: "合同段ID", aliases: ["sectionid", "section_id", "contractsectionid", "合同段id", "合同段ID", "合同段编号"] },
  { name: "periodId", label: "工期ID", aliases: ["periodid", "period_id", "工期id", "工期ID", "期次id", "期次ID"] },
  { name: "measureDate", label: "计量日期", aliases: ["measuredate", "measure_date", "date", "计量日期", "日期"] },
  { name: "position", label: "计量部位", aliases: ["position", "location", "计量部位", "部位", "位置"] }
]);

function normalizeHeader(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[\s\-_.()（）【】\[\]：:]+/g, "");
}

const ALIAS_MAP = new Map();
FIELDS.forEach((field) => [field.name, field.label, ...field.aliases].forEach((alias) => ALIAS_MAP.set(normalizeHeader(alias), field.name)));

function limits(options = {}) {
  const value = (name) => {
    const parsed = Number(options[name]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_LIMITS[name];
  };
  return { maxBytes: value("maxBytes"), maxRows: value("maxRows"), maxSheets: value("maxSheets") };
}

function importError(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function normalizeFileName(value) {
  const fileName = String(value || "").normalize("NFC").trim();
  if (!fileName || fileName !== path.basename(fileName) || /[\\/\0-\x1f\x7f]/.test(fileName)) {
    throw importError("导入文件名无效", "MEASURE_IMPORT_FILE_NAME_INVALID");
  }
  const extension = path.extname(fileName).toLowerCase();
  if (![".csv", ".xlsx"].includes(extension)) throw importError("仅支持 CSV 或 XLSX 文件", "MEASURE_IMPORT_TYPE_INVALID");
  return { fileName, extension };
}

function assertBuffer(buffer, options = {}) {
  const configured = limits(options);
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw importError("导入文件内容为空", "MEASURE_IMPORT_EMPTY");
  if (buffer.length > configured.maxBytes) throw importError("导入文件超过大小限制", "MEASURE_IMPORT_TOO_LARGE", 413);
  return configured;
}

function scalarCellValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "formula") || Object.prototype.hasOwnProperty.call(value, "sharedFormula")) {
      throw importError("导入文件不能包含公式单元格", "MEASURE_IMPORT_FORMULA_REJECTED");
    }
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("");
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return scalarCellValue(value.result);
    throw importError("导入文件包含不支持的单元格类型", "MEASURE_IMPORT_CELL_INVALID");
  }
  return value;
}

function mapHeaders(headers) {
  const mapped = [];
  const seen = new Set();
  headers.forEach((header, index) => {
    const field = ALIAS_MAP.get(normalizeHeader(header)) || null;
    if (field && seen.has(field)) throw importError(`表头重复映射到 ${field}`, "MEASURE_IMPORT_DUPLICATE_HEADER");
    if (field) seen.add(field);
    mapped[index] = field;
  });
  const missing = FIELDS.filter((field) => field.required && !seen.has(field.name)).map((field) => field.label);
  if (missing.length) throw importError(`缺少必填表头：${missing.join("、")}`, "MEASURE_IMPORT_HEADER_REQUIRED");
  return mapped;
}

function rowsFromMatrix(matrix, sheetName) {
  if (!Array.isArray(matrix) || !matrix.length) throw importError("导入文件没有表头", "MEASURE_IMPORT_HEADER_REQUIRED");
  const mapped = mapHeaders(matrix[0]);
  const rows = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const values = matrix[index] || [];
    const raw = {};
    let hasValue = false;
    mapped.forEach((field, column) => {
      if (!field) return;
      const value = scalarCellValue(values[column]);
      if (String(value ?? "").trim() !== "") hasValue = true;
      raw[field] = value;
    });
    if (hasValue) rows.push({ raw, sourceRow: index + 1, sheetName });
  }
  return rows;
}

function parseCsv(buffer) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw importError("CSV 必须使用 UTF-8 编码", "MEASURE_IMPORT_CSV_ENCODING");
  }
  let matrix;
  try {
    matrix = parse(text, { bom: true, relax_column_count: false, skip_empty_lines: true, trim: true });
  } catch (error) {
    throw importError(`CSV 格式错误：${error.message}`, "MEASURE_IMPORT_CSV_MALFORMED");
  }
  return rowsFromMatrix(matrix, "CSV");
}

async function assertSafeWorkbook(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false });
  } catch {
    throw importError("XLSX 文件结构损坏", "MEASURE_IMPORT_XLSX_MALFORMED");
  }
  const names = Object.keys(zip.files).map((name) => name.toLowerCase());
  const uncompressedBytes = Object.values(zip.files).reduce((total, file) => total + Number((file._data && file._data.uncompressedSize) || 0), 0);
  if (uncompressedBytes > 50 * 1024 * 1024) throw importError("XLSX 解压后内容超过安全限制", "MEASURE_IMPORT_XLSX_EXPANDED_TOO_LARGE", 413);
  if (names.some((name) => name.includes("vbaproject.bin") || name.startsWith("xl/macrosheets/"))) {
    throw importError("不允许导入包含宏的工作簿", "MEASURE_IMPORT_MACRO_REJECTED");
  }
  if (names.some((name) => name.startsWith("xl/externallinks/"))) {
    throw importError("不允许导入包含外部链接的工作簿", "MEASURE_IMPORT_EXTERNAL_LINK_REJECTED");
  }
  const worksheetEntries = Object.values(zip.files).filter((file) => /^xl\/worksheets\/[^/]+\.xml$/i.test(file.name));
  for (const file of worksheetEntries) {
    const xml = await file.async("string");
    if (/<f(?:\s|>)/i.test(xml)) throw importError("导入文件不能包含公式单元格", "MEASURE_IMPORT_FORMULA_REJECTED");
  }
  const relationshipEntries = Object.values(zip.files).filter((file) => /\.rels$/i.test(file.name));
  for (const file of relationshipEntries) {
    const xml = await file.async("string");
    if (/TargetMode\s*=\s*["']External["']/i.test(xml)) throw importError("不允许导入包含外部链接的工作簿", "MEASURE_IMPORT_EXTERNAL_LINK_REJECTED");
  }
}

async function parseXlsx(buffer, options = {}) {
  await assertSafeWorkbook(buffer);
  const configured = limits(options);
  let sheets;
  try {
    sheets = await readExcelFile(buffer);
  } catch {
    throw importError("XLSX 文件无法解析", "MEASURE_IMPORT_XLSX_MALFORMED");
  }
  if (!sheets.length) throw importError("XLSX 文件不包含工作表", "MEASURE_IMPORT_SHEET_REQUIRED");
  if (sheets.length > configured.maxSheets) throw importError("XLSX 工作表数量超过限制", "MEASURE_IMPORT_TOO_MANY_SHEETS");
  const rows = [];
  sheets.forEach((sheet) => {
    if (sheet.data.length) rows.push(...rowsFromMatrix(sheet.data, sheet.sheet));
  });
  return rows;
}

function cleanString(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function positiveNumber(value) {
  const text = cleanString(value).replace(/,/g, "");
  const parsed = Number(text);
  return text && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function optionalPositiveInteger(value) {
  const text = cleanString(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

function normalizedDate(value) {
  const text = cleanString(value);
  if (!text) return "";
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function validateParsedRows(parsedRows, bills = [], options = {}) {
  const configured = limits(options);
  if (!parsedRows.length) return { ok: false, rows: [], errors: [{ row: 0, field: "file", code: "empty_data", message: "没有可导入的数据行" }], total: 0, valid: 0, invalid: 0 };
  if (parsedRows.length > configured.maxRows) throw importError("导入数据行数超过限制", "MEASURE_IMPORT_TOO_MANY_ROWS", 413);
  const billsByNo = new Map();
  bills.forEach((bill) => {
    const billNo = cleanString(bill.billNo);
    if (!billsByNo.has(billNo)) billsByNo.set(billNo, []);
    billsByNo.get(billNo).push(bill);
  });
  const seen = new Map();
  const errors = [];
  const rows = parsedRows.map((source) => {
    const raw = source.raw || {};
    const rowErrors = [];
    const billNo = cleanString(raw.billNo);
    const candidates = billsByNo.get(billNo) || [];
    const sectionId = optionalPositiveInteger(raw.sectionId);
    const periodId = optionalPositiveInteger(raw.periodId);
    const measureNum = positiveNumber(raw.measureNum);
    if (!billNo) rowErrors.push({ field: "billNo", code: "required", message: "清单编号不能为空" });
    if (!measureNum) rowErrors.push({ field: "measureNum", code: "positive_number", message: "计量数量必须是大于 0 的数字" });
    if (Number.isNaN(sectionId)) rowErrors.push({ field: "sectionId", code: "positive_integer", message: "合同段ID必须是正整数" });
    if (Number.isNaN(periodId)) rowErrors.push({ field: "periodId", code: "positive_integer", message: "工期ID必须是正整数" });
    let bill = null;
    if (billNo && !candidates.length) rowErrors.push({ field: "billNo", code: "unknown_bill", message: "清单编号不存在" });
    else if (candidates.length) {
      const matches = sectionId ? candidates.filter((item) => Number(item.sectionId) === sectionId) : candidates;
      if (!matches.length) rowErrors.push({ field: "sectionId", code: "bill_section_mismatch", message: "清单不属于指定合同段" });
      else if (matches.length > 1) rowErrors.push({ field: "sectionId", code: "ambiguous_bill", message: "该清单编号存在于多个合同段，必须填写合同段ID" });
      else bill = matches[0];
    }
    const duplicateKey = billNo && `${sectionId || (bill && bill.sectionId) || ""}::${billNo}`;
    if (duplicateKey) {
      if (seen.has(duplicateKey)) rowErrors.push({ field: "billNo", code: "duplicate_bill", message: `与第 ${seen.get(duplicateKey)} 行清单重复` });
      else seen.set(duplicateKey, source.sourceRow);
    }
    const measureDate = normalizedDate(raw.measureDate);
    if (raw.measureDate && !measureDate) rowErrors.push({ field: "measureDate", code: "invalid_date", message: "计量日期必须为 YYYY-MM-DD" });
    const row = {
      sourceRow: source.sourceRow,
      sheetName: source.sheetName,
      billId: bill ? Number(bill.billId || bill.id) : null,
      billNo,
      billName: bill ? cleanString(bill.billName) : "",
      measureUnit: bill ? cleanString(bill.measureUnit || bill.unit) : "",
      measureNum: measureNum || 0,
      price: bill ? Number(bill.price || bill.contractPrice || 0) : 0,
      money: bill && measureNum ? Number((measureNum * Number(bill.price || bill.contractPrice || 0)).toFixed(2)) : 0,
      measureNo: cleanString(raw.measureNo),
      sectionId: sectionId || (bill ? Number(bill.sectionId) : null),
      periodId: periodId || null,
      measureDate: measureDate || "",
      position: cleanString(raw.position),
      errors: rowErrors,
      checkStatus: rowErrors.length ? "不通过" : "通过"
    };
    rowErrors.forEach((error) => errors.push({ row: source.sourceRow, sheet: source.sheetName, ...error }));
    return row;
  });
  return { ok: errors.length === 0, rows, errors, total: rows.length, valid: rows.filter((row) => !row.errors.length).length, invalid: rows.filter((row) => row.errors.length).length };
}

async function parseMeasureImport(options = {}) {
  const { fileName, extension } = normalizeFileName(options.fileName);
  const configured = assertBuffer(options.buffer, options);
  const parsedRows = extension === ".csv" ? parseCsv(options.buffer) : await parseXlsx(options.buffer, configured);
  return { fileName, extension, ...validateParsedRows(parsedRows, options.bills || [], configured) };
}

function templateCsv() {
  return stringify([{ billNo: "101-1", measureNum: 1, measureNo: "", sectionId: "", periodId: "", measureDate: "", position: "" }], {
    header: true,
    bom: true,
    columns: FIELDS.map((field) => ({ key: field.name, header: field.label }))
  });
}

function errorReportCsv(result) {
  return stringify((result.errors || []).map((error) => ({
    sheet: error.sheet || "",
    row: error.row || "",
    field: error.field || "",
    code: error.code || "",
    message: error.message || ""
  })), { header: true, bom: true, columns: ["sheet", "row", "field", "code", "message"] });
}

module.exports = {
  DEFAULT_LIMITS,
  FIELDS,
  assertSafeWorkbook,
  errorReportCsv,
  limits,
  mapHeaders,
  normalizeFileName,
  normalizeHeader,
  parseCsv,
  parseMeasureImport,
  parseXlsx,
  rowsFromMatrix,
  scalarCellValue,
  templateCsv,
  validateParsedRows
};
