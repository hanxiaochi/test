const fs = require("fs");
const path = require("path");
const express = require("express");
const engine = require("./costEngine");

const app = express();
const root = __dirname;
const dataDir = path.join(root, "data");
const port = process.env.PORT || 3100;

app.disable("etag");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

function readText(file, fallback = "") {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return fallback;
  }
}

function authCookie(req) {
  return (req.headers.cookie || "").includes("zwkjy_local_auth=1");
}

function html(res, value) {
  res.type("html").send(value);
}

function json(res, value) {
  res.json(value);
}

function operationOk(res, data = {}) {
  json(res, engine.ok(data));
}

function table(res, req, rows) {
  json(res, engine.table(rows, req));
}

function idsFrom(req, key) {
  const values = [
    req.body[key],
    req.query[key],
    req.params.id,
    req.body.id,
    req.query.id
  ];
  if (key === "ids" || key === "id") {
    [
      "analyzeId",
      "arrivalId",
      "contactId",
      "diasId",
      "gatherId",
      "hangId",
      "attId",
      "attIds",
      "billId",
      "billIds",
      "billMeasureId",
      "billMeasureIds",
      "billMeasureDetailId",
      "secBillId",
      "secBillIds",
      "manualId",
      "manualIds",
      "manualMeasureId",
      "manualMeasureIds",
      "mdmIds",
      "measureId",
      "measureIds",
      "meterialDiasMeasureId",
      "meterialDiasMeasureIds",
      "meterialInMeasureId",
      "meterialInMeasureIds",
      "modelId",
      "nodeId",
      "planId",
      "secMateriaId",
      "secMaterialId",
      "varyId",
      "varyIds",
      "varyDetailId"
    ].forEach((field) => {
      values.push(req.body[field], req.query[field]);
    });
  }
  if (req.body.planData) {
    try {
      const plan = JSON.parse(req.body.planData);
      values.push(plan[key], plan.id, key === "ids" ? plan.planId : undefined);
    } catch {
      // Ignore malformed inline edit payloads and fall back to regular fields.
    }
  }
  return values
    .filter((value) => value !== undefined && value !== null && value !== "")
    .flatMap((value) => String(value).split(","))
    .map((item) => item.trim() === "*" ? "*" : Number(item))
    .filter((item, index, ids) => (item === "*" || (Number.isFinite(item) && item > 0)) && ids.indexOf(item) === index);
}

function ensureWorkflowLogs() {
  engine.db.workflowLogs = Array.isArray(engine.db.workflowLogs) ? engine.db.workflowLogs : [];
  return engine.db.workflowLogs;
}

function workflowModuleFromIdField(idField) {
  return {
    measureId: "billmeasure",
    diasId: "meterialdiasmeasure",
    arrivalId: "meterialinmeasure",
    manualId: "manualmeasure",
    varyId: "varyapplication",
    contactId: "engineeringcontactbill"
  }[idField] || idField || "workflow";
}

function workflowLabel(row, idField) {
  return row.measureNo || row.varyNo || row.contactNo || row.meetingNo || row[idField] || row.id || "";
}

function addWorkflowLog({ module, businessId, businessNo, action, result, userName = "ys1", remark = "" }) {
  const logs = ensureWorkflowLogs();
  const id = nextId(logs, "logId");
  const time = new Date().toISOString().slice(0, 19).replace("T", " ");
  logs.push({
    id,
    logId: id,
    module,
    businessId,
    businessNo,
    step: action,
    userName,
    result,
    time,
    remark
  });
  return id;
}

function workflowLogsFor(req, title = "") {
  const safeReq = req || { body: {}, query: {}, params: {} };
  safeReq.body = safeReq.body || {};
  safeReq.query = safeReq.query || {};
  safeReq.params = safeReq.params || {};
  const rawQuery = {};
  try {
    const parsed = new URL(String(safeReq.originalUrl || safeReq.url || ""), "http://localhost");
    parsed.searchParams.forEach((value, key) => {
      rawQuery[key] = value;
    });
  } catch {
    // Express normally parses query parameters; raw URL parsing is a compatibility fallback.
  }
  const queryValue = (key) => safeReq.query[key] ?? rawQuery[key];
  const type = normalizeWorkflowType(req && (queryValue("measureType") || safeReq.body.measureType || queryValue("businessType") || safeReq.body.businessType || queryValue("type") || safeReq.body.type || ""));
  const module = type || (title.includes("材料补差") ? "meterialdiasmeasure"
    : title.includes("材料到场") ? "meterialinmeasure"
      : title.includes("手动") ? "manualmeasure"
        : title.includes("变更") ? "varyapplication"
          : title.includes("联系") ? "engineeringcontactbill"
            : "billmeasure");
  const resolvedModule = type || (title.includes("材料补差") ? "meterialdiasmeasure"
    : title.includes("材料到场") ? "meterialinmeasure"
      : title.includes("手动") ? "manualmeasure"
        : title.includes("变更") ? "varyapplication"
          : title.includes("联系") ? "engineeringcontactbill"
            : module);
  const config = workflowConfig(resolvedModule);
  const ids = [
    queryValue("ids"),
    safeReq.body.ids,
    queryValue("businessId"),
    safeReq.body.businessId,
    queryValue("id"),
    safeReq.body.id,
    safeReq.params.id,
    queryValue(config.key),
    safeReq.body[config.key]
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .flatMap((value) => String(value).split(","))
    .map((value) => Number(value))
    .filter((value, index, all) => Number.isFinite(value) && value > 0 && all.indexOf(value) === index);
  const businessNos = [
    queryValue("businessNo"),
    queryValue("measureNo"),
    queryValue("varyNo"),
    queryValue("contactNo"),
    safeReq.body.businessNo,
    safeReq.body.measureNo,
    safeReq.body.varyNo,
    safeReq.body.contactNo,
    ...config.rows
      .filter((row) => ids.includes(Number(row[config.key] || row.id)))
      .map((row) => row[config.no] || row.measureNo || row.varyNo || row.contactNo)
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => String(value));
  const logs = ensureWorkflowLogs()
    .filter((log) => (!resolvedModule || log.module === resolvedModule) && (!ids.length || ids.includes(Number(log.businessId))))
    .filter((log) => !businessNos.length || businessNos.includes(String(log.businessNo || "")));
  return ids.length ? logs.slice(-120) : logs.slice(-30);
}

function cleanWorkflowText(value, fallback = "") {
  const text = String(value ?? "").replace(/\?{2,}/g, "").trim();
  if (!text) return fallback;
  if (/^[\x20-\x7E]+$/.test(text)) return text;
  if (/[閸欓弰瀹稿鐎圭粭缂傚〒鐠侀柅閺夐崥]/.test(text)) return fallback;
  return text || fallback;
}

function cleanBusinessText(value, fallback = "") {
  const text = String(value ?? "").replace(/\?{2,}/g, "").trim();
  if (!text || /[鍙鏄宸寰瀹绗缂娓璁閫鏉鍚]/.test(text)) return fallback;
  return text;
}

function cleanBusinessText(value, fallback = "") {
  const text = String(value ?? "").replace(/\?{2,}/g, "").trim();
  if (!text) return fallback;
  if (/[\u934\u93c\u5bb8\u5be\u7c2\u7ca\u7f2\u5a5\u95c\u93d\u935\u5e0]/.test(text)) return fallback;
  return text;
}

function setState(rows, idField, ids, state, context = {}) {
  let changed = 0;
  const allRows = ids.includes("*");
  rows.forEach((row) => {
    if (allRows || !ids.length || ids.includes(Number(row[idField] || row.id))) {
      row.states = state;
      row.updateDate = today();
      row.processInstanceId = row.processInstanceId || `${workflowModuleFromIdField(idField)}-${row[idField] || row.id}`;
      addWorkflowLog({
        module: context.module || workflowModuleFromIdField(idField),
        businessId: Number(row[idField] || row.id || 0),
        businessNo: workflowLabel(row, idField),
        action: context.action || state,
        result: state,
        remark: context.remark || ""
      });
      row.states = row.gatherStateCode === 0 ? "锁定" : "启用";
      row.states = state;
      row.states = row.gatherStateCode === 0 ? "\u9501\u5b9a" : "\u542f\u7528";
      row.states = state;
      changed += 1;
    }
  });
  return changed;
}

function removeRows(rows, idField, ids) {
  if (!ids.length) return 0;
  let changed = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (ids.includes(Number(rows[index][idField] || rows[index].id))) {
      rows.splice(index, 1);
      changed += 1;
    }
  }
  return changed;
}

function csv(res, filename, rows) {
  const data = Array.isArray(rows) ? rows : [];
  const columns = Array.from(data.reduce((set, row) => {
    Object.keys(row).forEach((key) => {
      if (typeof row[key] !== "object") set.add(key);
    });
    return set;
  }, new Set()));
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const body = [columns.join(","), ...data.map((row) => columns.map((key) => escape(row[key])).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\uFEFF" + body);
}

function csvBody(rows) {
  const data = Array.isArray(rows) ? rows : [];
  const columns = Array.from(data.reduce((set, row) => {
    Object.keys(row).forEach((key) => {
      if (typeof row[key] !== "object") set.add(key);
    });
    return set;
  }, new Set()));
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return "\uFEFF" + [columns.join(","), ...data.map((row) => columns.map((key) => escape(row[key])).join(","))].join("\n");
}

function ensureExportDir() {
  const dir = path.join(dataDir, "exports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveCsvExport(filename, rows) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const safeName = `${stamp}-${path.basename(filename)}`;
  const dir = ensureExportDir();
  fs.writeFileSync(path.join(dir, safeName), csvBody(rows), "utf8");
  return {
    fileDir: "/data/exports",
    fileName: safeName,
    url: `/data/exports/${safeName}`
  };
}

function saveExportBuffer(filename, data) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const safeName = `${stamp}-${path.basename(filename)}`;
  const dir = ensureExportDir();
  fs.writeFileSync(path.join(dir, safeName), data);
  return {
    fileDir: "/data/exports",
    fileName: safeName,
    url: `/data/exports/${safeName}`
  };
}

function isAjaxExport(req) {
  return req.method !== "GET" || String(req.headers["x-requested-with"] || "").toLowerCase() === "xmlhttprequest";
}

function exportCsvOrTicket(req, res, filename, rows, ticketShape = "url") {
  if (!isAjaxExport(req)) {
    csv(res, filename, rows);
    return;
  }
  const saved = saveCsvExport(filename, rows);
  operationOk(res, ticketShape === "array" ? [saved.fileDir, saved.fileName] : saved.url);
}

function reportExportRows(req) {
  const rawIds = req.body.rpIds || req.query.rpIds || req.body.ids || req.query.ids || req.body.rpId || req.query.rpId;
  const ids = idsFromQueryValue(rawIds);
  return reportPaymentRows(ids);
}

function reportPaymentRows(ids = []) {
  const materialArrivalBySection = engine.materialArrivalRows().reduce((acc, row) => {
    const sectionId = Number(row.sectionId || 0);
    const current = acc.get(sectionId) || { materialArrivalMoney: 0, materialArrivalCount: 0 };
    current.materialArrivalMoney += Number(row.money || 0);
    current.materialArrivalCount += 1;
    acc.set(sectionId, current);
    return acc;
  }, new Map());
  return engine.reportProjectRows()
    .filter((row) => !ids.length || ids.includes(Number(row.sectionId || row.rpId)))
    .map((row) => {
      const arrival = materialArrivalBySection.get(Number(row.sectionId || 0)) || {};
      return {
        ...row,
        billMeasureMoney: Number(row.measureMoney || row.currentPayMoney || 0),
        materialArrivalMoney: Number(arrival.materialArrivalMoney || 0),
        materialArrivalCount: Number(arrival.materialArrivalCount || 0),
        materialAdvanceMoney: Number(row.materialAdvanceMoney || 0),
        materialDeductionMoney: Number(row.materialDeductionMoney || 0),
        retentionMoney: Number(row.retentionMoney || 0),
        mobilizationDeductionMoney: Number(row.mobilizationDeductionMoney || 0),
        payableFormula: row.payableFormula || engine.payableFormulaText(),
        arrivalRule: "JL109材料到场按预付率形成材料设备垫付款"
      };
    });
}

function queryNumber(req, key) {
  return Number(req.query[key] || req.body[key] || 0);
}

function queryText(req, key) {
  return String(req.query[key] || req.body[key] || "");
}

function reportBillPayPeriodRows(req) {
  const ids = idsFromAny(req, ["billPayId", "billId"]);
  const billId = ids[0] || 0;
  const baseRows = engine.billLedgerRows();
  const base = baseRows.find((row) => Number(row.billPayId || row.billId) === Number(billId))
    || baseRows.find((row) => ids.includes(Number(row.billPayId || row.billId)))
    || baseRows[0]
    || {};
  const targetBillId = Number(base.billPayId || base.billId || billId || 0);
  let cumulativeNum = 0;
  return (engine.db.measurePeriods || [])
    .map((period, index) => {
      const gatherId = Number(period.gatherId || period.id || index + 1);
      const currentNum = (engine.db.measures || [])
        .filter((measure) => Number(measure.periodId || measure.gatherId || 0) === gatherId)
        .flatMap((measure) => Array.isArray(measure.details) ? measure.details : [])
        .filter((detail) => Number(detail.billId || 0) === targetBillId)
        .reduce((sum, detail) => sum + Number(detail.measureNum || detail.currentNum || 0), 0);
      cumulativeNum += currentNum;
      const price = Number(base.contractPrice || base.price || 0);
      const currentMoney = Number((currentNum * price).toFixed(2));
      const cumulativeMoney = Number((cumulativeNum * price).toFixed(2));
      const remainAmount = Number((Number(base.contractSumAmount || base.finalNum || 0) - cumulativeNum).toFixed(3));
      const remainMoney = Number((Number(base.contractSumMoney || base.finalMoney || 0) - cumulativeMoney).toFixed(2));
      return {
        ...base,
        gatherId,
        gatherNo: period.gatherNo || period.periodDesc || gatherId,
        periodDesc: period.periodDesc || period.gatherNo || `第 ${gatherId} 期`,
        measureNum: Number(cumulativeNum.toFixed(3)),
        afterFinishNumSum: Number(cumulativeNum.toFixed(3)),
        currentFinishNumSum: Number(currentNum.toFixed(3)),
        currentMeasureMoney: currentMoney,
        measureMoney: cumulativeMoney,
        remainNum: remainAmount,
        remainAmount,
        remainMoney,
        measureRate: Number(base.contractSumMoney || base.finalMoney || 0)
          ? Number(((cumulativeMoney / Number(base.contractSumMoney || base.finalMoney || 0)) * 100).toFixed(2))
          : 0
      };
    });
}

function filteredBillMeasureRows(req) {
  const sectionId = queryNumber(req, "sectionId");
  const periodId = queryNumber(req, "periodId") || queryNumber(req, "gatherId");
  const state = queryText(req, "state");
  return engine.measureRows().filter((row) => {
    if (sectionId && Number(row.sectionId || 0) !== sectionId) return false;
    if (periodId && Number(row.periodId || row.gatherId || 0) !== periodId) return false;
    if (state && !String(row.states || "").includes(state)) return false;
    return true;
  });
}

function filteredMaterialDiasRows(req) {
  const sectionId = queryNumber(req, "sectionId");
  const state = queryText(req, "state");
  return engine.materialDiasRows().filter((row) => {
    if (sectionId && Number(row.sectionId || 0) !== sectionId) return false;
    if (state && String(row.states || "") !== state) return false;
    return true;
  });
}

function filteredMaterialArrivalRows(req) {
  const sectionId = queryNumber(req, "sectionId");
  const state = queryText(req, "state");
  return engine.materialArrivalRows().filter((row) => {
    if (sectionId && Number(row.sectionId || 0) !== sectionId) return false;
    if (state && String(row.states || "") !== state) return false;
    return true;
  });
}

function filteredManualMeasureRows(req) {
  const sectionId = queryNumber(req, "sectionId");
  const state = queryText(req, "state");
  return engine.manualMeasureRows().filter((row) => {
    if (sectionId && Number(row.sectionId || 0) !== sectionId) return false;
    if (state && String(row.states || "") !== state) return false;
    return true;
  });
}

function reportExportHtml(rows, title = "计量支付报表") {
  const safeRows = Array.isArray(rows) ? rows : [];
  const body = safeRows.map((row) => `
      <tr>
        <td>${htmlEscape(row.sectionName || "")}</td>
        <td>${htmlEscape(row.contractNo || "")}</td>
        <td>${row.contractMoney || 0}</td>
        <td>${row.finalMoney || 0}</td>
        <td>${row.billMeasureMoney || row.measureMoney || 0}</td>
        <td>${row.materialDiasMoney || 0}</td>
        <td>${row.materialArrivalMoney || 0}</td>
        <td>${row.manualMoney || 0}</td>
        <td>${row.totalPayMoney || 0}</td>
        <td>${row.payRate || 0}%</td>
      </tr>`).join("");
  const summary = safeRows.reduce((acc, row) => {
    acc.contractMoney += Number(row.contractMoney || 0);
    acc.finalMoney += Number(row.finalMoney || 0);
    acc.billMeasureMoney += Number(row.billMeasureMoney || row.measureMoney || 0);
    acc.materialDiasMoney += Number(row.materialDiasMoney || 0);
    acc.materialArrivalMoney += Number(row.materialArrivalMoney || 0);
    acc.manualMoney += Number(row.manualMoney || 0);
    acc.totalPayMoney += Number(row.totalPayMoney || 0);
    return acc;
  }, { contractMoney: 0, finalMoney: 0, billMeasureMoney: 0, materialDiasMoney: 0, materialArrivalMoney: 0, manualMoney: 0, totalPayMoney: 0 });
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${htmlEscape(title)}</title>
  <style>
    body{font-family:Arial,"Microsoft YaHei",sans-serif;margin:28px;color:#222;}
    h1{font-size:22px;margin:0 0 16px;text-align:center;}
    table{border-collapse:collapse;width:100%;font-size:13px;}
    th,td{border:1px solid #888;padding:7px 8px;text-align:center;}
    th{background:#f2f2f2;}
    .summary{margin:12px 0 18px;display:flex;gap:18px;font-weight:600;}
  </style>
</head>
<body>
  <h1>${htmlEscape(title)}</h1>
  <div class="summary">
    <span>合同金额：${Number(summary.contractMoney.toFixed(2))}</span>
    <span>最终金额：${Number(summary.finalMoney.toFixed(2))}</span>
    <span>清单计量：${Number(summary.billMeasureMoney.toFixed(2))}</span>
    <span>材料补差：${Number(summary.materialDiasMoney.toFixed(2))}</span>
    <span>材料到场：${Number(summary.materialArrivalMoney.toFixed(2))}</span>
    <span>手动计量：${Number(summary.manualMoney.toFixed(2))}</span>
    <span>累计支付：${Number(summary.totalPayMoney.toFixed(2))}</span>
  </div>
  <table>
    <thead><tr><th>合同段</th><th>合同编号</th><th>合同金额</th><th>最终金额</th><th>清单计量</th><th>材料补差</th><th>材料到场</th><th>手动计量</th><th>累计支付</th><th>支付比例</th></tr></thead>
    <tbody>${body || '<tr><td colspan="10">暂无报表数据</td></tr>'}</tbody>
  </table>
</body>
</html>`;
}

function reportExportContent(req) {
  const rows = reportExportRows(req);
  const type = String(req.body.exportType || req.query.exportType || "excel").toLowerCase();
  if (type === "pdf") {
    return {
      filename: "payment-report-print.html",
      contentType: "text/html; charset=utf-8",
      data: Buffer.from(reportExportHtml(rows, "计量支付报表 PDF预览"), "utf8")
    };
  }
  if (type === "word") {
    return {
      filename: "payment-report-word.doc",
      contentType: "application/msword; charset=utf-8",
      data: Buffer.from(reportExportHtml(rows, "计量支付报表 Word文档"), "utf8")
    };
  }
  if (type === "all") {
    const files = [
      { name: "payment-report.csv", data: csvBody(rows) },
      { name: "payment-report-print.html", data: reportExportHtml(rows, "计量支付报表打印版") },
      { name: "payment-report-word.doc", data: reportExportHtml(rows, "计量支付报表 Word文档") }
    ];
    return {
      filename: "payment-report-bundle.zip",
      contentType: "application/zip",
      data: zipBuffer(files)
    };
  }
  return {
    filename: "payment-report.csv",
    contentType: "text/csv; charset=utf-8",
    data: Buffer.from(csvBody(rows), "utf8")
  };
}

function exportReport(req, res) {
  const payload = reportExportContent(req);
  if (!isAjaxExport(req)) {
    res.setHeader("Content-Type", payload.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${payload.filename}"`);
    res.send(payload.data);
    return;
  }
  const saved = saveExportBuffer(payload.filename, payload.data);
  operationOk(res, [saved.fileDir, saved.fileName]);
}

function resolveExportFile(req) {
  const source = req.body.url || req.query.url || req.body.src || req.query.src || "";
  const fileName = req.body.file_name || req.query.file_name || req.body.fileName || req.query.fileName || "";
  const sourceName = source ? path.basename(String(source).replace(/\\/g, "/")) : "";
  const name = path.basename(String(fileName || sourceName || ""));
  if (!name) return "";
  const fullPath = path.join(ensureExportDir(), name);
  return fullPath.startsWith(ensureExportDir()) ? fullPath : "";
}

function downloadExport(req, res, fallbackName, fallbackRows) {
  const file = resolveExportFile(req);
  if (file && fs.existsSync(file)) {
    res.download(file, path.basename(file));
    return;
  }
  csv(res, fallbackName, fallbackRows);
}

const crcTable = (() => {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0 ^ -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[index]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, dosDate };
}

function zipBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, dosDate } = dosDateTime();
  files.forEach((file) => {
    const name = Buffer.from(file.name.replace(/\\/g, "/"), "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data || ""), "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  });
  const centralOffset = offset;
  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBuffer, end]);
}

function downloadDocumentZip(req, res) {
  const ids = idsFrom(req, "nodeId").concat(idsFrom(req, "ids"));
  const rows = engine.documentRows().filter((row) => !ids.length || ids.includes(Number(row.nodeId || row.id)));
  const selected = rows.length ? rows : engine.documentRows();
  const manifest = selected.map((row) => ({
    nodeId: row.nodeId,
    dataNo: row.dataNo || `ZL-${String(row.nodeId).padStart(3, "0")}`,
    title: row.title || row.dataName,
    type: row.type,
    createDate: row.createDate || row.createTime,
    fileCount: row.fileCount || 0,
    remark: row.remark || ""
  }));
  const attachmentFiles = selected.flatMap((row) => {
    const nodeId = row.nodeId || row.id;
    const attachments = Array.isArray(row.attachments) ? row.attachments : [];
    return attachments.map((attachment, index) => {
      const attachmentId = attachment.attachmentId || attachment.id || index + 1;
      const fileName = attachment.fileName || `attachment-${attachmentId}.txt`;
      const detail = [
        `资料编号: ${row.dataNo || `ZL-${String(nodeId).padStart(3, "0")}`}`,
        `资料名称: ${row.title || row.dataName || row.nodeName || ""}`,
        `附件名称: ${fileName}`,
        `上传人: ${attachment.uploadUser || "ys1"}`,
        `上传日期: ${attachment.uploadDate || ""}`,
        `大小: ${attachment.size || 0}`,
        `说明: ${attachment.remark || ""}`
      ].join("\n");
      return {
        name: `attachments/${String(nodeId).padStart(4, "0")}-${String(attachmentId).padStart(3, "0")}-${safeZipName(fileName, `attachment-${attachmentId}`)}.txt`,
        data: `${detail}\n`
      };
    });
  });
  const files = [
    { name: "documents.csv", data: csvBody(manifest) },
    { name: "README.txt", data: `Project information export\nGenerated: ${today()}\nRecords: ${manifest.length}\n` },
    ...selected.map((row) => {
      const nodeId = row.nodeId || row.id;
      const title = cleanBusinessText(row.title || row.dataName || row.nodeName, `资料 ${nodeId}`);
      const detail = [
        `资料编号: ${row.dataNo || `ZL-${String(nodeId).padStart(3, "0")}`}`,
        `资料名称: ${title}`,
        `资料类型: ${cleanBusinessText(row.type, "工程资料")}`,
        `父级节点: ${row.parentId || 0}`,
        `创建日期: ${row.createDate || row.createTime || ""}`,
        `文件数量: ${row.fileCount || 0}`,
        `创建人: ${cleanBusinessText(row.createUserName, "ys1")}`,
        `备注: ${cleanBusinessText(row.remark, "")}`
      ].join("\n");
      return {
        name: `documents/${String(nodeId).padStart(4, "0")}-${safeZipName(title, `document-${nodeId}`)}.txt`,
        data: `${detail}\n`
      };
    }),
    ...attachmentFiles
  ];
  const zip = zipBuffer(files);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="project-information.zip"');
  res.send(zip);
}

function persist() {
  const file = path.join(dataDir, "runtime-db.json");
  fs.writeFileSync(file, JSON.stringify(engine.db, null, 2), "utf8");
}

function mutate(res, fn) {
  const result = fn();
  persist();
  operationOk(res, result);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeZipName(value, fallback = "document") {
  const name = cleanBusinessText(value, fallback)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return name || fallback;
}

function normalizeNode(node) {
  const children = Array.isArray(node.sysBusinessResources)
    ? node.sysBusinessResources.map(normalizeNode)
    : [];
  return {
    id: node.resourceId,
    title: node.resourceName,
    href: node.resourceUrl || `sbr/sbr_com/${node.resourceId}`,
    icon: node.menuIcon || "layui-icon layui-icon-template-1",
    children,
    childrenCount: children.length
  };
}

function allLeaves(items, out = []) {
  for (const item of items || []) {
    const children = Array.isArray(item.sysBusinessResources) ? item.sysBusinessResources : [];
    if (children.length) allLeaves(children, out);
    else out.push(item);
  }
  return out;
}

const topMenuRaw = readJson(path.join(dataDir, "api_menu_utf8.json"), { data: [] }).data || [];
topMenuRaw.push({
  appImageUrl: "",
  appPageUrl: "",
  controllerDes: "",
  flagFlow: 1,
  isShow: 1,
  menuIcon: "layui-icon layui-icon-set",
  parentId: 0,
  refreshType: 1,
  resourceCode: "9900",
  resourceDes: "本地后台管理",
  resourceId: 9000,
  resourceLevel: 0,
  resourceName: "后台管理",
  resourceNo: "root",
  resourceUrl: "",
  sysBusinessResources: "",
  sysIdentityResources: ""
});
const topMenu = topMenuRaw.map((item) => ({
  id: item.resourceId,
  title: item.resourceName,
  href: item.resourceUrl || "",
  icon: item.menuIcon || "layui-icon layui-icon-template-1",
  children: [],
  childrenCount: ({ 2: 8, 3: 3, 7: 6, 409: 1 })[item.resourceId] || 1
}));

const leftMenus = new Map();
for (const item of topMenuRaw) {
  const raw = readJson(path.join(dataDir, `api_left_${item.resourceId}.json`), { data: [] }).data || [];
  leftMenus.set(String(item.resourceId), raw);
}
leftMenus.set("9000", [
  {
    appImageUrl: "",
    appPageUrl: "",
    controllerDes: "",
    flagFlow: 1,
    isShow: 1,
    menuIcon: "layui-icon layui-icon-console",
    parentId: 9000,
    refreshType: 1,
    resourceCode: "990000",
    resourceDes: "本地工程造价后台首页",
    resourceId: 9003,
    resourceLevel: 0,
    resourceName: "后台首页",
    resourceNo: "model",
    resourceUrl: "admin/dashboard_page",
    sysBusinessResources: [],
    sysIdentityResources: ""
  },
  {
    appImageUrl: "",
    appPageUrl: "",
    controllerDes: "",
    flagFlow: 1,
    isShow: 1,
    menuIcon: "layui-icon layui-icon-set",
    parentId: 9000,
    refreshType: 1,
    resourceCode: "990001",
    resourceDes: "工程造价计算规则",
    resourceId: 9001,
    resourceLevel: 0,
    resourceName: "计算规则管理",
    resourceNo: "root",
    resourceUrl: "",
    sysBusinessResources: [
      {
        appImageUrl: "",
        appPageUrl: "",
        controllerDes: "",
        flagFlow: 1,
        isShow: 1,
        menuIcon: "layui-icon layui-icon-form",
        parentId: 9001,
        refreshType: 1,
        resourceCode: "99000101",
        resourceDes: "修改计量支付公式、小数位和审核比例",
        resourceId: 9002,
        resourceLevel: 1,
        resourceName: "计算规则后台",
        resourceNo: "model",
        resourceUrl: "admin/calculation_rules_page",
        sysBusinessResources: [],
        sysIdentityResources: ""
      },
      {
        appImageUrl: "",
        appPageUrl: "",
        controllerDes: "",
        flagFlow: 1,
        isShow: 1,
        menuIcon: "layui-icon layui-icon-template-1",
        parentId: 9001,
        refreshType: 1,
        resourceCode: "99000102",
        resourceDes: "按JL104/JL105/JL113核对计量支付报表",
        resourceId: 9004,
        resourceLevel: 1,
        resourceName: "JL计量支付报表",
        resourceNo: "model",
        resourceUrl: "payment/jl_report_page",
        sysBusinessResources: [],
        sysIdentityResources: ""
      }
    ],
    sysIdentityResources: ""
  }
]);

const leavesById = new Map();
for (const raw of leftMenus.values()) {
  for (const leaf of allLeaves(raw)) leavesById.set(String(leaf.resourceId), leaf);
}

function dashboardHtml(title = "工作台") {
  const summary = engine.dashboard();
  const cards = [
    ["合同金额", summary.contractSumMoney],
    ["最终金额", summary.finalMoney],
    ["累计计量", summary.measuredMoney],
    ["应付金额", summary.payableMoney],
    ["支付比例", `${summary.payRate}%`],
    ["变更金额", summary.varyMoney],
    ["材料补差", summary.materialDiasMoney],
    ["手动计量", summary.manualMoney]
  ]
    .map(([label, value]) => `
      <div class="layui-col-md3">
        <div class="layui-card">
          <div class="layui-card-header">${label}</div>
          <div class="layui-card-body" style="font-size:20px;font-weight:600;">${value}</div>
        </div>
      </div>`)
    .join("");
  return `
    <div class="layui-fluid">
      <div class="layui-card">
        <div class="layui-card-header" style="display:flex;justify-content:space-between;align-items:center;">
          <span>${title}</span>
          <a class="layui-btn layui-btn-sm" href="/admin/calculation_rules_page">计算规则后台</a>
        </div>
        <div class="layui-card-body">
          <div class="layui-row layui-col-space15">${cards}</div>
          <div style="margin-top:12px;color:#64748b;">当前应付公式：${htmlEscape(summary.payableFormula || engine.payableFormulaText())}</div>
        </div>
      </div>
    </div>`;
}

function boolFromBody(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "on", "yes"].includes(String(value).toLowerCase());
}

function numberFromBody(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function monthListFromBody(value, fallback = [1, 4, 7, 10]) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,\s，、]+/);
  const months = raw
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 12);
  return Array.from(new Set(months.length ? months : fallback)).sort((a, b) => a - b);
}

function saveCalculationRules(body = {}) {
  const current = engine.calculationRules();
  const next = {
    moneyDigits: numberFromBody(body.moneyDigits, current.moneyDigits, 0, 6),
    quantityDigits: numberFromBody(body.quantityDigits, current.quantityDigits, 0, 6),
    priceDigits: numberFromBody(body.priceDigits, current.priceDigits, 0, 6),
    includeBillMeasure: boolFromBody(body.includeBillMeasure, false),
    includeMaterialAdjust: boolFromBody(body.includeMaterialAdjust, false),
    includeMaterialArrival: boolFromBody(body.includeMaterialArrival, false),
    includeMaterialAdvance: boolFromBody(body.includeMaterialAdvance, current.includeMaterialAdvance),
    includeManualMeasure: boolFromBody(body.includeManualMeasure, false),
    includeRetention: boolFromBody(body.includeRetention, current.includeRetention),
    auditSupervisorRate: numberFromBody(body.auditSupervisorRate, current.auditSupervisorRate, 0, 100),
    auditOwnerRate: numberFromBody(body.auditOwnerRate, current.auditOwnerRate, 0, 100),
    auditFinalRate: numberFromBody(body.auditFinalRate, current.auditFinalRate, 0, 100),
    materialAdvanceRate: numberFromBody(body.materialAdvanceRate, current.materialAdvanceRate, 0, 100),
    retentionRate: numberFromBody(body.retentionRate, current.retentionRate, 0, 100),
    mobilizationAdvanceRate: numberFromBody(body.mobilizationAdvanceRate, current.mobilizationAdvanceRate, 0, 100),
    mobilizationDeductionStartRate: numberFromBody(body.mobilizationDeductionStartRate, current.mobilizationDeductionStartRate, 0, 100),
    mobilizationDeductionEndRate: numberFromBody(body.mobilizationDeductionEndRate, current.mobilizationDeductionEndRate, 0, 100),
    materialDeductionMoney: numberFromBody(body.materialDeductionMoney, current.materialDeductionMoney, -999999999999, 999999999999),
    previousMaterialDeductionMoney: numberFromBody(body.previousMaterialDeductionMoney, current.previousMaterialDeductionMoney, -999999999999, 999999999999),
    cumulativeMaterialDeductionMoney: numberFromBody(body.cumulativeMaterialDeductionMoney, current.cumulativeMaterialDeductionMoney, -999999999999, 999999999999),
    mobilizationAdvanceMoney: numberFromBody(body.mobilizationAdvanceMoney, current.mobilizationAdvanceMoney, -999999999999, 999999999999),
    claimsMoney: numberFromBody(body.claimsMoney, current.claimsMoney, -999999999999, 999999999999),
    penaltyMoney: numberFromBody(body.penaltyMoney, current.penaltyMoney, -999999999999, 999999999999),
    interestMoney: numberFromBody(body.interestMoney, current.interestMoney, -999999999999, 999999999999),
    otherAdjustmentMoney: numberFromBody(body.otherAdjustmentMoney, current.otherAdjustmentMoney, -999999999999, 999999999999),
    provisionalCurrentMoney: numberFromBody(body.provisionalCurrentMoney, current.provisionalCurrentMoney, -999999999999, 999999999999),
    jl115EndPeriod: numberFromBody(body.jl115EndPeriod, current.jl115EndPeriod, 0, 999),
    jlPriceAdjustmentMonths: monthListFromBody(body.jlPriceAdjustmentMonths, current.jlPriceAdjustmentMonths)
  };
  engine.db.calculationRules = next;
  return {
    changed: 1,
    rules: engine.calculationRules(),
    summary: engine.contractSummary()
  };
}

function checked(value) {
  return value ? "checked" : "";
}

function calculationRulesPageHtml() {
  const rules = engine.calculationRules();
  const summary = engine.contractSummary();
  const rows = [
    ["合同金额", moneyText(summary.contractSumMoney)],
    ["最终金额", moneyText(summary.finalMoney)],
    ["清单计量", moneyText(summary.measuredMoney)],
    ["材料补差", moneyText(summary.materialDiasMoney)],
    ["材料到场", moneyText(summary.materialArrivalMoney)],
    ["材料设备垫付款", moneyText(summary.materialAdvanceMoney)],
    ["扣回材料设备垫付款", moneyText(summary.materialDeductionMoney)],
    ["保留金", moneyText(summary.retentionMoney)],
    ["扣回动员预付款", moneyText(summary.mobilizationDeductionMoney)],
    ["手动计量", moneyText(summary.manualMoney)],
    ["JL104本期实际支付", moneyText(summary.payableMoney)],
    ["支付比例", percentText(summary.payRate)]
  ].map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join("");
  return `
    <div class="layui-fluid calc-admin">
      <style>
        .calc-admin { padding:16px; background:#f5f7fb; color:#172033; }
        .calc-admin-shell { max-width:1180px; margin:0 auto; display:grid; grid-template-columns:minmax(0, 1.3fr) minmax(320px, .7fr); gap:14px; }
        .calc-admin-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:16px; }
        .calc-admin-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:14px; }
        .calc-admin-head h2 { margin:0; font-size:20px; font-weight:600; }
        .calc-admin-head p { margin:6px 0 0; color:#64748b; }
        .calc-admin-grid { display:grid; grid-template-columns:repeat(3, minmax(160px, 1fr)); gap:12px; }
        .calc-admin-field label { display:block; margin-bottom:6px; color:#475569; }
        .calc-admin-field input[type="number"], .calc-admin-field input[type="text"] { width:100%; height:34px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; box-sizing:border-box; }
        .calc-admin-checks { display:grid; grid-template-columns:repeat(2, minmax(180px, 1fr)); gap:10px; margin:12px 0; }
        .calc-admin-checks label { display:flex; align-items:center; gap:8px; border:1px solid #dbe4f0; border-radius:4px; padding:10px; }
        .calc-admin-formula { margin:12px 0; padding:10px 12px; background:#f8fafc; border:1px solid #dbe4f0; color:#0369a1; }
        .calc-admin-actions { display:flex; gap:8px; align-items:center; margin-top:14px; }
        .calc-admin-summary table { margin:0; }
        @media (max-width: 900px) { .calc-admin-shell { grid-template-columns:1fr; } .calc-admin-grid, .calc-admin-checks { grid-template-columns:1fr; } }
      </style>
      <div class="calc-admin-shell">
        <div class="calc-admin-panel">
          <div class="calc-admin-head">
            <div>
              <h2>计算规则管理后台</h2>
              <p>维护计量支付公式、小数位和审核比例；保存后项目汇总、合同段汇总和计算接口立即按新规则计算。</p>
            </div>
            <a class="layui-btn layui-btn-primary layui-btn-sm" href="/main">返回工作台</a>
          </div>
          <form id="calc-rules-form">
            <div class="calc-admin-grid">
              <div class="calc-admin-field"><label>金额小数位</label><input type="number" name="moneyDigits" min="0" max="6" value="${rules.moneyDigits}"></div>
              <div class="calc-admin-field"><label>数量小数位</label><input type="number" name="quantityDigits" min="0" max="6" value="${rules.quantityDigits}"></div>
              <div class="calc-admin-field"><label>单价小数位</label><input type="number" name="priceDigits" min="0" max="6" value="${rules.priceDigits}"></div>
              <div class="calc-admin-field"><label>监理审核比例(%)</label><input type="number" step="0.01" name="auditSupervisorRate" value="${rules.auditSupervisorRate}"></div>
              <div class="calc-admin-field"><label>业主审核比例(%)</label><input type="number" step="0.01" name="auditOwnerRate" value="${rules.auditOwnerRate}"></div>
              <div class="calc-admin-field"><label>最终审定比例(%)</label><input type="number" step="0.01" name="auditFinalRate" value="${rules.auditFinalRate}"></div>
              <div class="calc-admin-field"><label>材料预付率(%)</label><input type="number" step="0.01" name="materialAdvanceRate" value="${rules.materialAdvanceRate}"></div>
              <div class="calc-admin-field"><label>保留金率(%)</label><input type="number" step="0.01" name="retentionRate" value="${rules.retentionRate}"></div>
              <div class="calc-admin-field"><label>动员预付款率(%)</label><input type="number" step="0.01" name="mobilizationAdvanceRate" value="${rules.mobilizationAdvanceRate}"></div>
              <div class="calc-admin-field"><label>动员扣回起点(%)</label><input type="number" step="0.01" name="mobilizationDeductionStartRate" value="${rules.mobilizationDeductionStartRate}"></div>
              <div class="calc-admin-field"><label>动员扣回完成点(%)</label><input type="number" step="0.01" name="mobilizationDeductionEndRate" value="${rules.mobilizationDeductionEndRate}"></div>
              <div class="calc-admin-field"><label>JL115出现至第几期</label><input type="number" step="1" min="0" name="jl115EndPeriod" value="${rules.jl115EndPeriod}"></div>
              <div class="calc-admin-field"><label>JL108/JL116调差月份</label><input type="text" name="jlPriceAdjustmentMonths" value="${htmlEscape(rules.jlPriceAdjustmentMonths.join(","))}"></div>
              <div class="calc-admin-field"><label>本期材料扣回</label><input type="number" step="0.01" name="materialDeductionMoney" value="${rules.materialDeductionMoney}"></div>
              <div class="calc-admin-field"><label>到上期末材料扣回</label><input type="number" step="0.01" name="previousMaterialDeductionMoney" value="${rules.previousMaterialDeductionMoney}"></div>
              <div class="calc-admin-field"><label>到本期末材料扣回</label><input type="number" step="0.01" name="cumulativeMaterialDeductionMoney" value="${rules.cumulativeMaterialDeductionMoney}"></div>
              <div class="calc-admin-field"><label>索赔金额</label><input type="number" step="0.01" name="claimsMoney" value="${rules.claimsMoney}"></div>
              <div class="calc-admin-field"><label>违约罚金</label><input type="number" step="0.01" name="penaltyMoney" value="${rules.penaltyMoney}"></div>
              <div class="calc-admin-field"><label>迟付款利息</label><input type="number" step="0.01" name="interestMoney" value="${rules.interestMoney}"></div>
            </div>
            <div class="calc-admin-checks">
              <label><input type="checkbox" name="includeBillMeasure" ${checked(rules.includeBillMeasure)}>清单计量进入应付</label>
              <label><input type="checkbox" name="includeMaterialAdjust" ${checked(rules.includeMaterialAdjust)}>材料补差进入应付</label>
              <label><input type="checkbox" name="includeMaterialArrival" ${checked(rules.includeMaterialArrival)}>材料到场进入应付</label>
              <label><input type="checkbox" name="includeMaterialAdvance" ${checked(rules.includeMaterialAdvance)}>JL109材料到场按预付率进入JL104</label>
              <label><input type="checkbox" name="includeRetention" ${checked(rules.includeRetention)}>按小计扣保留金</label>
              <label><input type="checkbox" name="includeManualMeasure" ${checked(rules.includeManualMeasure)}>手动计量进入应付</label>
            </div>
            <div class="calc-admin-formula">当前公式：<strong>${htmlEscape(summary.payableFormula)}</strong></div>
            <div class="calc-admin-actions">
              <button type="button" class="layui-btn" id="save-calc-rules">保存规则</button>
              <button type="button" class="layui-btn layui-btn-primary" onclick="(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())">刷新汇总</button>
              <span id="calc-rules-msg" style="color:#64748b;"></span>
            </div>
          </form>
        </div>
        <div class="calc-admin-panel calc-admin-summary">
          <h3 style="margin:0 0 10px;font-size:16px;">当前汇总影响</h3>
          <table class="layui-table" lay-size="sm"><tbody>${rows}</tbody></table>
        </div>
      </div>
      <script>
        (function(){
          var btn = document.getElementById('save-calc-rules');
          var form = document.getElementById('calc-rules-form');
          var msg = document.getElementById('calc-rules-msg');
          btn.addEventListener('click', function(){
            var data = {};
            Array.prototype.forEach.call(form.querySelectorAll('input'), function(input){
              data[input.name] = input.type === 'checkbox' ? input.checked : input.value;
            });
            fetch('/api/admin/calculation_rules', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) })
              .then(function(res){ return res.json(); })
              .then(function(result){
                msg.textContent = result && result.code === 1 ? '已保存，正在刷新...' : '保存失败';
                setTimeout(function(){ (window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload()); }, 500);
              })
              .catch(function(){ msg.textContent = '保存失败'; });
          });
        })();
      </script>
    </div>`;
}

function coreSectionOptions(selectedId, label = "全部合同段") {
  return [`<option value="">${htmlEscape(label)}</option>`]
    .concat(engine.db.sections.map((section) => {
      const id = Number(section.sectionId || section.id || 0);
      const selected = selectedId && id === Number(selectedId) ? " selected" : "";
      return `<option value="${id}"${selected}>${htmlEscape(section.sectionName || section.name || "")}</option>`;
    }))
    .join("");
}

function corePeriodOptions(selectedId, label = "全部工期") {
  return [`<option value="">${htmlEscape(label)}</option>`]
    .concat(engine.db.measurePeriods.map((period) => {
      const id = Number(period.gatherId || period.id || 0);
      const selected = selectedId && id === Number(selectedId) ? " selected" : "";
      return `<option value="${id}"${selected}>${htmlEscape(period.periodDesc || period.gatherNo || `第 ${id} 期`)}</option>`;
    }))
    .join("");
}

function coreStateOptions(rows, selectedState, label = "全部状态") {
  const states = Array.from(new Set((rows || []).map((row) => String(row.states || row.gatherState || "").trim()).filter(Boolean)));
  return [`<option value="">${htmlEscape(label)}</option>`]
    .concat(states.map((state) => `<option value="${htmlEscape(state)}"${state === selectedState ? " selected" : ""}>${htmlEscape(state)}</option>`))
    .join("");
}

function coreCardsHtml(cards) {
  return cards.map(([label, value, hint]) => `
    <div class="core-card">
      <span>${htmlEscape(label)}</span>
      <strong>${htmlEscape(value)}</strong>
      <small>${htmlEscape(hint || "")}</small>
    </div>`).join("");
}

function corePageStyle(accent = "#0f766e") {
  return `
    <style>
      .core-page { padding:16px; background:#f4f7fb; color:#172033; min-height:100%; }
      .core-shell { max-width:1400px; margin:0 auto; }
      .core-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
      .core-head h2 { margin:0; font-size:22px; font-weight:600; }
      .core-head p { margin:6px 0 0; color:#64748b; }
      .core-tools, .core-filters { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .core-tools a, .core-tools button, .core-filters button { white-space:nowrap; }
      .core-tools select, .core-filters select, .core-filters input, .core-form input, .core-form select, .core-form textarea {
        height:32px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; box-sizing:border-box;
      }
      .core-form textarea { height:70px; padding:8px; resize:vertical; }
      .core-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
      .core-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
      .core-card span, .core-card small { display:block; color:#64748b; font-size:12px; }
      .core-card strong { display:block; margin:8px 0; color:${accent}; font-size:20px; }
      .core-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
      .core-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
      .core-panel table { margin:0; min-width:960px; }
      .core-grid { display:grid; grid-template-columns:minmax(0, 1.45fr) minmax(340px, .55fr); gap:12px; }
      .core-actions a, .core-actions button { display:inline-block; margin:0 7px 4px 0; color:#1d4ed8; cursor:pointer; background:transparent; border:0; padding:0; }
      .core-state { display:inline-block; min-width:54px; text-align:center; color:#075985; background:#e0f2fe; border:1px solid #bae6fd; border-radius:4px; padding:2px 6px; }
      .core-empty { text-align:center; color:#94a3b8; padding:24px; }
      .core-left { text-align:left; }
      .core-form { display:grid; gap:10px; }
      .core-form label { display:grid; gap:5px; color:#475569; }
      .core-form .core-form-row { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .core-form button { width:max-content; }
      .core-note { color:#64748b; line-height:1.7; }
      @media (max-width:1100px) {
        .core-cards { grid-template-columns:repeat(3, 1fr); }
        .core-grid { grid-template-columns:1fr; }
        .core-head { align-items:flex-start; flex-direction:column; }
      }
      @media (max-width:640px) {
        .core-cards { grid-template-columns:1fr 1fr; }
        .core-form .core-form-row { grid-template-columns:1fr; }
      }
    </style>`;
}

function coreInteractionScript(rootSelector = ".core-page") {
  return `
    <script>
      (function(){
        var root = document.querySelector('${rootSelector}') || document;
        if (window.layui && layui.form) layui.form.render();
        function reloadContent() {
          if (window.zwkjyReloadCurrentContent) window.zwkjyReloadCurrentContent();
          else location.reload();
        }
        function post(url, data) {
          return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {})
          }).then(function(res){ return res.json(); });
        }
        Array.prototype.forEach.call(root.querySelectorAll('[data-filter-form]'), function(form) {
          function go() {
            var params = new URLSearchParams(new FormData(form)).toString();
            location.href = form.getAttribute('data-filter-form') + (params ? '?' + params : '');
          }
          form.addEventListener('submit', function(event){ event.preventDefault(); go(); });
          Array.prototype.forEach.call(form.querySelectorAll('select'), function(select){ select.addEventListener('change', go); });
        });
        Array.prototype.forEach.call(root.querySelectorAll('[data-post]'), function(link) {
          link.addEventListener('click', function(event) {
            event.preventDefault();
            var id = link.getAttribute('data-id') || '';
            var payload = {};
            if (id) {
              payload.ids = id;
              payload.gatherId = id;
              payload.measureId = id;
              payload.billMeasureId = id;
              payload.billMeasureIds = id;
              payload.diasId = id;
              payload.meterialDiasMeasureId = id;
              payload.meterialDiasMeasureIds = id;
              payload.arrivalId = id;
              payload.meterialInMeasureId = id;
              payload.meterialInMeasureIds = id;
              payload.manualId = id;
              payload.manualMeasureId = id;
              payload.manualMeasureIds = id;
            }
            var extra = link.getAttribute('data-extra');
            if (extra) {
              try { Object.assign(payload, JSON.parse(extra)); } catch (error) {}
            }
            post(link.getAttribute('data-post'), payload).then(function(result){
              if (window.layer) layer.msg(result && (result.msg || (result.code === 1 ? '处理完成' : '处理失败')) || '处理完成');
              setTimeout(reloadContent, 350);
            }).catch(function(){
              if (window.layer) layer.msg('处理失败');
            });
          });
        });
        Array.prototype.forEach.call(root.querySelectorAll('[data-submit-form]'), function(button) {
          button.addEventListener('click', function() {
            var form = button.closest('form');
            var data = {};
            Array.prototype.forEach.call(form.querySelectorAll('[name]'), function(el) {
              data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
            });
            post(form.getAttribute('data-save-form'), data).then(function(result){
              if (window.layer) layer.msg(result && (result.msg || (result.code === 1 ? '保存成功' : '保存失败')) || '保存成功');
              setTimeout(reloadContent, 450);
            }).catch(function(){
              if (window.layer) layer.msg('保存失败');
            });
          });
        });
      })();
    </script>`;
}

function adminDashboardHtml() {
  const summary = engine.contractSummary();
  const rules = engine.calculationRules();
  const cards = coreCardsHtml([
    ["合同金额", moneyText(summary.contractSumMoney), "清单合同金额合计"],
    ["最终金额", moneyText(summary.finalMoney), "含变更后的控制金额"],
    ["清单计量", moneyText(summary.measuredMoney), "累计清单计量金额"],
    ["材料补差", moneyText(summary.materialDiasMoney), "材料价差应付"],
    ["手动计量", moneyText(summary.manualMoney), "现场签证/零星工程"],
    ["材料设备垫付款", moneyText(summary.materialAdvanceMoney), "JL109到场金额按预付率计算"],
    ["保留金", moneyText(summary.retentionMoney), "按小计预扣"],
    ["JL104实际支付", moneyText(summary.payableMoney), summary.payableFormula]
  ]);
  const entries = [
    ["工期管理", "/sysGather/gatherData_page/0", "维护计量期次、采集本期数据、锁定/启用工期"],
    ["清单计量", "/bill_measure/page", "计量单列表、明细、上报、审核、归档"],
    ["材料补差计量", "/meterialdiasmeasure/meterialdiasmeasurePage", "按材料价差计算补差金额"],
    ["材料到场计量", "/meterialInMeasure/meterialInMeasureList", "材料进场数量和金额跟踪"],
    ["手动计量", "/manualMeasure/manualMeasureList/0", "现场签证、零星工程和补充计量"],
    ["造价计算器", "/costBase/calculator_page", "清单、变更、材料、手动计量组合试算"],
    ["造价联动校核", "/costBase/reconciliation_page", "合同、计量、支付、审核链条校核"],
    ["BOQ校验", "/costBase/boq_validation_page", "清单数量、单价、金额一致性检查"],
    ["JL计量支付报表", "/payment/jl_report_page", "按JL114/JL113/JL105/JL104核对支付证书"],
    ["计算规则后台", "/admin/calculation_rules_page", "修改应付构成、小数位和审核比例"]
  ].map(([name, href, desc]) => `
    <tr>
      <td>${htmlEscape(name)}</td>
      <td class="core-left">${htmlEscape(desc)}</td>
      <td><a class="layui-btn layui-btn-xs" href="${href}">打开</a></td>
    </tr>`).join("");
  return `
    <div class="core-page" data-core-page="admin-dashboard">
      ${corePageStyle("#0f766e")}
      <div class="core-shell">
        <div class="core-head">
          <div>
            <h2>后台管理</h2>
            <p>集中维护计算规则、基础数据和各类计量计算入口。</p>
          </div>
          <div class="core-tools">
            <a class="layui-btn layui-btn-sm" href="/admin/calculation_rules_page">计算规则后台</a>
            <a class="layui-btn layui-btn-sm" href="/payment/jl_report_page">JL报表核对</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/costBase/calculator_page">造价计算器</a>
          </div>
        </div>
        <div class="core-cards">${cards}</div>
        <div class="core-grid">
          <div class="core-panel">
            <h3>后台功能入口</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>模块</th><th>功能</th><th>操作</th></tr></thead>
              <tbody>${entries}</tbody>
            </table>
          </div>
          <div class="core-panel">
            <h3>当前计算规则</h3>
            <div class="core-note">
              应付公式：${htmlEscape(summary.payableFormula)}<br>
              金额小数位：${rules.moneyDigits}，数量小数位：${rules.quantityDigits}，单价小数位：${rules.priceDigits}<br>
              监理审核比例：${rules.auditSupervisorRate}%<br>
              业主审核比例：${rules.auditOwnerRate}%<br>
              最终审定比例：${rules.auditFinalRate}%
            </div>
          </div>
        </div>
      </div>
      ${coreInteractionScript('[data-core-page="admin-dashboard"]')}
    </div>`;
}

function sysGatherManagementPageHtml(req) {
  const rows = gatherRows();
  const snapshots = ensureGatherSnapshots();
  const latestByGather = new Map(snapshots.map((snapshot) => [Number(snapshot.gatherId || 0), snapshot]));
  const locked = rows.filter((row) => Number(row.gatherStateCode ?? row.gatherState ?? 1) === 0 || String(row.states || "").includes("锁")).length;
  const collected = rows.filter((row) => latestByGather.has(Number(row.gatherId || row.id)) || row.collectTime).length;
  const totalPayable = rows.reduce((sum, row) => sum + Number(row.collectMoney || row.payableMoney || 0), 0);
  const body = rows.map((row) => {
    const id = Number(row.gatherId || row.id || 0);
    const snapshot = latestByGather.get(id) || {};
    const stateText = Number(row.gatherStateCode ?? row.gatherState ?? 1) === 0 ? "锁定" : cleanBusinessText(row.states || row.gatherState || "启用", "启用");
    return `
      <tr>
        <td>${htmlEscape(row.gatherNo || row.periodDesc || "")}</td>
        <td>${htmlEscape(row.periodDesc || row.gatherShow || "")}</td>
        <td>${htmlEscape(row.startDate || row.gatherStartDate || "")}</td>
        <td>${htmlEscape(row.endDate || row.gatherEndDate || "")}</td>
        <td>${moneyText(row.collectMoney || snapshot.payableMoney || 0)}</td>
        <td>${moneyText(snapshot.auditFinalMoney || row.auditFinalMoney || 0)}</td>
        <td>${htmlEscape(String(row.collectTime || snapshot.collectTime || "").slice(0, 19).replace("T", " "))}</td>
        <td><span class="core-state">${htmlEscape(stateText)}</span></td>
        <td class="core-actions">
          <a href="/sysGather/edit_gatherData_page?gatherId=${id}">编辑</a>
          <a href="/dataGather/gather_dashboard_page?gatherId=${id}">汇总</a>
          <a data-post="/dataGather/data_collect_gather" data-id="${id}">采集</a>
          <a data-post="/dataGather/data_check_gather" data-id="${id}">校核</a>
          <a data-post="/sysGather/update_gather_state" data-id="${id}" data-extra='${htmlEscape(JSON.stringify({ gatherState: 0 }))}'>锁定</a>
          <a data-post="/sysGather/update_gather_state" data-id="${id}" data-extra='${htmlEscape(JSON.stringify({ gatherState: 1 }))}'>启用</a>
          <a data-post="/sysGather/del_gather" data-id="${id}">删除</a>
        </td>
      </tr>`;
  }).join("");
  return `
    <div class="core-page" data-core-page="sys-gather-management">
      ${corePageStyle("#0f766e")}
      <div class="core-shell">
        <div class="core-head">
          <div><h2>工期管理</h2><p>维护计量期次，采集各计量模块数据，并完成本期校核、锁定和汇总。</p></div>
          <div class="core-tools">
            <a class="layui-btn layui-btn-sm" href="/sysGather/edit_gatherData_page">新增工期</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/sysGather/dashboard_page">工期汇总看板</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/dataGather/gather_dashboard_page">数据采集看板</a>
          </div>
        </div>
        <div class="core-cards">${coreCardsHtml([
          ["工期数量", rows.length, "全部计量期次"],
          ["已采集", collected, "已有采集快照或采集时间"],
          ["锁定工期", locked, "禁止继续调整"],
          ["启用工期", Math.max(0, rows.length - locked), "可继续计量"],
          ["采集应付", moneyText(totalPayable), "所有期次采集金额"],
          ["采集快照", snapshots.length, "本地汇总记录"]
        ])}</div>
        <div class="core-grid">
          <div class="core-panel">
            <h3>工期台账</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>工期编号</th><th>工期说明</th><th>开始日期</th><th>结束日期</th><th>采集应付</th><th>最终审定</th><th>最近采集</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>${body || `<tr><td colspan="9" class="core-empty">暂无工期数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="core-panel">
            <h3>快速新增工期</h3>
            <form class="core-form" data-save-form="/sysGather/save_gather">
              <label>工期编号<input name="gatherNo" value="第 ${rows.length + 1} 期"></label>
              <label>工期说明<input name="periodDesc" value="第 ${rows.length + 1} 期计量"></label>
              <div class="core-form-row">
                <label>开始日期<input name="startDate" value="${today()}"></label>
                <label>结束日期<input name="endDate" value="${today()}"></label>
              </div>
              <label>状态<select name="gatherStateCode"><option value="1">启用</option><option value="0">锁定</option></select></label>
              <label>备注<textarea name="remark">本地新增计量期次</textarea></label>
              <button type="button" class="layui-btn layui-btn-sm" data-submit-form>保存工期</button>
            </form>
          </div>
        </div>
      </div>
      ${coreInteractionScript('[data-core-page="sys-gather-management"]')}
    </div>`;
}

function billMeasureManagementPageHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const periodId = Number(req.query.periodId || req.body.periodId || req.query.gatherId || req.body.gatherId || 0);
  const selectedState = String(req.query.state || req.body.state || "");
  const allRows = engine.measureRows();
  const rows = filteredBillMeasureRows(req);
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.measureMoney || row.money || 0), 0);
  const totalDetails = rows.reduce((sum, row) => sum + Number(row.detailCount || measureDetailRowsFor(row.billMeasureId || row.measureId).length || 0), 0);
  const body = rows.map((row) => {
    const id = Number(row.billMeasureId || row.measureId || 0);
    return `
      <tr>
        <td>${htmlEscape(row.measureNo || "")}</td>
        <td>${htmlEscape(row.sectionName || "")}</td>
        <td>${htmlEscape(row.periodDesc || row.gatherNo || "")}</td>
        <td>${htmlEscape(row.measureDate || "")}</td>
        <td>${htmlEscape(row.drawNo || "")}</td>
        <td>${htmlEscape(row.pegNo || "")}</td>
        <td class="core-left">${htmlEscape(row.position || "")}</td>
        <td>${Number(row.detailCount || measureDetailRowsFor(id).length || 0)}</td>
        <td>${moneyText(row.measureMoney || row.money || 0)}</td>
        <td><span class="core-state">${htmlEscape(row.states || "")}</span></td>
        <td class="core-actions">
          <a href="/bill_measure/edit_page?billMeasureId=${id}">编辑</a>
          <a href="/bill_measure/add_measure_page?billMeasureId=${id}">明细</a>
          <a href="/bill_measure/copy_page?billMeasureId=${id}">复制</a>
          <a data-post="/bill_measure/up_order" data-id="${id}">上报</a>
          <a data-post="/bill_measure/agree_order" data-id="${id}">审核</a>
          <a data-post="/bill_measure/archive_measure" data-id="${id}">归档</a>
          <a href="/bill_measure/return_order_page?billMeasureId=${id}">退回</a>
          <a href="/bill_measure/render_order_page?billMeasureIds=${id}">打印</a>
          <a data-post="/bill_measure/delete" data-id="${id}">删除</a>
        </td>
      </tr>`;
  }).join("");
  return `
    <div class="core-page" data-core-page="bill-measure-management">
      ${corePageStyle("#0369a1")}
      <div class="core-shell">
        <div class="core-head">
          <div><h2>清单计量管理</h2><p>管理清单计量单、计量明细、流程上报、审核、归档和打印。</p></div>
          <div class="core-tools">
            <a class="layui-btn layui-btn-sm" href="/bill_measure/add_page">新增计量单</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/bill_measure/dashboard_page">清单计量看板</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/import_measure/dashboard_page">计量导入</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/bill_measure/export_bill_measure?sectionId=${encodeURIComponent(sectionId || "")}&periodId=${encodeURIComponent(periodId || "")}&state=${encodeURIComponent(selectedState)}">导出Excel</a>
          </div>
        </div>
        <form class="core-filters core-panel" data-filter-form="/bill_measure/page">
          <select name="sectionId">${coreSectionOptions(sectionId)}</select>
          <select name="periodId">${corePeriodOptions(periodId)}</select>
          <select name="state">${coreStateOptions(allRows, selectedState)}</select>
          <button type="submit" class="layui-btn layui-btn-sm">筛选</button>
        </form>
        <div class="core-cards">${coreCardsHtml([
          ["计量单数", rows.length, "当前筛选结果"],
          ["明细条目", totalDetails, "清单计量明细"],
          ["计量金额", moneyText(totalMoney), "清单计量应付金额"],
          ["平均单额", rows.length ? moneyText(totalMoney / rows.length) : "0.00", "计量金额 / 计量单"],
          ["审核中", rows.filter((row) => String(row.states || "").includes("审核")).length, "流程处理中"],
          ["已归档", rows.filter((row) => String(row.states || "").includes("归档")).length, "归档计量单"]
        ])}</div>
        <div class="core-grid">
          <div class="core-panel">
            <h3>清单计量台账</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>计量单号</th><th>合同段</th><th>工期</th><th>日期</th><th>图号</th><th>桩号</th><th>部位</th><th>明细</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>${body || `<tr><td colspan="11" class="core-empty">暂无清单计量数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="core-panel">
            <h3>快速新增计量单</h3>
            <form class="core-form" data-save-form="/bill_measure/save_measure">
              <label>计量单号<input name="measureNo" value="JL-LOCAL-${String((engine.db.measures || []).length + 1).padStart(3, "0")}"></label>
              <label>合同段<select name="sectionId">${sectionOptions(sectionId || ((engine.db.sections[0] || {}).sectionId))}</select></label>
              <label>工期<select name="periodId">${measurePeriodOptions(periodId || ((engine.db.measurePeriods[0] || {}).gatherId))}</select></label>
              <div class="core-form-row">
                <label>计量日期<input name="measureDate" value="${today()}"></label>
                <label>图号<input name="drawNo" value=""></label>
              </div>
              <div class="core-form-row">
                <label>桩号<input name="pegNo" value=""></label>
                <label>质检单<input name="certifyNo" value=""></label>
              </div>
              <label>计量部位<input name="position" value="现场计量部位"></label>
              <button type="button" class="layui-btn layui-btn-sm" data-submit-form>保存计量单</button>
            </form>
          </div>
        </div>
      </div>
      ${coreInteractionScript('[data-core-page="bill-measure-management"]')}
    </div>`;
}

function materialDiasManagementPageHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const selectedState = String(req.query.state || req.body.state || "");
  const allRows = engine.materialDiasRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const rows = filteredMaterialDiasRows(req);
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.adjustMoney || row.money || 0), 0);
  const totalQty = rows.reduce((sum, row) => sum + Number(row.measureNum || row.quantity || 0), 0);
  const body = rows.map((row) => {
    const id = Number(row.meterialDiasMeasureId || row.diasId || row.id || 0);
    return `
      <tr>
        <td>${htmlEscape(row.measureNo || "")}</td>
        <td>${htmlEscape(row.sectionName || "")}</td>
        <td>${htmlEscape(row.materialNo || "")}</td>
        <td class="core-left">${htmlEscape(row.materialName || row.secMaterialName || "")}</td>
        <td>${htmlEscape(row.measureUnit || row.unit || "")}</td>
        <td>${Number(row.measureNum || row.quantity || 0)}</td>
        <td>${moneyText(row.basePrice)}</td>
        <td>${moneyText(row.currentPrice)}</td>
        <td>${moneyText(row.priceDiff)}</td>
        <td>${moneyText(row.adjustMoney || row.money || 0)}</td>
        <td>${htmlEscape(row.measureDate || row.diffYearMonth || "")}</td>
        <td><span class="core-state">${htmlEscape(row.states || "")}</span></td>
        <td class="core-actions">
          <a href="/meterialdiasmeasure/detail_page?diasId=${id}">详情</a>
          <a href="/meterialdiasmeasure/edit_meterial_dias_measure_page?diasId=${id}">编辑</a>
          <a data-post="/meterialdiasmeasure/up_order" data-id="${id}">上报</a>
          <a data-post="/meterialdiasmeasure/agree_order" data-id="${id}">审核</a>
          <a data-post="/meterialdiasmeasure/archive" data-id="${id}">归档</a>
          <a href="/meterialdiasmeasure/return_order_page?diasId=${id}">退回</a>
          <a href="/meterialdiasmeasure/track_meterial_dias_reasoure_page?measureType=meterialdiasmeasure&ids=${id}&businessId=${id}">追踪</a>
          <a data-post="/meterialdiasmeasure/delete" data-id="${id}">删除</a>
        </td>
      </tr>`;
  }).join("");
  return `
    <div class="core-page" data-core-page="material-dias-management">
      ${corePageStyle("#b45309")}
      <div class="core-shell">
        <div class="core-head">
          <div><h2>材料补差计量管理</h2><p>按材料基准价、当前价和计量数量计算材料价差补偿。</p></div>
          <div class="core-tools">
            <a class="layui-btn layui-btn-sm" href="/meterialdiasmeasure/edit_meterial_dias_measure_page">新增补差</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/meterialdiasmeasure/dashboard_page">补差看板</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/meterialdiasmeasure/export_meterial_dias_measure?sectionId=${encodeURIComponent(sectionId || "")}&state=${encodeURIComponent(selectedState)}">导出Excel</a>
          </div>
        </div>
        <form class="core-filters core-panel" data-filter-form="/meterialdiasmeasure/meterialdiasmeasurePage">
          <select name="sectionId">${coreSectionOptions(sectionId)}</select>
          <select name="state">${coreStateOptions(allRows, selectedState)}</select>
          <button type="submit" class="layui-btn layui-btn-sm">筛选</button>
        </form>
        <div class="core-cards">${coreCardsHtml([
          ["补差批次", rows.length, "当前筛选记录"],
          ["材料种类", new Set(rows.map((row) => row.materialNo || row.materialId)).size, "按材料去重"],
          ["补差数量", Number(totalQty.toFixed(3)), "计量数量合计"],
          ["补差金额", moneyText(totalMoney), "数量 x 价差"],
          ["审核中", rows.filter((row) => String(row.states || "").includes("审核")).length, "流程处理中"],
          ["已归档", rows.filter((row) => String(row.states || "").includes("归档")).length, "归档批次"]
        ])}</div>
        <div class="core-grid">
          <div class="core-panel">
            <h3>材料补差台账</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>单号</th><th>合同段</th><th>材料编号</th><th>材料名称</th><th>单位</th><th>数量</th><th>基准价</th><th>当前价</th><th>价差</th><th>补差金额</th><th>日期</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>${body || `<tr><td colspan="13" class="core-empty">暂无材料补差数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="core-panel">
            <h3>快速新增补差</h3>
            <form class="core-form" data-save-form="/meterialdiasmeasure/save_detail">
              <label>补差单号<input name="measureNo" value="BC-LOCAL-${String((engine.db.materialAdjustments || []).length + 1).padStart(3, "0")}"></label>
              <label>合同段<select name="sectionId">${sectionOptions(sectionId || ((engine.db.sections[0] || {}).sectionId))}</select></label>
              <label>材料<select name="materialId">${materialOptions(firstMaterialId())}</select></label>
              <div class="core-form-row">
                <label>补差数量<input name="quantity" value="1"></label>
                <label>计量日期<input name="measureDate" value="${today()}"></label>
              </div>
              <label>供应单位<input name="provider" value=""></label>
              <label>审批编号<input name="approveNo" value=""></label>
              <button type="button" class="layui-btn layui-btn-sm" data-submit-form>保存补差</button>
            </form>
          </div>
        </div>
      </div>
      ${coreInteractionScript('[data-core-page="material-dias-management"]')}
    </div>`;
}

function materialArrivalManagementPageHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const selectedState = String(req.query.state || req.body.state || "");
  const allRows = engine.materialArrivalRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const rows = filteredMaterialArrivalRows(req);
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.money || 0), 0);
  const totalQty = rows.reduce((sum, row) => sum + Number(row.measureNum || row.quantity || 0), 0);
  const body = rows.map((row) => {
    const id = Number(row.meterialInMeasureId || row.arrivalId || row.id || 0);
    return `
      <tr>
        <td>${htmlEscape(row.measureNo || "")}</td>
        <td>${htmlEscape(row.sectionName || "")}</td>
        <td>${htmlEscape(row.certifyNo || row.approveNo || "")}</td>
        <td>${htmlEscape(row.materialNo || "")}</td>
        <td class="core-left">${htmlEscape(row.materialName || "")}</td>
        <td>${htmlEscape(row.measureUnit || row.unit || "")}</td>
        <td>${Number(row.measureNum || row.quantity || 0)}</td>
        <td>${moneyText(row.price || row.measurePrice || 0)}</td>
        <td>${moneyText(row.money || 0)}</td>
        <td>${htmlEscape(row.measureDate || "")}</td>
        <td><span class="core-state">${htmlEscape(row.states || "")}</span></td>
        <td class="core-actions">
          <a href="/meterialInMeasure/detail_page?arrivalId=${id}">详情</a>
          <a href="/meterialInMeasure/form_page?arrivalId=${id}">编辑</a>
          <a data-post="/meterialInMeasure/up_order" data-id="${id}">上报</a>
          <a data-post="/meterialInMeasure/update_measure_state" data-id="${id}">确认</a>
          <a data-post="/meterialInMeasure/archive" data-id="${id}">归档</a>
          <a href="/meterialInMeasure/return_order_page?arrivalId=${id}">退回</a>
          <a href="/meterialInMeasure/record_page?measureType=meterialinmeasure&ids=${id}&businessId=${id}">追踪</a>
          <a data-post="/meterialInMeasure/delete" data-id="${id}">删除</a>
        </td>
      </tr>`;
  }).join("");
  return `
    <div class="core-page" data-core-page="material-arrival-management">
      ${corePageStyle("#0f766e")}
      <div class="core-shell">
        <div class="core-head">
          <div><h2>材料到场计量管理</h2><p>记录材料进场凭证、数量、单价和到场金额，支撑材料跟踪与支付核对。</p></div>
          <div class="core-tools">
            <a class="layui-btn layui-btn-sm" href="/meterialInMeasure/add_page">新增到场</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/meterialInMeasure/dashboard_page">到场看板</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/meterialInMeasure/export_meterial_in_measure?sectionId=${encodeURIComponent(sectionId || "")}&state=${encodeURIComponent(selectedState)}">导出Excel</a>
          </div>
        </div>
        <form class="core-filters core-panel" data-filter-form="/meterialInMeasure/meterialInMeasureList">
          <select name="sectionId">${coreSectionOptions(sectionId)}</select>
          <select name="state">${coreStateOptions(allRows, selectedState)}</select>
          <button type="submit" class="layui-btn layui-btn-sm">筛选</button>
        </form>
        <div class="core-cards">${coreCardsHtml([
          ["到场批次", rows.length, "当前筛选记录"],
          ["材料种类", new Set(rows.map((row) => row.materialNo || row.materialId)).size, "按材料去重"],
          ["到场数量", Number(totalQty.toFixed(3)), "进场数量合计"],
          ["到场金额", moneyText(totalMoney), "数量 x 单价"],
          ["处理中", rows.filter((row) => String(row.states || "").includes("审核") || String(row.states || "").includes("更新")).length, "流程处理中"],
          ["已归档", rows.filter((row) => String(row.states || "").includes("归档")).length, "归档批次"]
        ])}</div>
        <div class="core-grid">
          <div class="core-panel">
            <h3>材料到场台账</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>到场单号</th><th>合同段</th><th>凭证</th><th>材料编号</th><th>材料名称</th><th>单位</th><th>数量</th><th>单价</th><th>金额</th><th>日期</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>${body || `<tr><td colspan="12" class="core-empty">暂无材料到场数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="core-panel">
            <h3>快速新增到场</h3>
            <form class="core-form" data-save-form="/meterialInMeasure/save_detail">
              <label>到场单号<input name="measureNo" value="DC-LOCAL-${String((engine.db.materialArrivals || []).length + 1).padStart(3, "0")}"></label>
              <label>进场凭证<input name="certifyNo" value=""></label>
              <label>合同段<select name="sectionId">${sectionOptions(sectionId || ((engine.db.sections[0] || {}).sectionId))}</select></label>
              <label>材料<select name="materialId">${materialOptions(firstMaterialId())}</select></label>
              <div class="core-form-row">
                <label>进场数量<input name="quantity" value="1"></label>
                <label>进场日期<input name="measureDate" value="${today()}"></label>
              </div>
              <label>供应单位<input name="provider" value=""></label>
              <label>验收编号<input name="approveNo" value=""></label>
              <button type="button" class="layui-btn layui-btn-sm" data-submit-form>保存到场</button>
            </form>
          </div>
        </div>
      </div>
      ${coreInteractionScript('[data-core-page="material-arrival-management"]')}
    </div>`;
}

function manualMeasureManagementPageHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const selectedState = String(req.query.state || req.body.state || "");
  const allRows = engine.manualMeasureRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const rows = filteredManualMeasureRows(req);
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.measureMoney || row.money || 0), 0);
  const totalQty = rows.reduce((sum, row) => sum + Number(row.measureNum || 0), 0);
  const body = rows.map((row) => {
    const id = Number(row.manualId || row.manualMeasureId || row.id || 0);
    return `
      <tr>
        <td>${htmlEscape(row.measureNo || "")}</td>
        <td>${htmlEscape(row.sectionName || "")}</td>
        <td>${htmlEscape(row.billNo || "")}</td>
        <td class="core-left">${htmlEscape(row.billName || "")}</td>
        <td>${htmlEscape(row.measureUnit || "")}</td>
        <td>${Number(row.measureNum || 0)}</td>
        <td>${moneyText(row.price || 0)}</td>
        <td>${moneyText(row.measureMoney || row.money || 0)}</td>
        <td>${htmlEscape(row.measureDate || "")}</td>
        <td>${htmlEscape(row.position || "")}</td>
        <td><span class="core-state">${htmlEscape(row.states || "")}</span></td>
        <td class="core-actions">
          <a href="/manualMeasure/manualMeasure_edit_page?manualId=${id}">编辑</a>
          <a data-post="/manualMeasure/up_order" data-id="${id}">上报</a>
          <a data-post="/manualMeasure/update_measure_state" data-id="${id}">确认</a>
          <a data-post="/manualMeasure/archive" data-id="${id}">归档</a>
          <a href="/manualMeasure/return_order_page?manualId=${id}">退回</a>
          <a href="/manualMeasure/record_page?measureType=manualmeasure&ids=${id}&businessId=${id}">追踪</a>
          <a data-post="/manualMeasure/delete" data-id="${id}">删除</a>
        </td>
      </tr>`;
  }).join("");
  return `
    <div class="core-page" data-core-page="manual-measure-management">
      ${corePageStyle("#7c3aed")}
      <div class="core-shell">
        <div class="core-head">
          <div><h2>手动计量管理</h2><p>维护现场签证、零星工程和补充计量，直接参与应付金额计算。</p></div>
          <div class="core-tools">
            <a class="layui-btn layui-btn-sm" href="/manualMeasure/manualMeasure_edit_page">新增手动计量</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/manualMeasure/dashboard_page">手动计量看板</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/manualMeasure/export_manual_measure?sectionId=${encodeURIComponent(sectionId || "")}&state=${encodeURIComponent(selectedState)}">导出Excel</a>
          </div>
        </div>
        <form class="core-filters core-panel" data-filter-form="/manualMeasure/manualMeasureList/0">
          <select name="sectionId">${coreSectionOptions(sectionId)}</select>
          <select name="state">${coreStateOptions(allRows, selectedState)}</select>
          <button type="submit" class="layui-btn layui-btn-sm">筛选</button>
        </form>
        <div class="core-cards">${coreCardsHtml([
          ["计量单数", rows.length, "当前筛选记录"],
          ["清单项数", new Set(rows.map((row) => row.billNo || row.billName || row.manualId)).size, "按清单去重"],
          ["计量数量", Number(totalQty.toFixed(3)), "数量合计"],
          ["计量金额", moneyText(totalMoney), "数量 x 单价"],
          ["处理中", rows.filter((row) => String(row.states || "").includes("审核") || String(row.states || "").includes("更新")).length, "流程处理中"],
          ["已归档", rows.filter((row) => String(row.states || "").includes("归档")).length, "归档单据"]
        ])}</div>
        <div class="core-grid">
          <div class="core-panel">
            <h3>手动计量台账</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>计量单号</th><th>合同段</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>数量</th><th>单价</th><th>金额</th><th>日期</th><th>部位</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>${body || `<tr><td colspan="12" class="core-empty">暂无手动计量数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="core-panel">
            <h3>快速新增手动计量</h3>
            <form class="core-form" data-save-form="/manualMeasure/save_measure">
              <label>计量单号<input name="measureNo" value="SD-LOCAL-${String((engine.db.manualMeasures || []).length + 1).padStart(3, "0")}"></label>
              <label>合同段<select name="sectionId">${sectionOptions(sectionId || ((engine.db.sections[0] || {}).sectionId))}</select></label>
              <div class="core-form-row">
                <label>清单编号<input name="billNo" value="SD-${String((engine.db.manualMeasures || []).length + 1).padStart(3, "0")}"></label>
                <label>单位<input name="measureUnit" value="项"></label>
              </div>
              <label>清单名称<input name="billName" value="现场签证工程"></label>
              <div class="core-form-row">
                <label>数量<input name="measureNum" value="1"></label>
                <label>单价<input name="price" value="1000"></label>
              </div>
              <label>计量日期<input name="measureDate" value="${today()}"></label>
              <label>施工部位<input name="position" value="现场部位"></label>
              <button type="button" class="layui-btn layui-btn-sm" data-submit-form>保存手动计量</button>
            </form>
          </div>
        </div>
      </div>
      ${coreInteractionScript('[data-core-page="manual-measure-management"]')}
    </div>`;
}

function contentForId(id) {
  if (String(id) === "46") return dataGatherDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "47") return billMeasureManagementPageHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "48") return materialDiasManagementPageHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "49") return materialArrivalManagementPageHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "50") return manualMeasureManagementPageHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "63") return reportManagerDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "64") return reportExportProjectPageHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "355") return sysGatherManagementPageHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "376") return subItemLedgerHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "377") return reportDetailHtml();
  if (String(id) === "378") return variationPaymentDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "411" || String(id) === "670" || String(id) === "671" || String(id) === "672" || String(id) === "673") return documentManagementDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "568") return documentManagementDashboardHtml({ query: { type: "syzl" }, body: {}, params: {} });
  if (String(id) === "640" || String(id) === "641" || String(id) === "642") return documentManagementDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "690") return engineeringContactDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "691") return variationManagementDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "692") return billMeasureDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "693") return importMeasureDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "694") return materialArrivalDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "695") return materialDiasDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "696") return manualMeasureDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "697") return sysGatherDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "698") return dataGatherDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "699") return auditMoneyDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "700") return variationPaymentDashboardHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "9001" || String(id) === "9003") return adminDashboardHtml();
  if (String(id) === "9002") return calculationRulesPageHtml();
  if (String(id) === "9004") return jlPaymentReportPageHtml({ query: {}, body: {}, params: {} });
  if (String(id) === "6998") return reportManagerDashboardHtml({ query: {}, body: {}, params: {} });
  const file = path.join(dataDir, "content", `page_content_${id}.html`);
  const htmlText = readText(file, "");
  if (htmlText && !htmlText.includes('"status":404')) return htmlText;
  const leaf = leavesById.get(String(id));
  return dashboardHtml(leaf ? leaf.resourceName : `页面 ${id}`);
}

function workPositionForId(id) {
  const leaf = leavesById.get(String(id));
  const name = leaf ? leaf.resourceName : id;
  return `<div class="layui-card" style="margin-bottom:0;"><div class="layui-card-body" style="padding:8px 15px;"><span class="layui-breadcrumb"><a>首页</a><a><cite>${name}</cite></a></span></div></div>`;
}

function modalFormHtml(title, sourcePath = "") {
  const moduleName = inferModule(sourcePath);
  const defaults = {
    secBill: { name: "新增清单", quantity: 1000, price: 35 },
    analyzeNode: { name: "新增节点", quantity: 1, price: 0 },
    material: { name: "新增材料", quantity: 1, price: 450 },
    materialDias: { name: "新增材料补差", quantity: 100, price: 0 },
    materialArrival: { name: "新增材料到场", quantity: 100, price: 0 },
    plan: { name: "新增工程计划", quantity: 1, price: 100000 },
    measure: { name: "新增计量单", quantity: 100, price: 35 },
    manualMeasure: { name: "新增手动计量", quantity: 1, price: 50000 },
    variation: { name: "新增变更", quantity: 100, price: 35 },
    contact: { name: "新增工程技术联系单", quantity: 1, price: 0 },
    meeting: { name: "新增变更会议", quantity: 100, price: 35 },
    document: { name: "新增资料", quantity: 1, price: 0 },
    generic: { name: title, quantity: 1, price: 1000 }
  }[moduleName] || { name: title, quantity: 1, price: 1000 };
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="local-form-${moduleName}" lay-filter="local-form">
        <input type="hidden" name="module" value="${moduleName}">
        <div class="layui-form-item">
          <label class="layui-form-label">名称</label>
          <div class="layui-input-block"><input class="layui-input" name="name" value="${defaults.name}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">数量</label>
          <div class="layui-input-block"><input class="layui-input" name="quantity" value="${defaults.quantity}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">单价</label>
          <div class="layui-input-block"><input class="layui-input" name="price" value="${defaults.price}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">金额</label>
          <div class="layui-input-block"><input class="layui-input" name="amount" value="${Number(defaults.quantity) * Number(defaults.price)}"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/api/local/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存</button>
          </div>
        </div>
      </form>
    </div>`;
}

function inferModule(sourcePath) {
  if (sourcePath.includes("secBill") || sourcePath.includes("billModel") || sourcePath.includes("billAnalyze")) return "secBill";
  if (sourcePath.includes("billAnalyzeNode") || sourcePath.includes("edit_node")) return "analyzeNode";
  if (sourcePath.includes("manual_model") || sourcePath.includes("secMateria") || sourcePath.includes("materia")) return "material";
  if (sourcePath.includes("secProjectPlan")) return "plan";
  if (sourcePath.includes("meterialdiasmeasure")) return "materialDias";
  if (sourcePath.includes("meterialInMeasure")) return "materialArrival";
  if (sourcePath.includes("manualMeasure")) return "manualMeasure";
  if (sourcePath.includes("bill_measure")) return "measure";
  if (sourcePath.includes("engineering_contact_bill")) return "contact";
  if (sourcePath.includes("vary_meeting")) return "meeting";
  if (sourcePath.includes("vary_measure")) return "variation";
  if (sourcePath.includes("oaDataNode") || sourcePath.includes("projectInformation") || sourcePath.includes("syzl")) return "document";
  return "generic";
}

function nextId(rows, key = "id") {
  return rows.reduce((max, row) => Math.max(max, Number(row[key] || row.id || 0)), 0) + 1;
}

function saveLocalRecord(body) {
  const moduleName = body.module || "generic";
  const name = body.name || "未命名";
  const quantity = Number(body.quantity || 1);
  const price = Number(body.price || 0);
  if (moduleName === "secBill") {
    const id = nextId(engine.db.bills, "billId");
    engine.db.bills.push({
      id,
      billId: id,
      sectionId: 101,
      chapter: "900",
      billNo: `900-${id}`,
      billName: name,
      measureUnit: "项",
      contractNum: quantity,
      correctedNum: quantity,
      price
    });
    return { id, module: moduleName };
  }
  if (moduleName === "analyzeNode") {
    const nodes = ensureAnalyzeNodes();
    const id = Number(body.nodeId || 0) > 0 && body.type === "showOwn"
      ? Number(body.nodeId)
      : nextId(nodes, "nodeId");
    const parentId = Number(body.parentId || (body.type === "addNext" ? body.nodeId : 0) || 0);
    const existing = nodes.find((row) => Number(row.nodeId || row.id) === id);
    if (existing) {
      existing.nodeName = body.name || body.nodeName || existing.nodeName;
      existing.name = existing.nodeName;
      existing.parentId = Number(body.parentId || existing.parentId || 0);
      existing.pId = existing.parentId;
      return { id, module: moduleName, updated: true };
    }
    nodes.push({
      id,
      nodeId: id,
      parentId: parentId > 0 ? parentId : 0,
      pId: parentId > 0 ? parentId : 0,
      nodeName: body.name || body.nodeName || `Node ${id}`,
      name: body.name || body.nodeName || `Node ${id}`,
      countNum: 0
    });
    return { id, module: moduleName };
  }
  if (moduleName === "material") {
    const id = nextId(engine.db.materials, "materialId");
    engine.db.materials.push({
      id,
      materialId: id,
      materialNo: `CL-${String(id).padStart(3, "0")}`,
      materialName: name,
      unit: "项",
      basePrice: price,
      currentPrice: price,
      spec: "本地新增"
    });
    return { id, module: moduleName };
  }
  if (moduleName === "materialDias") {
    const id = nextId(engine.db.materialAdjustments, "diasId");
    const firstMaterial = engine.db.materials[0];
    engine.db.materialAdjustments.push({
      id,
      diasId: id,
      sectionId: 101,
      measureNo: `BC-LOCAL-${String(id).padStart(3, "0")}`,
      materialId: firstMaterial.materialId,
      measureDate: new Date().toISOString().slice(0, 10),
      quantity,
      states: "待上报",
      provider: name,
      approveNo: `BC-SP-${String(id).padStart(3, "0")}`
    });
    return { id, module: moduleName };
  }
  if (moduleName === "materialArrival") {
    const id = nextId(engine.db.materialArrivals, "arrivalId");
    const firstMaterial = engine.db.materials[0];
    engine.db.materialArrivals.push({
      id,
      arrivalId: id,
      sectionId: 101,
      measureNo: `DC-LOCAL-${String(id).padStart(3, "0")}`,
      certifyNo: `DC-LOCAL-${String(id).padStart(3, "0")}`,
      materialId: firstMaterial.materialId,
      measureDate: new Date().toISOString().slice(0, 10),
      quantity,
      states: "待上报",
      remark: name
    });
    return { id, module: moduleName };
  }
  if (moduleName === "plan") {
    const id = nextId(engine.db.plans, "planId");
    engine.db.plans.push({
      id,
      planId: id,
      sectionId: 101,
      planName: name,
      startDate: "2026-03-01",
      endDate: "2026-12-31",
      amount: quantity * price,
      status: "执行中"
    });
    return { id, module: moduleName };
  }
  if (moduleName === "measure") {
    const id = nextId(engine.db.measures, "measureId");
    const firstBill = engine.db.bills[0];
    engine.db.measures.push({
      id,
      measureId: id,
      measureNo: `JL-LOCAL-${String(id).padStart(3, "0")}`,
      sectionId: 101,
      periodId: 2,
      measureDate: new Date().toISOString().slice(0, 10),
      states: "待上报",
      drawNo: "LOCAL",
      pegNo: "LOCAL",
      certifyNo: "LOCAL",
      position: name,
      details: [{ billId: firstBill.billId, measureNum: quantity }]
    });
    return { id, module: moduleName };
  }
  if (moduleName === "manualMeasure") {
    const id = nextId(engine.db.manualMeasures, "manualId");
    engine.db.manualMeasures.push({
      id,
      manualId: id,
      sectionId: 101,
      measureNo: `SD-LOCAL-${String(id).padStart(3, "0")}`,
      billNo: `900-${id}`,
      billName: name,
      measureUnit: "项",
      measureNum: quantity,
      price,
      measureDate: new Date().toISOString().slice(0, 10),
      states: "待上报"
    });
    return { id, module: moduleName };
  }
  if (moduleName === "variation") {
    const id = nextId(engine.db.variations, "varyId");
    const firstBill = engine.db.bills[0];
    engine.db.variations.push({
      id,
      varyId: id,
      varyNo: `BG-LOCAL-${String(id).padStart(3, "0")}`,
      sectionId: 101,
      billId: firstBill.billId,
      billNo: firstBill.billNo,
      billName: firstBill.billName,
      measureUnit: firstBill.measureUnit,
      beforeNum: firstBill.contractNum,
      beforePrice: firstBill.price,
      afterNum: firstBill.contractNum + quantity,
      afterPrice: price || firstBill.price,
      states: "待上报",
      varyReason: name
    });
    return { id, module: moduleName };
  }
  if (moduleName === "contact") {
    const id = nextId(engine.db.contactBills, "contactId");
    engine.db.contactBills.push({
      id,
      contactId: id,
      contactNo: `LX-LOCAL-${String(id).padStart(3, "0")}`,
      title: name,
      contactContent: name,
      changeMeetingText: "本地新增联系记录",
      createDate: new Date().toISOString().slice(0, 10),
      userName: "ys1",
      states: "待上报",
      sectionName: "TJ-01 合同段"
    });
    return { id, module: moduleName };
  }
  if (moduleName === "meeting") {
    const id = nextId(engine.db.variations, "varyId");
    const firstBill = engine.db.bills[0];
    engine.db.variations.push({
      id,
      varyId: id,
      meetingId: id,
      meetingNo: `HY-LOCAL-${String(id).padStart(3, "0")}`,
      meetingTitle: name,
      meetingAddress: "TJ-01 合同段",
      meetingDate: new Date().toISOString().slice(0, 10),
      sectionId: 101,
      billId: firstBill.billId,
      billNo: firstBill.billNo,
      billName: firstBill.billName,
      measureUnit: firstBill.measureUnit,
      beforeNum: firstBill.contractNum,
      beforePrice: firstBill.price,
      afterNum: firstBill.contractNum + quantity,
      afterPrice: price || firstBill.price,
      states: "待上报",
      varyReason: name,
      varyContent: firstBill.billName,
      createUserId: 563
    });
    return { id, module: moduleName };
  }
  if (moduleName === "document") {
    const id = nextId(engine.db.documents, "nodeId");
    engine.db.documents.push({
      id,
      nodeId: id,
      title: name,
      type: "本地新增资料",
      createDate: new Date().toISOString().slice(0, 10),
      fileCount: 0
    });
    return { id, module: moduleName };
  }
  return { module: moduleName };
}

function simpleTableHtml(title, columns, rows) {
  const head = columns.map((col) => `<th>${col.title}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map((col) => `<td>${row[col.field] ?? ""}</td>`).join("")}</tr>`).join("");
  return `
    <div class="layui-card" style="margin:10px;">
      <div class="layui-card-header">${title}</div>
      <div class="layui-card-body">
        <table class="layui-table" lay-size="sm">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
}

function billDetailHtml() {
  return simpleTableHtml("清单明细", [
    { title: "清单编号", field: "billNo" },
    { title: "清单名称", field: "billName" },
    { title: "单位", field: "measureUnit" },
    { title: "合同数量", field: "contractNum" },
    { title: "单价", field: "price" },
    { title: "合同金额", field: "contractMoney" },
    { title: "已计量", field: "measuredNum" },
    { title: "剩余量", field: "remainNum" }
  ], engine.billRows());
}

function billCollectHtml() {
  const rows = Object.values(engine.billRows().reduce((acc, row) => {
    acc[row.chapter] = acc[row.chapter] || { chapter: row.chapter, billCount: 0, billNos: [], contractMoney: 0, finalMoney: 0, measuredMoney: 0, remainMoney: 0 };
    acc[row.chapter].billCount += 1;
    acc[row.chapter].billNos.push(row.billNo);
    acc[row.chapter].contractMoney += row.contractMoney;
    acc[row.chapter].finalMoney += row.finalMoney;
    acc[row.chapter].measuredMoney += row.measuredMoney;
    acc[row.chapter].remainMoney += row.remainMoney;
    return acc;
  }, {})).map((row) => ({
    ...row,
    billNos: row.billNos.filter(Boolean).slice(0, 8).join("、"),
    contractMoney: Number(row.contractMoney.toFixed(2)),
    finalMoney: Number(row.finalMoney.toFixed(2)),
    measuredMoney: Number(row.measuredMoney.toFixed(2)),
    remainMoney: Number(row.remainMoney.toFixed(2))
  }));
  return simpleTableHtml("章节汇总", [
    { title: "章节", field: "chapter" },
    { title: "清单条数", field: "billCount" },
    { title: "清单编号", field: "billNos" },
    { title: "合同金额", field: "contractMoney" },
    { title: "最终金额", field: "finalMoney" },
    { title: "已计量金额", field: "measuredMoney" },
    { title: "剩余金额", field: "remainMoney" }
  ], rows);
}

function contractSurveyDashboardHtml(req) {
  const projectId = Number(req.query.projectId || req.body.projectId || 0);
  const project = engine.db.projects.find((row) => !projectId || Number(row.projectId || row.id) === projectId) || engine.db.projects[0] || {};
  const summary = engine.contractSummary();
  const projectSectionIds = engine.db.sections
    .filter((section) => !projectId || Number(section.projectId || 0) === projectId)
    .map((section) => Number(section.sectionId || section.id));
  const reportRows = reportPaymentRows(projectSectionIds);
  const materialArrivalMoney = reportRows.reduce((sum, row) => sum + Number(row.materialArrivalMoney || 0), 0);
  const billRows = engine.billRows().filter((row) => reportRows.some((section) => Number(section.sectionId) === Number(row.sectionId))).slice(0, 10);
  const sectionBody = reportRows.map((row) => {
    const section = engine.db.sections.find((item) => Number(item.sectionId || item.id) === Number(row.sectionId)) || {};
    return `
      <tr>
        <td>${htmlEscape(row.sectionName || "")}</td>
        <td>${htmlEscape(row.contractNo || section.contractNo || "")}</td>
        <td>${htmlEscape(section.contractor || "")}</td>
        <td>${htmlEscape(section.supervisor || "")}</td>
        <td>${moneyText(row.contractMoney)}</td>
        <td>${moneyText(row.finalMoney)}</td>
        <td>${moneyText(row.materialArrivalMoney)}</td>
        <td>${moneyText(row.totalPayMoney)}</td>
        <td>${percentText(row.payRate)}</td>
      </tr>`;
  }).join("");
  const billBody = billRows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.contractNum || 0)}</td>
      <td>${moneyText(row.price)}</td>
      <td>${moneyText(row.contractMoney)}</td>
      <td>${moneyText(row.measuredMoney)}</td>
      <td>${moneyText(row.remainMoney)}</td>
    </tr>`).join("");
  const cards = [
    ["合同总价", moneyText(summary.contractSumMoney), "清单合同金额"],
    ["变更金额", moneyText(summary.varyMoney), "工程变更净增减"],
    ["最终金额", moneyText(summary.finalMoney), "合同金额 + 变更"],
    ["累计计量", moneyText(summary.measuredMoney), "清单计量金额"],
    ["材料到场", moneyText(materialArrivalMoney), "到场跟踪不计入应付"],
    ["累计支付", moneyText(summary.payableMoney), "清单 + 补差 + 手动"],
    ["支付比例", percentText(summary.payRate), "累计支付 / 最终金额"]
  ].map(([label, value, hint]) => `
    <div class="survey-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const clauseRows = [
    ["项目名称", project.projectName || ""],
    ["项目简称", project.shortName || ""],
    ["建设单位", project.owner || "建设单位"],
    ["开工日期", project.startDate || ""],
    ["竣工日期", project.endDate || ""],
    ["合同段数", String(reportRows.length)],
    ["材料补差", moneyText(summary.materialDiasMoney)],
    ["材料到场", `${moneyText(materialArrivalMoney)}（跟踪项）`],
    ["手动计量", moneyText(summary.manualMoney)]
  ].map(([label, value]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join("");
  return `
    <div class="layui-fluid contract-survey-dashboard">
      <style>
        .contract-survey-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .survey-shell { max-width:1380px; margin:0 auto; }
        .survey-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .survey-head h2 { margin:0; font-size:22px; font-weight:600; }
        .survey-head p { margin:6px 0 0; color:#64748b; }
        .survey-actions { display:flex; gap:8px; flex-wrap:wrap; }
        .survey-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .survey-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .survey-card span, .survey-card small { display:block; color:#64748b; font-size:12px; }
        .survey-card strong { display:block; margin:8px 0; color:#166534; font-size:20px; }
        .survey-grid { display:grid; grid-template-columns:360px 1fr; gap:12px; }
        .survey-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .survey-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .survey-panel table { margin:0; min-width:760px; }
        .survey-profile table { min-width:0; }
        .survey-profile th { width:110px; background:#f8fafc; text-align:right; }
        .survey-wide { grid-column:1 / -1; }
        .left { text-align:left; }
        .survey-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .survey-cards { grid-template-columns:repeat(3, 1fr); } .survey-grid { grid-template-columns:1fr; } .survey-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .survey-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="survey-shell">
        <div class="survey-head">
          <div>
            <h2>合同概况</h2>
            <p>展示项目合同段基础信息、合同金额、变更金额、累计计量和支付比例。</p>
          </div>
          <div class="survey-actions">
            <a class="layui-btn layui-btn-sm" href="/costBase/dashboard_page">基础资料</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/reportManager/dashboard_page">计量支付报表</a>
          </div>
        </div>
        <div class="survey-cards">${cards}</div>
        <div class="survey-grid">
          <div class="survey-panel survey-profile">
            <h3>项目信息</h3>
            <table class="layui-table" lay-size="sm"><tbody>${clauseRows}</tbody></table>
          </div>
          <div class="survey-panel">
            <h3>合同段信息</h3>
            <table class="layui-table" lay-size="sm">
            <thead><tr><th>合同段</th><th>合同编号</th><th>施工单位</th><th>监理单位</th><th>合同金额</th><th>最终金额</th><th>材料到场</th><th>累计支付</th><th>支付比例</th></tr></thead>
            <tbody>${sectionBody || `<tr><td colspan="9" class="survey-empty">暂无合同段数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="survey-panel survey-wide">
            <h3>关键清单概况</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>合同段</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>合同数量</th><th>单价</th><th>合同金额</th><th>累计计量</th><th>剩余金额</th></tr></thead>
              <tbody>${billBody || `<tr><td colspan="9" class="survey-empty">暂无清单数据</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function costBaseDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const bills = engine.billRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const materials = engine.materialRows();
  const models = billModelRowsClean();
  const totalContract = bills.reduce((sum, row) => sum + Number(row.contractMoney || 0), 0);
  const totalFinal = bills.reduce((sum, row) => sum + Number(row.finalMoney || 0), 0);
  const totalMeasured = bills.reduce((sum, row) => sum + Number(row.measuredMoney || 0), 0);
  const totalRemain = bills.reduce((sum, row) => sum + Number(row.remainMoney || 0), 0);
  const chapterRows = Object.values(bills.reduce((acc, row) => {
    const chapter = String(row.chapter || row.billNo || "其他").slice(0, 3);
    acc[chapter] = acc[chapter] || { chapter, count: 0, contractMoney: 0, finalMoney: 0, measuredMoney: 0, remainMoney: 0 };
    acc[chapter].count += 1;
    acc[chapter].contractMoney += Number(row.contractMoney || 0);
    acc[chapter].finalMoney += Number(row.finalMoney || 0);
    acc[chapter].measuredMoney += Number(row.measuredMoney || 0);
    acc[chapter].remainMoney += Number(row.remainMoney || 0);
    return acc;
  }, {}));
  const materialDiff = materials.reduce((sum, row) => sum + Math.max(0, Number(row.currentPrice || row.unitPrice || 0) - Number(row.basePrice || 0)), 0);
  const cards = [
    ["清单数量", String(bills.length), `${chapterRows.length} 个章节`],
    ["合同金额", moneyText(totalContract), "清单合同金额合计"],
    ["最终金额", moneyText(totalFinal), "含变更后的控制金额"],
    ["累计计量", moneyText(totalMeasured), `计量比例 ${percentText(totalFinal ? (totalMeasured / totalFinal) * 100 : 0)}`],
    ["剩余金额", moneyText(totalRemain), "最终金额 - 累计计量"],
    ["材料价差", moneyText(materialDiff), `${materials.length} 条材料基础数据`]
  ].map(([label, value, hint]) => `
    <div class="base-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const sectionOptionsHtml = [`<option value="0"${sectionId ? "" : " selected"}>全部合同段</option>`]
    .concat(engine.db.sections.map((section) => {
      const selected = Number(section.sectionId || section.id) === sectionId ? " selected" : "";
      return `<option value="${section.sectionId || section.id}"${selected}>${htmlEscape(section.sectionName || "")}</option>`;
    })).join("");
  const chapterBody = chapterRows.map((row) => `
    <tr><td>${htmlEscape(row.chapter)}</td><td>${row.count}</td><td>${moneyText(row.contractMoney)}</td><td>${moneyText(row.finalMoney)}</td><td>${moneyText(row.measuredMoney)}</td><td>${moneyText(row.remainMoney)}</td><td>${percentText(row.finalMoney ? (row.measuredMoney / row.finalMoney) * 100 : 0)}</td></tr>`).join("");
  const billBody = bills.slice(0, 12).map((row) => `
    <tr><td>${htmlEscape(row.sectionName || "")}</td><td>${htmlEscape(row.billNo || "")}</td><td class="left">${htmlEscape(row.billName || "")}</td><td>${htmlEscape(row.measureUnit || "")}</td><td>${Number(row.contractNum || 0)}</td><td>${moneyText(row.price)}</td><td>${moneyText(row.contractMoney)}</td><td>${moneyText(row.finalMoney)}</td><td>${moneyText(row.measuredMoney)}</td><td>${moneyText(row.remainMoney)}</td></tr>`).join("");
  const materialBody = materials.slice(0, 12).map((row) => {
    const diff = Number(row.currentPrice || row.unitPrice || 0) - Number(row.basePrice || 0);
    return `<tr><td>${htmlEscape(row.materialNo || "")}</td><td class="left">${htmlEscape(row.materialName || row.secMaterialName || "")}</td><td>${htmlEscape(row.spec || row.specType || "")}</td><td>${htmlEscape(row.measureUnit || row.unit || "")}</td><td>${moneyText(row.basePrice)}</td><td>${moneyText(row.currentPrice || row.unitPrice)}</td><td>${moneyText(diff)}</td></tr>`;
  }).join("");
  const modelBody = models.slice(0, 8).map((row) => `
    <tr><td>${htmlEscape(row.modelName || row.billModelName || "")}</td><td>${htmlEscape(row.modelType || "")}</td><td>${htmlEscape(row.createDate || "")}</td><td class="left">${htmlEscape(row.remark || "")}</td></tr>`).join("");
  return `
    <div class="layui-fluid cost-base-dashboard">
      <style>
        .cost-base-dashboard { padding:16px; background:#f4f7fb; color:#172033; }
        .base-shell { max-width:1380px; margin:0 auto; }
        .base-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .base-head h2 { margin:0; font-size:22px; font-weight:600; }
        .base-head p { margin:6px 0 0; color:#64748b; }
        .base-actions { display:flex; gap:8px; align-items:center; }
        .base-actions select { height:32px; min-width:180px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .base-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .base-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .base-card span, .base-card small { display:block; color:#64748b; font-size:12px; }
        .base-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .base-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .base-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .base-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .base-panel table { margin:0; min-width:760px; }
        .base-panel-wide { grid-column:1 / -1; }
        .left { text-align:left; }
        .base-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .base-cards { grid-template-columns:repeat(3, 1fr); } .base-grid { grid-template-columns:1fr; } .base-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .base-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="base-shell">
        <div class="base-head">
          <div><h2>基础造价资料</h2><p>汇总合同清单、章节金额、材料基础价格和清单范本，作为计量支付和变更计算的基础库。</p></div>
          <div class="base-actions">
            <select onchange="location.href='/costBase/dashboard_page?sectionId='+this.value">${sectionOptionsHtml}</select>
            <a class="layui-btn layui-btn-sm layui-btn-normal" href="/costBase/reconciliation_page">造价联动校核</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/costBase/boq_validation_page">BOQ校验</a>
            <a class="layui-btn layui-btn-sm layui-btn-warm" href="/costBase/5d_model_page">5D成本模型</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/costBase/unit_price_analysis_page">综合单价分析</a>
            <a class="layui-btn layui-btn-sm" href="/costBase/calculator_page">造价计算器</a>
            <a class="layui-btn layui-btn-sm" href="/secBill/export_sec_bill">导出清单</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/secMateria/export_sec_materia">导出材料</a>
          </div>
        </div>
        <div class="base-cards">${cards}</div>
        <div class="base-grid">
          <div class="base-panel"><h3>章节金额汇总</h3><table class="layui-table" lay-size="sm"><thead><tr><th>章节</th><th>清单数</th><th>合同金额</th><th>最终金额</th><th>累计计量</th><th>剩余金额</th><th>计量比例</th></tr></thead><tbody>${chapterBody || `<tr><td colspan="7" class="base-empty">暂无章节数据</td></tr>`}</tbody></table></div>
          <div class="base-panel"><h3>材料基础价格</h3><table class="layui-table" lay-size="sm"><thead><tr><th>材料编号</th><th>材料名称</th><th>规格</th><th>单位</th><th>基准价</th><th>当前价</th><th>价差</th></tr></thead><tbody>${materialBody || `<tr><td colspan="7" class="base-empty">暂无材料数据</td></tr>`}</tbody></table></div>
          <div class="base-panel base-panel-wide"><h3>清单明细</h3><table class="layui-table" lay-size="sm"><thead><tr><th>合同段</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>合同数量</th><th>单价</th><th>合同金额</th><th>最终金额</th><th>累计计量</th><th>剩余金额</th></tr></thead><tbody>${billBody || `<tr><td colspan="10" class="base-empty">暂无清单数据</td></tr>`}</tbody></table></div>
          <div class="base-panel base-panel-wide"><h3>清单范本</h3><table class="layui-table" lay-size="sm"><thead><tr><th>范本名称</th><th>类型</th><th>创建日期</th><th>备注</th></tr></thead><tbody>${modelBody || `<tr><td colspan="4" class="base-empty">暂无范本数据</td></tr>`}</tbody></table></div>
        </div>
      </div>
    </div>`;
}

function measureById(id) {
  return engine.db.measures.find((row) => Number(row.measureId || row.id) === Number(id));
}

function billById(id) {
  return engine.db.bills.find((row) => Number(row.billId || row.id) === Number(id));
}

function billIdFrom(req) {
  return Number(
    req.body.billId ||
    req.query.billId ||
    req.body.secBillId ||
    req.query.secBillId ||
    req.params.id ||
    idsFrom(req, "ids")[0] ||
    0
  );
}

function billFormHtml(req) {
  const id = billIdFrom(req);
  const item = billById(id) || {};
  const row = item.billId ? engine.billRows().find((entry) => Number(entry.billId) === Number(item.billId)) || {} : {};
  const sectionId = item.sectionId || (engine.db.sections[0] && engine.db.sections[0].sectionId) || 101;
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="sec-bill-form">
        <input type="hidden" name="billId" value="${item.billId || ""}">
        <input type="hidden" name="secBillId" value="${item.billId || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">章节</label>
          <div class="layui-input-block"><input class="layui-input" name="chapter" value="${htmlEscape(item.chapter || "100")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">清单编号</label>
          <div class="layui-input-block"><input class="layui-input" name="billNo" value="${htmlEscape(item.billNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">清单名称</label>
          <div class="layui-input-block"><input class="layui-input" name="billName" value="${htmlEscape(item.billName || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">合同段</label>
          <div class="layui-input-block"><select name="sectionId">${sectionOptions(sectionId)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">单位</label>
          <div class="layui-input-block"><input class="layui-input" name="measureUnit" value="${htmlEscape(item.measureUnit || "项")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">合同数量</label>
          <div class="layui-input-block"><input class="layui-input" name="contractNum" value="${item.contractNum || 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">修正数量</label>
          <div class="layui-input-block"><input class="layui-input" name="correctedNum" value="${item.correctedNum ?? item.contractNum ?? 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">单价</label>
          <div class="layui-input-block"><input class="layui-input" name="price" value="${item.price || 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">合同金额</label>
          <div class="layui-input-block"><input class="layui-input" readonly value="${row.contractMoney || 0}"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/secBill/save_bill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存清单</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveSecBill(req) {
  const body = { ...req.query, ...req.body };
  let id = billIdFrom(req);
  let item = billById(id);
  if (!item) {
    id = nextId(engine.db.bills, "billId");
    item = { id, billId: id };
    engine.db.bills.push(item);
  }
  item.sectionId = numeric(body.sectionId, item.sectionId || 101);
  item.chapter = body.chapter || item.chapter || "900";
  item.billNo = body.billNo || item.billNo || `${item.chapter}-${id}`;
  item.billName = body.billName || body.name || item.billName || `清单 ${id}`;
  item.measureUnit = body.measureUnit || body.unit || item.measureUnit || "项";
  item.contractNum = numeric(body.contractNum ?? body.quantity, item.contractNum || 0);
  item.correctedNum = numeric(body.correctedNum ?? body.updateNum, item.correctedNum ?? item.contractNum);
  item.price = numeric(body.price ?? body.unitPrice, item.price || 0);
  return { changed: 1, billId: item.billId, row: engine.billRows().find((row) => Number(row.billId) === Number(item.billId)) };
}

function secBillDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const chapter = String(req.query.chapter || req.body.chapter || "");
  let rows = engine.billRows();
  if (sectionId) rows = rows.filter((row) => Number(row.sectionId || 0) === sectionId);
  if (chapter) rows = rows.filter((row) => String(row.chapter || row.billNo || "").startsWith(chapter));
  const sections = engine.db.sections || [];
  const sectionOptionsHtml = [`<option value="0"${sectionId ? "" : " selected"}>全部合同段</option>`]
    .concat(sections.map((section) => {
      const selected = Number(section.sectionId || section.id) === sectionId ? " selected" : "";
      return `<option value="${section.sectionId || section.id}"${selected}>${htmlEscape(section.sectionName || "")}</option>`;
    })).join("");
  const chapters = [...new Set(engine.billRows().map((row) => String(row.chapter || row.billNo || "").slice(0, 3)).filter(Boolean))].sort();
  const chapterOptionsHtml = [`<option value=""${chapter ? "" : " selected"}>全部章节</option>`]
    .concat(chapters.map((item) => `<option value="${htmlEscape(item)}"${item === chapter ? " selected" : ""}>${htmlEscape(item)}</option>`)).join("");
  const totals = rows.reduce((acc, row) => {
    acc.count += 1;
    acc.contractMoney += Number(row.contractMoney || 0);
    acc.correctedMoney += Number(row.correctedMoney || row.contractMoney || 0);
    acc.finalMoney += Number(row.finalMoney || 0);
    acc.measuredMoney += Number(row.measuredMoney || 0);
    acc.remainMoney += Number(row.remainMoney || 0);
    acc.varyMoney += Number(row.finalMoney || 0) - Number(row.correctedMoney || row.contractMoney || 0);
    return acc;
  }, { count: 0, contractMoney: 0, correctedMoney: 0, finalMoney: 0, measuredMoney: 0, remainMoney: 0, varyMoney: 0 });
  const chapterRows = Object.values(rows.reduce((acc, row) => {
    const key = String(row.chapter || row.billNo || "其它").slice(0, 3) || "其它";
    acc[key] = acc[key] || { chapter: key, count: 0, contractMoney: 0, finalMoney: 0, measuredMoney: 0, remainMoney: 0 };
    acc[key].count += 1;
    acc[key].contractMoney += Number(row.contractMoney || 0);
    acc[key].finalMoney += Number(row.finalMoney || 0);
    acc[key].measuredMoney += Number(row.measuredMoney || 0);
    acc[key].remainMoney += Number(row.remainMoney || 0);
    return acc;
  }, {})).sort((a, b) => String(a.chapter).localeCompare(String(b.chapter)));
  const sectionRows = Object.values(rows.reduce((acc, row) => {
    const key = row.sectionName || row.contractNo || `section-${row.sectionId || 0}`;
    acc[key] = acc[key] || { sectionName: key, count: 0, finalMoney: 0, measuredMoney: 0, remainMoney: 0 };
    acc[key].count += 1;
    acc[key].finalMoney += Number(row.finalMoney || 0);
    acc[key].measuredMoney += Number(row.measuredMoney || 0);
    acc[key].remainMoney += Number(row.remainMoney || 0);
    return acc;
  }, {}));
  const riskRows = rows
    .filter((row) => Number(row.finalMoney || 0) > 0 && (Number(row.measuredMoney || 0) / Number(row.finalMoney || 0) >= 0.8 || Number(row.remainMoney || 0) < 0))
    .sort((a, b) => (Number(b.measuredMoney || 0) / Number(b.finalMoney || 1)) - (Number(a.measuredMoney || 0) / Number(a.finalMoney || 1)))
    .slice(0, 12);
  const cards = [
    ["清单条数", String(totals.count), "当前筛选清单数量"],
    ["合同金额", moneyText(totals.contractMoney), "原始合同金额"],
    ["修正金额", moneyText(totals.correctedMoney), "修正数量 x 单价"],
    ["变更净额", moneyText(totals.varyMoney), "最终金额 - 修正金额"],
    ["最终金额", moneyText(totals.finalMoney), "含变更后的控制金额"],
    ["累计计量", moneyText(totals.measuredMoney), `计量比例 ${percentText(totals.finalMoney ? (totals.measuredMoney / totals.finalMoney) * 100 : 0)}`]
  ].map(([label, value, hint]) => `
    <div class="secbill-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const chapterBody = chapterRows.map((row) => `
    <tr>
      <td>${htmlEscape(row.chapter)}</td>
      <td>${row.count}</td>
      <td>${moneyText(row.contractMoney)}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${moneyText(row.measuredMoney)}</td>
      <td>${moneyText(row.remainMoney)}</td>
      <td>${percentText(row.finalMoney ? (row.measuredMoney / row.finalMoney) * 100 : 0)}</td>
      <td><a href="/secBill/dashboard_page?sectionId=${sectionId || ""}&chapter=${encodeURIComponent(row.chapter)}">筛选</a></td>
    </tr>`).join("");
  const sectionBody = sectionRows.map((row) => `
    <tr>
      <td class="left">${htmlEscape(row.sectionName)}</td>
      <td>${row.count}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${moneyText(row.measuredMoney)}</td>
      <td>${moneyText(row.remainMoney)}</td>
      <td>${percentText(row.finalMoney ? (row.measuredMoney / row.finalMoney) * 100 : 0)}</td>
    </tr>`).join("");
  const billBody = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.chapter || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.contractNum || 0)}</td>
      <td>${Number(row.correctedNum || row.contractNum || 0)}</td>
      <td>${moneyText(row.price)}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${moneyText(row.measuredMoney)}</td>
      <td>${moneyText(row.remainMoney)}</td>
      <td><a href="/save_sec_bill_page?billId=${row.billId}">编辑</a></td>
    </tr>`).join("");
  const riskBody = riskRows.map((row) => `
    <tr>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${moneyText(row.measuredMoney)}</td>
      <td>${moneyText(row.remainMoney)}</td>
      <td>${percentText(row.finalMoney ? (row.measuredMoney / row.finalMoney) * 100 : 0)}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid secbill-dashboard">
      <style>
        .secbill-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .secbill-shell { max-width:1380px; margin:0 auto; }
        .secbill-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .secbill-head h2 { margin:0; font-size:22px; font-weight:600; }
        .secbill-head p { margin:6px 0 0; color:#64748b; }
        .secbill-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .secbill-actions select { height:32px; min-width:150px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .secbill-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .secbill-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .secbill-card span, .secbill-card small { display:block; color:#64748b; font-size:12px; }
        .secbill-card strong { display:block; margin:8px 0; color:#1d4ed8; font-size:20px; }
        .secbill-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .secbill-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .secbill-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .secbill-panel table { margin:0; min-width:820px; }
        .secbill-wide { grid-column:1 / -1; }
        .left { text-align:left; }
        .secbill-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .secbill-cards { grid-template-columns:repeat(3, 1fr); } .secbill-grid { grid-template-columns:1fr; } .secbill-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .secbill-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="secbill-shell">
        <div class="secbill-head">
          <div>
            <h2>清单管理综合看板</h2>
            <p>汇总合同清单、章节金额、标段金额、变更后最终金额、累计计量和剩余金额，支撑清单维护与造价控制。</p>
          </div>
          <div class="secbill-actions">
            <select onchange="location.href='/secBill/dashboard_page?sectionId='+this.value+'&chapter=${encodeURIComponent(chapter)}'">${sectionOptionsHtml}</select>
            <select onchange="location.href='/secBill/dashboard_page?sectionId=${sectionId || ""}&chapter='+this.value">${chapterOptionsHtml}</select>
            <a class="layui-btn layui-btn-sm" href="/save_sec_bill_page">添加清单</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/import_sec_bill">导入清单</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/secBill/export_sec_bill">导出清单</a>
          </div>
        </div>
        <div class="secbill-cards">${cards}</div>
        <div class="secbill-grid">
          <div class="secbill-panel">
            <h3>章节汇总</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>章节</th><th>条数</th><th>合同金额</th><th>最终金额</th><th>累计计量</th><th>剩余金额</th><th>计量比例</th><th>操作</th></tr></thead>
              <tbody>${chapterBody || `<tr><td colspan="8" class="secbill-empty">暂无章节数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="secbill-panel">
            <h3>标段汇总</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>合同段</th><th>条数</th><th>最终金额</th><th>累计计量</th><th>剩余金额</th><th>计量比例</th></tr></thead>
              <tbody>${sectionBody || `<tr><td colspan="6" class="secbill-empty">暂无标段数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="secbill-panel secbill-wide">
            <h3>计量风险清单</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>清单编号</th><th>清单名称</th><th>最终金额</th><th>累计计量</th><th>剩余金额</th><th>计量比例</th></tr></thead>
              <tbody>${riskBody || `<tr><td colspan="6" class="secbill-empty">暂无高计量比例清单</td></tr>`}</tbody>
            </table>
          </div>
          <div class="secbill-panel secbill-wide">
            <h3>清单明细</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>合同段</th><th>章节</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>合同数量</th><th>修正数量</th><th>单价</th><th>最终金额</th><th>累计计量</th><th>剩余金额</th><th>操作</th></tr></thead>
              <tbody>${billBody || `<tr><td colspan="12" class="secbill-empty">暂无清单数据</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function materialIdFrom(req) {
  return Number(
    req.body.materialId ||
    req.query.materialId ||
    req.body.secMateriaId ||
    req.query.secMateriaId ||
    req.body.secMaterialId ||
    req.query.secMaterialId ||
    req.params.id ||
    idsFrom(req, "ids")[0] ||
    0
  );
}

function materialById(id) {
  return engine.db.materials.find((row) => Number(row.materialId || row.secMateriaId || row.secMaterialId || row.id) === Number(id));
}

function modelCenterDashboardHtml(req) {
  const sourcePath = String(req.path || "");
  const showMaterialsOnly = sourcePath.includes("manual_model") || sourcePath.includes("secMateria");
  const billModels = billModelRowsClean();
  const materials = engine.materialRows();
  const totalModelMoney = billModels.reduce((sum, row) => sum + Number(row.contractMoney || 0), 0);
  const totalBaseMaterialMoney = materials.reduce((sum, row) => sum + Number(row.basePrice || 0), 0);
  const totalCurrentMaterialMoney = materials.reduce((sum, row) => sum + Number(row.currentPrice || row.unitPrice || 0), 0);
  const chapterMap = billModels.reduce((acc, row) => {
    const chapter = row.chapter || String(row.billNo || "").slice(0, 3) || "其它";
    acc[chapter] = acc[chapter] || { chapter, count: 0, money: 0 };
    acc[chapter].count += 1;
    acc[chapter].money += Number(row.contractMoney || 0);
    return acc;
  }, {});
  const priceDiffMaterials = materials.filter((row) => Number(row.currentPrice || row.unitPrice || 0) !== Number(row.basePrice || 0));
  const cards = [
    ["清单范本", String(billModels.length), "可导入合同清单"],
    ["范本金额", moneyText(totalModelMoney), "数量 x 单价"],
    ["材料范本", String(materials.length), "材料/机械/人工基础库"],
    ["调差材料", String(priceDiffMaterials.length), "现行价不同于基准价"],
    ["基准价合计", moneyText(totalBaseMaterialMoney), "材料基准价格汇总"],
    ["现行价合计", moneyText(totalCurrentMaterialMoney), "材料现行价格汇总"]
  ].map(([label, value, hint]) => `
    <div class="model-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const modelBody = billModels.map((row) => `
    <tr>
      <td>${htmlEscape(row.chapter || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || row.modelName || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.contractNum || 0)}</td>
      <td>${moneyText(row.price)}</td>
      <td>${moneyText(row.contractMoney)}</td>
      <td><a href="/billModel/edit_model_page?billId=${row.billId || row.modelId}">编辑</a></td>
    </tr>`).join("");
  const materialBody = materials.map((row) => {
    const currentPrice = Number(row.currentPrice || row.unitPrice || 0);
    const basePrice = Number(row.basePrice || 0);
    return `
      <tr>
        <td>${htmlEscape(row.materialNo || "")}</td>
        <td class="left">${htmlEscape(row.materialName || row.secMaterialName || "")}</td>
        <td>${htmlEscape(row.spec || row.specType || "")}</td>
        <td>${htmlEscape(row.measureUnit || row.unit || "")}</td>
        <td>${moneyText(basePrice)}</td>
        <td>${moneyText(currentPrice)}</td>
        <td>${moneyText(currentPrice - basePrice)}</td>
        <td><a href="/secMateria/sec_materia_add_page?materialId=${row.materialId || row.secMaterialId || row.id}">编辑</a></td>
      </tr>`;
  }).join("");
  const chapterBody = Object.values(chapterMap).sort((a, b) => String(a.chapter).localeCompare(String(b.chapter))).map((row) => `
    <tr><td>${htmlEscape(row.chapter)}</td><td>${row.count}</td><td>${moneyText(row.money)}</td></tr>`).join("");
  const diffBody = priceDiffMaterials.map((row) => {
    const currentPrice = Number(row.currentPrice || row.unitPrice || 0);
    const basePrice = Number(row.basePrice || 0);
    return `<tr><td>${htmlEscape(row.materialNo || "")}</td><td class="left">${htmlEscape(row.materialName || "")}</td><td>${moneyText(basePrice)}</td><td>${moneyText(currentPrice)}</td><td>${moneyText(currentPrice - basePrice)}</td></tr>`;
  }).join("");
  return `
    <div class="layui-fluid model-dashboard">
      <style>
        .model-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .model-shell { max-width:1380px; margin:0 auto; }
        .model-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .model-head h2 { margin:0; font-size:22px; font-weight:600; }
        .model-head p { margin:6px 0 0; color:#64748b; }
        .model-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .model-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .model-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .model-card span, .model-card small { display:block; color:#64748b; font-size:12px; }
        .model-card strong { display:block; margin:8px 0; color:#166534; font-size:20px; }
        .model-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .model-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .model-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .model-panel table { margin:0; min-width:720px; }
        .model-panel-wide { grid-column:1 / -1; }
        .left { text-align:left; }
        .model-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .model-cards { grid-template-columns:repeat(3, 1fr); } .model-grid { grid-template-columns:1fr; } .model-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .model-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="model-shell">
        <div class="model-head">
          <div>
            <h2>${showMaterialsOnly ? "材料范本管理看板" : "造价范本资料中心"}</h2>
            <p>汇总清单范本、材料范本、章节金额和材料调差信息，支撑清单导入、材料价格维护与造价计算复用。</p>
          </div>
          <div class="model-actions">
            <a class="layui-btn layui-btn-sm" href="/billModel/edit_model_page">新增清单范本</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/billModel/import_model">导入清单范本</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/billModel/export_model">导出清单范本</a>
            <a class="layui-btn layui-btn-sm" href="/secMateria/sec_materia_add_page">新增材料</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/secMateria/export_sec_materia">导出材料</a>
          </div>
        </div>
        <div class="model-cards">${cards}</div>
        <div class="model-grid">
          <div class="model-panel">
            <h3>章节范本汇总</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>章节</th><th>清单条数</th><th>范本金额</th></tr></thead>
              <tbody>${chapterBody || `<tr><td colspan="3" class="model-empty">暂无清单范本</td></tr>`}</tbody>
            </table>
          </div>
          <div class="model-panel">
            <h3>材料调差预警</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>材料编号</th><th>材料名称</th><th>基准价</th><th>现行价</th><th>价差</th></tr></thead>
              <tbody>${diffBody || `<tr><td colspan="5" class="model-empty">暂无价差材料</td></tr>`}</tbody>
            </table>
          </div>
          ${showMaterialsOnly ? "" : `
          <div class="model-panel model-panel-wide">
            <h3>清单范本明细</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>章节</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>数量</th><th>单价</th><th>金额</th><th>操作</th></tr></thead>
              <tbody>${modelBody || `<tr><td colspan="8" class="model-empty">暂无清单范本</td></tr>`}</tbody>
            </table>
          </div>`}
          <div class="model-panel model-panel-wide">
            <h3>材料范本明细</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>材料编号</th><th>材料名称</th><th>规格型号</th><th>单位</th><th>基准价</th><th>现行价</th><th>价差</th><th>操作</th></tr></thead>
              <tbody>${materialBody || `<tr><td colspan="8" class="model-empty">暂无材料范本</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function materialFormHtml(req) {
  const id = materialIdFrom(req);
  const item = materialById(id) || {};
  const saveUrl = String(req.path || "").includes("manual_model") ? "/manual_model/save_material" : "/secMateria/save_material";
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="material-form">
        <input type="hidden" name="materialId" value="${item.materialId || ""}">
        <input type="hidden" name="secMateriaId" value="${item.materialId || ""}">
        <input type="hidden" name="secMaterialId" value="${item.materialId || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">材料编号</label>
          <div class="layui-input-block"><input class="layui-input" name="materialNo" value="${htmlEscape(item.materialNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">材料名称</label>
          <div class="layui-input-block"><input class="layui-input" name="materialName" value="${htmlEscape(item.materialName || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">规格型号</label>
          <div class="layui-input-block"><input class="layui-input" name="spec" value="${htmlEscape(item.spec || item.specType || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">单位</label>
          <div class="layui-input-block"><input class="layui-input" name="unit" value="${htmlEscape(item.unit || item.measureUnit || "项")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">基准价</label>
          <div class="layui-input-block"><input class="layui-input" name="basePrice" value="${item.basePrice || 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">现行价</label>
          <div class="layui-input-block"><input class="layui-input" name="currentPrice" value="${item.currentPrice ?? item.unitPrice ?? item.basePrice ?? 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">调差范围</label>
          <div class="layui-input-block"><input class="layui-input" name="sendersRange" value="${htmlEscape(item.sendersRange || "按合同调差")}"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('${saveUrl}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存材料</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveMaterial(req) {
  const body = { ...req.query, ...req.body };
  let id = materialIdFrom(req);
  let item = materialById(id);
  if (!item) {
    id = nextId(engine.db.materials, "materialId");
    item = { id, materialId: id, secMateriaId: id, secMaterialId: id };
    engine.db.materials.push(item);
  }
  item.materialId = item.materialId || id;
  item.secMateriaId = item.materialId;
  item.secMaterialId = item.materialId;
  item.materialNo = body.materialNo || item.materialNo || `CL-${String(item.materialId).padStart(3, "0")}`;
  item.materialName = body.materialName || body.name || item.materialName || `材料 ${item.materialId}`;
  item.spec = body.spec || body.specType || item.spec || "";
  item.specType = item.spec;
  item.unit = body.unit || body.measureUnit || item.unit || "项";
  item.measureUnit = item.unit;
  item.basePrice = numeric(body.basePrice ?? body.price, item.basePrice || 0);
  item.currentPrice = numeric(body.currentPrice ?? body.unitPrice ?? body.price, item.currentPrice ?? item.basePrice);
  item.unitPrice = item.currentPrice;
  item.materialName = cleanBusinessText(item.materialName, `材料 ${item.materialId}`);
  item.unit = cleanBusinessText(item.unit, "项");
  item.measureUnit = item.unit;
  item.sendersRange = body.sendersRange || item.sendersRange || "按合同调差";
  return { changed: 1, materialId: item.materialId, row: engine.materialRows().find((row) => Number(row.materialId) === Number(item.materialId)) };
}

function billModelIdFrom(req) {
  return Number(req.body.modelId || req.query.modelId || req.body.billModelId || req.query.billModelId || req.body.billId || req.query.billId || req.params.id || idsFrom(req, "ids")[0] || 0);
}

function billModelById(id) {
  return engine.db.billModels.find((row) => Number(row.modelId || row.id) === Number(id));
}

function billModelRowsClean() {
  return engine.db.billModels.map((item, index) => {
    const id = item.modelId || item.billId || item.id || index + 1;
    const quantity = numeric(item.contractNum ?? item.quantity, 0);
    const price = numeric(item.price ?? item.unitPrice, 0);
    const money = Number((quantity * price).toFixed(2));
    const billName = cleanBusinessText(item.billName || item.modelName, `清单范本 ${id}`);
    const measureUnit = cleanBusinessText(item.measureUnit || item.unit, "项");
    return {
      ...item,
      id,
      modelId: id,
      billId: id,
      billNo: item.billNo || `MB-${String(id).padStart(3, "0")}`,
      billName,
      modelName: billName,
      chapter: item.chapter || "900",
      measureUnit,
      contractNum: quantity,
      correctedNum: numeric(item.correctedNum, quantity),
      price,
      contractMoney: money,
      finalMoney: money,
      modelType: cleanBusinessText(item.modelType, "计量支付"),
      createDate: item.createDate || today(),
      remark: cleanBusinessText(item.remark, "")
    };
  });
}

function billModelFormHtmlClean(req) {
  const id = billModelIdFrom(req);
  const raw = billModelById(id) || {};
  const item = raw.modelId ? billModelRowsClean().find((row) => Number(row.modelId) === Number(raw.modelId)) || {} : {};
  const input = (label, name, value, attrs = "") => `
        <div class="layui-form-item">
          <label class="layui-form-label">${label}</label>
          <div class="layui-input-block"><input class="layui-input" name="${name}" value="${htmlEscape(value ?? "")}" ${attrs}></div>
        </div>`;
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="bill-model-form">
        <input type="hidden" name="modelId" value="${htmlEscape(item.modelId || "")}">
        ${input("清单编号", "billNo", item.billNo)}
        ${input("中文名称", "billName", item.billName)}
        ${input("章节", "chapter", item.chapter || "900")}
        ${input("计量单位", "measureUnit", item.measureUnit || "项")}
        ${input("工程数量", "contractNum", item.contractNum || 0, 'type="number" step="0.001"')}
        ${input("单价", "price", item.price || 0, 'type="number" step="0.01"')}
        <div class="layui-form-item">
          <label class="layui-form-label">备注</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="remark">${htmlEscape(item.remark || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/billModel/save_model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存范本</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveBillModelClean(req) {
  const body = { ...req.query, ...req.body };
  let id = billModelIdFrom(req);
  let item = billModelById(id);
  if (!item) {
    id = nextId(engine.db.billModels, "modelId");
    item = { id, modelId: id };
    engine.db.billModels.push(item);
  }
  item.id = item.id || id;
  item.modelId = item.modelId || id;
  item.billNo = body.billNo || item.billNo || `MB-${String(item.modelId).padStart(3, "0")}`;
  item.billName = cleanBusinessText(body.billName || body.modelName || body.name || item.billName || item.modelName, `清单范本 ${item.modelId}`);
  item.modelName = item.billName;
  item.chapter = body.chapter || item.chapter || "900";
  item.measureUnit = cleanBusinessText(body.measureUnit || body.unit || item.measureUnit, "项");
  item.contractNum = numeric(body.contractNum ?? body.quantity, item.contractNum || 0);
  item.correctedNum = numeric(body.correctedNum ?? body.updateNum, item.correctedNum ?? item.contractNum);
  item.price = numeric(body.price ?? body.unitPrice, item.price || 0);
  item.modelType = cleanBusinessText(body.modelType || item.modelType, "计量支付");
  item.createDate = body.createDate || item.createDate || today();
  item.remark = body.remark || item.remark || "";
  return { changed: 1, modelId: item.modelId, billId: item.modelId, row: billModelRowsClean().find((row) => Number(row.modelId) === Number(item.modelId)) };
}

function billModelFormHtml(req) {
  const id = billModelIdFrom(req);
  const item = billModelById(id) || {};
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="bill-model-form">
        <input type="hidden" name="modelId" value="${item.modelId || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">范本名称</label>
          <div class="layui-input-block"><input class="layui-input" name="modelName" value="${htmlEscape(item.modelName || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">范本类型</label>
          <div class="layui-input-block"><input class="layui-input" name="modelType" value="${htmlEscape(item.modelType || "计量支付")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">创建日期</label>
          <div class="layui-input-block"><input class="layui-input" name="createDate" value="${htmlEscape(item.createDate || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">备注</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="remark">${htmlEscape(item.remark || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/billModel/save_model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存范本</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveBillModel(req) {
  const body = { ...req.query, ...req.body };
  let id = billModelIdFrom(req);
  let item = billModelById(id);
  if (!item) {
    id = nextId(engine.db.billModels, "modelId");
    item = { id, modelId: id };
    engine.db.billModels.push(item);
  }
  item.modelName = body.modelName || body.name || item.modelName || `清单范本 ${id}`;
  item.modelType = body.modelType || item.modelType || "计量支付";
  item.createDate = body.createDate || item.createDate || today();
  item.remark = body.remark || item.remark || "";
  return { changed: 1, modelId: item.modelId, row: item };
}

function billMeasureIdFrom(req) {
  return Number(
    req.body.billMeasureId ||
    req.query.billMeasureId ||
    req.body.measureId ||
    req.query.measureId ||
    req.params.id ||
    0
  );
}

function measureDetailRowsFor(measureId) {
  const measure = measureById(measureId);
  if (!measure) return [];
  return (measure.details || []).map((detail, index) => {
    const bill = billById(detail.billId) || {};
    const price = Number(bill.price || detail.price || 0);
    const measureNum = Number(detail.measureNum || 0);
    return {
      ...bill,
      billMeasureId: measure.measureId,
      measureId: measure.measureId,
      billMeasureDetailId: detail.detailId || `${measure.measureId}-${detail.billId}-${index + 1}`,
      detailIndex: index,
      measureNo: measure.measureNo,
      sectionName: (engine.db.sections.find((item) => Number(item.sectionId) === Number(measure.sectionId)) || {}).sectionName || "",
      measureDate: measure.measureDate,
      measureNum,
      currentNum: measureNum,
      price,
      currentMoney: Number((measureNum * price).toFixed(2)),
      measureMoney: Number((measureNum * price).toFixed(2)),
      money: Number((measureNum * price).toFixed(2))
    };
  });
}

function billMeasureDetailHtml(req) {
  const measureId = billMeasureIdFrom(req);
  const measure = measureById(measureId);
  const rows = measureDetailRowsFor(measureId);
  const total = rows.reduce((sum, row) => sum + Number(row.measureMoney || 0), 0).toFixed(2);
  const body = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.billNo)}</td>
      <td>${htmlEscape(row.billName)}</td>
      <td>${htmlEscape(row.measureUnit)}</td>
      <td>${row.measureNum}</td>
      <td>${row.price}</td>
      <td>${row.measureMoney}</td>
      <td><button type="button" class="layui-btn layui-btn-danger layui-btn-xs" onclick="(function(btn){fetch('/bill_measure/delete_detail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({billMeasureId:${measureId},detailIndex:${row.detailIndex}})}).then(function(r){return r.json()}).then(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())});})(this)">删除</button></td>
    </tr>`).join("");
  return `
    <div class="layui-card" style="margin-top:10px;">
      <div class="layui-card-header">${htmlEscape(measure ? measure.measureNo : "计量明细")} 明细合计：${total}</div>
      <div class="layui-card-body">
        <table class="layui-table" lay-size="sm">
          <thead><tr><th>清单编号</th><th>清单名称</th><th>单位</th><th>计量数量</th><th>单价</th><th>计量金额</th><th>操作</th></tr></thead>
          <tbody>${body || '<tr><td colspan="7" style="text-align:center;">暂无明细</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function billMeasureAddDetailHtml(req) {
  const measureId = billMeasureIdFrom(req);
  const options = engine.billRows().map((bill) => `<option value="${bill.billId}">${htmlEscape(bill.billNo)} ${htmlEscape(bill.billName)} (${htmlEscape(bill.measureUnit)})</option>`).join("");
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="bill-measure-detail-form">
        <input type="hidden" name="billMeasureId" value="${measureId}">
        <div class="layui-form-item">
          <label class="layui-form-label">清单</label>
          <div class="layui-input-block"><select class="layui-select" name="billId">${options}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">数量</label>
          <div class="layui-input-block"><input class="layui-input" name="measureNum" value="1"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/bill_measure/save_detail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存明细</button>
          </div>
        </div>
        ${billMeasureDetailHtml(req)}
      </form>
    </div>`;
}

function saveBillMeasureDetail(req) {
  const measureId = billMeasureIdFrom(req);
  const measure = measureById(measureId);
  if (!measure) return { changed: 0, error: "计量单不存在" };
  const billId = Number(req.body.billId || req.query.billId || 0);
  const bill = billById(billId);
  if (!bill) return { changed: 0, error: "清单不存在" };
  const measureNum = Number(req.body.measureNum || req.query.measureNum || req.body.quantity || 0);
  if (!Number.isFinite(measureNum) || measureNum <= 0) return { changed: 0, error: "计量数量无效" };
  const existing = (measure.details || []).find((detail) => Number(detail.billId) === billId);
  if (existing) {
    existing.measureNum = Number((Number(existing.measureNum || 0) + measureNum).toFixed(3));
  } else {
    measure.details = measure.details || [];
    measure.details.push({ detailId: nextId(measure.details, "detailId"), billId, measureNum });
  }
  return { changed: 1, billMeasureId: measureId, detailCount: measure.details.length };
}

function deleteBillMeasureDetail(req) {
  const measureId = billMeasureIdFrom(req);
  const measure = measureById(measureId);
  if (!measure || !Array.isArray(measure.details)) return { changed: 0 };
  const detailIndex = Number(req.body.detailIndex ?? req.query.detailIndex);
  const billId = Number(req.body.billId || req.query.billId || 0);
  let index = Number.isFinite(detailIndex) ? detailIndex : -1;
  if (index < 0 && billId > 0) index = measure.details.findIndex((detail) => Number(detail.billId) === billId);
  if (index < 0 || index >= measure.details.length) return { changed: 0 };
  measure.details.splice(index, 1);
  return { changed: 1, billMeasureId: measureId, detailCount: measure.details.length };
}

function measurePeriodOptions(selectedId) {
  return engine.db.measurePeriods.map((item) => {
    const value = item.gatherId || item.id;
    const selected = Number(value) === Number(selectedId) ? " selected" : "";
    return `<option value="${value}"${selected}>${htmlEscape(item.periodDesc || item.gatherNo || `第 ${value} 期`)}</option>`;
  }).join("");
}

function billMeasureFormHtml(req, mode = "edit") {
  const id = billMeasureIdFrom(req);
  const source = measureById(id) || {};
  const isCopy = mode === "copy";
  const item = isCopy ? { ...source, measureId: "", measureNo: "" } : source;
  const row = source.measureId ? engine.measureRows().find((entry) => Number(entry.measureId) === Number(source.measureId)) || {} : {};
  const sectionId = item.sectionId || (engine.db.sections[0] && engine.db.sections[0].sectionId) || 101;
  const periodId = item.periodId || item.gatherId || (engine.db.measurePeriods[0] && engine.db.measurePeriods[0].gatherId) || 1;
  const details = Array.isArray(source.details) ? source.details.length : 0;
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="bill-measure-form">
        <input type="hidden" name="billMeasureId" value="${item.measureId || ""}">
        <input type="hidden" name="measureId" value="${item.measureId || ""}">
        <input type="hidden" name="sourceMeasureId" value="${isCopy ? htmlEscape(source.measureId || "") : ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">计量单号</label>
          <div class="layui-input-block"><input class="layui-input" name="measureNo" value="${htmlEscape(item.measureNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">合同段</label>
          <div class="layui-input-block"><select name="sectionId">${sectionOptions(sectionId)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">工期</label>
          <div class="layui-input-block"><select name="periodId">${measurePeriodOptions(periodId)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">计量日期</label>
          <div class="layui-input-block"><input class="layui-input" name="measureDate" value="${htmlEscape(item.measureDate || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">图号</label>
          <div class="layui-input-block"><input class="layui-input" name="drawNo" value="${htmlEscape(item.drawNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">桩号</label>
          <div class="layui-input-block"><input class="layui-input" name="pegNo" value="${htmlEscape(item.pegNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">质检单</label>
          <div class="layui-input-block"><input class="layui-input" name="certifyNo" value="${htmlEscape(item.certifyNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">部位</label>
          <div class="layui-input-block"><input class="layui-input" name="position" value="${htmlEscape(item.position || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">状态</label>
          <div class="layui-input-block"><select name="states">${workflowStateOptions(item.states || row.states || "待上报", ["待上报", "审核中", "已审核", "已调整", "已归档", "已退回"])}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">明细</label>
          <div class="layui-input-block"><input class="layui-input" readonly value="${details} 条，金额 ${row.measureMoney || 0}"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/bill_measure/save_measure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存计量单</button>
          </div>
        </div>
      </form>
      ${source.measureId && !isCopy ? billMeasureDetailHtml(req) : ""}
    </div>`;
}

function billMeasureOrderHtml(req) {
  const ids = idsFrom(req, "billMeasureIds").concat(idsFrom(req, "measureIds"), idsFrom(req, "billMeasureId"), idsFrom(req, "measureId"));
  const rows = engine.measureRows().filter((row) => !ids.length || ids.includes(Number(row.billMeasureId || row.measureId)));
  const detailSections = rows.map((measure) => {
    const details = measureDetailRowsFor(measure.billMeasureId || measure.measureId);
    const detailRows = details.map((detail) => `
          <tr>
            <td>${htmlEscape(detail.billNo)}</td>
            <td>${htmlEscape(detail.billName)}</td>
            <td>${htmlEscape(detail.measureUnit)}</td>
            <td>${detail.measureNum}</td>
            <td>${detail.price}</td>
            <td>${detail.measureMoney}</td>
          </tr>`).join("");
    return `
      <section style="page-break-after:always;margin-bottom:24px;">
        <h2 style="margin:0 0 12px;font-size:20px;">清单计量单 ${htmlEscape(measure.measureNo || "")}</h2>
        <table class="layui-table" lay-size="sm">
          <tbody>
            <tr><th>合同段</th><td>${htmlEscape(measure.sectionName || "")}</td><th>计量日期</th><td>${htmlEscape(measure.measureDate || "")}</td></tr>
            <tr><th>图号</th><td>${htmlEscape(measure.drawNo || "")}</td><th>桩号</th><td>${htmlEscape(measure.pegNo || "")}</td></tr>
            <tr><th>质检单</th><td>${htmlEscape(measure.certifyNo || "")}</td><th>状态</th><td>${htmlEscape(measure.states || "")}</td></tr>
            <tr><th>计量部位</th><td colspan="3">${htmlEscape(measure.position || "")}</td></tr>
          </tbody>
        </table>
        <table class="layui-table" lay-size="sm">
          <thead><tr><th>清单编号</th><th>清单名称</th><th>单位</th><th>计量数量</th><th>单价</th><th>计量金额</th></tr></thead>
          <tbody>${detailRows || '<tr><td colspan="6" style="text-align:center;">暂无明细</td></tr>'}</tbody>
          <tfoot><tr><th colspan="5" style="text-align:right;">合计</th><th>${measure.measureMoney || 0}</th></tr></tfoot>
        </table>
      </section>`;
  }).join("");
  return `
    <div class="layui-fluid" style="padding:16px;">
      <div class="layui-card">
        <div class="layui-card-header">清单计量单打印预览</div>
        <div class="layui-card-body">${detailSections || '<div style="padding:20px;text-align:center;">暂无计量单</div>'}</div>
      </div>
    </div>`;
}

function saveBillMeasure(req) {
  const body = { ...req.query, ...req.body };
  let id = billMeasureIdFrom(req);
  let item = measureById(id);
  if (!item) {
    id = nextId(engine.db.measures, "measureId");
    const firstBill = engine.db.bills[0] || {};
    item = {
      id,
      measureId: id,
      states: "待上报",
      details: firstBill.billId ? [{ billId: firstBill.billId, measureNum: 0 }] : []
    };
    engine.db.measures.push(item);
    const source = measureById(Number(body.sourceMeasureId || 0));
    if (source && Array.isArray(source.details)) {
      item.details = source.details.map((detail, index) => ({ ...detail, detailId: index + 1 }));
      item.states = "待上报";
    }
  }
  item.measureNo = body.measureNo || item.measureNo || `JL-LOCAL-${String(id).padStart(3, "0")}`;
  item.sectionId = numeric(body.sectionId, item.sectionId || 101);
  item.periodId = numeric(body.periodId || body.gatherId, item.periodId || 1);
  item.measureDate = body.measureDate || item.measureDate || today();
  item.drawNo = body.drawNo || item.drawNo || "";
  item.pegNo = body.pegNo || item.pegNo || "";
  item.certifyNo = body.certifyNo || item.certifyNo || "";
  item.position = body.position || item.position || "";
  item.states = body.states || body.state || item.states || "待上报";
  if (!Array.isArray(item.details)) item.details = [];
  return { changed: 1, billMeasureId: item.measureId, row: engine.measureRows().find((row) => Number(row.measureId) === Number(item.measureId)) };
}

function orderBillMeasureNo(req) {
  const body = { ...req.query, ...req.body };
  const periodId = numeric(body.periodId || body.gatherId, 0);
  let rows = engine.db.measures;
  if (periodId) rows = rows.filter((row) => Number(row.periodId || row.gatherId || 0) === periodId);
  rows = rows.slice().sort((a, b) => {
    const periodDiff = Number(a.periodId || a.gatherId || 0) - Number(b.periodId || b.gatherId || 0);
    if (periodDiff) return periodDiff;
    const dateDiff = String(a.measureDate || "").localeCompare(String(b.measureDate || ""));
    if (dateDiff) return dateDiff;
    return Number(a.measureId || a.id || 0) - Number(b.measureId || b.id || 0);
  });
  rows.forEach((row, index) => {
    row.sortNo = index + 1;
    row.orderNo = index + 1;
    row.measureSort = index + 1;
  });
  return {
    changed: rows.length,
    periodId,
    firstMeasureNo: rows[0] ? rows[0].measureNo : "",
    lastMeasureNo: rows[rows.length - 1] ? rows[rows.length - 1].measureNo : ""
  };
}

function billMeasureDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const periodId = Number(req.query.periodId || req.body.periodId || req.query.gatherId || req.body.gatherId || 0);
  const stateFilter = String(req.query.state || req.body.state || "");
  let rows = engine.measureRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  if (periodId) rows = rows.filter((row) => Number(row.periodId || row.gatherId || 0) === periodId);
  if (stateFilter) rows = rows.filter((row) => String(row.states || "").includes(stateFilter));
  const detailRowsAll = rows.flatMap((row) => measureDetailRowsFor(row.billMeasureId || row.measureId));
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.measureMoney || 0), 0);
  const totalDetailMoney = detailRowsAll.reduce((sum, row) => sum + Number(row.measureMoney || row.currentMoney || 0), 0);
  const totalQuantity = detailRowsAll.reduce((sum, row) => sum + Number(row.measureNum || 0), 0);
  const pending = rows.filter((row) => /待|上报|审核中/.test(row.states || "")).length;
  const approved = rows.filter((row) => /已审核|审核通过/.test(row.states || "")).length;
  const archived = rows.filter((row) => /归档/.test(row.states || "") || row.isArchive).length;
  const measureIds = new Set(rows.map((row) => Number(row.billMeasureId || row.measureId || 0)).filter(Boolean));
  const logs = ensureWorkflowLogs()
    .filter((log) => log.module === "billmeasure" && (!measureIds.size || measureIds.has(Number(log.businessId || 0))))
    .slice(-12)
    .reverse();
  const cards = [
    ["计量单数量", rows.length, "当前筛选范围"],
    ["明细数量", detailRowsAll.length, "清单计量明细条目"],
    ["计量数量", Number(totalQuantity.toFixed(3)), "明细工程量合计"],
    ["计量金额", moneyText(totalMoney || totalDetailMoney), "清单计量金额合计"],
    ["待处理/已审核/已归档", `${pending}/${approved}/${archived}`, "流程状态汇总"],
    ["平均单金额", rows.length ? moneyText(totalMoney / rows.length) : "0.00", "计量金额 / 计量单数量"]
  ].map(([label, value, hint]) => `
    <div class="bm-card">
      <span>${htmlEscape(label)}</span>
      <strong>${htmlEscape(value)}</strong>
      <small>${htmlEscape(hint)}</small>
    </div>`).join("");
  const sectionOptionsHtml = [`<option value="">全部合同段</option>`].concat(engine.db.sections.map((section) => {
    const id = Number(section.sectionId || section.id || 0);
    const selected = sectionId && id === sectionId ? " selected" : "";
    return `<option value="${id}"${selected}>${htmlEscape(section.sectionName || "")}</option>`;
  })).join("");
  const periodOptionsHtml = [`<option value="">全部工期</option>`].concat(engine.db.measurePeriods.map((period) => {
    const id = Number(period.gatherId || period.id || 0);
    const selected = periodId && id === periodId ? " selected" : "";
    return `<option value="${id}"${selected}>${htmlEscape(period.periodDesc || period.gatherNo || `第${id}期`)}</option>`;
  })).join("");
  const stateOptions = ["", "待上报", "审核中", "已审核", "已归档", "已退回"].map((state) => {
    const selected = state === stateFilter ? " selected" : "";
    return `<option value="${htmlEscape(state)}"${selected}>${htmlEscape(state || "全部状态")}</option>`;
  }).join("");
  const measureRows = rows.map((row) => {
    const id = Number(row.billMeasureId || row.measureId || 0);
    return `
      <tr>
        <td>${htmlEscape(row.measureNo || "")}</td>
        <td>${htmlEscape(row.sectionName || "")}</td>
        <td>${htmlEscape(row.periodDesc || row.gatherNo || "")}</td>
        <td>${htmlEscape(row.measureDate || "")}</td>
        <td>${htmlEscape(row.drawNo || "")}</td>
        <td>${htmlEscape(row.pegNo || "")}</td>
        <td class="left">${htmlEscape(row.position || "")}</td>
        <td>${Number(row.detailCount || (measureDetailRowsFor(id).length) || 0)}</td>
        <td>${moneyText(row.measureMoney)}</td>
        <td><span class="bm-state">${htmlEscape(row.states || "")}</span></td>
        <td class="bm-actions">
          <a href="/bill_measure/edit_page?billMeasureId=${id}">编辑</a>
          <a href="/bill_measure/add_measure_page?billMeasureId=${id}">明细</a>
          <a href="/bill_measure/copy_page?billMeasureId=${id}">复制</a>
          <a href="/bill_measure/up_order?billMeasureIds=${id}">上报</a>
          <a href="/bill_measure/agree_order?billMeasureId=${id}">审核</a>
          <a href="/bill_measure/return_order_page?billMeasureId=${id}">退回</a>
          <a href="/bill_measure/track_bill_measure_page?measureType=billmeasure&ids=${id}">流程</a>
          <a href="/bill_measure/render_order_page?billMeasureIds=${id}">打印</a>
        </td>
      </tr>`;
  }).join("");
  const detailRows = detailRowsAll.slice(0, 80).map((row) => `
    <tr>
      <td>${htmlEscape(row.measureNo || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.measureNum || 0)}</td>
      <td>${moneyText(row.price)}</td>
      <td>${moneyText(row.measureMoney)}</td>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.measureDate || "")}</td>
    </tr>`).join("");
  const logRows = logs.map((log) => `
    <tr>
      <td>${htmlEscape(log.businessNo || "")}</td>
      <td>${htmlEscape(log.step || log.action || "")}</td>
      <td>${htmlEscape(log.result || "")}</td>
      <td>${htmlEscape(log.userName || "")}</td>
      <td>${htmlEscape(log.time || "")}</td>
      <td class="left">${htmlEscape(cleanBusinessText(log.remark, ""))}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid bill-measure-dashboard">
      <style>
        .bill-measure-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .bm-shell { max-width:1380px; margin:0 auto; }
        .bm-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .bm-head h2 { margin:0; font-size:22px; font-weight:600; }
        .bm-head p { margin:6px 0 0; color:#64748b; }
        .bm-tools { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .bm-tools select { height:32px; min-width:140px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .bm-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .bm-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .bm-card span, .bm-card small { display:block; color:#64748b; font-size:12px; }
        .bm-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .bm-grid { display:grid; grid-template-columns:1.15fr .85fr; gap:12px; }
        .bm-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .bm-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .bm-panel table { margin:0; min-width:860px; }
        .bm-wide { grid-column:1 / -1; }
        .bm-actions a { margin-right:8px; white-space:nowrap; }
        .bm-state { display:inline-block; min-width:54px; text-align:center; color:#075985; background:#e0f2fe; border:1px solid #bae6fd; border-radius:4px; padding:2px 6px; }
        .bm-empty { text-align:center; color:#94a3b8; padding:24px; }
        .left { text-align:left; }
        @media (max-width:1100px) { .bm-cards { grid-template-columns:repeat(3, 1fr); } .bm-grid { grid-template-columns:1fr; } .bm-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .bm-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="bm-shell">
        <div class="bm-head">
          <div>
            <h2>清单计量管理看板</h2>
            <p>集中管理清单计量单、计量明细、审核流转、打印预览和计量支付报表。</p>
          </div>
          <div class="bm-tools">
            <select onchange="location.href='/bill_measure/dashboard_page?sectionId='+this.value+'&periodId=${encodeURIComponent(periodId || "")}&state=${encodeURIComponent(stateFilter)}'">${sectionOptionsHtml}</select>
            <select onchange="location.href='/bill_measure/dashboard_page?sectionId=${encodeURIComponent(sectionId || "")}&periodId='+this.value+'&state=${encodeURIComponent(stateFilter)}'">${periodOptionsHtml}</select>
            <select onchange="location.href='/bill_measure/dashboard_page?sectionId=${encodeURIComponent(sectionId || "")}&periodId=${encodeURIComponent(periodId || "")}&state='+this.value">${stateOptions}</select>
            <a class="layui-btn layui-btn-sm" href="/bill_measure/add_page">新增计量</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/import_measure/dashboard_page">导入记录</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/bill_measure/export_bill_measure?sectionId=${encodeURIComponent(sectionId || "")}&periodId=${encodeURIComponent(periodId || "")}&state=${encodeURIComponent(stateFilter)}">导出Excel</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/reportManager/dashboard_page?sectionId=${sectionId || ""}">报表中心</a>
          </div>
        </div>
        <div class="bm-cards">${cards}</div>
        <div class="bm-panel bm-wide">
          <h3>计量单清单</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>计量单号</th><th>合同段</th><th>工期</th><th>计量日期</th><th>图号</th><th>桩号</th><th>部位</th><th>明细数</th><th>计量金额</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${measureRows || `<tr><td colspan="11" class="bm-empty">暂无清单计量单</td></tr>`}</tbody>
          </table>
        </div>
        <div class="bm-grid">
          <div class="bm-panel">
            <h3>计量明细</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>计量单号</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>计量数量</th><th>单价</th><th>计量金额</th><th>合同段</th><th>日期</th></tr></thead>
              <tbody>${detailRows || `<tr><td colspan="9" class="bm-empty">暂无计量明细</td></tr>`}</tbody>
            </table>
          </div>
          <div class="bm-panel">
            <h3>最近流程记录</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>业务编号</th><th>环节</th><th>结果</th><th>处理人</th><th>时间</th><th>意见</th></tr></thead>
              <tbody>${logRows || `<tr><td colspan="6" class="bm-empty">暂无流程记录</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function manualMeasureIdFrom(req) {
  return Number(
    req.body.manualMeasureId ||
    req.query.manualMeasureId ||
    req.body.manualId ||
    req.query.manualId ||
    req.params.id ||
    idsFrom(req, "ids")[0] ||
    0
  );
}

function manualMeasureById(id) {
  return engine.db.manualMeasures.find((row) => Number(row.manualId || row.id) === Number(id));
}

function manualMeasureFormHtml(req) {
  const id = manualMeasureIdFrom(req);
  const item = manualMeasureById(id) || {};
  const row = item.manualId ? engine.manualMeasureRows().find((entry) => Number(entry.manualId) === Number(item.manualId)) || {} : {};
  const sectionId = item.sectionId || (engine.db.sections[0] && engine.db.sections[0].sectionId) || 101;
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="manual-measure-form">
        <input type="hidden" name="manualMeasureId" value="${item.manualId || ""}">
        <input type="hidden" name="manualId" value="${item.manualId || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">计量单号</label>
          <div class="layui-input-block"><input class="layui-input" name="measureNo" value="${htmlEscape(item.measureNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">合同段</label>
          <div class="layui-input-block"><select name="sectionId">${sectionOptions(sectionId)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">清单编号</label>
          <div class="layui-input-block"><input class="layui-input" name="billNo" value="${htmlEscape(item.billNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">清单名称</label>
          <div class="layui-input-block"><input class="layui-input" name="billName" value="${htmlEscape(item.billName || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">单位</label>
          <div class="layui-input-block"><input class="layui-input" name="measureUnit" value="${htmlEscape(item.measureUnit || "项")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">数量</label>
          <div class="layui-input-block"><input class="layui-input" name="measureNum" value="${item.measureNum || 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">单价</label>
          <div class="layui-input-block"><input class="layui-input" name="price" value="${item.price || 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">计量日期</label>
          <div class="layui-input-block"><input class="layui-input" name="measureDate" value="${htmlEscape(item.measureDate || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">计量依据</label>
          <div class="layui-input-block"><input class="layui-input" name="certifyNo" value="${htmlEscape(item.certifyNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">施工部位</label>
          <div class="layui-input-block"><input class="layui-input" name="position" value="${htmlEscape(item.position || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">备注</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="remark">${htmlEscape(item.remark || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">状态</label>
          <div class="layui-input-block"><select name="states">${workflowStateOptions(item.states || row.states || "待上报", ["待上报", "审核中", "已更新", "已调整", "已归档", "已退回"])}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">测算金额</label>
          <div class="layui-input-block"><input class="layui-input" readonly value="${row.measureMoney || 0}"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/manualMeasure/save_measure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存手动计量</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveManualMeasure(req) {
  const body = { ...req.query, ...req.body };
  let id = manualMeasureIdFrom(req);
  let item = manualMeasureById(id);
  if (!item) {
    id = nextId(engine.db.manualMeasures, "manualId");
    item = { id, manualId: id, states: "待上报" };
    engine.db.manualMeasures.push(item);
  }
  item.sectionId = numeric(body.sectionId, item.sectionId || 101);
  item.measureNo = body.measureNo || item.measureNo || `SD-LOCAL-${String(id).padStart(3, "0")}`;
  item.billNo = body.billNo || item.billNo || `900-${id}`;
  item.billName = body.billName || item.billName || "现场签证工程";
  item.measureUnit = body.measureUnit || item.measureUnit || "项";
  item.measureNum = numeric(body.measureNum ?? body.quantity, item.measureNum || 0);
  item.price = numeric(body.price, item.price || 0);
  item.measureDate = body.measureDate || item.measureDate || today();
  item.certifyNo = body.certifyNo || item.certifyNo || item.measureNo;
  item.position = body.position || item.position || "";
  item.remark = body.remark || item.remark || "";
  item.states = body.states || body.state || item.states || "待上报";
  return { changed: 1, manualMeasureId: item.manualId, row: engine.manualMeasureRows().find((row) => Number(row.manualId) === Number(item.manualId)) };
}

function manualMeasureDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const rows = engine.manualMeasureRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.measureMoney || row.money || 0), 0);
  const totalQuantity = rows.reduce((sum, row) => sum + Number(row.measureNum || 0), 0);
  const archivedCount = rows.filter((row) => String(row.states || "").includes("归档")).length;
  const updatedCount = rows.filter((row) => String(row.states || "").includes("更新") || String(row.states || "").includes("审核")).length;
  const sectionOptionsHtml = [`<option value="0"${sectionId ? "" : " selected"}>全部合同段</option>`]
    .concat(engine.db.sections.map((section) => {
      const selected = Number(section.sectionId || section.id) === sectionId ? " selected" : "";
      return `<option value="${section.sectionId || section.id}"${selected}>${htmlEscape(section.sectionName || "")}</option>`;
    })).join("");
  const billGroups = Object.values(rows.reduce((acc, row) => {
    const key = row.billNo || row.billName || row.manualId;
    acc[key] = acc[key] || { billNo: row.billNo, billName: row.billName, unit: row.measureUnit, count: 0, quantity: 0, money: 0 };
    acc[key].count += 1;
    acc[key].quantity += Number(row.measureNum || 0);
    acc[key].money += Number(row.measureMoney || row.money || 0);
    return acc;
  }, {}));
  const cards = [
    ["计量单数", String(rows.length), "手动计量记录数"],
    ["清单项数", String(billGroups.length), "按清单编号去重"],
    ["计量数量", Number(totalQuantity.toFixed(3)).toLocaleString("zh-CN"), "数量合计"],
    ["计量金额", moneyText(totalMoney), "数量乘以单价"],
    ["已归档", String(archivedCount), "归档完成单据"],
    ["处理中", String(Math.max(0, rows.length - archivedCount)), `${updatedCount} 条已审核/更新`]
  ].map(([label, value, hint]) => `
    <div class="manual-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const groupBody = billGroups.map((row) => `
    <tr>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.unit || "")}</td>
      <td>${row.count}</td>
      <td>${Number(row.quantity.toFixed(3))}</td>
      <td>${moneyText(row.money)}</td>
    </tr>`).join("");
  const detailBody = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.measureNo || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.measureNum || 0)}</td>
      <td>${moneyText(row.price)}</td>
      <td>${moneyText(row.measureMoney || row.money)}</td>
      <td>${htmlEscape(row.measureDate || "")}</td>
      <td>${htmlEscape(row.states || "")}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid manual-measure-dashboard">
      <style>
        .manual-measure-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .manual-shell { max-width:1320px; margin:0 auto; }
        .manual-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .manual-head h2 { margin:0; font-size:22px; font-weight:600; }
        .manual-head p { margin:6px 0 0; color:#64748b; }
        .manual-actions { display:flex; gap:8px; align-items:center; }
        .manual-actions select { height:32px; min-width:180px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .manual-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .manual-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .manual-card span, .manual-card small { display:block; color:#64748b; font-size:12px; }
        .manual-card strong { display:block; margin:8px 0; color:#0369a1; font-size:20px; }
        .manual-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .manual-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .manual-panel table { margin:0; min-width:920px; }
        .left { text-align:left; }
        .manual-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width: 980px) {
          .manual-head { align-items:flex-start; flex-direction:column; }
          .manual-cards { grid-template-columns:repeat(2, minmax(140px, 1fr)); }
        }
      </style>
      <div class="manual-shell">
        <div class="manual-head">
          <div>
            <h2>手动计量看板</h2>
            <p>汇总现场签证、零星工程等手动计量金额，作为计量支付应付金额的补充项。</p>
          </div>
          <div class="manual-actions">
            <select onchange="location.href='/manualMeasure/dashboard_page?sectionId='+this.value">${sectionOptionsHtml}</select>
            <a class="layui-btn layui-btn-sm" href="/manualMeasure/manualMeasure_edit_page">新增手动计量</a>
          </div>
        </div>
        <div class="manual-cards">${cards}</div>
        <div class="manual-panel">
          <h3>手动计量汇总</h3>
          <table class="layui-table">
            <thead><tr><th>清单编号</th><th>清单名称</th><th>单位</th><th>单据数</th><th>计量数量</th><th>计量金额</th></tr></thead>
            <tbody>${groupBody || `<tr><td colspan="6" class="manual-empty">暂无手动计量汇总</td></tr>`}</tbody>
          </table>
        </div>
        <div class="manual-panel">
          <h3>手动计量明细</h3>
          <table class="layui-table">
            <thead><tr><th>合同段</th><th>计量单号</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>数量</th><th>单价</th><th>计量金额</th><th>计量日期</th><th>状态</th></tr></thead>
            <tbody>${detailBody || `<tr><td colspan="10" class="manual-empty">暂无手动计量明细</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function manualMeasureManagementDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const selectedState = String(req.query.state || req.body.state || "");
  const allRows = engine.manualMeasureRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const rows = allRows.filter((row) => !selectedState || String(row.states || "") === selectedState);
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.measureMoney || row.money || 0), 0);
  const totalQuantity = rows.reduce((sum, row) => sum + Number(row.measureNum || 0), 0);
  const archivedCount = rows.filter((row) => String(row.states || "").includes("归档") || String(row.states || "").includes("褰掓。")).length;
  const sectionOptionsHtml = [`<option value="0"${sectionId ? "" : " selected"}>全部合同段</option>`]
    .concat(engine.db.sections.map((section) => {
      const id = section.sectionId || section.id;
      return `<option value="${id}"${Number(id) === sectionId ? " selected" : ""}>${htmlEscape(section.sectionName || "")}</option>`;
    })).join("");
  const stateValues = Array.from(new Set(allRows.map((row) => String(row.states || "")).filter(Boolean)));
  const stateOptionsHtml = [`<option value=""${selectedState ? "" : " selected"}>全部状态</option>`]
    .concat(stateValues.map((state) => `<option value="${htmlEscape(state)}"${state === selectedState ? " selected" : ""}>${htmlEscape(state)}</option>`))
    .join("");
  const billGroups = Object.values(rows.reduce((acc, row) => {
    const key = row.billNo || row.billName || row.manualId;
    acc[key] = acc[key] || { billNo: row.billNo, billName: row.billName, unit: row.measureUnit, count: 0, quantity: 0, money: 0 };
    acc[key].count += 1;
    acc[key].quantity += Number(row.measureNum || 0);
    acc[key].money += Number(row.measureMoney || row.money || 0);
    return acc;
  }, {}));
  const cards = [
    ["计量单数", String(rows.length), "手动计量记录"],
    ["清单项数", String(billGroups.length), "按清单编号汇总"],
    ["计量数量", Number(totalQuantity.toFixed(3)).toLocaleString("zh-CN"), "当前筛选数量合计"],
    ["计量金额", moneyText(totalMoney), "数量乘单价"],
    ["已归档", String(archivedCount), "归档完成单据"],
    ["待处理", String(Math.max(0, rows.length - archivedCount)), "仍在流转单据"]
  ].map(([label, value, hint]) => `
    <div class="manual-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const groupBody = billGroups.map((row) => `
    <tr>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.unit || "")}</td>
      <td>${row.count}</td>
      <td>${Number(row.quantity.toFixed(3))}</td>
      <td>${moneyText(row.money)}</td>
    </tr>`).join("");
  const detailBody = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.measureNo || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.measureNum || 0)}</td>
      <td>${moneyText(row.price)}</td>
      <td>${moneyText(row.measureMoney || row.money)}</td>
      <td>${htmlEscape(row.measureDate || "")}</td>
      <td>${htmlEscape(row.states || "")}</td>
      <td class="manual-links">
        <a href="/manualMeasure/manualMeasure_edit_page?manualId=${row.manualId}">编辑</a>
        <a data-post="/manualMeasure/up_order" data-id="${row.manualId}">上报</a>
        <a data-post="/manualMeasure/update_measure_state" data-id="${row.manualId}">确认</a>
        <a href="/manualMeasure/return_order_page?measureType=manualmeasure&ids=${row.manualId}">退回</a>
        <a data-post="/manualMeasure/archive" data-id="${row.manualId}">归档</a>
        <a href="/manualMeasure/record_page?measureType=manualmeasure&ids=${row.manualId}&businessId=${row.manualId}">追踪</a>
      </td>
    </tr>`).join("");
  const logBody = ensureWorkflowLogs()
    .filter((log) => log.module === "manualmeasure")
    .slice(-8)
    .reverse()
    .map((log) => `
      <tr>
        <td>${htmlEscape(log.businessNo || "")}</td>
        <td>${htmlEscape(log.step || "")}</td>
        <td>${htmlEscape(log.userName || "")}</td>
        <td>${htmlEscape(log.result || "")}</td>
        <td>${htmlEscape(log.time || "")}</td>
        <td class="left">${htmlEscape(log.remark || "")}</td>
      </tr>`).join("");
  return `
    <div class="layui-fluid manual-measure-dashboard">
      <style>
        .manual-measure-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .manual-shell { max-width:1320px; margin:0 auto; }
        .manual-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .manual-head h2 { margin:0; font-size:22px; font-weight:600; }
        .manual-head p { margin:6px 0 0; color:#64748b; }
        .manual-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .manual-actions select { height:32px; min-width:150px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .manual-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .manual-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .manual-card span, .manual-card small { display:block; color:#64748b; font-size:12px; }
        .manual-card strong { display:block; margin:8px 0; color:#0369a1; font-size:20px; }
        .manual-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .manual-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .manual-panel table { margin:0; min-width:980px; }
        .left { text-align:left; }
        .manual-empty { text-align:center; color:#94a3b8; padding:24px; }
        .manual-links { min-width:190px; }
        .manual-links a { display:inline-block; margin:0 6px 4px 0; color:#1d4ed8; cursor:pointer; }
        @media (max-width:1100px) { .manual-cards { grid-template-columns:repeat(3, 1fr); } .manual-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .manual-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="manual-shell">
        <div class="manual-head">
          <div><h2>手动计量管理看板</h2><p>汇总现场签证、零星工程等手动计量金额，作为计量支付应付金额的补充项。</p></div>
          <div class="manual-actions">
            <select id="manual-section">${sectionOptionsHtml}</select>
            <select id="manual-state">${stateOptionsHtml}</select>
            <a class="layui-btn layui-btn-sm" href="/manualMeasure/manualMeasure_edit_page">新增手动计量</a>
            <a class="layui-btn layui-btn-primary layui-btn-sm" href="/workflow/dashboard_page?module=manualmeasure">流程台账</a>
            <a class="layui-btn layui-btn-primary layui-btn-sm" href="/manualMeasure/export_manual_measure?sectionId=${encodeURIComponent(sectionId || "")}&state=${encodeURIComponent(selectedState)}">导出Excel</a>
          </div>
        </div>
        <div class="manual-cards">${cards}</div>
        <div class="manual-panel">
          <h3>手动计量汇总</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>清单编号</th><th>清单名称</th><th>单位</th><th>单据数</th><th>计量数量</th><th>计量金额</th></tr></thead>
            <tbody>${groupBody || `<tr><td colspan="6" class="manual-empty">暂无手动计量汇总</td></tr>`}</tbody>
          </table>
        </div>
        <div class="manual-panel">
          <h3>手动计量明细</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>合同段</th><th>计量单号</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>数量</th><th>单价</th><th>计量金额</th><th>计量日期</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${detailBody || `<tr><td colspan="11" class="manual-empty">暂无手动计量数据</td></tr>`}</tbody>
          </table>
        </div>
        <div class="manual-panel">
          <h3>最近流程记录</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>单据编号</th><th>节点</th><th>处理人</th><th>结果</th><th>时间</th><th>意见</th></tr></thead>
            <tbody>${logBody || `<tr><td colspan="6" class="manual-empty">暂无手动计量流程记录</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <script>
        (function(){
          function reload(){
            var section = document.getElementById('manual-section').value;
            var state = document.getElementById('manual-state').value;
            location.href = '/manualMeasure/dashboard_page?sectionId=' + encodeURIComponent(section) + '&state=' + encodeURIComponent(state);
          }
          document.getElementById('manual-section').onchange = reload;
          document.getElementById('manual-state').onchange = reload;
          Array.prototype.forEach.call(document.querySelectorAll('[data-post]'), function(link) {
            link.onclick = function() {
              fetch(link.getAttribute('data-post'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: link.getAttribute('data-id'), manualId: link.getAttribute('data-id') })
              }).then(function(r){ return r.json(); }).then(function(r){
                if (window.layer) layer.msg(r.msg || '处理完成');
                setTimeout(function(){ (window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload()); }, 450);
              });
            };
          });
        })();
      </script>
    </div>`;
}

function variationById(id) {
  return engine.db.variations.find((row) => Number(row.varyId || row.id) === Number(id) || Number(row.varyDetailId) === Number(id));
}

function varyIdFrom(req) {
  return Number(
    req.body.varyId ||
    req.query.varyId ||
    req.body.varyDetailId ||
    req.query.varyDetailId ||
    req.params.id ||
    0
  );
}

function variationDetailRows(req) {
  const varyId = Number((req.query && req.query.varyId) || (req.body && req.body.varyId) || 0);
  return engine.variationRows().filter((row) => {
    if (row.detailDeleted) return false;
    if (varyId > 0) return Number(row.varyId) === varyId || Number(row.varyDetailId) === varyId;
    return true;
  });
}

function variationDetailFormHtml(req) {
  const id = varyIdFrom(req);
  const item = variationById(id) || engine.db.variations[0] || {};
  const billOptions = engine.billRows().map((bill) => {
    const selected = Number(bill.billId) === Number(item.billId) ? " selected" : "";
    return `<option value="${bill.billId}"${selected}>${htmlEscape(bill.billNo)} ${htmlEscape(bill.billName)}</option>`;
  }).join("");
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="vary-detail-form">
        <input type="hidden" name="varyId" value="${item.varyId || id || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">清单</label>
          <div class="layui-input-block"><select name="billId" class="layui-select">${billOptions}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更前数量</label>
          <div class="layui-input-block"><input class="layui-input" name="beforeNum" value="${item.beforeNum || 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更前单价</label>
          <div class="layui-input-block"><input class="layui-input" name="beforePrice" value="${item.beforePrice || 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更后数量</label>
          <div class="layui-input-block"><input class="layui-input" name="afterNum" value="${item.afterNum || 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更后单价</label>
          <div class="layui-input-block"><input class="layui-input" name="afterPrice" value="${item.afterPrice || 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更原因</label>
          <div class="layui-input-block"><input class="layui-input" name="varyReason" value="${htmlEscape(item.varyReason || "")}"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/vary_detail/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存变更明细</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveVariationDetail(req) {
  const id = varyIdFrom(req);
  const item = variationById(id);
  if (!item) return { changed: 0, error: "变更不存在" };
  const bill = billById(req.body.billId || req.query.billId || item.billId) || billById(item.billId) || {};
  item.billId = bill.billId || item.billId;
  item.billNo = bill.billNo || item.billNo;
  item.billName = bill.billName || item.billName;
  item.measureUnit = bill.measureUnit || item.measureUnit;
  item.beforeNum = Number(req.body.beforeNum ?? req.query.beforeNum ?? item.beforeNum ?? 0);
  item.beforePrice = Number(req.body.beforePrice ?? req.query.beforePrice ?? item.beforePrice ?? bill.price ?? 0);
  item.afterNum = Number(req.body.afterNum ?? req.query.afterNum ?? item.afterNum ?? 0);
  item.afterPrice = Number(req.body.afterPrice ?? req.query.afterPrice ?? item.afterPrice ?? bill.price ?? 0);
  item.varyReason = req.body.varyReason || req.query.varyReason || item.varyReason || "";
  item.detailDeleted = false;
  return {
    changed: 1,
    varyId: item.varyId,
    varyMoney: Number(((item.afterNum * item.afterPrice) - (item.beforeNum * item.beforePrice)).toFixed(2))
  };
}

function deleteVariationDetail(req) {
  const item = variationById(varyIdFrom(req));
  if (!item) return { changed: 0 };
  item.afterNum = item.beforeNum;
  item.afterPrice = item.beforePrice;
  item.detailDeleted = true;
  return { changed: 1, varyId: item.varyId, state: "detailDeleted" };
}

function variationFormHtml(req) {
  const id = varyIdFrom(req);
  const item = variationById(id) || {};
  const billId = item.billId || (engine.db.bills[0] && engine.db.bills[0].billId);
  const selectedBill = billById(billId) || engine.db.bills[0] || {};
  const billOptions = engine.billRows().map((bill) => {
    const selected = Number(bill.billId) === Number(billId) ? " selected" : "";
    return `<option value="${bill.billId}"${selected}>${htmlEscape(bill.billNo)} ${htmlEscape(bill.billName)} / ${htmlEscape(bill.measureUnit)} / ${bill.price}</option>`;
  }).join("");
  const sectionId = item.sectionId || selectedBill.sectionId || 101;
  const beforeNum = item.beforeNum ?? selectedBill.contractNum ?? 0;
  const beforePrice = item.beforePrice ?? selectedBill.price ?? 0;
  const afterNum = item.afterNum ?? beforeNum;
  const afterPrice = item.afterPrice ?? beforePrice;
  const varyMoney = Number(((Number(afterNum) * Number(afterPrice)) - (Number(beforeNum) * Number(beforePrice))).toFixed(2));
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="variation-form">
        <input type="hidden" name="varyId" value="${item.varyId || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">变更编号</label>
          <div class="layui-input-block"><input class="layui-input" name="varyNo" value="${htmlEscape(item.varyNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">合同段</label>
          <div class="layui-input-block"><select name="sectionId">${sectionOptions(sectionId)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">清单</label>
          <div class="layui-input-block"><select name="billId">${billOptions}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更前数量</label>
          <div class="layui-input-block"><input class="layui-input" name="beforeNum" value="${beforeNum}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更前单价</label>
          <div class="layui-input-block"><input class="layui-input" name="beforePrice" value="${beforePrice}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更后数量</label>
          <div class="layui-input-block"><input class="layui-input" name="afterNum" value="${afterNum}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更后单价</label>
          <div class="layui-input-block"><input class="layui-input" name="afterPrice" value="${afterPrice}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更原因</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="varyReason">${htmlEscape(item.varyReason || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">测算金额</label>
          <div class="layui-input-block"><input class="layui-input" readonly value="${varyMoney}"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/vary_measure/save_measure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存变更</button>
          </div>
        </div>
      </form>
      ${item.varyId ? variationDetailFormHtml(req) : ""}
    </div>`;
}

function saveVariation(req) {
  const body = { ...req.query, ...req.body };
  let id = varyIdFrom(req);
  let item = variationById(id);
  if (!item) {
    id = nextId(engine.db.variations, "varyId");
    item = { id, varyId: id, states: "待上报" };
    engine.db.variations.push(item);
  }
  const bill = billById(body.billId || item.billId) || engine.db.bills[0] || {};
  item.sectionId = numeric(body.sectionId, item.sectionId || bill.sectionId || 101);
  item.billId = bill.billId || item.billId;
  item.billNo = bill.billNo || item.billNo || "";
  item.billName = bill.billName || item.billName || "";
  item.measureUnit = bill.measureUnit || item.measureUnit || "";
  item.varyNo = body.varyNo || item.varyNo || `BG-LOCAL-${String(id).padStart(3, "0")}`;
  item.beforeNum = numeric(body.beforeNum, item.beforeNum ?? bill.contractNum ?? 0);
  item.beforePrice = numeric(body.beforePrice, item.beforePrice ?? bill.price ?? 0);
  item.afterNum = numeric(body.afterNum, item.afterNum ?? item.beforeNum);
  item.afterPrice = numeric(body.afterPrice, item.afterPrice ?? item.beforePrice);
  item.varyReason = body.varyReason || item.varyReason || "";
  item.measureDate = body.measureDate || body.createDate || item.measureDate || today();
  item.detailDeleted = false;
  item.states = body.states || body.state || item.states || "待上报";
  return { changed: 1, varyId: item.varyId, row: engine.variationRows().find((row) => Number(row.varyId) === Number(item.varyId)) };
}

function contactIdFrom(req) {
  return Number(req.body.contactId || req.query.contactId || req.body.id || req.query.id || req.params.id || idsFrom(req, "ids")[0] || 0);
}

function contactById(id) {
  return engine.db.contactBills.find((row) => Number(row.contactId || row.id) === Number(id));
}

function contactFormHtml(req) {
  const id = contactIdFrom(req);
  const item = contactById(id) || {};
  const sectionId = item.sectionId || (engine.db.sections[0] && engine.db.sections[0].sectionId) || 101;
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="contact-bill-form">
        <input type="hidden" name="contactId" value="${item.contactId || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">联系单编号</label>
          <div class="layui-input-block"><input class="layui-input" name="contactNo" value="${htmlEscape(item.contactNo || item.skillNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">标题</label>
          <div class="layui-input-block"><input class="layui-input" name="title" value="${htmlEscape(item.title || item.contactContent || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">合同段</label>
          <div class="layui-input-block"><select name="sectionId">${sectionOptions(sectionId)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">日期</label>
          <div class="layui-input-block"><input class="layui-input" name="createDate" value="${htmlEscape(item.createDate || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">联系内容</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="contactContent">${htmlEscape(item.contactContent || item.title || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">会议纪要</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="changeMeetingText">${htmlEscape(item.changeMeetingText || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">影响类型</label>
          <div class="layui-input-block">
            <select name="costImpactType">
              <option value="技术联系"${String(item.costImpactType || "技术联系") === "技术联系" ? " selected" : ""}>技术联系</option>
              <option value="建议变更"${String(item.costImpactType || "") === "建议变更" ? " selected" : ""}>建议变更</option>
              <option value="费用调整"${String(item.costImpactType || "") === "费用调整" ? " selected" : ""}>费用调整</option>
            </select>
          </div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">建议金额</label>
          <div class="layui-input-block"><input class="layui-input" name="estimateMoney" value="${Number(item.estimateMoney || item.money || 0)}"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/engineering_contact_bill/save_bill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存联系单</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveContactBill(req) {
  const body = { ...req.query, ...req.body };
  let id = contactIdFrom(req);
  let item = contactById(id);
  if (!item) {
    id = nextId(engine.db.contactBills, "contactId");
    item = { id, contactId: id, states: "待上报" };
    engine.db.contactBills.push(item);
  }
  const section = engine.db.sections.find((row) => Number(row.sectionId || row.id) === Number(body.sectionId || item.sectionId || 101)) || engine.db.sections[0] || {};
  item.sectionId = Number(section.sectionId || section.id || 101);
  item.sectionName = section.sectionName || item.sectionName || "";
  item.workAreaName = item.sectionName;
  item.contactNo = body.contactNo || body.skillNo || item.contactNo || `LX-LOCAL-${String(id).padStart(3, "0")}`;
  item.skillNo = item.contactNo;
  item.title = body.title || body.contactContent || item.title || "";
  item.contactContent = body.contactContent || item.contactContent || item.title;
  item.changeMeetingText = body.changeMeetingText || item.changeMeetingText || "";
  item.costImpactType = body.costImpactType || item.costImpactType || "技术联系";
  item.estimateMoney = Number(body.estimateMoney ?? body.money ?? item.estimateMoney ?? item.money ?? 0);
  item.money = item.estimateMoney;
  item.createDate = body.createDate || item.createDate || today();
  item.userName = body.userName || item.userName || "ys1";
  item.states = body.states || body.state || item.states || "待上报";
  item.states = cleanBusinessText(item.states, "待上报");
  item.title = cleanBusinessText(item.title, "工程联系单");
  item.contactContent = cleanBusinessText(item.contactContent, item.title);
  item.changeMeetingText = cleanBusinessText(item.changeMeetingText, "现场技术联系记录");
  item.costImpactType = cleanBusinessText(item.costImpactType, "技术联系");
  return { changed: 1, contactId: item.contactId, row: item };
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function engineeringContactDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const rows = engine.db.contactBills
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId)
    .slice()
    .sort((a, b) => String(b.createDate || "").localeCompare(String(a.createDate || "")));
  const sectionIds = new Set(rows.map((row) => Number(row.sectionId || 0)).filter(Boolean));
  const variations = engine.variationRows()
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId)
    .filter((row) => !sectionIds.size || sectionIds.has(Number(row.sectionId || 0)))
    .slice(0, 8);
  const nowMonth = today().slice(0, 7);
  const pending = rows.filter((row) => /待|上报|审核中/.test(row.states || "")).length;
  const approved = rows.filter((row) => /已审核|审核通过/.test(row.states || "")).length;
  const returned = rows.filter((row) => /退回/.test(row.states || "")).length;
  const thisMonth = rows.filter((row) => String(row.createDate || "").slice(0, 7) === nowMonth).length;
  const estimateMoney = rows.reduce((sum, row) => sum + Number(row.estimateMoney || row.money || 0), 0);
  const contactIds = new Set(rows.map((row) => Number(row.contactId || row.id || 0)).filter(Boolean));
  const logs = ensureWorkflowLogs()
    .filter((log) => log.module === "engineeringcontactbill" && (!contactIds.size || contactIds.has(Number(log.businessId || 0))))
    .slice(-12)
    .reverse();
  const cards = [
    ["联系单数量", rows.length, "工程技术联系单台账"],
    ["待处理", pending, "待上报或审核中的联系单"],
    ["已审核", approved, "完成审核的联系单"],
    ["已退回", returned, "需要补充修改的联系单"],
    ["本月新增", thisMonth, `${nowMonth} 新增记录`],
    ["建议金额", moneyText(estimateMoney), "联系单建议变更/调整金额"],
    ["关联变更", variations.length, "同合同段变更协同记录"]
  ].map(([label, value, hint]) => `
    <div class="contact-card">
      <span>${htmlEscape(label)}</span>
      <strong>${htmlEscape(value)}</strong>
      <small>${htmlEscape(hint)}</small>
    </div>`).join("");
  const sectionOptionsHtml = [`<option value="">全部合同段</option>`].concat(engine.db.sections.map((item) => {
    const id = Number(item.sectionId || item.id || 0);
    const selected = sectionId && id === sectionId ? " selected" : "";
    return `<option value="${id}"${selected}>${htmlEscape(item.sectionName || item.name || "")}</option>`;
  })).join("");
  const contactRows = rows.map((row) => {
    const id = Number(row.contactId || row.id || 0);
    const title = row.title || row.contactContent || "";
    return `
      <tr>
        <td>${htmlEscape(row.contactNo || row.skillNo || "")}</td>
        <td>${htmlEscape(title)}</td>
        <td>${htmlEscape(row.sectionName || row.workAreaName || "")}</td>
        <td>${htmlEscape(row.costImpactType || "技术联系")}</td>
        <td>${moneyText(row.estimateMoney || row.money || 0)}</td>
        <td>${htmlEscape(row.userName || "ys1")}</td>
        <td>${htmlEscape(row.createDate || "")}</td>
        <td><span class="contact-state">${htmlEscape(row.states || "")}</span></td>
        <td class="contact-actions">
          <a href="/engineering_contact_bill/edit_page?contactId=${id}">编辑</a>
          <a href="/engineering_contact_bill/up_order?contactId=${id}">上报</a>
          <a href="/engineering_contact_bill/agree_order?contactId=${id}">审核</a>
          <a href="/engineering_contact_bill/return_order_page?contactId=${id}">退回</a>
          <a href="/engineering_contact_bill/track_engineering_contact_bill_page?contactId=${id}">流程</a>
          <a href="/reportManager/reportViewSecurity?reportCode=vary_skill_contact&ids=${id}">打印</a>
        </td>
      </tr>`;
  }).join("");
  const meetingRows = rows.filter((row) => row.changeMeetingText || row.contactContent).map((row) => `
    <tr>
      <td>${htmlEscape(row.contactNo || row.skillNo || "")}</td>
      <td>${htmlEscape(row.contactContent || row.title || "")}</td>
      <td>${htmlEscape(row.changeMeetingText || "暂无会议纪要")}</td>
      <td>${htmlEscape(row.states || "")}</td>
    </tr>`).join("");
  const variationRows = variations.map((row) => `
    <tr>
      <td>${htmlEscape(row.varyNo || "")}</td>
      <td>${htmlEscape(row.billName || row.varyItem || row.varyReason || "")}</td>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${moneyText(row.varyMoney)}</td>
      <td>${htmlEscape(row.states || "")}</td>
      <td><a href="/vary_measure/render_order_page?varyId=${Number(row.varyId || row.id || 0)}">查看变更</a></td>
    </tr>`).join("");
  const logRows = logs.map((log) => `
    <tr>
      <td>${htmlEscape(log.businessNo || "")}</td>
      <td>${htmlEscape(log.step || log.action || "")}</td>
      <td>${htmlEscape(log.result || "")}</td>
      <td>${htmlEscape(log.userName || "")}</td>
      <td>${htmlEscape(log.time || "")}</td>
      <td>${htmlEscape(log.remark || "")}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid contact-dashboard">
      <style>
        .contact-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .contact-shell { max-width:1380px; margin:0 auto; }
        .contact-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .contact-head h2 { margin:0; font-size:22px; font-weight:600; }
        .contact-head p { margin:6px 0 0; color:#64748b; }
        .contact-tools { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .contact-tools select { height:32px; min-width:150px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .contact-cards { display:grid; grid-template-columns:repeat(7, minmax(120px, 1fr)); gap:10px; margin-bottom:12px; }
        .contact-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .contact-card span, .contact-card small { display:block; color:#64748b; font-size:12px; }
        .contact-card strong { display:block; margin:8px 0; color:#0f766e; font-size:21px; }
        .contact-grid { display:grid; grid-template-columns:1.2fr .8fr; gap:12px; }
        .contact-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .contact-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .contact-panel table { margin:0; min-width:760px; }
        .contact-wide { grid-column:1 / -1; }
        .contact-actions a { margin-right:8px; white-space:nowrap; }
        .contact-state { display:inline-block; min-width:54px; text-align:center; color:#075985; background:#e0f2fe; border:1px solid #bae6fd; border-radius:4px; padding:2px 6px; }
        .contact-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .contact-cards { grid-template-columns:repeat(3, 1fr); } .contact-grid { grid-template-columns:1fr; } .contact-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .contact-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="contact-shell">
        <div class="contact-head">
          <div>
            <h2>工程技术联系单管理看板</h2>
            <p>集中管理工程技术联系单、会议纪要、审核流转和同合同段变更协同。</p>
          </div>
          <div class="contact-tools">
            <select onchange="location.href='/engineering_contact_bill/dashboard_page?sectionId='+this.value">${sectionOptionsHtml}</select>
            <a class="layui-btn layui-btn-sm" href="/engineering_contact_bill/edit_page">新增联系单</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/workflow/dashboard_page?module=engineeringcontactbill">流程工作台</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/busineInfo/busine_info_page">业务信息</a>
          </div>
        </div>
        <div class="contact-cards">${cards}</div>
        <div class="contact-panel contact-wide">
          <h3>联系单明细</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>联系单号</th><th>标题</th><th>合同段</th><th>影响类型</th><th>建议金额</th><th>填报人</th><th>日期</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${contactRows || `<tr><td colspan="9" class="contact-empty">暂无工程技术联系单</td></tr>`}</tbody>
          </table>
        </div>
        <div class="contact-grid">
          <div class="contact-panel">
            <h3>会议纪要与处理意见</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>联系单号</th><th>联系内容</th><th>会议纪要</th><th>状态</th></tr></thead>
              <tbody>${meetingRows || `<tr><td colspan="4" class="contact-empty">暂无会议纪要</td></tr>`}</tbody>
            </table>
          </div>
          <div class="contact-panel">
            <h3>变更协同</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>变更编号</th><th>项目</th><th>合同段</th><th>变更金额</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>${variationRows || `<tr><td colspan="6" class="contact-empty">暂无关联变更</td></tr>`}</tbody>
            </table>
          </div>
          <div class="contact-panel contact-wide">
            <h3>最近流程记录</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>业务编号</th><th>环节</th><th>结果</th><th>处理人</th><th>时间</th><th>意见</th></tr></thead>
              <tbody>${logRows || `<tr><td colspan="6" class="contact-empty">暂无流程记录</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function firstMaterialId() {
  return Number((engine.db.materials[0] && engine.db.materials[0].materialId) || 0);
}

function materialOptions(selectedId) {
  return engine.db.materials.map((item) => {
    const selected = Number(item.materialId) === Number(selectedId) ? " selected" : "";
    const label = `${item.materialNo || ""} ${item.materialName || ""} / ${item.unit || ""} / ${item.currentPrice || 0}`;
    return `<option value="${item.materialId}"${selected}>${htmlEscape(label)}</option>`;
  }).join("");
}

function sectionOptions(selectedId) {
  return engine.db.sections.map((item) => {
    const selected = Number(item.sectionId || item.id) === Number(selectedId) ? " selected" : "";
    return `<option value="${item.sectionId || item.id}"${selected}>${htmlEscape(item.sectionName || item.name || "")}</option>`;
  }).join("");
}

function workflowStateOptions(selectedState, states = ["待上报", "审核中", "已审核", "已更新", "已调整", "已归档", "已退回"]) {
  return states.map((state) => {
    const selected = String(selectedState || "") === state ? " selected" : "";
    return `<option value="${htmlEscape(state)}"${selected}>${htmlEscape(state)}</option>`;
  }).join("");
}

function materialDiasIdFrom(req) {
  return Number(
    req.body.meterialDiasMeasureId ||
    req.query.meterialDiasMeasureId ||
    req.body.diasId ||
    req.query.diasId ||
    req.params.id ||
    idsFrom(req, "ids")[0] ||
    0
  );
}

function materialArrivalIdFrom(req) {
  return Number(
    req.body.meterialInMeasureId ||
    req.query.meterialInMeasureId ||
    req.body.arrivalId ||
    req.query.arrivalId ||
    req.params.id ||
    idsFrom(req, "ids")[0] ||
    0
  );
}

function materialDiasById(id) {
  return engine.db.materialAdjustments.find((row) => Number(row.diasId || row.id) === Number(id));
}

function materialArrivalById(id) {
  return engine.db.materialArrivals.find((row) => Number(row.arrivalId || row.id) === Number(id));
}

function materialDiasComputed(id) {
  return engine.materialDiasRows().find((row) => Number(row.meterialDiasMeasureId || row.diasId || row.id) === Number(id));
}

function materialArrivalComputed(id) {
  return engine.materialArrivalRows().find((row) => Number(row.meterialInMeasureId || row.arrivalId || row.id) === Number(id));
}

function materialDiasDetailHtml(req) {
  const id = materialDiasIdFrom(req);
  const row = materialDiasComputed(id);
  if (!row) return `<div class="layui-card"><div class="layui-card-body">暂无材料补差明细</div></div>`;
  return `
    <div class="layui-card" style="margin-top:10px;">
      <div class="layui-card-header">材料补差明细</div>
      <div class="layui-card-body">
        <table class="layui-table">
          <thead><tr><th>材料编号</th><th>材料名称</th><th>单位</th><th>计量数量</th><th>基准价</th><th>现行价</th><th>价差</th><th>补差金额</th></tr></thead>
          <tbody>
            <tr>
              <td>${htmlEscape(row.materialNo)}</td>
              <td>${htmlEscape(row.materialName || row.secMaterialName)}</td>
              <td>${htmlEscape(row.measureUnit || row.unit)}</td>
              <td>${row.measureNum}</td>
              <td>${row.basePrice}</td>
              <td>${row.currentPrice}</td>
              <td>${row.priceDiff}</td>
              <td>${row.adjustMoney}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function materialDiasFormHtml(req) {
  const id = materialDiasIdFrom(req);
  const item = materialDiasById(id) || {};
  const current = item.diasId ? materialDiasComputed(item.diasId) : {};
  const selectedMaterial = item.materialId || firstMaterialId();
  const sectionId = item.sectionId || (engine.db.sections[0] && engine.db.sections[0].sectionId) || 101;
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="material-dias-form">
        <input type="hidden" name="meterialDiasMeasureId" value="${item.diasId || ""}">
        <input type="hidden" name="diasId" value="${item.diasId || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">计量单号</label>
          <div class="layui-input-block"><input class="layui-input" name="measureNo" value="${htmlEscape(item.measureNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">合同段</label>
          <div class="layui-input-block"><select name="sectionId">${sectionOptions(sectionId)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">材料</label>
          <div class="layui-input-block"><select name="materialId">${materialOptions(selectedMaterial)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">计量数量</label>
          <div class="layui-input-block"><input class="layui-input" name="quantity" value="${item.quantity || current.measureNum || 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">计量日期</label>
          <div class="layui-input-block"><input class="layui-input" name="measureDate" value="${htmlEscape(item.measureDate || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">供应单位</label>
          <div class="layui-input-block"><input class="layui-input" name="provider" value="${htmlEscape(item.provider || current.provider || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">审批编号</label>
          <div class="layui-input-block"><input class="layui-input" name="approveNo" value="${htmlEscape(item.approveNo || current.approveNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">状态</label>
          <div class="layui-input-block"><select name="states">${workflowStateOptions(item.states || current.states || "待上报", ["待上报", "审核中", "已审核", "已调整", "已归档", "已退回"])}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">测算金额</label>
          <div class="layui-input-block"><input class="layui-input" readonly value="${current.adjustMoney || 0}"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/meterialdiasmeasure/save_detail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存材料补差</button>
          </div>
        </div>
      </form>
      ${item.diasId ? materialDiasDetailHtml(req) : ""}
    </div>`;
}

function saveMaterialDias(req) {
  const body = { ...req.query, ...req.body };
  let id = materialDiasIdFrom(req);
  let item = materialDiasById(id);
  if (!item) {
    id = nextId(engine.db.materialAdjustments, "diasId");
    item = {
      id,
      diasId: id,
      states: "待上报",
      measureNo: body.measureNo || `BC-LOCAL-${String(id).padStart(3, "0")}`
    };
    engine.db.materialAdjustments.push(item);
  }
  item.sectionId = numeric(body.sectionId, item.sectionId || 101);
  item.materialId = numeric(body.materialId || body.secMateriaId, item.materialId || firstMaterialId());
  item.quantity = numeric(body.quantity ?? body.measureNum, item.quantity || 0);
  item.measureDate = body.measureDate || (body.diffYearMonth ? `${body.diffYearMonth}-01` : item.measureDate) || today();
  item.measureNo = body.measureNo || item.measureNo || `BC-LOCAL-${String(id).padStart(3, "0")}`;
  item.provider = body.provider || item.provider || "";
  item.approveNo = body.approveNo || item.approveNo || item.measureNo;
  item.states = body.states || body.state || item.states || "待上报";
  return { changed: 1, meterialDiasMeasureId: item.diasId, row: materialDiasComputed(item.diasId) };
}

function materialDiasDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const rows = engine.materialDiasRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.adjustMoney || row.money || 0), 0);
  const totalQuantity = rows.reduce((sum, row) => sum + Number(row.measureNum || row.quantity || 0), 0);
  const materialCount = new Set(rows.map((row) => row.materialId || row.materialNo)).size;
  const archivedCount = rows.filter((row) => String(row.states || "").includes("归档")).length;
  const sectionOptionsHtml = [`<option value="0"${sectionId ? "" : " selected"}>全部合同段</option>`]
    .concat(engine.db.sections.map((section) => {
      const selected = Number(section.sectionId || section.id) === sectionId ? " selected" : "";
      return `<option value="${section.sectionId || section.id}"${selected}>${htmlEscape(section.sectionName || "")}</option>`;
    })).join("");
  const cards = [
    ["补差批次", String(rows.length), "材料价差计量记录数"],
    ["材料种类", String(materialCount), "按材料编号去重"],
    ["补差数量", Number(totalQuantity.toFixed(3)).toLocaleString("zh-CN"), "全部材料数量合计"],
    ["补差金额", moneyText(totalMoney), "数量乘以材料价差"],
    ["已归档", String(archivedCount), "归档完成批次"],
    ["待处理", String(Math.max(0, rows.length - archivedCount)), "未归档批次"]
  ].map(([label, value, hint]) => `
    <div class="dias-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const materialGroups = Object.values(rows.reduce((acc, row) => {
    const key = row.materialNo || row.materialName || row.materialId;
    acc[key] = acc[key] || {
      materialNo: row.materialNo,
      materialName: row.materialName || row.secMaterialName,
      unit: row.measureUnit || row.unit,
      quantity: 0,
      basePriceTotal: 0,
      currentPriceTotal: 0,
      priceDiffTotal: 0,
      basePriceSampleTotal: 0,
      currentPriceSampleTotal: 0,
      priceDiffSampleTotal: 0,
      money: 0,
      count: 0
    };
    const quantity = Number(row.measureNum || row.quantity || 0);
    acc[key].quantity += quantity;
    acc[key].basePriceTotal += Number(row.basePrice || 0) * quantity;
    acc[key].currentPriceTotal += Number(row.currentPrice || 0) * quantity;
    acc[key].priceDiffTotal += Number(row.priceDiff || 0) * quantity;
    acc[key].basePriceSampleTotal += Number(row.basePrice || 0);
    acc[key].currentPriceSampleTotal += Number(row.currentPrice || 0);
    acc[key].priceDiffSampleTotal += Number(row.priceDiff || 0);
    acc[key].money += Number(row.adjustMoney || row.money || 0);
    acc[key].count += 1;
    return acc;
  }, {}));
  const groupBody = materialGroups.map((row) => {
    const basePrice = row.quantity ? row.basePriceTotal / row.quantity : row.basePriceSampleTotal / Math.max(1, row.count);
    const currentPrice = row.quantity ? row.currentPriceTotal / row.quantity : row.currentPriceSampleTotal / Math.max(1, row.count);
    const priceDiff = row.quantity ? row.priceDiffTotal / row.quantity : row.priceDiffSampleTotal / Math.max(1, row.count);
    return `
      <tr>
        <td>${htmlEscape(row.materialNo || "")}</td>
        <td class="left">${htmlEscape(row.materialName || "")}</td>
        <td>${htmlEscape(row.unit || "")}</td>
        <td>${row.count}</td>
        <td>${Number(row.quantity.toFixed(3))}</td>
        <td>${moneyText(basePrice)}</td>
        <td>${moneyText(currentPrice)}</td>
        <td>${moneyText(priceDiff)}</td>
        <td>${moneyText(row.money)}</td>
      </tr>`;
  }).join("");
  const detailBody = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.measureNo || "")}</td>
      <td>${htmlEscape(row.materialNo || "")}</td>
      <td class="left">${htmlEscape(row.materialName || row.secMaterialName || "")}</td>
      <td>${htmlEscape(row.measureUnit || row.unit || "")}</td>
      <td>${Number(row.measureNum || row.quantity || 0)}</td>
      <td>${moneyText(row.basePrice)}</td>
      <td>${moneyText(row.currentPrice)}</td>
      <td>${moneyText(row.priceDiff)}</td>
      <td>${moneyText(row.adjustMoney || row.money)}</td>
      <td>${htmlEscape(row.measureDate || row.diffYearMonth || "")}</td>
      <td>${htmlEscape(row.states || "")}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid material-dias-dashboard">
      <style>
        .material-dias-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .dias-shell { max-width:1320px; margin:0 auto; }
        .dias-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .dias-head h2 { margin:0; font-size:22px; font-weight:600; }
        .dias-head p { margin:6px 0 0; color:#64748b; }
        .dias-actions { display:flex; gap:8px; align-items:center; }
        .dias-actions select { height:32px; min-width:180px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .dias-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .dias-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .dias-card span, .dias-card small { display:block; color:#64748b; font-size:12px; }
        .dias-card strong { display:block; margin:8px 0; color:#b45309; font-size:20px; }
        .dias-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .dias-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .dias-panel table { margin:0; min-width:980px; }
        .left { text-align:left; }
        .dias-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width: 980px) {
          .dias-head { align-items:flex-start; flex-direction:column; }
          .dias-cards { grid-template-columns:repeat(2, minmax(140px, 1fr)); }
        }
      </style>
      <div class="dias-shell">
        <div class="dias-head">
          <div>
            <h2>材料补差看板</h2>
            <p>按合同段汇总材料调差数量、基准价、现行价、价差与补差金额。</p>
          </div>
          <div class="dias-actions">
            <select onchange="location.href='/meterialdiasmeasure/dashboard_page?sectionId='+this.value">${sectionOptionsHtml}</select>
            <a class="layui-btn layui-btn-sm" href="/meterialdiasmeasure/edit_meterial_dias_measure_page">新增补差</a>
          </div>
        </div>
        <div class="dias-cards">${cards}</div>
        <div class="dias-panel">
          <h3>材料补差汇总</h3>
          <table class="layui-table">
            <thead><tr><th>材料编号</th><th>材料名称</th><th>单位</th><th>批次</th><th>补差数量</th><th>平均基准价</th><th>平均现行价</th><th>平均价差</th><th>补差金额</th></tr></thead>
            <tbody>${groupBody || `<tr><td colspan="9" class="dias-empty">暂无材料补差数据</td></tr>`}</tbody>
          </table>
        </div>
        <div class="dias-panel">
          <h3>补差明细</h3>
          <table class="layui-table">
            <thead><tr><th>合同段</th><th>计量单号</th><th>材料编号</th><th>材料名称</th><th>单位</th><th>数量</th><th>基准价</th><th>现行价</th><th>价差</th><th>补差金额</th><th>计量日期</th><th>状态</th></tr></thead>
            <tbody>${detailBody || `<tr><td colspan="12" class="dias-empty">暂无补差明细</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function materialDiasManagementDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const selectedState = String(req.query.state || req.body.state || "");
  const allRows = engine.materialDiasRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const rows = allRows.filter((row) => !selectedState || String(row.states || "") === selectedState);
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.adjustMoney || row.money || 0), 0);
  const totalQuantity = rows.reduce((sum, row) => sum + Number(row.measureNum || row.quantity || 0), 0);
  const materialCount = new Set(rows.map((row) => row.materialId || row.materialNo)).size;
  const archivedCount = rows.filter((row) => String(row.states || "").includes("归档") || String(row.states || "").includes("褰掓。")).length;
  const sectionOptionsHtml = [`<option value="0"${sectionId ? "" : " selected"}>全部合同段</option>`]
    .concat(engine.db.sections.map((section) => {
      const id = section.sectionId || section.id;
      return `<option value="${id}"${Number(id) === sectionId ? " selected" : ""}>${htmlEscape(section.sectionName || "")}</option>`;
    })).join("");
  const stateValues = Array.from(new Set(allRows.map((row) => String(row.states || "")).filter(Boolean)));
  const stateOptionsHtml = [`<option value=""${selectedState ? "" : " selected"}>全部状态</option>`]
    .concat(stateValues.map((state) => `<option value="${htmlEscape(state)}"${state === selectedState ? " selected" : ""}>${htmlEscape(state)}</option>`))
    .join("");
  const cards = [
    ["补差批次", String(rows.length), "材料价差计量记录"],
    ["材料种类", String(materialCount), "按材料编码汇总"],
    ["补差数量", Number(totalQuantity.toFixed(3)).toLocaleString("zh-CN"), "当前筛选数量合计"],
    ["补差金额", moneyText(totalMoney), "数量乘材料价差"],
    ["已归档", String(archivedCount), "归档完成批次"],
    ["待处理", String(Math.max(0, rows.length - archivedCount)), "仍在流转批次"]
  ].map(([label, value, hint]) => `
    <div class="dias-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const materialGroups = Object.values(rows.reduce((acc, row) => {
    const key = row.materialNo || row.materialName || row.materialId;
    acc[key] = acc[key] || { materialNo: row.materialNo, materialName: row.materialName || row.secMaterialName, unit: row.measureUnit || row.unit, quantity: 0, money: 0, count: 0, baseTotal: 0, currentTotal: 0, diffTotal: 0 };
    const quantity = Number(row.measureNum || row.quantity || 0);
    acc[key].quantity += quantity;
    acc[key].money += Number(row.adjustMoney || row.money || 0);
    acc[key].baseTotal += Number(row.basePrice || 0) * Math.max(quantity, 1);
    acc[key].currentTotal += Number(row.currentPrice || 0) * Math.max(quantity, 1);
    acc[key].diffTotal += Number(row.priceDiff || 0) * Math.max(quantity, 1);
    acc[key].count += 1;
    return acc;
  }, {}));
  const groupBody = materialGroups.map((row) => {
    const divisor = row.quantity || row.count || 1;
    return `
      <tr>
        <td>${htmlEscape(row.materialNo || "")}</td>
        <td class="left">${htmlEscape(row.materialName || "")}</td>
        <td>${htmlEscape(row.unit || "")}</td>
        <td>${row.count}</td>
        <td>${Number(row.quantity.toFixed(3))}</td>
        <td>${moneyText(row.baseTotal / divisor)}</td>
        <td>${moneyText(row.currentTotal / divisor)}</td>
        <td>${moneyText(row.diffTotal / divisor)}</td>
        <td>${moneyText(row.money)}</td>
      </tr>`;
  }).join("");
  const detailBody = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.measureNo || "")}</td>
      <td>${htmlEscape(row.materialNo || "")}</td>
      <td class="left">${htmlEscape(row.materialName || row.secMaterialName || "")}</td>
      <td>${htmlEscape(row.measureUnit || row.unit || "")}</td>
      <td>${Number(row.measureNum || row.quantity || 0)}</td>
      <td>${moneyText(row.basePrice)}</td>
      <td>${moneyText(row.currentPrice)}</td>
      <td>${moneyText(row.priceDiff)}</td>
      <td>${moneyText(row.adjustMoney || row.money)}</td>
      <td>${htmlEscape(row.measureDate || row.diffYearMonth || "")}</td>
      <td>${htmlEscape(row.states || "")}</td>
      <td class="dias-links">
        <a href="/meterialdiasmeasure/detail_page?diasId=${row.diasId}">详情</a>
        <a href="/meterialdiasmeasure/edit_meterial_dias_measure_page?diasId=${row.diasId}">编辑</a>
        <a data-post="/meterialdiasmeasure/up_order" data-id="${row.diasId}">上报</a>
        <a data-post="/meterialdiasmeasure/agree_order" data-id="${row.diasId}">审核</a>
        <a href="/meterialdiasmeasure/return_order_page?measureType=meterialdiasmeasure&ids=${row.diasId}">退回</a>
        <a data-post="/meterialdiasmeasure/archive" data-id="${row.diasId}">归档</a>
        <a href="/meterialdiasmeasure/track_meterial_dias_reasoure_page?measureType=meterialdiasmeasure&ids=${row.diasId}&businessId=${row.diasId}">追踪</a>
      </td>
    </tr>`).join("");
  const logBody = ensureWorkflowLogs()
    .filter((log) => log.module === "meterialdiasmeasure")
    .slice(-8)
    .reverse()
    .map((log) => `
      <tr>
        <td>${htmlEscape(log.businessNo || "")}</td>
        <td>${htmlEscape(log.step || "")}</td>
        <td>${htmlEscape(log.userName || "")}</td>
        <td>${htmlEscape(log.result || "")}</td>
        <td>${htmlEscape(log.time || "")}</td>
        <td class="left">${htmlEscape(log.remark || "")}</td>
      </tr>`).join("");
  return `
    <div class="layui-fluid material-dias-dashboard">
      <style>
        .material-dias-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .dias-shell { max-width:1320px; margin:0 auto; }
        .dias-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .dias-head h2 { margin:0; font-size:22px; font-weight:600; }
        .dias-head p { margin:6px 0 0; color:#64748b; }
        .dias-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .dias-actions select { height:32px; min-width:150px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .dias-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .dias-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .dias-card span, .dias-card small { display:block; color:#64748b; font-size:12px; }
        .dias-card strong { display:block; margin:8px 0; color:#b45309; font-size:20px; }
        .dias-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .dias-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .dias-panel table { margin:0; min-width:1060px; }
        .left { text-align:left; }
        .dias-empty { text-align:center; color:#94a3b8; padding:24px; }
        .dias-links { min-width:220px; }
        .dias-links a { display:inline-block; margin:0 6px 4px 0; color:#1d4ed8; cursor:pointer; }
        @media (max-width:1100px) { .dias-cards { grid-template-columns:repeat(3, 1fr); } .dias-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .dias-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="dias-shell">
        <div class="dias-head">
          <div><h2>材料补差计量管理看板</h2><p>按合同段、材料和状态汇总补差数量、基准价、现行价、价差金额和流程记录。</p></div>
          <div class="dias-actions">
            <select id="dias-section">${sectionOptionsHtml}</select>
            <select id="dias-state">${stateOptionsHtml}</select>
            <a class="layui-btn layui-btn-sm" href="/meterialdiasmeasure/edit_meterial_dias_measure_page">新增补差</a>
            <a class="layui-btn layui-btn-primary layui-btn-sm" href="/workflow/dashboard_page?module=meterialdiasmeasure">流程台账</a>
            <a class="layui-btn layui-btn-primary layui-btn-sm" href="/meterialdiasmeasure/export_meterial_dias_measure?sectionId=${encodeURIComponent(sectionId || "")}&state=${encodeURIComponent(selectedState)}">导出Excel</a>
          </div>
        </div>
        <div class="dias-cards">${cards}</div>
        <div class="dias-panel">
          <h3>材料补差汇总</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>材料编号</th><th>材料名称</th><th>单位</th><th>批次</th><th>补差数量</th><th>平均基准价</th><th>平均现行价</th><th>平均价差</th><th>补差金额</th></tr></thead>
            <tbody>${groupBody || `<tr><td colspan="9" class="dias-empty">暂无材料补差汇总</td></tr>`}</tbody>
          </table>
        </div>
        <div class="dias-panel">
          <h3>补差明细</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>合同段</th><th>计量单号</th><th>材料编号</th><th>材料名称</th><th>单位</th><th>数量</th><th>基准价</th><th>现行价</th><th>价差</th><th>补差金额</th><th>计量日期</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${detailBody || `<tr><td colspan="13" class="dias-empty">暂无材料补差数据</td></tr>`}</tbody>
          </table>
        </div>
        <div class="dias-panel">
          <h3>最近流程记录</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>单据编号</th><th>节点</th><th>处理人</th><th>结果</th><th>时间</th><th>意见</th></tr></thead>
            <tbody>${logBody || `<tr><td colspan="6" class="dias-empty">暂无材料补差流程记录</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <script>
        (function(){
          function reload(){
            var section = document.getElementById('dias-section').value;
            var state = document.getElementById('dias-state').value;
            location.href = '/meterialdiasmeasure/dashboard_page?sectionId=' + encodeURIComponent(section) + '&state=' + encodeURIComponent(state);
          }
          document.getElementById('dias-section').onchange = reload;
          document.getElementById('dias-state').onchange = reload;
          Array.prototype.forEach.call(document.querySelectorAll('[data-post]'), function(link) {
            link.onclick = function() {
              fetch(link.getAttribute('data-post'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: link.getAttribute('data-id'), diasId: link.getAttribute('data-id') })
              }).then(function(r){ return r.json(); }).then(function(r){
                if (window.layer) layer.msg(r.msg || '处理完成');
                setTimeout(function(){ (window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload()); }, 450);
              });
            };
          });
        })();
      </script>
    </div>`;
}

function materialArrivalDetailHtml(req) {
  const id = materialArrivalIdFrom(req);
  const row = materialArrivalComputed(id);
  if (!row) return `<div class="layui-card"><div class="layui-card-body">暂无材料进场明细</div></div>`;
  return `
    <div class="layui-card" style="margin-top:10px;">
      <div class="layui-card-header">材料进场明细</div>
      <div class="layui-card-body">
        <table class="layui-table">
          <thead><tr><th>进场单号</th><th>材料编号</th><th>材料名称</th><th>单位</th><th>进场数量</th><th>计量单价</th><th>计量金额</th></tr></thead>
          <tbody>
            <tr>
              <td>${htmlEscape(row.certifyNo || row.measureNo)}</td>
              <td>${htmlEscape(row.materialNo)}</td>
              <td>${htmlEscape(row.materialName)}</td>
              <td>${htmlEscape(row.measureUnit || row.unit)}</td>
              <td>${row.measureNum}</td>
              <td>${row.measurePrice || row.price}</td>
              <td>${row.money}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function materialArrivalDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const rows = engine.materialArrivalRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.money || 0), 0);
  const totalQuantity = rows.reduce((sum, row) => sum + Number(row.measureNum || row.quantity || 0), 0);
  const materialCount = new Set(rows.map((row) => row.materialId || row.materialNo)).size;
  const archivedCount = rows.filter((row) => String(row.states || "").includes("归档")).length;
  const sectionOptionsHtml = [`<option value="0"${sectionId ? "" : " selected"}>全部合同段</option>`]
    .concat(engine.db.sections.map((section) => {
      const selected = Number(section.sectionId || section.id) === sectionId ? " selected" : "";
      return `<option value="${section.sectionId || section.id}"${selected}>${htmlEscape(section.sectionName || "")}</option>`;
    })).join("");
  const cards = [
    ["到场批次", String(rows.length), "材料进场记录数"],
    ["材料种类", String(materialCount), "按材料编号去重"],
    ["到场数量", Number(totalQuantity.toFixed(3)).toLocaleString("zh-CN"), "全部材料数量合计"],
    ["到场金额", moneyText(totalMoney), "按当前材料价计算"],
    ["已归档", String(archivedCount), "归档完成批次"],
    ["待处理", String(Math.max(0, rows.length - archivedCount)), "未归档批次"]
  ].map(([label, value, hint]) => `
    <div class="arrival-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const materialGroups = Object.values(rows.reduce((acc, row) => {
    const key = row.materialNo || row.materialName || row.materialId;
    acc[key] = acc[key] || { materialNo: row.materialNo, materialName: row.materialName, unit: row.measureUnit || row.unit, quantity: 0, money: 0, count: 0 };
    acc[key].quantity += Number(row.measureNum || row.quantity || 0);
    acc[key].money += Number(row.money || 0);
    acc[key].count += 1;
    return acc;
  }, {}));
  const groupBody = materialGroups.map((row) => `
    <tr>
      <td>${htmlEscape(row.materialNo || "")}</td>
      <td class="left">${htmlEscape(row.materialName || "")}</td>
      <td>${htmlEscape(row.unit || "")}</td>
      <td>${row.count}</td>
      <td>${Number(row.quantity.toFixed(3))}</td>
      <td>${moneyText(row.money)}</td>
    </tr>`).join("");
  const detailBody = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.measureNo || "")}</td>
      <td>${htmlEscape(row.materialNo || "")}</td>
      <td class="left">${htmlEscape(row.materialName || "")}</td>
      <td>${htmlEscape(row.measureUnit || row.unit || "")}</td>
      <td>${Number(row.measureNum || 0)}</td>
      <td>${moneyText(row.price || row.measurePrice)}</td>
      <td>${moneyText(row.money)}</td>
      <td>${htmlEscape(row.measureDate || "")}</td>
      <td>${htmlEscape(row.states || "")}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid material-arrival-dashboard">
      <style>
        .material-arrival-dashboard { padding:16px; background:#f4f7fb; color:#172033; }
        .arrival-shell { max-width:1320px; margin:0 auto; }
        .arrival-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .arrival-head h2 { margin:0; font-size:22px; font-weight:600; }
        .arrival-head p { margin:6px 0 0; color:#64748b; }
        .arrival-actions { display:flex; gap:8px; align-items:center; }
        .arrival-actions select { height:32px; min-width:180px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .arrival-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .arrival-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .arrival-card span, .arrival-card small { display:block; color:#64748b; font-size:12px; }
        .arrival-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .arrival-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .arrival-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .arrival-panel table { margin:0; min-width:860px; }
        .left { text-align:left; }
        .arrival-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .arrival-cards { grid-template-columns:repeat(3, 1fr); } .arrival-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .arrival-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="arrival-shell">
        <div class="arrival-head">
          <div><h2>材料到场看板</h2><p>按合同段和材料汇总到场批次、数量、金额和处理状态。</p></div>
          <div class="arrival-actions">
            <select onchange="location.href='/meterialInMeasure/dashboard_page?sectionId='+this.value">${sectionOptionsHtml}</select>
            <a class="layui-btn layui-btn-sm" href="/meterialInMeasure/add_page">新增到场</a>
          </div>
        </div>
        <div class="arrival-cards">${cards}</div>
        <div class="arrival-panel">
          <h3>材料汇总</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>材料编号</th><th>材料名称</th><th>单位</th><th>批次</th><th>到场数量</th><th>到场金额</th></tr></thead>
            <tbody>${groupBody || `<tr><td colspan="6" class="arrival-empty">暂无材料到场汇总</td></tr>`}</tbody>
          </table>
        </div>
        <div class="arrival-panel">
          <h3>到场明细</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>合同段</th><th>到场单号</th><th>材料编号</th><th>材料名称</th><th>单位</th><th>数量</th><th>当前价</th><th>金额</th><th>日期</th><th>状态</th></tr></thead>
            <tbody>${detailBody || `<tr><td colspan="10" class="arrival-empty">暂无材料到场数据</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function materialArrivalManagementDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const selectedState = String(req.query.state || req.body.state || "");
  const allRows = engine.materialArrivalRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const rows = allRows.filter((row) => !selectedState || String(row.states || "") === selectedState);
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.money || 0), 0);
  const totalQuantity = rows.reduce((sum, row) => sum + Number(row.measureNum || row.quantity || 0), 0);
  const materialCount = new Set(rows.map((row) => row.materialId || row.materialNo)).size;
  const archivedCount = rows.filter((row) => String(row.states || "").includes("归档") || String(row.states || "").includes("褰掓。")).length;
  const sectionOptionsHtml = [`<option value="0"${sectionId ? "" : " selected"}>全部合同段</option>`]
    .concat(engine.db.sections.map((section) => {
      const id = section.sectionId || section.id;
      return `<option value="${id}"${Number(id) === sectionId ? " selected" : ""}>${htmlEscape(section.sectionName || "")}</option>`;
    })).join("");
  const stateValues = Array.from(new Set(allRows.map((row) => String(row.states || "")).filter(Boolean)));
  const stateOptionsHtml = [`<option value=""${selectedState ? "" : " selected"}>全部状态</option>`]
    .concat(stateValues.map((state) => `<option value="${htmlEscape(state)}"${state === selectedState ? " selected" : ""}>${htmlEscape(state)}</option>`))
    .join("");
  const cards = [
    ["到场批次", String(rows.length), "材料到场计量记录"],
    ["材料种类", String(materialCount), "按材料编码汇总"],
    ["到场数量", Number(totalQuantity.toFixed(3)).toLocaleString("zh-CN"), "当前筛选数量合计"],
    ["到场金额", moneyText(totalMoney), "数量乘当前材料价"],
    ["已归档", String(archivedCount), "归档完成批次"],
    ["待处理", String(Math.max(0, rows.length - archivedCount)), "仍在流转批次"]
  ].map(([label, value, hint]) => `
    <div class="arrival-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const materialGroups = Object.values(rows.reduce((acc, row) => {
    const key = row.materialNo || row.materialName || row.materialId;
    acc[key] = acc[key] || { materialNo: row.materialNo, materialName: row.materialName, unit: row.measureUnit || row.unit, quantity: 0, money: 0, count: 0 };
    acc[key].quantity += Number(row.measureNum || row.quantity || 0);
    acc[key].money += Number(row.money || 0);
    acc[key].count += 1;
    return acc;
  }, {}));
  const groupBody = materialGroups.map((row) => `
    <tr>
      <td>${htmlEscape(row.materialNo || "")}</td>
      <td class="left">${htmlEscape(row.materialName || "")}</td>
      <td>${htmlEscape(row.unit || "")}</td>
      <td>${row.count}</td>
      <td>${Number(row.quantity.toFixed(3))}</td>
      <td>${moneyText(row.money)}</td>
    </tr>`).join("");
  const detailBody = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.measureNo || "")}</td>
      <td>${htmlEscape(row.materialNo || "")}</td>
      <td class="left">${htmlEscape(row.materialName || "")}</td>
      <td>${htmlEscape(row.measureUnit || row.unit || "")}</td>
      <td>${Number(row.measureNum || 0)}</td>
      <td>${moneyText(row.price || row.measurePrice)}</td>
      <td>${moneyText(row.money)}</td>
      <td>${htmlEscape(row.measureDate || "")}</td>
      <td>${htmlEscape(row.states || "")}</td>
      <td class="arrival-links">
        <a href="/meterialInMeasure/detail_page?arrivalId=${row.arrivalId}">详情</a>
        <a href="/meterialInMeasure/form_page?arrivalId=${row.arrivalId}">编辑</a>
        <a data-post="/meterialInMeasure/up_order" data-id="${row.arrivalId}">上报</a>
        <a data-post="/meterialInMeasure/update_measure_state" data-id="${row.arrivalId}">确认</a>
        <a href="/meterialInMeasure/return_order_page?measureType=meterialinmeasure&ids=${row.arrivalId}">退回</a>
        <a data-post="/meterialInMeasure/archive" data-id="${row.arrivalId}">归档</a>
        <a href="/meterialInMeasure/record_page?measureType=meterialinmeasure&ids=${row.arrivalId}&businessId=${row.arrivalId}">追踪</a>
      </td>
    </tr>`).join("");
  const logBody = ensureWorkflowLogs()
    .filter((log) => log.module === "meterialinmeasure")
    .slice(-8)
    .reverse()
    .map((log) => `
      <tr>
        <td>${htmlEscape(log.businessNo || "")}</td>
        <td>${htmlEscape(log.step || "")}</td>
        <td>${htmlEscape(log.userName || "")}</td>
        <td>${htmlEscape(log.result || "")}</td>
        <td>${htmlEscape(log.time || "")}</td>
        <td class="left">${htmlEscape(log.remark || "")}</td>
      </tr>`).join("");
  return `
    <div class="layui-fluid material-arrival-dashboard">
      <style>
        .material-arrival-dashboard { padding:16px; background:#f4f7fb; color:#172033; }
        .arrival-shell { max-width:1320px; margin:0 auto; }
        .arrival-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .arrival-head h2 { margin:0; font-size:22px; font-weight:600; }
        .arrival-head p { margin:6px 0 0; color:#64748b; }
        .arrival-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .arrival-actions select { height:32px; min-width:150px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .arrival-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .arrival-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .arrival-card span, .arrival-card small { display:block; color:#64748b; font-size:12px; }
        .arrival-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .arrival-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .arrival-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .arrival-panel table { margin:0; min-width:920px; }
        .left { text-align:left; }
        .arrival-empty { text-align:center; color:#94a3b8; padding:24px; }
        .arrival-links { min-width:220px; }
        .arrival-links a { display:inline-block; margin:0 6px 4px 0; color:#1d4ed8; cursor:pointer; }
        @media (max-width:1100px) { .arrival-cards { grid-template-columns:repeat(3, 1fr); } .arrival-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .arrival-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="arrival-shell">
        <div class="arrival-head">
          <div><h2>材料到场计量管理看板</h2><p>按合同段、材料和状态汇总到场批次、数量、金额、处理状态和流程记录。</p></div>
          <div class="arrival-actions">
            <select id="arrival-section">${sectionOptionsHtml}</select>
            <select id="arrival-state">${stateOptionsHtml}</select>
            <a class="layui-btn layui-btn-sm" href="/meterialInMeasure/add_page">新增到场</a>
            <a class="layui-btn layui-btn-primary layui-btn-sm" href="/workflow/dashboard_page?module=meterialinmeasure">流程台账</a>
            <a class="layui-btn layui-btn-primary layui-btn-sm" href="/meterialInMeasure/export_meterial_in_measure?sectionId=${encodeURIComponent(sectionId || "")}&state=${encodeURIComponent(selectedState)}">导出Excel</a>
          </div>
        </div>
        <div class="arrival-cards">${cards}</div>
        <div class="arrival-panel">
          <h3>材料汇总</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>材料编号</th><th>材料名称</th><th>单位</th><th>批次</th><th>到场数量</th><th>到场金额</th></tr></thead>
            <tbody>${groupBody || `<tr><td colspan="6" class="arrival-empty">暂无材料到场汇总</td></tr>`}</tbody>
          </table>
        </div>
        <div class="arrival-panel">
          <h3>到场明细</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>合同段</th><th>到场单号</th><th>材料编号</th><th>材料名称</th><th>单位</th><th>数量</th><th>当前价</th><th>金额</th><th>日期</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${detailBody || `<tr><td colspan="11" class="arrival-empty">暂无材料到场数据</td></tr>`}</tbody>
          </table>
        </div>
        <div class="arrival-panel">
          <h3>最近流程记录</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>单据编号</th><th>节点</th><th>处理人</th><th>结果</th><th>时间</th><th>意见</th></tr></thead>
            <tbody>${logBody || `<tr><td colspan="6" class="arrival-empty">暂无材料到场流程记录</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <script>
        (function(){
          function reload(){
            var section = document.getElementById('arrival-section').value;
            var state = document.getElementById('arrival-state').value;
            location.href = '/meterialInMeasure/dashboard_page?sectionId=' + encodeURIComponent(section) + '&state=' + encodeURIComponent(state);
          }
          document.getElementById('arrival-section').onchange = reload;
          document.getElementById('arrival-state').onchange = reload;
          Array.prototype.forEach.call(document.querySelectorAll('[data-post]'), function(link) {
            link.onclick = function() {
              fetch(link.getAttribute('data-post'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: link.getAttribute('data-id'), arrivalId: link.getAttribute('data-id') })
              }).then(function(r){ return r.json(); }).then(function(r){
                if (window.layer) layer.msg(r.msg || '处理完成');
                setTimeout(function(){ (window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload()); }, 450);
              });
            };
          });
        })();
      </script>
    </div>`;
}

function materialArrivalFormHtml(req) {
  const id = materialArrivalIdFrom(req);
  const item = materialArrivalById(id) || {};
  const current = item.arrivalId ? materialArrivalComputed(item.arrivalId) : {};
  const selectedMaterial = item.materialId || firstMaterialId();
  const sectionId = item.sectionId || (engine.db.sections[0] && engine.db.sections[0].sectionId) || 101;
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="material-arrival-form">
        <input type="hidden" name="meterialInMeasureId" value="${item.arrivalId || ""}">
        <input type="hidden" name="arrivalId" value="${item.arrivalId || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">计量单号</label>
          <div class="layui-input-block"><input class="layui-input" name="measureNo" value="${htmlEscape(item.measureNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">进场凭证</label>
          <div class="layui-input-block"><input class="layui-input" name="certifyNo" value="${htmlEscape(item.certifyNo || current.certifyNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">合同段</label>
          <div class="layui-input-block"><select name="sectionId">${sectionOptions(sectionId)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">材料</label>
          <div class="layui-input-block"><select name="materialId">${materialOptions(selectedMaterial)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">进场数量</label>
          <div class="layui-input-block"><input class="layui-input" name="quantity" value="${item.quantity || current.measureNum || 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">进场日期</label>
          <div class="layui-input-block"><input class="layui-input" name="measureDate" value="${htmlEscape(item.measureDate || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">供应单位</label>
          <div class="layui-input-block"><input class="layui-input" name="provider" value="${htmlEscape(item.provider || current.provider || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">验收编号</label>
          <div class="layui-input-block"><input class="layui-input" name="approveNo" value="${htmlEscape(item.approveNo || current.approveNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">备注</label>
          <div class="layui-input-block"><input class="layui-input" name="remark" value="${htmlEscape(item.remark || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">状态</label>
          <div class="layui-input-block"><select name="states">${workflowStateOptions(item.states || current.states || "待上报", ["待上报", "审核中", "已更新", "已调整", "已归档", "已退回"])}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">测算金额</label>
          <div class="layui-input-block"><input class="layui-input" readonly value="${current.money || 0}"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/meterialInMeasure/save_detail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存材料进场</button>
          </div>
        </div>
      </form>
      ${item.arrivalId ? materialArrivalDetailHtml(req) : ""}
    </div>`;
}

function saveMaterialArrival(req) {
  const body = { ...req.query, ...req.body };
  let id = materialArrivalIdFrom(req);
  let item = materialArrivalById(id);
  if (!item) {
    id = nextId(engine.db.materialArrivals, "arrivalId");
    item = {
      id,
      arrivalId: id,
      states: "待上报",
      measureNo: body.measureNo || `DC-LOCAL-${String(id).padStart(3, "0")}`
    };
    engine.db.materialArrivals.push(item);
  }
  item.sectionId = numeric(body.sectionId, item.sectionId || 101);
  item.materialId = numeric(body.materialId || body.secMateriaId, item.materialId || firstMaterialId());
  item.quantity = numeric(body.quantity ?? body.measureNum, item.quantity || 0);
  item.measureDate = body.measureDate || item.measureDate || today();
  item.measureNo = body.measureNo || item.measureNo || `DC-LOCAL-${String(id).padStart(3, "0")}`;
  item.certifyNo = body.certifyNo || item.certifyNo || item.measureNo;
  item.provider = body.provider || item.provider || "";
  item.approveNo = body.approveNo || item.approveNo || item.certifyNo;
  item.remark = body.remark || item.remark || "";
  item.states = body.states || body.state || item.states || "待上报";
  item.states = cleanBusinessText(item.states, "待上报");
  return { changed: 1, meterialInMeasureId: item.arrivalId, row: materialArrivalComputed(item.arrivalId) };
}

function reportDetailHtml() {
  const table = simpleTableHtml("支付报表", [
    { title: "合同段", field: "sectionName" },
    { title: "合同编号", field: "contractNo" },
    { title: "合同金额", field: "contractMoney" },
    { title: "最终金额", field: "finalMoney" },
    { title: "清单计量", field: "billMeasureMoney" },
    { title: "材料补差", field: "materialDiasMoney" },
    { title: "材料到场", field: "materialArrivalMoney" },
    { title: "手动计量", field: "manualMoney" },
    { title: "累计支付", field: "totalPayMoney" },
    { title: "支付比例", field: "payRate" },
    { title: "到场规则", field: "arrivalRule" }
  ], reportPaymentRows());
  return `
    <div class="box-header dt-buttons btn-group form-inline" style="margin:10px;">
      <a id="export_project_measure_pay" class="layui-btn layui-btn-sm layui-btn-primary" href="/reportManager/export_project_measure_pay">导出Excel</a>
    </div>
    ${table}`;
}

function reportPageHtml() {
  const summary = engine.contractSummary();
  return `
    <div class="layui-fluid" style="padding:10px;">
      <div class="layui-card">
        <div class="layui-card-header">
          支付报表
          <button class="layui-btn layui-btn-sm" style="float:right;margin-top:4px;" onclick="layer.open({type:1,title:'报表详情',area:['860px','520px'],content:document.getElementById('local-report-detail').innerHTML})">报表详情</button>
        </div>
        <div class="layui-card-body">
          <div class="layui-row layui-col-space10">
            <div class="layui-col-md3"><div class="layui-card"><div class="layui-card-header">合同金额</div><div class="layui-card-body">${summary.contractSumMoney}</div></div></div>
            <div class="layui-col-md3"><div class="layui-card"><div class="layui-card-header">变更金额</div><div class="layui-card-body">${summary.varyMoney}</div></div></div>
            <div class="layui-col-md3"><div class="layui-card"><div class="layui-card-header">累计支付</div><div class="layui-card-body">${summary.payableMoney}</div></div></div>
            <div class="layui-col-md3"><div class="layui-card"><div class="layui-card-header">支付比例</div><div class="layui-card-body">${summary.payRate}%</div></div></div>
          </div>
          ${reportDetailHtml()}
          <div id="local-report-detail" style="display:none;">${reportDetailHtml()}</div>
        </div>
      </div>
    </div>`;
}

function gatherRows() {
  return engine.db.measurePeriods.map((item, index) => ({
    ...item,
    gatherNo: item.gatherNo || item.periodDesc || `第 ${index + 1} 期`,
    gatherFileNo: item.gatherFileNo || `GQ-2026-${String(index + 1).padStart(3, "0")}`,
    gatherStartDate: item.gatherStartDate || item.startDate,
    gatherEndDate: item.gatherEndDate || item.endDate,
    collectTime: item.collectTime || item.endDate,
    gatherShow: item.gatherShow || item.periodDesc || "",
    remark: item.remark || item.gatherState || "",
    gatherState: item.gatherStateCode ?? 1,
    isLast: index === engine.db.measurePeriods.length - 1 ? 1 : 0
  }));
}

function gatherIdFrom(req) {
  return Number(req.body.gatherId || req.query.gatherId || req.params.id || idsFrom(req, "ids")[0] || 0);
}

function gatherById(id) {
  return engine.db.measurePeriods.find((row) => Number(row.gatherId || row.id) === Number(id));
}

function gatherFormHtml(req) {
  const id = gatherIdFrom(req);
  const item = gatherById(id) || {};
  const rows = gatherRows();
  const current = rows.find((row) => Number(row.gatherId || row.id) === Number(id)) || {};
  const nextIndex = engine.db.measurePeriods.length + 1;
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="gather-form">
        <input type="hidden" name="gatherId" value="${item.gatherId || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">工期编号</label>
          <div class="layui-input-block"><input class="layui-input" name="gatherNo" value="${htmlEscape(item.gatherNo || current.gatherNo || `第 ${nextIndex} 期`)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">工期名称</label>
          <div class="layui-input-block"><input class="layui-input" name="periodDesc" value="${htmlEscape(item.periodDesc || current.gatherNo || `第 ${nextIndex} 期`)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">文件编号</label>
          <div class="layui-input-block"><input class="layui-input" name="gatherFileNo" value="${htmlEscape(item.gatherFileNo || current.gatherFileNo || `GQ-2026-${String(nextIndex).padStart(3, "0")}`)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">开始日期</label>
          <div class="layui-input-block"><input class="layui-input" name="startDate" value="${htmlEscape(item.startDate || current.gatherStartDate || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">结束日期</label>
          <div class="layui-input-block"><input class="layui-input" name="endDate" value="${htmlEscape(item.endDate || current.gatherEndDate || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">最后操作</label>
          <div class="layui-input-block"><input class="layui-input" name="collectTime" value="${htmlEscape(item.collectTime || current.collectTime || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">状态</label>
          <div class="layui-input-block">
            <select name="gatherStateCode">
              <option value="1"${Number(item.gatherStateCode ?? current.gatherState ?? 1) === 1 ? " selected" : ""}>启用</option>
              <option value="0"${Number(item.gatherStateCode ?? current.gatherState ?? 1) === 0 ? " selected" : ""}>锁定</option>
            </select>
          </div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">说明</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="gatherShow">${htmlEscape(item.gatherShow || current.gatherShow || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">备注</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="remark">${htmlEscape(item.remark || current.remark || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/sysGather/save_gather',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存工期</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveGather(req) {
  const body = { ...req.query, ...req.body };
  let id = gatherIdFrom(req);
  let item = gatherById(id);
  if (!item) {
    id = nextId(engine.db.measurePeriods, "gatherId");
    item = { id, gatherId: id };
    engine.db.measurePeriods.push(item);
  }
  item.periodDesc = body.periodDesc || body.gatherNo || item.periodDesc || `第 ${id} 期`;
  item.periodDesc = cleanBusinessText(item.periodDesc, `第 ${id} 期`);
  item.gatherNo = body.gatherNo || item.periodDesc;
  item.gatherFileNo = body.gatherFileNo || item.gatherFileNo || `GQ-2026-${String(id).padStart(3, "0")}`;
  item.startDate = body.startDate || body.gatherStartDate || item.startDate || today();
  item.endDate = body.endDate || body.gatherEndDate || item.endDate || item.startDate;
  item.gatherStartDate = item.startDate;
  item.gatherEndDate = item.endDate;
  item.collectTime = body.collectTime || item.collectTime || item.endDate;
  item.gatherShow = body.gatherShow || item.gatherShow || "";
  item.remark = body.remark || item.remark || "";
  item.gatherStateCode = numeric(body.gatherStateCode ?? body.gatherState, item.gatherStateCode ?? 1);
  return { changed: 1, gatherId: item.gatherId, row: gatherRows().find((row) => Number(row.gatherId) === Number(item.gatherId)) };
}

function planIdFrom(req) {
  return Number(req.body.planId || req.query.planId || req.params.id || idsFrom(req, "ids")[0] || 0);
}

function planById(id) {
  return engine.db.plans.find((row) => Number(row.planId || row.id) === Number(id));
}

function planFormHtml(req) {
  const id = planIdFrom(req);
  const item = planById(id) || {};
  const row = item.planId ? engine.planRows().find((entry) => Number(entry.planId) === Number(item.planId)) || {} : {};
  const sectionId = item.sectionId || (engine.db.sections[0] && engine.db.sections[0].sectionId) || 101;
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="project-plan-form">
        <input type="hidden" name="planId" value="${item.planId || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">计划名称</label>
          <div class="layui-input-block"><input class="layui-input" name="planName" value="${htmlEscape(item.planName || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">合同段</label>
          <div class="layui-input-block"><select name="sectionId">${sectionOptions(sectionId)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">开始日期</label>
          <div class="layui-input-block"><input class="layui-input" name="startDate" value="${htmlEscape(item.startDate || item.planStartDate || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">结束日期</label>
          <div class="layui-input-block"><input class="layui-input" name="endDate" value="${htmlEscape(item.endDate || item.planEndDate || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">计划金额</label>
          <div class="layui-input-block"><input class="layui-input" name="amount" value="${item.amount || row.finishMoney || 0}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">状态</label>
          <div class="layui-input-block"><input class="layui-input" name="status" value="${htmlEscape(item.status || row.gatherState || "执行中")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">完成比例</label>
          <div class="layui-input-block"><input class="layui-input" readonly value="${htmlEscape(row.finishPercent || "0%")}"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/secProjectPlan/save_plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存计划</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveProjectPlan(req) {
  const body = { ...req.query, ...req.body };
  let id = planIdFrom(req);
  let item = planById(id);
  if (!item) {
    id = nextId(engine.db.plans, "planId");
    item = { id, planId: id };
    engine.db.plans.push(item);
  }
  item.sectionId = numeric(body.sectionId, item.sectionId || 101);
  item.planName = body.planName || body.name || item.planName || `工程计划 ${id}`;
  item.startDate = body.startDate || body.planStartDate || item.startDate || today();
  item.endDate = body.endDate || body.planEndDate || item.endDate || item.startDate;
  item.planStartDate = item.startDate;
  item.planEndDate = item.endDate;
  item.amount = numeric(body.amount ?? body.finishMoney ?? body.money, item.amount || 0);
  item.status = body.status || item.status || "执行中";
  item.gatherState = item.status;
  return { changed: 1, planId: item.planId, row: engine.planRows().find((row) => Number(row.planId) === Number(item.planId)) };
}

function projectPlanDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const planRows = engine.planRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const reportRows = reportPaymentRows(sectionId ? [sectionId] : []);
  const measuredMoney = reportRows.reduce((sum, row) => sum + Number(row.totalPayMoney || row.measureMoney || 0), 0);
  const contractMoney = reportRows.reduce((sum, row) => sum + Number(row.contractMoney || 0), 0);
  const finalMoney = reportRows.reduce((sum, row) => sum + Number(row.finalMoney || 0), 0);
  let cumulative = 0;
  const totalPlanMoney = planRows.reduce((sum, row) => sum + Number(row.finishMoney || row.amount || 0), 0);
  const maxBar = Math.max(totalPlanMoney, measuredMoney, 1);
  const cardData = [
    ["计划产值", moneyText(totalPlanMoney), "计划累计产值"],
    ["已计量支付", moneyText(measuredMoney), "清单计量、材料补差、手动计量合计"],
    ["合同金额", moneyText(contractMoney), "筛选合同段合同额"],
    ["最终金额", moneyText(finalMoney), "含变更后的控制金额"],
    ["计划完成率", percentText(finalMoney ? (totalPlanMoney / finalMoney) * 100 : 0), "计划产值 / 最终金额"],
    ["实际支付率", percentText(finalMoney ? (measuredMoney / finalMoney) * 100 : 0), "累计支付 / 最终金额"]
  ].map(([label, value, hint]) => `
    <div class="plan-card">
      <span>${htmlEscape(label)}</span>
      <strong>${htmlEscape(value)}</strong>
      <small>${htmlEscape(hint)}</small>
    </div>`).join("");
  const rows = planRows.map((row) => {
    const amount = Number(row.finishMoney || row.amount || 0);
    cumulative += amount;
    const completeRate = finalMoney ? (amount / finalMoney) * 100 : 0;
    const cumulativeRate = finalMoney ? (cumulative / finalMoney) * 100 : 0;
    const barWidth = Math.max(0, Math.min(100, (amount / maxBar) * 100));
    return `
      <tr>
        <td>${htmlEscape(row.planNo || "")}</td>
        <td class="left">${htmlEscape(row.planName || "")}</td>
        <td>${htmlEscape(row.sectionName || ((engine.db.sections.find((s) => Number(s.sectionId) === Number(row.sectionId)) || {}).sectionName) || "")}</td>
        <td>${htmlEscape(row.planStartDate || row.startDate || "")}</td>
        <td>${htmlEscape(row.planEndDate || row.endDate || "")}</td>
        <td>${moneyText(amount)}</td>
        <td>${moneyText(cumulative)}</td>
        <td>${percentText(completeRate)}</td>
        <td>${percentText(cumulativeRate)}</td>
        <td>${htmlEscape(row.gatherState || row.status || "")}</td>
        <td><div class="plan-bar"><i style="width:${barWidth}%"></i></div></td>
      </tr>`;
  }).join("");
  const sectionOptionsHtml = [`<option value="0"${sectionId ? "" : " selected"}>全部合同段</option>`]
    .concat(engine.db.sections.map((section) => {
      const selected = Number(section.sectionId || section.id) === sectionId ? " selected" : "";
      return `<option value="${section.sectionId || section.id}"${selected}>${htmlEscape(section.sectionName || "")}</option>`;
    })).join("");
  return `
    <div class="layui-fluid project-plan-dashboard">
      <style>
        .project-plan-dashboard { padding:16px; background:#f4f7fb; color:#172033; }
        .plan-shell { max-width:1320px; margin:0 auto; }
        .plan-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .plan-head h2 { margin:0; font-size:22px; font-weight:600; }
        .plan-head p { margin:6px 0 0; color:#64748b; }
        .plan-filter { display:flex; gap:8px; align-items:center; }
        .plan-filter select { height:32px; min-width:180px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .plan-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .plan-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .plan-card span, .plan-card small { display:block; color:#64748b; font-size:12px; }
        .plan-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .plan-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; }
        .plan-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .plan-panel table { min-width:1120px; margin:0; }
        .left { text-align:left; }
        .plan-bar { height:8px; background:#e5e7eb; border-radius:999px; overflow:hidden; min-width:90px; }
        .plan-bar i { display:block; height:100%; background:#0f766e; }
        .plan-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .plan-cards { grid-template-columns:repeat(3, 1fr); } .plan-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .plan-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="plan-shell">
        <div class="plan-head">
          <div>
            <h2>项目计划执行看板</h2>
            <p>按合同段跟踪计划产值、累计计划、已计量支付和完成比例。</p>
          </div>
          <div class="plan-filter">
            <select onchange="location.href='/secProjectPlan/plan_dashboard_page?sectionId='+this.value">${sectionOptionsHtml}</select>
            <button class="layui-btn layui-btn-sm" onclick="location.href='/secProjectPlan/plan_edit_page'">新增计划</button>
          </div>
        </div>
        <div class="plan-cards">${cardData}</div>
        <div class="plan-panel">
          <h3>计划产值明细</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>计划编号</th><th>计划名称</th><th>合同段</th><th>开始日期</th><th>结束日期</th><th>计划产值</th><th>累计计划</th><th>单项占比</th><th>累计占比</th><th>状态</th><th>产值条</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="11" class="plan-empty">暂无项目计划</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function documentNodePayload() {
  const nodes = engine.documentRows().map((item) => ({
    ...item,
    oaNodeId: item.nodeId,
    oaDataName: item.title,
    oaDataNodeList: []
  }));
  const menuXml = [
    '<?xml version="1.0"?>',
    '<menu>',
    '<item id="addDataManage" text="添加资料"/>',
    '<item id="addSubNode" text="添加节点"/>',
    '<item id="modifyNode" text="编辑节点"/>',
    '<item id="deleteNode" text="删除节点"/>',
    '<item id="add_right" text="权限设置"/>',
    '</menu>'
  ].join("");
  return {
    json: menuXml,
    nodeList: nodes
  };
}

function projectInformationTreeRows() {
  return engine.documentRows().map((item) => ({
    ...item,
    id: item.nodeId,
    pId: item.parentId || 0,
    parentId: item.parentId || 0,
    name: item.title || item.nodeName || item.dataName,
    title: item.title || item.nodeName || item.dataName,
    state: item.state || "open",
    open: true,
    checked: false
  }));
}

function projectInformationHangRows() {
  const sections = engine.db.sections.length ? engine.db.sections : [{ sectionId: 0, sectionName: "" }];
  return engine.documentRows().map((doc, index) => {
    const section = sections[index % sections.length];
    const nodeId = doc.nodeId || doc.id || index + 1;
    const attachments = Array.isArray(doc.attachments) ? doc.attachments : [];
    const dataNo = doc.dataNo || `ZL-${String(nodeId).padStart(3, "0")}`;
    const dataName = doc.title || doc.nodeName || doc.dataName || `Data ${nodeId}`;
    return {
      ...doc,
      zizeng: index + 1,
      hangId: doc.hangId || nodeId,
      fileCount: attachments.length || doc.fileCount || 0,
      hangDate: doc.hangDate || doc.updateDate || doc.createDate || new Date().toISOString().slice(0, 10),
      projectInformationParam: {
        informationId: nodeId,
        paramId: nodeId,
        dataNo,
        dataName,
        dataType: doc.type || ""
      },
      projectInformationNode: {
        nodeId,
        nodeName: dataName,
        parentId: doc.parentId || 0,
        sysSection: section
      },
      sysUser: {
        userId: 563,
        userName: doc.createUserName || "ys1"
      }
    };
  });
}

function documentIdFrom(req) {
  return Number(
    req.body.nodeId ||
    req.query.nodeId ||
    req.body.oaNodeId ||
    req.query.oaNodeId ||
    req.body.informationId ||
    req.query.informationId ||
    req.body.hangId ||
    req.query.hangId ||
    req.params.id ||
    idsFrom(req, "ids")[0] ||
    0
  );
}

function documentById(id) {
  return engine.db.documents.find((row) => Number(row.nodeId || row.id || row.hangId) === Number(id));
}

function documentAttachmentRows(req) {
  const id = documentIdFrom(req);
  const item = documentById(id) || {};
  const attachments = Array.isArray(item.attachments) ? item.attachments : [];
  return attachments.map((row, index) => ({
    ...row,
    id: row.id || row.attachmentId || index + 1,
    attachmentId: row.attachmentId || row.id || index + 1,
    hangId: item.hangId || item.nodeId || id,
    nodeId: item.nodeId || id,
    fileName: row.fileName || row.name || `附件${index + 1}.doc`,
    uploadDate: row.uploadDate || row.createDate || today(),
    uploadUser: row.uploadUser || row.userName || "ys1",
    size: Number(row.size || 0),
    remark: row.remark || ""
  }));
}

function documentAttachmentPageHtml(req) {
  const id = documentIdFrom(req);
  const item = documentById(id) || {};
  const rows = documentAttachmentRows(req).map((row) => `
    <tr>
      <td>${htmlEscape(row.fileName || "")}</td>
      <td>${htmlEscape(row.uploadUser || "")}</td>
      <td>${htmlEscape(row.uploadDate || "")}</td>
      <td>${htmlEscape(String(row.size || 0))}</td>
      <td class="left">${htmlEscape(row.remark || "")}</td>
      <td><button type="button" class="layui-btn layui-btn-danger layui-btn-xs" data-delete="${row.attachmentId}">删除</button></td>
    </tr>`).join("");
  return `
    <div style="padding:16px 20px;" class="document-attachment-page">
      <form class="layui-form" id="document-attachment-form">
        <input type="hidden" name="hangId" value="${htmlEscape(item.hangId || item.nodeId || id || "")}">
        <input type="hidden" name="nodeId" value="${htmlEscape(item.nodeId || id || "")}">
        <div class="layui-form-item">
          <label class="layui-form-label">资料名称</label>
          <div class="layui-input-block"><input class="layui-input" readonly value="${htmlEscape(item.title || item.dataName || item.nodeName || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">附件名称</label>
          <div class="layui-input-block"><input class="layui-input" name="fileName" value="资料附件.docx"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">文件大小</label>
          <div class="layui-input-block"><input class="layui-input" name="size" value="1024"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">附件说明</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="remark">资料附件上传</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/projectInformationNode/upload_attachment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'上传成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">上传附件</button>
          </div>
        </div>
      </form>
      <table class="layui-table" lay-size="sm">
        <thead><tr><th>附件名称</th><th>上传人</th><th>上传日期</th><th>大小</th><th>说明</th><th>操作</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="text-align:center;color:#94a3b8;">暂无附件</td></tr>`}</tbody>
      </table>
      <script>
        Array.prototype.forEach.call(document.querySelectorAll('[data-delete]'), function(btn) {
          btn.onclick = function() {
            fetch('/projectInformationNode/delete_attachment', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({ hangId:'${htmlEscape(item.hangId || item.nodeId || id || "")}', attachmentId:btn.getAttribute('data-delete') })
            }).then(function(r){return r.json()}).then(function(){ (window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload()); });
          };
        });
      </script>
    </div>`;
}

function saveDocumentAttachment(req) {
  const body = { ...req.query, ...req.body };
  const id = documentIdFrom(req);
  const item = documentById(id);
  if (!item) return { changed: 0, reason: "document_not_found" };
  item.attachments = Array.isArray(item.attachments) ? item.attachments : [];
  const attachmentId = nextId(item.attachments, "attachmentId");
  const row = {
    id: attachmentId,
    attachmentId,
    hangId: item.hangId || item.nodeId || id,
    nodeId: item.nodeId || id,
    fileName: String(body.fileName || body.filename || body.name || `资料附件-${attachmentId}.docx`).trim(),
    size: numeric(body.size, 0),
    remark: body.remark || "",
    uploadUser: body.uploadUser || body.userName || "ys1",
    uploadDate: body.uploadDate || today()
  };
  item.attachments.push(row);
  item.fileCount = item.attachments.length;
  item.updateDate = today();
  return { changed: 1, attachmentId, row };
}

function deleteDocumentAttachment(req) {
  const body = { ...req.query, ...req.body };
  const id = documentIdFrom(req);
  const item = documentById(id);
  if (!item || !Array.isArray(item.attachments)) return { changed: 0 };
  const ids = idsFromAny(req, ["attachmentId", "attachmentIds", "attId", "attIds"]);
  const changed = removeRows(item.attachments, "attachmentId", ids);
  item.fileCount = item.attachments.length;
  item.updateDate = today();
  return { changed, rows: item.attachments.length };
}

function documentFormHtml(req, mode = "node") {
  const body = { ...req.query, ...req.body };
  const sourceId = documentIdFrom(req);
  const isAdd = mode === "add" || ["addNext", "addSubNode", "addLevel"].includes(String(body.type || ""));
  const item = isAdd ? {} : (documentById(sourceId) || {});
  const parentId = Number(body.parentId || item.parentId || (isAdd ? sourceId : 0) || 0);
  const saveUrl = mode === "syzl" ? "/syzl/save" : "/oaDataNode/save_data_node";
  const title = mode === "syzl" ? "试验资料" : mode === "detail" ? "资料明细" : "资料节点";
  const submitLabel = mode === "syzl" ? "保存试验资料" : "保存资料";
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="document-form">
        <input type="hidden" name="nodeId" value="${isAdd ? "" : htmlEscape(item.nodeId || item.id || "")}">
        <input type="hidden" name="hangId" value="${htmlEscape(item.hangId || "")}">
        <input type="hidden" name="parentId" value="${parentId || 0}">
        <input type="hidden" name="formMode" value="${htmlEscape(mode)}">
        <div class="layui-form-item">
          <label class="layui-form-label">资料名称</label>
          <div class="layui-input-block"><input class="layui-input" name="title" value="${htmlEscape(item.title || item.dataName || item.nodeName || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">资料编号</label>
          <div class="layui-input-block"><input class="layui-input" name="dataNo" value="${htmlEscape(item.dataNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">资料类型</label>
          <div class="layui-input-block"><input class="layui-input" name="type" value="${htmlEscape(item.type || title)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">试验室</label>
          <div class="layui-input-block"><input class="layui-input" name="testHouseName" value="${htmlEscape(item.testHouseName || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">试验名称</label>
          <div class="layui-input-block"><input class="layui-input" name="testName" value="${htmlEscape(item.testName || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">创建日期</label>
          <div class="layui-input-block"><input class="layui-input" name="createDate" value="${htmlEscape(item.createDate || item.createTime || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">文件数</label>
          <div class="layui-input-block"><input class="layui-input" name="fileCount" value="${Number(item.fileCount || 0)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">备注</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="remark">${htmlEscape(item.remark || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('${saveUrl}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">${submitLabel}</button>
          </div>
        </div>
      </form>
    </div>`;
}

function documentFormHtmlClean(req, mode = "node") {
  const body = { ...req.query, ...req.body };
  const sourceId = documentIdFrom(req);
  const isAdd = mode === "add" || ["addNext", "addSubNode", "addLevel"].includes(String(body.type || ""));
  const item = isAdd ? {} : (documentById(sourceId) || {});
  const parentId = Number(body.parentId || item.parentId || (isAdd ? sourceId : 0) || 0);
  const saveUrl = mode === "syzl" ? "/syzl/save" : "/oaDataNode/save_data_node";
  const defaultType = mode === "syzl" ? "试验资料" : mode === "detail" ? "资料明细" : "工程资料";
  const submitLabel = mode === "syzl" ? "保存试验资料" : "保存资料";
  const field = (label, name, value, attrs = "") => `
        <div class="layui-form-item">
          <label class="layui-form-label">${label}</label>
          <div class="layui-input-block"><input class="layui-input" name="${name}" value="${htmlEscape(value || "")}" ${attrs}></div>
        </div>`;
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="document-form">
        <input type="hidden" name="nodeId" value="${isAdd ? "" : htmlEscape(item.nodeId || item.id || "")}">
        <input type="hidden" name="hangId" value="${htmlEscape(item.hangId || "")}">
        <input type="hidden" name="parentId" value="${parentId || 0}">
        <input type="hidden" name="formMode" value="${htmlEscape(mode)}">
        ${field("资料名称", "title", item.title || item.dataName || item.nodeName)}
        ${field("资料编号", "dataNo", item.dataNo)}
        ${field("资料类型", "type", item.type || defaultType)}
        ${field("试验室", "testHouseName", item.testHouseName)}
        ${field("试验名称", "testName", item.testName)}
        ${field("创建日期", "createDate", item.createDate || item.createTime || today())}
        ${field("文件数", "fileCount", Number(item.fileCount || 0), 'type="number" min="0" step="1"')}
        <div class="layui-form-item">
          <label class="layui-form-label">备注</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="remark">${htmlEscape(item.remark || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('${saveUrl}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">${submitLabel}</button>
          </div>
        </div>
      </form>
    </div>`;
}

function documentPowerFormHtml(req) {
  const id = documentIdFrom(req);
  const item = documentById(id) || engine.db.documents[0] || {};
  const nodeId = item.nodeId || item.id || id || "";
  const power = item.userPower || {};
  const users = power.users || item.powerUsers || "ys1,项目经理,资料员";
  const permissionText = (Array.isArray(power.permissions) ? power.permissions : String(power.permissions || item.permissions || "上传,下载,编辑").split(/[,\s，、]+/))
    .filter(Boolean);
  const checked = (value) => permissionText.includes(value) ? " checked" : "";
  const nodeOptions = engine.documentRows().map((doc) => {
    const selected = Number(doc.nodeId || doc.id) === Number(nodeId) ? " selected" : "";
    return `<option value="${doc.nodeId || doc.id}"${selected}>${htmlEscape(doc.title || doc.nodeName || doc.dataName || `资料 ${doc.nodeId || doc.id}`)}</option>`;
  }).join("");
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="document-power-form">
        <div class="layui-form-item">
          <label class="layui-form-label">资料节点</label>
          <div class="layui-input-block"><select name="nodeId" class="layui-select">${nodeOptions}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">授权用户</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="powerUsers">${htmlEscape(users)}</textarea></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">权限项</label>
          <div class="layui-input-block">
            <label><input type="checkbox" name="permissions" value="上传"${checked("上传")}> 上传</label>
            <label style="margin-left:16px;"><input type="checkbox" name="permissions" value="下载"${checked("下载")}> 下载</label>
            <label style="margin-left:16px;"><input type="checkbox" name="permissions" value="编辑"${checked("编辑")}> 编辑</label>
            <label style="margin-left:16px;"><input type="checkbox" name="permissions" value="删除"${checked("删除")}> 删除</label>
          </div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">权限说明</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="powerRemark">${htmlEscape(power.remark || item.powerRemark || "资料节点操作权限")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={permissions:[]};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){if(el.type==='checkbox'){if(el.checked)data.permissions.push(el.value)}else{data[el.name]=el.value}});fetch('/oaDataNode/save_node_user_power',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'权限已保存')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存权限</button>
          </div>
        </div>
      </form>
    </div>`;
}

function projectInformationEditorHtml(req) {
  return documentFormHtmlClean(req, "node");
}

function projectInformationHangHtml(req) {
  const id = documentIdFrom(req);
  const item = documentById(id) || {};
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="project-information-hang-form">
        <input type="hidden" name="nodeId" value="${htmlEscape(id || item.nodeId || "")}">
        <input type="hidden" name="parentId" value="${htmlEscape(item.parentId || 0)}">
        <div class="layui-form-item">
          <label class="layui-form-label">挂接资料</label>
          <div class="layui-input-block"><input class="layui-input" name="title" value="${htmlEscape(item.title || item.dataName || "")}" placeholder="资料名称"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">资料编号</label>
          <div class="layui-input-block"><input class="layui-input" name="dataNo" value="${htmlEscape(item.dataNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">资料类型</label>
          <div class="layui-input-block"><input class="layui-input" name="type" value="${htmlEscape(item.type || "工程资料")}"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/oaDataNode/save_data_node',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'挂接成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存挂接</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveDocument(req) {
  const body = { ...req.query, ...req.body };
  let id = documentIdFrom(req);
  let item = documentById(id);
  if (!item) {
    id = nextId(engine.db.documents, "nodeId");
    item = { id, nodeId: id };
    engine.db.documents.push(item);
  }
  item.id = item.id || id;
  item.nodeId = item.nodeId || id;
  item.hangId = numeric(body.hangId, item.hangId || item.nodeId);
  item.parentId = numeric(body.parentId, item.parentId || 0);
  item.title = body.title || body.dataName || body.nodeName || body.name || item.title || `资料 ${item.nodeId}`;
  item.title = cleanBusinessText(item.title, `资料 ${item.nodeId}`);
  item.title = cleanBusinessText(item.title, `资料 ${item.nodeId}`);
  item.name = item.title;
  item.dataName = item.title;
  item.nodeName = item.title;
  item.dataNo = body.dataNo || body.fileNo || item.dataNo || `ZL-${String(item.nodeId).padStart(3, "0")}`;
  item.type = body.type || body.dataType || item.type || (body.formMode === "syzl" ? "试验资料" : "工程资料");
  item.type = cleanBusinessText(item.type, body.formMode === "syzl" ? "试验资料" : "工程资料");
  item.type = cleanBusinessText(item.type, body.formMode === "syzl" ? "试验资料" : "工程资料");
  item.testHouseName = body.testHouseName || item.testHouseName || item.title;
  item.testName = body.testName || item.testName || item.type;
  item.createDate = body.createDate || body.createTime || item.createDate || today();
  item.createTime = item.createDate;
  item.updateDate = body.updateDate || today();
  item.fileCount = numeric(body.fileCount, item.fileCount || 0);
  item.remark = body.remark || item.remark || "";
  item.createUserName = body.createUserName || body.userName || item.createUserName || "ys1";
  return { changed: 1, nodeId: item.nodeId, hangId: item.hangId, row: engine.documentRows().find((row) => Number(row.nodeId) === Number(item.nodeId)) };
}

function saveDocumentPower(req) {
  const body = { ...req.query, ...req.body };
  const id = documentIdFrom(req);
  const item = documentById(id);
  if (!item) return { changed: 0, nodeId: id, reason: "not_found" };
  const permissions = Array.isArray(body.permissions)
    ? body.permissions
    : String(body.permissions || "").split(/[,\s，、]+/).filter(Boolean);
  item.userPower = {
    users: body.powerUsers || body.users || item.powerUsers || "ys1",
    permissions: permissions.length ? permissions : ["上传", "下载", "编辑"],
    remark: body.powerRemark || body.remark || ""
  };
  item.powerUsers = item.userPower.users;
  item.permissions = item.userPower.permissions.join(",");
  item.powerRemark = item.userPower.remark;
  item.updateDate = today();
  return { changed: 1, nodeId: item.nodeId, row: engine.documentRows().find((row) => Number(row.nodeId) === Number(item.nodeId)) };
}


function defaultDocuments() {
  return [
    { id: 1, nodeId: 1, title: "开工报告", type: "建设单位工程资料", createDate: "2026-01-10", fileCount: 3, parentId: 0 },
    { id: 2, nodeId: 2, title: "试验检测资料", type: "试验室内部资料", createDate: "2026-02-02", fileCount: 8, parentId: 0 }
  ];
}

function documentManagementDashboardHtml(req) {
  const sourcePath = String(req.path || "");
  const showTestOnly = sourcePath.includes("/syzl");
  const rows = engine.documentRows();
  const allTreeRows = projectInformationTreeRows();
  const allHangRows = projectInformationHangRows();
  const isTestDocument = (row) => {
    const text = `${row.title || ""} ${row.dataName || ""} ${row.nodeName || ""} ${row.type || ""} ${row.testName || ""}`;
    return /试验|检测|sy/i.test(text);
  };
  const testRows = rows.filter(isTestDocument);
  const displayRows = showTestOnly ? testRows : rows;
  const displayIds = new Set(displayRows.map((row) => Number(row.nodeId || row.id || row.hangId)));
  const treeRows = showTestOnly ? allTreeRows.filter((row) => displayIds.has(Number(row.nodeId || row.id || row.hangId))) : allTreeRows;
  const hangRows = showTestOnly ? allHangRows.filter((row) => displayIds.has(Number(row.nodeId || row.id || row.hangId))) : allHangRows;
  const totalFiles = rows.reduce((sum, row) => sum + Number(row.fileCount || 0), 0);
  const hangFileCount = hangRows.reduce((sum, row) => sum + Number(row.fileCount || 0), 0);
  const recentRows = [...displayRows].sort((a, b) => String(b.updateDate || b.createDate || "").localeCompare(String(a.updateDate || a.createDate || ""))).slice(0, 12);
  const sectionNames = [...new Set(hangRows.map((row) => row.projectInformationNode && row.projectInformationNode.sysSection && row.projectInformationNode.sysSection.sectionName).filter(Boolean))];
  const cards = [
    ["资料节点", String(treeRows.length), "项目资料树节点"],
    ["资料文件数", String(totalFiles), "全部资料附件数量"],
    ["试验资料", String(testRows.length), "试验/检测资料"],
    ["工程资料", String(Math.max(0, rows.length - testRows.length)), "施工与计量过程资料"],
    ["已挂接", String(hangRows.length), `覆盖 ${sectionNames.length || 0} 个合同段`],
    ["挂接文件", String(hangFileCount), "已挂接资料附件"]
  ].map(([label, value, hint]) => `
    <div class="doc-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const treeBody = treeRows.map((row) => `
    <tr>
      <td class="left" style="padding-left:${12 + Number(row.parentId || 0) * 10}px">${htmlEscape(row.name || row.title || "")}</td>
      <td>${htmlEscape(row.dataNo || `ZL-${String(row.nodeId || row.id || "").padStart(3, "0")}`)}</td>
      <td>${htmlEscape(row.type || "")}</td>
      <td>${Number(row.fileCount || 0)}</td>
      <td>${htmlEscape(row.createDate || row.updateDate || "")}</td>
    </tr>`).join("");
  const hangBody = hangRows.slice(0, 80).map((row) => {
    const param = row.projectInformationParam || {};
    const node = row.projectInformationNode || {};
    const section = node.sysSection || {};
    return `
      <tr>
        <td>${htmlEscape(section.sectionName || "")}</td>
        <td>${htmlEscape(param.dataNo || row.dataNo || "")}</td>
        <td class="left">${htmlEscape(param.dataName || row.title || row.dataName || "")}</td>
        <td>${htmlEscape(param.dataType || row.type || "")}</td>
        <td>${Number(row.fileCount || 0)}</td>
        <td>${htmlEscape(row.sysUser && row.sysUser.userName || row.createUserName || "")}</td>
        <td>${htmlEscape(row.hangDate || row.updateDate || row.createDate || "")}</td>
      </tr>`;
  }).join("");
  const testBody = testRows.map((row) => `
    <tr>
      <td>${htmlEscape(row.dataNo || "")}</td>
      <td class="left">${htmlEscape(row.title || row.dataName || row.nodeName || "")}</td>
      <td>${htmlEscape(row.testHouseName || "")}</td>
      <td>${htmlEscape(row.testName || row.type || "")}</td>
      <td>${Number(row.fileCount || 0)}</td>
      <td>${htmlEscape(row.createDate || "")}</td>
      <td><a href="/syzl/see_page?nodeId=${row.nodeId || row.id}">查看</a></td>
    </tr>`).join("");
  const recentBody = recentRows.map((row) => `
    <tr>
      <td>${htmlEscape(row.dataNo || "")}</td>
      <td class="left">${htmlEscape(row.title || row.dataName || row.nodeName || "")}</td>
      <td>${htmlEscape(row.type || "")}</td>
      <td>${Number(row.fileCount || 0)}</td>
      <td>${htmlEscape(row.updateDate || row.createDate || "")}</td>
      <td><a href="/oaDataNode/get_data_detail_page?nodeId=${row.nodeId || row.id}">详情</a></td>
    </tr>`).join("");
  return `
    <div class="layui-fluid document-dashboard">
      <style>
        .document-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .doc-shell { max-width:1380px; margin:0 auto; }
        .doc-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .doc-head h2 { margin:0; font-size:22px; font-weight:600; }
        .doc-head p { margin:6px 0 0; color:#64748b; }
        .doc-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .doc-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .doc-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .doc-card span, .doc-card small { display:block; color:#64748b; font-size:12px; }
        .doc-card strong { display:block; margin:8px 0; color:#155e75; font-size:20px; }
        .doc-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .doc-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .doc-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .doc-panel table { margin:0; min-width:760px; }
        .doc-panel-wide { grid-column:1 / -1; }
        .left { text-align:left; }
        .doc-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .doc-cards { grid-template-columns:repeat(3, 1fr); } .doc-grid { grid-template-columns:1fr; } .doc-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .doc-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="doc-shell">
        <div class="doc-head">
          <div>
            <h2>${showTestOnly ? "试验资料管理看板" : "项目资料管理看板"}</h2>
            <p>汇总资料节点、资料挂接、试验检测资料、附件数量和最近更新，支撑项目资料归档与计量支付附件管理。</p>
          </div>
          <div class="doc-actions">
            <a class="layui-btn layui-btn-sm" href="/oaDataNode/add_data_node_page">新增资料</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/syzl/edit_page">新增试验资料</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/oaDataNode/downLoadZipFile">下载资料包</a>
          </div>
        </div>
        <div class="doc-cards">${cards}</div>
        <div class="doc-grid">
          <div class="doc-panel">
            <h3>资料节点树</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>资料名称</th><th>资料编号</th><th>资料类型</th><th>文件数</th><th>创建日期</th></tr></thead>
              <tbody>${treeBody || `<tr><td colspan="5" class="doc-empty">暂无资料节点</td></tr>`}</tbody>
            </table>
          </div>
          <div class="doc-panel">
            <h3>试验资料</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>资料编号</th><th>资料名称</th><th>试验室</th><th>试验名称</th><th>文件数</th><th>日期</th><th>操作</th></tr></thead>
              <tbody>${testBody || `<tr><td colspan="7" class="doc-empty">暂无试验资料</td></tr>`}</tbody>
            </table>
          </div>
          <div class="doc-panel doc-panel-wide">
            <h3>资料挂接明细</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>合同段</th><th>资料编号</th><th>资料名称</th><th>资料类型</th><th>文件数</th><th>经办人</th><th>挂接日期</th></tr></thead>
              <tbody>${hangBody || `<tr><td colspan="7" class="doc-empty">暂无挂接资料</td></tr>`}</tbody>
            </table>
          </div>
          <div class="doc-panel doc-panel-wide">
            <h3>最近更新</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>资料编号</th><th>资料名称</th><th>资料类型</th><th>文件数</th><th>更新日期</th><th>详情</th></tr></thead>
              <tbody>${recentBody || `<tr><td colspan="6" class="doc-empty">暂无最近更新</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function ensureImportAttachments() {
  if (!Array.isArray(engine.db.importMeasureAttachments)) {
    engine.db.importMeasureAttachments = [
      { id: 1, attachmentId: 1, attId: 1, fileName: "清单计量导入模板.xlsx", size: 28672, uploadDate: "2026-02-20", status: 0, state: "已解析" }
    ];
  }
  return engine.db.importMeasureAttachments;
}

function importAttachmentRows() {
  return ensureImportAttachments().map((item) => ({
    ...item,
    fileName: cleanBusinessText(item.fileName, "清单计量导入模板.xlsx"),
    id: item.attachmentId || item.attId || item.id,
    attachmentId: item.attachmentId || item.attId || item.id,
    attId: item.attId || item.attachmentId || item.id,
    state: item.state || (item.status === 1 ? "已导入" : item.status === 2 ? "已清空数据" : "已解析"),
    state: cleanBusinessText(item.state, item.status === 1 ? "已导入" : item.status === 2 ? "已清空数据" : "已解析"),
    uploadDate: item.uploadDate || today(),
    fileDate: item.fileDate || item.uploadDate || today(),
    sort: item.sort || engine.allMeasureDetails().length
  }));
}

function parsedImportDetails(attachment, fallbackIndex = 0) {
  const sourceRows = Array.isArray(attachment.parsedRows) ? attachment.parsedRows : [];
  const details = sourceRows.map((row) => {
    const bill = engine.db.bills.find((item) => {
      if (Number(row.billId || 0) && Number(item.billId || 0) === Number(row.billId)) return true;
      if (row.billNo && String(item.billNo || "") === String(row.billNo)) return true;
      return false;
    });
    if (!bill) return null;
    const measureNum = Number(row.measureNum ?? row.quantity ?? row.currentNum ?? row.num ?? 0);
    return {
      billId: bill.billId,
      measureNum: measureNum > 0 ? measureNum : Math.max(1, Math.round(Number(bill.contractNum || 1) * 0.01))
    };
  }).filter(Boolean);
  if (details.length) return details;
  const firstBill = engine.db.bills[fallbackIndex % engine.db.bills.length] || engine.db.bills[0];
  return [{ billId: firstBill.billId, measureNum: Math.max(1, Math.round(Number(firstBill.contractNum || 1) * 0.01)) }];
}

function uploadImportRows(req) {
  const raw = req.body.rows || req.body.details || req.body.items || req.query.rows || req.query.details || req.query.items;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function importMeasureFromAttachments(ids) {
  const attachments = importAttachmentRows();
  const selected = ids.length ? attachments.filter((item) => ids.includes(Number(item.attId || item.attachmentId || item.id))) : attachments;
  let imported = 0;
  selected.forEach((attachment) => {
    const exists = engine.db.measures.some((row) => row.sourceAttId === attachment.attId);
    if (!exists) {
      const id = nextId(engine.db.measures, "measureId");
      const firstBill = engine.db.bills[imported % engine.db.bills.length] || engine.db.bills[0];
      const details = parsedImportDetails(attachment, imported);
      const sectionBill = engine.db.bills.find((bill) => Number(bill.billId || 0) === Number(details[0] && details[0].billId)) || firstBill;
      engine.db.measures.push({
        id,
        measureId: id,
        sourceAttId: attachment.attId,
        measureNo: `JL-IMPORT-${String(id).padStart(3, "0")}`,
        sectionId: sectionBill.sectionId || 101,
        periodId: 2,
        measureDate: today(),
        states: "待上报",
        drawNo: "IMPORT",
        pegNo: "导入计量",
        certifyNo: `DR-${String(id).padStart(3, "0")}`,
        position: attachment.fileName || "导入计量",
        details
      });
      imported += 1;
    }
    const source = ensureImportAttachments().find((row) => Number(row.attId || row.attachmentId || row.id) === Number(attachment.attId));
    if (source) {
      source.status = 1;
      source.state = "已导入";
    }
  });
  return { imported, rows: engine.db.measures.length };
}

function clearImportedMeasureData(ids) {
  const attachments = importAttachmentRows();
  const selected = ids.length ? attachments.filter((item) => ids.includes(Number(item.attId || item.attachmentId || item.id))) : attachments;
  const selectedIds = selected.map((item) => Number(item.attId || item.attachmentId || item.id));
  let changed = 0;
  for (let index = engine.db.measures.length - 1; index >= 0; index -= 1) {
    if (selectedIds.includes(Number(engine.db.measures[index].sourceAttId))) {
      engine.db.measures.splice(index, 1);
      changed += 1;
    }
  }
  ensureImportAttachments().forEach((item) => {
    if (!selectedIds.length || selectedIds.includes(Number(item.attId || item.attachmentId || item.id))) {
      item.status = 2;
      item.state = "已清空数据";
    }
  });
  return { changed, rows: engine.db.measures.length };
}

function deleteImportAttachments(ids) {
  const attachments = ensureImportAttachments();
  const targetIds = ids.length ? ids : attachments.map((item) => Number(item.attId || item.attachmentId || item.id));
  let dataChanged = 0;
  for (let index = engine.db.measures.length - 1; index >= 0; index -= 1) {
    if (targetIds.includes(Number(engine.db.measures[index].sourceAttId))) {
      engine.db.measures.splice(index, 1);
      dataChanged += 1;
    }
  }
  const changed = removeRows(attachments, "attId", targetIds) || removeRows(attachments, "attachmentId", targetIds);
  return { changed, dataChanged, rows: attachments.length };
}

function importMeasureDashboardHtml(req) {
  const attachments = importAttachmentRows().slice().sort((a, b) => Number(b.attId || b.id || 0) - Number(a.attId || a.id || 0));
  const selectedAttId = Number(req.query.attId || req.body.attId || (attachments[0] && (attachments[0].attId || attachments[0].id)) || 0);
  const importedMeasures = engine.measureRows().filter((row) => !selectedAttId || Number(row.sourceAttId || 0) === selectedAttId);
  const previewRows = importMeasurePreviewRows(selectedAttId).slice(0, 80);
  const totalImportedMoney = importedMeasures.reduce((sum, row) => sum + Number(row.measureMoney || 0), 0);
  const parsedCount = attachments.filter((row) => /解析/.test(row.state || "")).length;
  const importedCount = attachments.filter((row) => /导入/.test(row.state || "")).length;
  const clearedCount = attachments.filter((row) => /清空/.test(row.state || "")).length;
  const cards = [
    ["附件数量", attachments.length, "上传并解析的 Excel"],
    ["已解析", parsedCount, "可执行导入的附件"],
    ["已导入", importedCount, "已生成计量单"],
    ["已清空", clearedCount, "已删除导入数据"],
    ["导入计量单", importedMeasures.length, "当前附件关联计量单"],
    ["导入金额", moneyText(totalImportedMoney), "当前附件导入计量金额"]
  ].map(([label, value, hint]) => `
    <div class="import-card">
      <span>${htmlEscape(label)}</span>
      <strong>${htmlEscape(value)}</strong>
      <small>${htmlEscape(hint)}</small>
    </div>`).join("");
  const attachmentRows = attachments.map((row) => {
    const id = Number(row.attId || row.attachmentId || row.id || 0);
    const active = id === selectedAttId ? " import-active" : "";
    return `
      <tr class="${active}">
        <td>${id}</td>
        <td class="left">${htmlEscape(row.fileName || "")}</td>
        <td>${Number(row.size || 0)}</td>
        <td>${htmlEscape(row.uploadDate || row.fileDate || "")}</td>
        <td><span class="import-state">${htmlEscape(row.state || "")}</span></td>
        <td>${Number(row.sort || 0)}</td>
        <td class="import-actions">
          <a href="/import_measure/dashboard_page?attId=${id}">查看</a>
          <a href="/import_measure/import_excel?attIds=${id}">导入</a>
          <a href="/import_measure/reload_import?attId=${id}">重解析</a>
          <a href="/import_measure/delete_data?attId=${id}">清空数据</a>
          <a href="/import_measure/delete?attIds=${id}">删除附件</a>
        </td>
      </tr>`;
  }).join("");
  const importedRows = importedMeasures.map((row) => `
    <tr>
      <td>${htmlEscape(row.measureNo || "")}</td>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.periodDesc || row.gatherNo || "")}</td>
      <td>${htmlEscape(row.measureDate || "")}</td>
      <td class="left">${htmlEscape(row.position || "")}</td>
      <td>${Number(row.detailCount || 0)}</td>
      <td>${moneyText(row.measureMoney)}</td>
      <td>${htmlEscape(row.states || "")}</td>
      <td><a href="/bill_measure/dashboard_page?sectionId=${Number(row.sectionId || 0)}">计量看板</a></td>
    </tr>`).join("");
  const previewBody = previewRows.map((row) => `
    <tr>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.measureNum || row.currentNum || 0)}</td>
      <td>${moneyText(row.price)}</td>
      <td>${moneyText(row.measureMoney || row.money || 0)}</td>
      <td>${htmlEscape(row.checkStatus || "")}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid import-measure-dashboard">
      <style>
        .import-measure-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .import-shell { max-width:1380px; margin:0 auto; }
        .import-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .import-head h2 { margin:0; font-size:22px; font-weight:600; }
        .import-head p { margin:6px 0 0; color:#64748b; }
        .import-tools { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .import-tools input { height:32px; min-width:220px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; }
        .import-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .import-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .import-card span, .import-card small { display:block; color:#64748b; font-size:12px; }
        .import-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .import-grid { display:grid; grid-template-columns:1.15fr .85fr; gap:12px; }
        .import-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .import-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .import-panel table { margin:0; min-width:760px; }
        .import-wide { grid-column:1 / -1; }
        .import-actions a { margin-right:8px; white-space:nowrap; }
        .import-state { display:inline-block; min-width:54px; text-align:center; color:#075985; background:#e0f2fe; border:1px solid #bae6fd; border-radius:4px; padding:2px 6px; }
        .import-active td { background:#f0fdfa; }
        .import-empty { text-align:center; color:#94a3b8; padding:24px; }
        .left { text-align:left; }
        @media (max-width:1100px) { .import-cards { grid-template-columns:repeat(3, 1fr); } .import-grid { grid-template-columns:1fr; } .import-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .import-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="import-shell">
        <div class="import-head">
          <div>
            <h2>清单计量导入管理</h2>
            <p>管理计量 Excel 附件、解析预览、生成计量单、重解析、清空导入数据和删除附件。</p>
          </div>
          <form class="import-tools" onsubmit="event.preventDefault();var f=this;fetch('/import_measure/upload_excel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileName:f.fileName.value,size:f.size.value})}).then(function(r){return r.json()}).then(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())});">
            <input name="fileName" value="本地计量导入-${today()}.xlsx">
            <input name="size" value="4096" style="min-width:90px;width:90px;">
            <button class="layui-btn layui-btn-sm" type="submit">上传解析</button>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/bill_measure/dashboard_page">计量看板</a>
          </form>
        </div>
        <div class="import-cards">${cards}</div>
        <div class="import-panel import-wide">
          <h3>导入附件</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>ID</th><th>文件名</th><th>大小</th><th>上传日期</th><th>状态</th><th>预览条数</th><th>操作</th></tr></thead>
            <tbody>${attachmentRows || `<tr><td colspan="7" class="import-empty">暂无导入附件</td></tr>`}</tbody>
          </table>
        </div>
        <div class="import-grid">
          <div class="import-panel">
            <h3>解析预览</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>清单编号</th><th>清单名称</th><th>单位</th><th>计量数量</th><th>单价</th><th>计量金额</th><th>校验</th></tr></thead>
              <tbody>${previewBody || `<tr><td colspan="7" class="import-empty">暂无解析预览</td></tr>`}</tbody>
            </table>
          </div>
          <div class="import-panel">
            <h3>已生成计量单</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>计量单号</th><th>合同段</th><th>工期</th><th>日期</th><th>来源</th><th>明细</th><th>金额</th><th>状态</th><th>入口</th></tr></thead>
              <tbody>${importedRows || `<tr><td colspan="9" class="import-empty">当前附件尚未生成计量单</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function deleteDocumentHang(ids) {
  return removeRows(engine.db.documents, "hangId", ids)
    || removeRows(engine.db.documents, "nodeId", ids)
    || removeRows(engine.db.documents, "id", ids);
}

function moveDocumentNode(req) {
  const ids = idsFrom(req, "nodeId");
  const id = ids[0];
  const type = Number(req.body.type ?? req.query.type ?? 0);
  const rows = engine.db.documents;
  const index = rows.findIndex((row) => Number(row.nodeId || row.id) === id);
  if (index < 0) return { changed: 0 };
  const direction = type === 1 ? -1 : 1;
  const target = index + direction;
  if (target < 0 || target >= rows.length) return { changed: 0, edge: true };
  const currentParent = Number(rows[index].parentId || 0);
  const targetParent = Number(rows[target].parentId || 0);
  if (currentParent !== targetParent) return { changed: 0, edge: true };
  const temp = rows[index];
  rows[index] = rows[target];
  rows[target] = temp;
  return { changed: 1, nodeId: id, type };
}

function withdrawWorkflow(req) {
  const requestedType = workflowRequestType(req);
  const requestedConfig = workflowConfig(requestedType);
  const requestedIds = workflowRequestIds(req, requestedConfig);
  const ids = requestedIds.length ? requestedIds : idsFrom(req, "ids");
  if (!ids.length) return { changed: 0, state: "已撤回" };
  const measureType = requestedType;
  const allCollections = [
    { type: "billmeasure", rows: engine.db.measures, key: "measureId" },
    { type: "meterialdiasmeasure", rows: engine.db.materialAdjustments, key: "diasId" },
    { type: "meterialinmeasure", rows: engine.db.materialArrivals, key: "arrivalId" },
    { type: "manualmeasure", rows: engine.db.manualMeasures, key: "manualId" },
    { type: "varyapplication", rows: engine.db.variations, key: "varyId" },
    { type: "engineeringcontactbill", rows: engine.db.contactBills, key: "contactId" }
  ];
  const collections = measureType
    ? allCollections.filter((item) => item.type === measureType)
    : allCollections;
  let changed = 0;
  collections.forEach(({ rows, key }) => {
    rows.forEach((row) => {
      if (ids.includes(Number(row[key] || row.id))) {
        row.states = "已撤回";
        row.measureState = 0;
        row.states = "已退回";
        addWorkflowLog({
          module: workflowModuleFromIdField(key),
          businessId: Number(row[key] || row.id || 0),
          businessNo: workflowLabel(row, key),
          action: "退回",
          result: "已退回",
          remark: req.body.returnReason || req.query.returnReason || ""
        });
        changed += 1;
      }
    });
  });
  return { changed, state: "已退回" };
}

function documentDetailHtml() {
  return simpleTableHtml("资料明细", [
    { title: "资料名称", field: "title" },
    { title: "资料类型", field: "type" },
    { title: "文件数", field: "fileCount" },
    { title: "创建时间", field: "createDate" }
  ], engine.documentRows());
}

function workflowTrackHtml(title = "流程追踪", req = null) {
  const logs = workflowLogsFor(req || { body: {}, query: {}, params: {} }, title);
  const rows = logs.length ? logs.map((log) => ({
    ...log,
    businessNo: cleanWorkflowText(log.businessNo, "-"),
    step: cleanWorkflowText(log.step, "已处理"),
    result: cleanWorkflowText(log.result, "已处理"),
    remark: cleanWorkflowText(log.remark, "")
  })) : [
    { step: "施工单位申报", userName: "ys1", result: "已提交", time: "2026-02-25", remark: "本地复刻流程记录" },
    { step: "监理审核", userName: "监理工程师", result: "审核中", time: "2026-02-26", remark: "等待确认" },
    { step: "业主审批", userName: "工程科", result: "待处理", time: "", remark: "" }
  ];
  return simpleTableHtml(title, [
    { title: "单据编号", field: "businessNo" },
    { title: "节点", field: "step" },
    { title: "处理人", field: "userName" },
    { title: "处理结果", field: "result" },
    { title: "处理时间", field: "time" },
    { title: "意见", field: "remark" }
  ], rows);
}

function workflowDashboardRows() {
  const configs = [
    { module: "billmeasure", label: "清单计量", rows: engine.measureRows(), idField: "measureId", noField: "measureNo", titleField: "position", moneyField: "measureMoney", trackUrl: "/bill_measure/track_bill_measure_page", adjustUrl: "/bill_measure/adjust_page", returnUrl: "/bill_measure/return_order_page" },
    { module: "meterialdiasmeasure", label: "材料补差", rows: engine.materialDiasRows(), idField: "diasId", noField: "measureNo", titleField: "materialName", moneyField: "adjustMoney", trackUrl: "/meterialdiasmeasure/track_meterial_dias_reasoure_page", adjustUrl: "/meterialdiasmeasure/adjust_page", returnUrl: "/meterialdiasmeasure/return_order_page" },
    { module: "meterialinmeasure", label: "材料到场", rows: engine.materialArrivalRows(), idField: "arrivalId", noField: "measureNo", titleField: "materialName", moneyField: "money", trackUrl: "/meterialInMeasure/record_page", adjustUrl: "/meterialInMeasure/adjust_page", returnUrl: "/meterialInMeasure/return_order_page" },
    { module: "manualmeasure", label: "手动计量", rows: engine.manualMeasureRows(), idField: "manualId", noField: "measureNo", titleField: "billName", moneyField: "measureMoney", trackUrl: "/manualMeasure/record_page", adjustUrl: "/manualMeasure/adjust_page", returnUrl: "/manualMeasure/return_order_page" },
    { module: "varyapplication", label: "工程变更", rows: engine.variationRows(), idField: "varyId", noField: "varyNo", titleField: "varyReason", moneyField: "varyMoney", trackUrl: "/vary_measure/track_page", adjustUrl: "/vary_measure/adjust_page", returnUrl: "/vary_measure/return_order_page" },
    { module: "engineeringcontactbill", label: "工程联系单", rows: engine.db.contactBills || [], idField: "contactId", noField: "contactNo", titleField: "title", moneyField: "", trackUrl: "/engineering_contact_bill/track_engineering_contact_bill_page", adjustUrl: "/engineering_contact_bill/edit_page", returnUrl: "/engineering_contact_bill/return_order_page" }
  ];
  return configs.flatMap((config) => config.rows.map((row) => {
    const id = Number(row[config.idField] || row.id || 0);
    const states = cleanBusinessText(row.states || row.state || "", "待处理");
    const title = cleanBusinessText(row[config.titleField] || row.billName || row.materialName || row.contactContent || row.varyContent || config.label, config.label);
    const businessNo = cleanBusinessText(row[config.noField] || row.skillNo || row.meetingNo || String(id), String(id));
    const sectionName = cleanBusinessText(row.sectionName || (row.sysSection && row.sysSection.sectionName) || "", "");
    const money = config.moneyField ? Number(row[config.moneyField] || 0) : 0;
    return {
      ...row,
      workflowModule: config.module,
      moduleLabel: config.label,
      workflowIdField: config.idField,
      workflowId: id,
      businessNo,
      title,
      sectionName,
      states,
      money,
      updateDate: row.updateDate || row.measureDate || row.createDate || row.meetingDate || today(),
      trackHref: `${config.trackUrl}?measureType=${config.module}&ids=${id}&businessId=${id}`,
      adjustHref: `${config.adjustUrl}?measureType=${config.module}&ids=${id}&businessId=${id}`,
      returnHref: `${config.returnUrl}?measureType=${config.module}&ids=${id}&businessId=${id}`,
      smsHref: `/workflow/isSendSMSpage?businessType=${config.module}&businessId=${id}`
    };
  }));
}

function workflowDashboardHtml(req) {
  const moduleFilter = normalizeWorkflowType(req.query.module || req.body.module || "");
  const stateFilter = String(req.query.state || req.body.state || "");
  let rows = workflowDashboardRows();
  if (moduleFilter) rows = rows.filter((row) => row.workflowModule === moduleFilter);
  if (stateFilter) rows = rows.filter((row) => String(row.states || "").includes(stateFilter));
  const allRows = workflowDashboardRows();
  const pendingRows = allRows.filter((row) => /待|处理中|审核中|上报/.test(row.states || ""));
  const approvedRows = allRows.filter((row) => /已审核|已更新|已调整/.test(row.states || ""));
  const returnedRows = allRows.filter((row) => /退回|撤回/.test(row.states || ""));
  const archivedRows = allRows.filter((row) => /归档/.test(row.states || ""));
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.money || 0), 0);
  const moduleOptions = [
    ["", "全部业务"],
    ["billmeasure", "清单计量"],
    ["meterialdiasmeasure", "材料补差"],
    ["meterialinmeasure", "材料到场"],
    ["manualmeasure", "手动计量"],
    ["varyapplication", "工程变更"],
    ["engineeringcontactbill", "工程联系单"]
  ].map(([value, label]) => `<option value="${value}"${value === moduleFilter ? " selected" : ""}>${label}</option>`).join("");
  const stateOptions = [
    ["", "全部状态"],
    ["待", "待处理"],
    ["已审核", "已审核"],
    ["已调整", "已调整"],
    ["退回", "已退回"],
    ["归档", "已归档"]
  ].map(([value, label]) => `<option value="${value}"${value === stateFilter ? " selected" : ""}>${label}</option>`).join("");
  const cards = [
    ["业务单据", String(allRows.length), "全部流程业务"],
    ["待处理", String(pendingRows.length), "待上报/审核/处理"],
    ["已审核", String(approvedRows.length), "审核或调整完成"],
    ["已退回", String(returnedRows.length), "退回补充资料"],
    ["已归档", String(archivedRows.length), "归档完成"],
    ["当前金额", moneyText(totalMoney), "当前筛选金额合计"]
  ].map(([label, value, hint]) => `
    <div class="workflow-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const body = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.moduleLabel)}</td>
      <td>${htmlEscape(row.businessNo)}</td>
      <td class="left">${htmlEscape(row.title)}</td>
      <td>${htmlEscape(row.sectionName)}</td>
      <td>${moneyText(row.money)}</td>
      <td>${htmlEscape(row.states)}</td>
      <td>${htmlEscape(row.updateDate)}</td>
      <td>
        <a href="${row.trackHref}">追踪</a>
        <a href="${row.adjustHref}">调整</a>
        <a href="${row.returnHref}">退回</a>
        <a href="${row.smsHref}">通知</a>
      </td>
    </tr>`).join("");
  const latestLogs = ensureWorkflowLogs().slice(-12).reverse().map((log) => `
    <tr>
      <td>${htmlEscape(cleanBusinessText(log.businessNo, "-"))}</td>
      <td>${htmlEscape(cleanBusinessText(log.module, ""))}</td>
      <td>${htmlEscape(cleanBusinessText(log.step, ""))}</td>
      <td>${htmlEscape(cleanBusinessText(log.result, ""))}</td>
      <td>${htmlEscape(log.userName || "")}</td>
      <td>${htmlEscape(log.time || "")}</td>
      <td class="left">${htmlEscape(cleanBusinessText(log.remark, ""))}</td>
    </tr>`).join("");
  const moduleSummary = Object.values(allRows.reduce((acc, row) => {
    acc[row.workflowModule] = acc[row.workflowModule] || { label: row.moduleLabel, count: 0, money: 0, pending: 0 };
    acc[row.workflowModule].count += 1;
    acc[row.workflowModule].money += Number(row.money || 0);
    if (/待|处理中|审核中|上报/.test(row.states || "")) acc[row.workflowModule].pending += 1;
    return acc;
  }, {})).map((row) => `
    <tr><td>${htmlEscape(row.label)}</td><td>${row.count}</td><td>${row.pending}</td><td>${moneyText(row.money)}</td></tr>`).join("");
  return `
    <div class="layui-fluid workflow-dashboard">
      <style>
        .workflow-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .workflow-shell { max-width:1380px; margin:0 auto; }
        .workflow-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .workflow-head h2 { margin:0; font-size:22px; font-weight:600; }
        .workflow-head p { margin:6px 0 0; color:#64748b; }
        .workflow-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .workflow-actions select { height:32px; min-width:150px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .workflow-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .workflow-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .workflow-card span, .workflow-card small { display:block; color:#64748b; font-size:12px; }
        .workflow-card strong { display:block; margin:8px 0; color:#7c3aed; font-size:20px; }
        .workflow-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .workflow-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .workflow-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .workflow-panel table { margin:0; min-width:760px; }
        .workflow-wide { grid-column:1 / -1; }
        .workflow-panel td a { margin-right:8px; }
        .left { text-align:left; }
        .workflow-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .workflow-cards { grid-template-columns:repeat(3, 1fr); } .workflow-grid { grid-template-columns:1fr; } .workflow-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .workflow-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="workflow-shell">
        <div class="workflow-head">
          <div>
            <h2>流程审核工作台</h2>
            <p>集中查看清单计量、材料补差、材料到场、手动计量、工程变更和工程联系单的审核、退回、调整、通知与归档状态。</p>
          </div>
          <div class="workflow-actions">
            <select onchange="location.href='/workflow/dashboard_page?module='+this.value+'&state=${encodeURIComponent(stateFilter)}'">${moduleOptions}</select>
            <select onchange="location.href='/workflow/dashboard_page?module=${encodeURIComponent(moduleFilter)}&state='+this.value">${stateOptions}</select>
            <a class="layui-btn layui-btn-sm" href="/workflow/isSendSMSpage">发送通知</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/workflow/sms_record_page">通知记录</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/workflow/see_process_img">流程图</a>
          </div>
        </div>
        <div class="workflow-cards">${cards}</div>
        <div class="workflow-grid">
          <div class="workflow-panel">
            <h3>业务类型汇总</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>业务类型</th><th>单据数</th><th>待处理</th><th>金额</th></tr></thead>
              <tbody>${moduleSummary || `<tr><td colspan="4" class="workflow-empty">暂无流程业务</td></tr>`}</tbody>
            </table>
          </div>
          <div class="workflow-panel">
            <h3>最近处理记录</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>单据编号</th><th>模块</th><th>节点</th><th>结果</th><th>处理人</th><th>时间</th><th>意见</th></tr></thead>
              <tbody>${latestLogs || `<tr><td colspan="7" class="workflow-empty">暂无流程记录</td></tr>`}</tbody>
            </table>
          </div>
          <div class="workflow-panel workflow-wide">
            <h3>流程业务清单</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>业务类型</th><th>单据编号</th><th>业务名称</th><th>合同段</th><th>金额</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
              <tbody>${body || `<tr><td colspan="8" class="workflow-empty">暂无业务单据</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function workflowSvg() {
  const steps = [
    { x: 90, title: "施工单位申报", sub: "ys1 已提交" },
    { x: 310, title: "监理审核", sub: "审核中" },
    { x: 530, title: "业主审批", sub: "待处理" }
  ];
  const nodes = steps.map((step, index) => `
    <g>
      <circle cx="${step.x}" cy="70" r="34" fill="${index === 0 ? "#16a34a" : index === 1 ? "#2563eb" : "#94a3b8"}"/>
      <text x="${step.x}" y="66" text-anchor="middle" fill="#fff" font-size="13" font-family="Microsoft YaHei, Arial">${index + 1}</text>
      <text x="${step.x}" y="122" text-anchor="middle" fill="#111827" font-size="14" font-family="Microsoft YaHei, Arial">${step.title}</text>
      <text x="${step.x}" y="146" text-anchor="middle" fill="#64748b" font-size="12" font-family="Microsoft YaHei, Arial">${step.sub}</text>
    </g>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180" viewBox="0 0 640 180">
  <rect width="640" height="180" fill="#f8fafc"/>
  <line x1="124" y1="70" x2="276" y2="70" stroke="#cbd5e1" stroke-width="5"/>
  <line x1="344" y1="70" x2="496" y2="70" stroke="#cbd5e1" stroke-width="5"/>
  ${nodes}
</svg>`;
}

function projectInformationWordHtml(req) {
  const hangId = Number(req.query.hangId || req.body.hangId || 0);
  const row = projectInformationHangRows().find((item) => Number(item.hangId) === hangId) || projectInformationHangRows()[0] || {};
  const title = row.projectInformationParam ? row.projectInformationParam.dataName : row.title || "资料预览";
  const mode = req.query.type === "edit" ? "编辑" : "查看";
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <link rel="stylesheet" href="/assets/layui/css/layui.css">
      <style>
        body { background:#eef2f7; padding:24px; font-family:"Microsoft YaHei", Arial, sans-serif; }
        .doc { max-width:840px; min-height:900px; margin:0 auto; background:#fff; padding:56px 64px; box-shadow:0 8px 30px rgba(15,23,42,.12); }
        h1 { text-align:center; font-size:26px; margin:0 0 32px; }
        table { width:100%; border-collapse:collapse; margin-top:18px; }
        td, th { border:1px solid #d8dee9; padding:12px; font-size:14px; }
        .muted { color:#64748b; text-align:center; margin-bottom:28px; }
      </style>
    </head>
    <body>
      <div class="doc">
        <h1>${title}</h1>
        <div class="muted">本地复刻资料${mode}页</div>
        <table>
          <tr><th>文件编号</th><td>${row.projectInformationParam ? row.projectInformationParam.dataNo : ""}</td></tr>
          <tr><th>所属标段</th><td>${row.projectInformationNode && row.projectInformationNode.sysSection ? row.projectInformationNode.sysSection.sectionName : ""}</td></tr>
          <tr><th>资料类型</th><td>${row.type || ""}</td></tr>
          <tr><th>填写时间</th><td>${row.hangDate || ""}</td></tr>
          <tr><th>填报人</th><td>${row.sysUser ? row.sysUser.userName : "ys1"}</td></tr>
          <tr><th>备注</th><td>${row.remark || "本地资料预览，可用于替代原系统 PageOffice 打开效果。"}</td></tr>
        </table>
      </div>
    </body>
    </html>`;
}

function reportPreviewHtml(title = "计量支付报表预览") {
  const summary = engine.contractSummary();
  return `
    <div class="layui-fluid" style="padding:12px;">
      <div class="layui-card">
        <div class="layui-card-header">${title}</div>
        <div class="layui-card-body">
          <table class="layui-table" lay-size="sm">
            <tbody>
              <tr><th>合同金额</th><td>${summary.contractSumMoney}</td><th>变更金额</th><td>${summary.varyMoney}</td></tr>
              <tr><th>最终金额</th><td>${summary.finalMoney}</td><th>累计支付</th><td>${summary.payableMoney}</td></tr>
              <tr><th>材料补差</th><td>${summary.materialDiasMoney}</td><th>支付比例</th><td>${summary.payRate}%</td></tr>
            </tbody>
          </table>
          ${reportDetailHtml()}
        </div>
      </div>
    </div>`;
}

function reportExportProjectPageHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const rows = reportPaymentRows(sectionId ? [sectionId] : []);
  const selectedIds = rows.map((row) => row.sectionId).join(",");
  const reportTree = rows.map((row) => `
    <li>
      <label>
        <input type="checkbox" checked value="${row.sectionId}">
        <span>${htmlEscape(row.sectionName || "")}</span>
        <small>${htmlEscape(row.contractNo || "")}</small>
      </label>
    </li>`).join("");
  const exportItems = [
    ["pdf", "img/reportSign/exportReportIcon/pdf.png", "导出PDF格式报表", "生成打印预览 HTML，保持原站 PDF 预览流程"],
    ["word", "img/reportSign/exportReportIcon/word.png", "导出WORD格式报表", "生成 Word 兼容文档，便于编辑归档"],
    ["excel", "img/reportSign/exportReportIcon/excel.png", "导出EXCEL格式报表", "导出计量支付台账 CSV/Excel 数据"],
    ["all", "img/reportSign/exportReportIcon/print.png", "一键打印", "打包 Excel、打印预览和 Word 文件"]
  ].map(([type, icon, title, hint]) => `
    <a class="export-item ecportClass" data-type="${type}" href="/reportManager/exportReport?rpIds=${encodeURIComponent(selectedIds)}&exportType=${type}">
      <img src="/${icon}" alt="${htmlEscape(title)}">
      <span>${htmlEscape(title)}</span>
      <small>${htmlEscape(hint)}</small>
    </a>`).join("");
  return `
    <div class="layui-fluid report-export-page">
      <style>
        .report-export-page { padding:16px; background:#f5f7fb; color:#172033; }
        .export-shell { display:grid; grid-template-columns:320px minmax(360px, 1fr); gap:14px; max-width:1180px; margin:0 auto; }
        .export-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; }
        .export-panel h2, .export-panel h3 { margin:0 0 10px; font-weight:600; }
        .export-panel h2 { font-size:20px; }
        .export-panel h3 { font-size:16px; }
        .export-tree { list-style:none; padding:0; margin:0; }
        .export-tree li { border:1px solid #e2e8f0; border-radius:5px; margin-bottom:8px; }
        .export-tree label { display:flex; align-items:center; gap:8px; padding:9px 10px; cursor:pointer; }
        .export-tree span { font-weight:600; }
        .export-tree small { margin-left:auto; color:#64748b; }
        .export-options { display:grid; grid-template-columns:repeat(2, minmax(210px, 1fr)); gap:12px; }
        .export-item { display:grid; grid-template-columns:48px 1fr; gap:10px; align-items:center; min-height:86px; border:1px solid #dbe4f0; border-radius:6px; padding:14px; color:#172033; background:#fff; }
        .export-item:hover { border-color:#3c8dbc; box-shadow:0 6px 16px rgba(15, 23, 42, .08); text-decoration:none; }
        .export-item img { width:42px; height:42px; object-fit:contain; }
        .export-item span, .export-item small { display:block; }
        .export-item span { font-size:16px; font-weight:600; }
        .export-item small { margin-top:4px; color:#64748b; line-height:1.45; }
        .export-actions { margin-top:12px; display:flex; flex-wrap:wrap; gap:8px; }
        @media (max-width:820px) { .export-shell { grid-template-columns:1fr; } .export-options { grid-template-columns:1fr; } }
      </style>
      <div class="export-shell">
        <div class="export-panel">
          <h2>计量报表导出页面</h2>
          <h3>报表目录</h3>
          <ul class="export-tree">${reportTree || `<li><label><span>暂无可导出报表</span></label></li>`}</ul>
          <div class="export-actions">
            <a class="layui-btn layui-btn-sm" href="/reportManager/dashboard_page${sectionId ? `?sectionId=${sectionId}` : ""}">返回报表中心</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/reportManager/reportViewSecurity?reportCode=MEASUREREOPORT&rpId=${encodeURIComponent(selectedIds)}">预览报表</a>
          </div>
        </div>
        <div class="export-panel">
          <h2>批量导出</h2>
          <div class="export-options">${exportItems}</div>
        </div>
      </div>
    </div>`;
}

function reportManagerDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const rows = reportPaymentRows(sectionId ? [sectionId] : []);
  const summary = rows.reduce((acc, row) => {
    acc.contractMoney += Number(row.contractMoney || 0);
    acc.finalMoney += Number(row.finalMoney || 0);
    acc.measureMoney += Number(row.billMeasureMoney || row.measureMoney || row.currentPayMoney || 0);
    acc.materialDiasMoney += Number(row.materialDiasMoney || 0);
    acc.materialArrivalMoney += Number(row.materialArrivalMoney || 0);
    acc.manualMoney += Number(row.manualMoney || 0);
    acc.totalPayMoney += Number(row.totalPayMoney || 0);
    return acc;
  }, { contractMoney: 0, finalMoney: 0, measureMoney: 0, materialDiasMoney: 0, materialArrivalMoney: 0, manualMoney: 0, totalPayMoney: 0 });
  summary.payRate = summary.finalMoney ? (summary.totalPayMoney / summary.finalMoney) * 100 : 0;
  const selectedIds = rows.map((row) => row.sectionId).join(",");
  const sectionOptionsHtml = [`<option value="0"${sectionId ? "" : " selected"}>全部合同段</option>`]
    .concat(engine.db.sections.map((section) => {
      const selected = Number(section.sectionId || section.id) === sectionId ? " selected" : "";
      return `<option value="${section.sectionId || section.id}"${selected}>${htmlEscape(section.sectionName || "")}</option>`;
    })).join("");
  const cards = [
    ["合同金额", moneyText(summary.contractMoney), "合同清单金额合计"],
    ["最终金额", moneyText(summary.finalMoney), "含工程变更后的金额"],
    ["清单计量", moneyText(summary.measureMoney), "已审核计量支付"],
    ["材料补差", moneyText(summary.materialDiasMoney), "材料价差进入应付"],
    ["材料到场", moneyText(summary.materialArrivalMoney), "到场跟踪不计入应付"],
    ["手动计量", moneyText(summary.manualMoney), "现场签证/零星工程"],
    ["累计支付", moneyText(summary.totalPayMoney), `支付比例 ${percentText(summary.payRate)}`]
  ].map(([label, value, hint]) => `
    <div class="report-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const treeRows = rows.map((row) => `
    <li>
      <a href="/reportManager/reportViewSecurity?reportCode=MEASUREREOPORT&rpId=${row.sectionId}">
        <strong>${htmlEscape(row.sectionName || "")}</strong>
        <span>${htmlEscape(row.contractNo || "")}</span>
      </a>
    </li>`).join("");
  const tableRows = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.contractNo || "")}</td>
      <td>${moneyText(row.contractMoney)}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${moneyText(row.billMeasureMoney || row.measureMoney || row.currentPayMoney)}</td>
      <td>${moneyText(row.materialDiasMoney)}</td>
      <td>${moneyText(row.materialArrivalMoney)}</td>
      <td>${moneyText(row.manualMoney)}</td>
      <td>${moneyText(row.totalPayMoney)}</td>
      <td>${percentText(row.payRate)}</td>
      <td><a href="/reportManager/reportPreviewSecond?sectionId=${row.sectionId}">二级报表</a></td>
    </tr>`).join("");
  const billRows = engine.billLedgerRows()
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId)
    .slice(0, 12)
    .map((row) => `
      <tr>
        <td>${htmlEscape(row.sectionName || "")}</td>
        <td>${htmlEscape(row.billNo || "")}</td>
        <td class="left">${htmlEscape(row.billName || "")}</td>
        <td>${moneyText(row.measureMoney)}</td>
        <td>${moneyText(row.remainMoney)}</td>
        <td>${percentText(row.measureRate)}</td>
      </tr>`).join("");
  return `
    <div class="layui-fluid report-manager-dashboard">
      <style>
        .report-manager-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .report-shell { max-width:1380px; margin:0 auto; }
        .report-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .report-head h2 { margin:0; font-size:22px; font-weight:600; }
        .report-head p { margin:6px 0 0; color:#64748b; }
        .report-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:flex-end; }
        .report-actions select { height:32px; min-width:180px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .report-cards { display:grid; grid-template-columns:repeat(7, minmax(120px, 1fr)); gap:10px; margin-bottom:12px; }
        .report-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .report-card span, .report-card small { display:block; color:#64748b; font-size:12px; }
        .report-card strong { display:block; margin:8px 0; color:#155e75; font-size:20px; }
        .report-grid { display:grid; grid-template-columns:260px 1fr; gap:12px; }
        .report-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .report-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .report-tree { list-style:none; padding:0; margin:0; }
        .report-tree li { border:1px solid #e2e8f0; border-radius:5px; margin-bottom:8px; }
        .report-tree a { display:block; padding:10px 11px; color:#172033; }
        .report-tree strong, .report-tree span { display:block; }
        .report-tree span { margin-top:4px; color:#64748b; font-size:12px; }
        .report-panel table { margin:0; min-width:920px; }
        .report-ledger { grid-column:1 / -1; }
        .left { text-align:left; }
        .report-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .report-cards { grid-template-columns:repeat(3, 1fr); } .report-grid { grid-template-columns:1fr; } .report-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .report-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="report-shell">
        <div class="report-head">
          <div>
            <h2>计量支付报表中心</h2>
            <p>汇总合同段支付、二级计量报表、清单台账和导出打印，形成计量支付闭环。</p>
          </div>
          <div class="report-actions">
            <select onchange="location.href='/reportManager/dashboard_page?sectionId='+this.value">${sectionOptionsHtml}</select>
            <a class="layui-btn layui-btn-sm" href="/payment/jl_report_page${sectionId ? `?sectionId=${sectionId}` : ""}">JL报表核对</a>
            <a class="layui-btn layui-btn-sm" href="/reportManager/reportViewSecurity?reportCode=MEASUREREOPORT&rpId=${encodeURIComponent(selectedIds)}">打印报表</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/reportManager/exportReport?rpIds=${encodeURIComponent(selectedIds)}&exportType=excel">导出Excel</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/reportManager/exportReport?rpIds=${encodeURIComponent(selectedIds)}&exportType=pdf">导出PDF</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/reportManager/exportReport?rpIds=${encodeURIComponent(selectedIds)}&exportType=word">导出WORD</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/reportManager/exportReport?rpIds=${encodeURIComponent(selectedIds)}&exportType=all">一键导出</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/reportManager/export_report_project_page/0?bdCode=MEASUREREOPORT${sectionId ? `&sectionId=${sectionId}` : ""}">批量导出</a>
          </div>
        </div>
        <div class="report-cards">${cards}</div>
        <div class="report-grid">
          <div class="report-panel">
            <h3>报表目录</h3>
            <ul class="report-tree">
              <li><a href="/reportManager/reportViewSecurity?reportCode=MEASUREREOPORT&rpId=${encodeURIComponent(selectedIds)}"><strong>计量支付报表</strong><span>全部合同段汇总</span></a></li>
              ${treeRows}
            </ul>
          </div>
          <div class="report-panel">
            <h3>合同段支付汇总</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>合同段</th><th>合同编号</th><th>合同金额</th><th>最终金额</th><th>清单计量</th><th>材料补差</th><th>材料到场</th><th>手动计量</th><th>累计支付</th><th>支付比例</th><th>操作</th></tr></thead>
              <tbody>${tableRows || `<tr><td colspan="11" class="report-empty">暂无报表数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="report-panel report-ledger">
            <h3>清单支付台账</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>合同段</th><th>清单编号</th><th>清单名称</th><th>累计计量</th><th>剩余金额</th><th>计量比例</th></tr></thead>
              <tbody>${billRows || `<tr><td colspan="6" class="report-empty">暂无清单台账</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function jlPaymentReportPageHtml(req) {
  const requestedPeriodId = Number(req.query.periodId || req.body.periodId || req.query.gatherId || req.body.gatherId || 0);
  const latestPeriod = (engine.db.measurePeriods || [])[engine.db.measurePeriods.length - 1] || {};
  const periodId = requestedPeriodId || Number(latestPeriod.gatherId || latestPeriod.id || 0);
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const certificate = engine.paymentCertificateForPeriod(periodId, { sectionId });
  const validation = engine.jlPaymentValidation({ periodId, sectionId });
  const lifecycle = engine.jlFormLifecycle({ periodId, sectionId });
  const rules = engine.calculationRules();
  const sectionOptionsHtml = coreSectionOptions(sectionId, "全部合同段");
  const periodOptionsHtml = corePeriodOptions(periodId, "选择计量期");
  const cards = coreCardsHtml([
    ["JL104实际支付", moneyText(certificate.finalPayment), "本期最终支付金额"],
    ["小计", moneyText(certificate.subtotal), "清单计量 + 手动/暂定"],
    ["价格调整", moneyText(certificate.priceAdjustment), "JL108材料调差"],
    ["材料设备垫付款", moneyText(certificate.materialAdvanceMoney), `JL109 × ${rules.materialAdvanceRate}%`],
    ["扣回材料垫付款", moneyText(certificate.materialDeductionMoney), "JL110本期扣回"],
    ["保留金", moneyText(certificate.retentionMoney), `${rules.retentionRate}% × 小计`],
    ["扣回动员预付款", moneyText(certificate.mobilizationDeductionMoney), "JL111阈值扣回"]
  ]);
  const chapterRows = certificate.chapters.map((row) => `
    <tr>
      <td>${htmlEscape(row.chapter)}</td>
      <td class="left">${htmlEscape(row.chapterName)}</td>
      <td>${moneyText(row.contractAmount)}</td>
      <td>${moneyText(row.adjustedAmount)}</td>
      <td>${moneyText(row.previousAmount)}</td>
      <td>${moneyText(row.currentAmount)}</td>
      <td>${moneyText(row.cumulativeAmount)}</td>
    </tr>`).join("");
  const jl113Rows = certificate.jl113Rows.slice(0, 80).map((row) => `
    <tr>
      <td>${htmlEscape(row.itemCode || row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.itemName || row.billName || "")}</td>
      <td>${htmlEscape(row.measureRefs || "")}</td>
      <td>${htmlEscape(row.unit || row.measureUnit || "")}</td>
      <td>${moneyText(row.price)}</td>
      <td>${htmlEscape(row.quantity)}</td>
      <td>${moneyText(row.amount)}</td>
    </tr>`).join("");
  const jl105Rows = certificate.jl105Rows.slice(0, 120).map((row) => `
    <tr>
      <td>${htmlEscape(row.itemCode || row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.itemName || row.billName || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${htmlEscape(row.contractQuantity)}</td>
      <td>${moneyText(row.contractPrice)}</td>
      <td>${moneyText(row.contractAmount)}</td>
      <td>${htmlEscape(row.previousQuantity)}</td>
      <td>${moneyText(row.previousAmount)}</td>
      <td>${htmlEscape(row.currentQuantity)}</td>
      <td>${moneyText(row.currentAmount)}</td>
      <td>${htmlEscape(row.cumulativeQuantity)}</td>
      <td>${moneyText(row.cumulativeAmount)}</td>
      <td>${percentText(row.progressPct)}</td>
    </tr>`).join("");
  const materialRows = engine.materialArrivalRows()
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId)
    .filter((row) => {
      if (!periodId) return true;
      const target = (engine.db.measurePeriods || []).find((period) => Number(period.gatherId || period.id) === Number(periodId));
      if (!target) return true;
      const rowPeriodId = Number(row.periodId || row.gatherId || 0);
      if (rowPeriodId) return rowPeriodId === Number(periodId);
      const date = String(row.measureDate || "").slice(0, 10);
      const start = String(target.startDate || target.gatherStartDate || "").slice(0, 10);
      const end = String(target.endDate || target.gatherEndDate || "").slice(0, 10);
      if (start && date && date < start) return false;
      if (end && date && date > end) return false;
      return true;
    })
    .slice(0, 60)
    .map((row) => `
      <tr>
        <td>${htmlEscape(row.measureNo || row.certifyNo || "")}</td>
        <td class="left">${htmlEscape(row.materialName || "")}</td>
        <td>${htmlEscape(row.unit || row.measureUnit || "")}</td>
        <td>${htmlEscape(row.measureNum || row.quantity || 0)}</td>
        <td>${moneyText(row.price || row.measurePrice)}</td>
        <td>${moneyText(row.money)}</td>
        <td>${moneyText(row.advanceMoney)}</td>
      </tr>`)
    .join("");
  const formulaLines = [
    `本期实际支付 = 小计 + 价格调整 + 材料设备垫付款 - 扣回材料设备垫付款 - 保留金 - 扣回动员预付款`,
    `材料设备垫付款 = 材料到场金额 × ${rules.materialAdvanceRate}%`,
    `保留金 = 小计 × ${rules.retentionRate}%`,
    `动员预付款扣回：累计小计达到合同价 ${rules.mobilizationDeductionStartRate}% 后开始，${rules.mobilizationDeductionEndRate}% 时扣完`
  ].map((line) => `<li>${htmlEscape(line)}</li>`).join("");
  const referenceRows = [
    ["第12期样表", "实际支付", 7699376, "JL104：5,094,708 + 4,529,717 - 1,415,578 - 509,471"],
    ["第12期样表", "材料设备垫付款", 4529717, "JL109：7,549,523 × 60%"],
    ["第12期样表", "扣回动员预付款", 0, "JL111：累计小计151,301,505未达30%门槛"],
    ["第14期样表", "扣回动员预付款", 621281, "JL111：(174,060,235 - 170,953,828) / 569,846,095 × 2 × 56,984,610"],
    ["第14期样表", "实际支付", 24024989, "JL104：含价格调整2,139,953、动员扣回621,281"]
  ].map(([period, item, value, basis]) => `
    <tr>
      <td>${htmlEscape(period)}</td>
      <td>${htmlEscape(item)}</td>
      <td>${moneyText(value)}</td>
      <td class="left">${htmlEscape(basis)}</td>
    </tr>`).join("");
  const validationCards = coreCardsHtml([
    ["校验结论", validation.ok ? "通过" : "需复核", `失败 ${validation.summary.failedChecks} / ${validation.summary.totalChecks}`],
    ["横向校验", `${validation.summary.groups["横向校验"]?.passed || 0}/${validation.summary.groups["横向校验"]?.total || 0}`, "同表内金额/数量/支付平衡"],
    ["纵向校验", `${validation.summary.groups["纵向校验"]?.passed || 0}/${validation.summary.groups["纵向校验"]?.total || 0}`, "JL114→JL113→JL105→JL104"],
    ["期次校验", `${validation.summary.groups["期次校验"]?.passed || 0}/${validation.summary.groups["期次校验"]?.total || 0}`, "上期末与本期初连续"],
    ["样表校验", `${validation.summary.groups["样表校验"]?.passed || 0}/${validation.summary.groups["样表校验"]?.total || 0}`, "第12/14期PDF基准"]
  ]);
  const validationRows = validation.failed.length
    ? validation.failed.slice(0, 80).map((row) => `
      <tr>
        <td>${htmlEscape(row.group || "")}</td>
        <td class="left">${htmlEscape(row.name || "")}</td>
        <td>${moneyText(row.expected)}</td>
        <td>${moneyText(row.actual)}</td>
        <td>${moneyText(row.difference)}</td>
        <td class="left">${htmlEscape(row.detail || "")}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="core-empty">当前期横向、纵向、期次和样表基准校验全部通过</td></tr>`;
  const lifecycleRows = lifecycle.forms.map((row) => `
    <tr>
      <td>${htmlEscape(row.expected ? "应出现" : "可不出现")}</td>
      <td>${htmlEscape(row.code)}</td>
      <td class="left">${htmlEscape(row.name)}</td>
      <td class="left">${htmlEscape(row.reason)}</td>
    </tr>`).join("");
  const lifecycleCards = coreCardsHtml([
    ["JL表单总数", String(lifecycle.summary.formCount), `本期应出现 ${lifecycle.summary.requiredCount}`],
    ["JL115规则", `1-${lifecycle.summary.lifecycleRules.jl115EndPeriod}期`, "开工动员预付款支付证书"],
    ["调差月份", lifecycle.summary.lifecycleRules.jlPriceAdjustmentMonths.join(","), "JL108/JL108-1/JL116"],
    ["动员扣回区间", `${lifecycle.summary.lifecycleRules.mobilizationDeductionStartRate}%-${lifecycle.summary.lifecycleRules.mobilizationDeductionEndRate}%`, "JL111出现条件"]
  ]);
  return `
    <div class="core-page jl-report-page" data-core-page="jl-report-page">
      ${corePageStyle("#155e75")}
      <style>
        .jl-report-page .core-grid { grid-template-columns:1fr; }
        .jl-report-page .core-panel table { min-width:980px; }
        .jl-report-page .left { text-align:left; }
        .jl-report-page .formula-list { margin:0; padding-left:18px; color:#334155; line-height:1.8; }
        .jl-report-page .quick-links { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
        .jl-report-page .subtle { color:#64748b; font-size:12px; }
      </style>
      <div class="core-shell">
        <div class="core-head">
          <div>
            <h2>JL计量支付报表核对</h2>
            <p>按需求文档的数据流核对 JL114 → JL113 → JL105 → JL104，并联动 JL109/JL110/JL111 财务扣付规则。</p>
          </div>
          <div class="core-tools">
            <select onchange="location.href='/payment/jl_report_page?periodId='+this.value+'&sectionId=${encodeURIComponent(sectionId || "")}'">${periodOptionsHtml}</select>
            <select onchange="location.href='/payment/jl_report_page?periodId=${encodeURIComponent(periodId || "")}&sectionId='+this.value">${sectionOptionsHtml}</select>
            <a class="layui-btn layui-btn-sm" href="/reportManager/dashboard_page${sectionId ? `?sectionId=${sectionId}` : ""}">报表中心</a>
            <a class="layui-btn layui-btn-sm" href="/api/payment/jl_lifecycle?periodId=${encodeURIComponent(periodId || "")}&sectionId=${encodeURIComponent(sectionId || "")}">生命周期JSON</a>
            <a class="layui-btn layui-btn-sm" href="/api/payment/jl_validation?periodId=${encodeURIComponent(periodId || "")}&sectionId=${encodeURIComponent(sectionId || "")}">校验JSON</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/api/payment/certificate?periodId=${encodeURIComponent(periodId || "")}&sectionId=${encodeURIComponent(sectionId || "")}">证书JSON</a>
          </div>
        </div>
        <div class="core-cards">${cards}</div>
        <div class="core-grid">
          <div class="core-panel">
            <h3>JL104 中期财务支付证书</h3>
            <ul class="formula-list">${formulaLines}</ul>
            <div class="quick-links">
              <a class="layui-btn layui-btn-xs" href="/bill_measure/page">录入JL114工程计量表</a>
              <a class="layui-btn layui-btn-xs" href="/meterialInMeasure/meterialInMeasureList">录入JL109材料到场</a>
              <a class="layui-btn layui-btn-xs" href="/meterialdiasmeasure/meterialdiasmeasurePage">录入JL108材料调差</a>
              <a class="layui-btn layui-btn-xs" href="/admin/calculation_rules_page">维护JL104扣付规则</a>
            </div>
          </div>
          <div class="core-panel">
            <h3>样表基准核对</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>期次</th><th>核对项</th><th>样表金额</th><th>计算依据</th></tr></thead>
              <tbody>${referenceRows}</tbody>
            </table>
          </div>
          <div class="core-panel">
            <h3>JL表单校验结果</h3>
            <div class="core-cards">${validationCards}</div>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>类型</th><th>校验项</th><th>应为</th><th>实际</th><th>差额</th><th>依据</th></tr></thead>
              <tbody>${validationRows}</tbody>
            </table>
          </div>
          <div class="core-panel">
            <h3>JL表单生命周期</h3>
            <div class="core-cards">${lifecycleCards}</div>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>状态</th><th>表号</th><th>名称</th><th>判断依据</th></tr></thead>
              <tbody>${lifecycleRows}</tbody>
            </table>
          </div>
          <div class="core-panel">
            <h3>JL104 章级汇总</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>章号</th><th>项目内容</th><th>合同金额</th><th>变更后金额</th><th>到上期末</th><th>本期完成</th><th>到本期末</th></tr></thead>
              <tbody>${chapterRows || `<tr><td colspan="7" class="core-empty">暂无章级汇总</td></tr>`}</tbody>
            </table>
          </div>
          <div class="core-panel">
            <h3>JL113 计量支付数量汇总表 <span class="subtle">按细目编号汇总本期JL114</span></h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>细目编号</th><th>细目名称</th><th>计量表编号</th><th>单位</th><th>单价</th><th>数量</th><th>金额</th></tr></thead>
              <tbody>${jl113Rows || `<tr><td colspan="7" class="core-empty">暂无本期计量明细</td></tr>`}</tbody>
            </table>
          </div>
          <div class="core-panel">
            <h3>JL105 清单中期财务支付报表 <span class="subtle">E=G+I，F=H+J，D=F/C</span></h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>细目编号</th><th>细目名称</th><th>单位</th><th>合同数量</th><th>单价</th><th>合同金额</th><th>上期数量</th><th>上期金额</th><th>本期数量</th><th>本期金额</th><th>累计数量</th><th>累计金额</th><th>进度</th></tr></thead>
              <tbody>${jl105Rows || `<tr><td colspan="13" class="core-empty">暂无清单支付台账</td></tr>`}</tbody>
            </table>
          </div>
          <div class="core-panel">
            <h3>JL109 材料到场预付</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>计量单号</th><th>材料名称</th><th>单位</th><th>数量</th><th>单价</th><th>到场金额</th><th>预付金额</th></tr></thead>
              <tbody>${materialRows || `<tr><td colspan="7" class="core-empty">暂无本期材料到场</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
      ${coreInteractionScript('[data-core-page="jl-report-page"]')}
    </div>`;
}

function secondPaymentReportHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const sections = engine.db.sections.filter((section) => !sectionId || Number(section.sectionId || section.id) === sectionId);
  const selectedSectionIds = new Set(sections.map((section) => Number(section.sectionId || section.id)));
  const bills = engine.billRows().filter((row) => !selectedSectionIds.size || selectedSectionIds.has(Number(row.sectionId || 0)));
  const reportRows = reportPaymentRows([...selectedSectionIds]);
  const materialRows = engine.materialDiasRows().filter((row) => !selectedSectionIds.size || selectedSectionIds.has(Number(row.sectionId || 0)));
  const manualRows = engine.manualMeasureRows().filter((row) => !selectedSectionIds.size || selectedSectionIds.has(Number(row.sectionId || 0)));
  const summary = reportRows.reduce((acc, row) => {
    acc.contractMoney += Number(row.contractMoney || 0);
    acc.finalMoney += Number(row.finalMoney || 0);
    acc.measureMoney += Number(row.measureMoney || 0);
    acc.materialDiasMoney += Number(row.materialDiasMoney || 0);
    acc.materialArrivalMoney += Number(row.materialArrivalMoney || 0);
    acc.manualMoney += Number(row.manualMoney || 0);
    acc.totalPayMoney += Number(row.totalPayMoney || 0);
    return acc;
  }, { contractMoney: 0, finalMoney: 0, measureMoney: 0, materialDiasMoney: 0, materialArrivalMoney: 0, manualMoney: 0, totalPayMoney: 0 });
  summary.payRate = summary.finalMoney ? (summary.totalPayMoney / summary.finalMoney) * 100 : 0;

  const sectionRows = reportRows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.contractNo || "")}</td>
      <td>${moneyText(row.contractMoney)}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${moneyText(row.measureMoney)}</td>
      <td>${moneyText(row.materialDiasMoney)}</td>
      <td>${moneyText(row.materialArrivalMoney)}</td>
      <td>${moneyText(row.manualMoney)}</td>
      <td>${moneyText(row.totalPayMoney)}</td>
      <td>${percentText(row.payRate)}</td>
    </tr>`).join("");
  const billRows = bills.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.contractNum || row.contractAmount || 0)}</td>
      <td>${moneyText(row.price || 0)}</td>
      <td>${moneyText(row.contractMoney)}</td>
      <td>${Number(row.finalNum || 0)}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${Number(row.measuredNum || 0)}</td>
      <td>${moneyText(row.measuredMoney)}</td>
      <td>${moneyText(row.remainMoney)}</td>
    </tr>`).join("");
  const materialBody = materialRows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.measureNo || "")}</td>
      <td>${htmlEscape(row.materialName || "")}</td>
      <td>${htmlEscape(row.measureUnit || row.unit || "")}</td>
      <td>${Number(row.measureNum || 0)}</td>
      <td>${moneyText(row.priceDiff)}</td>
      <td>${moneyText(row.adjustMoney)}</td>
      <td>${htmlEscape(row.states || "")}</td>
    </tr>`).join("");
  const manualBody = manualRows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.measureNo || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.measureNum || 0)}</td>
      <td>${moneyText(row.price)}</td>
      <td>${moneyText(row.measureMoney)}</td>
      <td>${htmlEscape(row.states || "")}</td>
    </tr>`).join("");

  return `
    <div class="layui-fluid second-payment-report">
      <style>
        .second-payment-report { padding:16px; background:#f4f7fb; color:#172033; }
        .spr-shell { max-width:1380px; margin:0 auto; }
        .spr-title { display:flex; justify-content:space-between; gap:16px; align-items:flex-end; margin-bottom:14px; }
        .spr-title h2 { margin:0; font-size:22px; font-weight:600; }
        .spr-title p { margin:6px 0 0; color:#64748b; }
        .spr-cards { display:grid; grid-template-columns:repeat(7, minmax(120px, 1fr)); gap:10px; margin-bottom:12px; }
        .spr-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:82px; }
        .spr-card span { display:block; color:#64748b; font-size:12px; }
        .spr-card strong { display:block; margin-top:8px; color:#0f766e; font-size:20px; }
        .spr-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; margin-top:12px; overflow:auto; }
        .spr-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .spr-panel table { margin:0; min-width:980px; }
        .left { text-align:left; }
        .spr-empty { text-align:center; color:#94a3b8; padding:22px; }
        @media (max-width:1100px) { .spr-cards { grid-template-columns:repeat(3, 1fr); } }
        @media (max-width:640px) { .spr-cards { grid-template-columns:1fr 1fr; } .spr-title { display:block; } }
      </style>
      <div class="spr-shell">
        <div class="spr-title">
          <div>
            <h2>二级计量支付报表</h2>
            <p>按合同段和清单拆分累计支付，含材料补差、材料到场、手动计量和支付比例。</p>
          </div>
          <button class="layui-btn layui-btn-sm" onclick="location.href='/reportManager/reportViewSecurity?reportCode=MEASUREREOPORT'">打印总报表</button>
        </div>
        <div class="spr-cards">
          <div class="spr-card"><span>合同金额</span><strong>${moneyText(summary.contractMoney)}</strong></div>
          <div class="spr-card"><span>最终金额</span><strong>${moneyText(summary.finalMoney)}</strong></div>
          <div class="spr-card"><span>清单计量</span><strong>${moneyText(summary.measureMoney)}</strong></div>
          <div class="spr-card"><span>材料补差</span><strong>${moneyText(summary.materialDiasMoney)}</strong></div>
          <div class="spr-card"><span>材料到场</span><strong>${moneyText(summary.materialArrivalMoney)}</strong><small>到场跟踪不计入应付</small></div>
          <div class="spr-card"><span>手动计量</span><strong>${moneyText(summary.manualMoney)}</strong></div>
          <div class="spr-card"><span>支付比例</span><strong>${percentText(summary.payRate)}</strong></div>
        </div>
        <div class="spr-panel">
          <h3>合同段汇总</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>合同段</th><th>合同编号</th><th>合同金额</th><th>最终金额</th><th>清单计量</th><th>材料补差</th><th>材料到场</th><th>手动计量</th><th>累计支付</th><th>支付比例</th></tr></thead>
            <tbody>${sectionRows || `<tr><td colspan="10" class="spr-empty">暂无合同段数据</td></tr>`}</tbody>
          </table>
        </div>
        <div class="spr-panel">
          <h3>清单支付明细</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>合同段</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>合同数量</th><th>合同单价</th><th>合同金额</th><th>最终数量</th><th>最终金额</th><th>累计计量</th><th>计量金额</th><th>剩余金额</th></tr></thead>
            <tbody>${billRows || `<tr><td colspan="12" class="spr-empty">暂无清单支付数据</td></tr>`}</tbody>
          </table>
        </div>
        <div class="spr-panel">
          <h3>材料补差</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>合同段</th><th>计量单号</th><th>材料名称</th><th>单位</th><th>数量</th><th>价差</th><th>补差金额</th><th>状态</th></tr></thead>
            <tbody>${materialBody || `<tr><td colspan="8" class="spr-empty">暂无材料补差数据</td></tr>`}</tbody>
          </table>
        </div>
        <div class="spr-panel">
          <h3>手动计量</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>合同段</th><th>计量单号</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>数量</th><th>单价</th><th>金额</th><th>状态</th></tr></thead>
            <tbody>${manualBody || `<tr><td colspan="9" class="spr-empty">暂无手动计量数据</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function auditMoneyDashboardHtml(req) {
  const rows = engine.auditMoneyRows();
  const totals = rows.reduce((acc, row) => {
    acc.contractMoney += Number(row.contractMoney || 0);
    acc.modifyMoney += Number(row.modifyMoney || 0);
    acc.varyMoney += Number(row.varyMoney || 0);
    acc.finishContractMoney += Number(row.finishContractMoney || 0);
    acc.submitMoney += Number(row.usertask1 || row.submitMoney || 0);
    acc.submitVaryMoney += Number(row.usertask1v || 0);
    acc.supervisorMoney += Number(row.usertask2 || row.engineerAuditMoney || 0);
    acc.supervisorVaryMoney += Number(row.usertask2v || 0);
    acc.ownerMoney += Number(row.usertask3 || row.supervisorAuditMoney || 0);
    acc.ownerVaryMoney += Number(row.usertask3v || 0);
    acc.finalOwnerMoney += Number(row.ownerAuditMoney || 0);
    return acc;
  }, {
    contractMoney: 0,
    modifyMoney: 0,
    varyMoney: 0,
    finishContractMoney: 0,
    submitMoney: 0,
    submitVaryMoney: 0,
    supervisorMoney: 0,
    supervisorVaryMoney: 0,
    ownerMoney: 0,
    ownerVaryMoney: 0,
    finalOwnerMoney: 0
  });
  const submitCut = totals.submitMoney - totals.supervisorMoney;
  const ownerCut = totals.supervisorMoney - totals.ownerMoney;
  const finalCut = totals.submitMoney - totals.finalOwnerMoney;
  const cards = [
    ["施工单位上报", moneyText(totals.submitMoney), `其中变更 ${moneyText(totals.submitVaryMoney)}`],
    ["监理单位审核", moneyText(totals.supervisorMoney), `核减 ${moneyText(submitCut)}`],
    ["业主单位审批", moneyText(totals.ownerMoney), `核减 ${moneyText(ownerCut)}`],
    ["最终审核金额", moneyText(totals.finalOwnerMoney), `总核减 ${moneyText(finalCut)}`],
    ["变更后金额", moneyText(totals.finishContractMoney), `变更金额 ${moneyText(totals.varyMoney)}`],
    ["审核支付率", percentText(totals.finishContractMoney ? (totals.finalOwnerMoney / totals.finishContractMoney) * 100 : 0), "最终审核 / 变更后金额"]
  ].map(([label, value, hint]) => `
    <div class="audit-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const body = rows.map((row) => {
    const rowSubmitCut = Number(row.usertask1 || 0) - Number(row.usertask2 || 0);
    const rowOwnerCut = Number(row.usertask2 || 0) - Number(row.usertask3 || 0);
    return `
      <tr>
        <td>${htmlEscape(row.auditType || "清单计量")}</td>
        <td>${htmlEscape(row.chapterNo || row.billNo || "")}</td>
        <td class="left">${htmlEscape(row.chapterName || row.billName || "")}</td>
        <td>${moneyText(row.contractMoney)}</td>
        <td>${moneyText(row.modifyMoney)}</td>
        <td>${moneyText(row.varyMoney)}</td>
        <td>${moneyText(row.finishContractMoney)}</td>
        <td>${moneyText(row.usertask1)}</td>
        <td>${moneyText(row.usertask1v)}</td>
        <td>${moneyText(row.usertask2)}</td>
        <td>${moneyText(row.usertask2v)}</td>
        <td>${moneyText(row.usertask3)}</td>
        <td>${moneyText(row.usertask3v)}</td>
        <td>${moneyText(row.ownerAuditMoney)}</td>
        <td>${moneyText(rowSubmitCut)}</td>
        <td>${moneyText(rowOwnerCut)}</td>
      </tr>`;
  }).join("");
  return `
    <div class="layui-fluid audit-money-dashboard">
      <style>
        .audit-money-dashboard { padding:16px; background:#f4f7fb; color:#172033; }
        .audit-shell { max-width:1420px; margin:0 auto; }
        .audit-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .audit-head h2 { margin:0; font-size:22px; font-weight:600; }
        .audit-head p { margin:6px 0 0; color:#64748b; }
        .audit-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .audit-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .audit-card span, .audit-card small { display:block; color:#64748b; font-size:12px; }
        .audit-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .audit-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; }
        .audit-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .audit-panel table { min-width:1380px; margin:0; }
        .audit-panel thead tr:first-child th { background:#dfeaf6; }
        .audit-panel thead tr:nth-child(2) th { background:#eef3f8; }
        .left { text-align:left; }
        .audit-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .audit-cards { grid-template-columns:repeat(3, 1fr); } .audit-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .audit-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="audit-shell">
        <div class="audit-head">
          <div>
            <h2>各级审核金额</h2>
            <p>对比施工单位上报、监理单位审核、业主单位审批和最终审核金额，跟踪核减与变更金额。</p>
          </div>
          <button class="layui-btn layui-btn-sm" onclick="location.href='/measure_data/audit_money_list?page=1&limit=1000'">查看接口数据</button>
        </div>
        <div class="audit-cards">${cards}</div>
        <div class="audit-panel">
          <h3>审核金额明细</h3>
          <table class="layui-table" lay-size="sm">
            <thead>
              <tr>
                <th rowspan="2">业务类型</th><th rowspan="2">项目编号</th><th rowspan="2">项目名称</th><th rowspan="2">合同金额</th><th rowspan="2">修正金额</th><th rowspan="2">变更金额</th><th rowspan="2">变更后金额</th>
                <th colspan="2">施工单位</th><th colspan="2">监理单位</th><th colspan="2">业主单位</th><th rowspan="2">最终审核金额</th><th rowspan="2">监理核减</th><th rowspan="2">业主核减</th>
              </tr>
              <tr>
                <th>上报金额</th><th>其中变更金额</th><th>审核金额</th><th>其中变更金额</th><th>审批金额</th><th>其中变更金额</th>
              </tr>
            </thead>
              <tbody>${body || `<tr><td colspan="16" class="audit-empty">暂无审核金额数据</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function moneyText(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";
}

function percentText(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : "0.00%";
}

function number2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function costReconciliationData() {
  const round2 = (value) => Number(Number(value || 0).toFixed(2));
  const summary = engine.contractSummary();
  const sections = engine.reportProjectRows();
  const bills = engine.billRows();
  const materialDiasRows = engine.materialDiasRows();
  const materialArrivalRows = engine.materialArrivalRows();
  const auditRows = engine.auditMoneyRows();
  const periodRows = gatherRows();
  const snapshots = ensureGatherSnapshots();
  const materialArrivalMoney = round2(materialArrivalRows.reduce((sum, row) => sum + Number(row.money || 0), 0));
  const materialArrivalQuantity = round2(materialArrivalRows.reduce((sum, row) => sum + Number(row.measureNum || row.quantity || 0), 0));
  const materialDiasQuantity = round2(materialDiasRows.reduce((sum, row) => sum + Number(row.measureNum || row.quantity || 0), 0));
  const materialArrivalBySection = materialArrivalRows.reduce((acc, row) => {
    const sectionId = Number(row.sectionId || 0);
    const current = acc.get(sectionId) || { money: 0, quantity: 0 };
    current.money += Number(row.money || 0);
    current.quantity += Number(row.measureNum || row.quantity || 0);
    acc.set(sectionId, current);
    return acc;
  }, new Map());
  const materialLinkMap = new Map();
  const materialLinkKey = (row) => `${Number(row.sectionId || 0)}:${Number(row.materialId || row.secMaterialId || row.secMateriaId || 0)}`;
  const ensureMaterialLink = (row) => {
    const key = materialLinkKey(row);
    const current = materialLinkMap.get(key) || {
      sectionId: Number(row.sectionId || 0),
      sectionName: row.sectionName || "",
      materialId: Number(row.materialId || row.secMaterialId || row.secMateriaId || 0),
      materialName: row.materialName || row.secMaterialName || "",
      unit: row.measureUnit || row.unit || "",
      diasQuantity: 0,
      diasMoney: 0,
      arrivalQuantity: 0,
      arrivalMoney: 0
    };
    if (!current.sectionName && row.sectionName) current.sectionName = row.sectionName;
    if (!current.materialName && (row.materialName || row.secMaterialName)) current.materialName = row.materialName || row.secMaterialName;
    if (!current.unit && (row.measureUnit || row.unit)) current.unit = row.measureUnit || row.unit;
    materialLinkMap.set(key, current);
    return current;
  };
  materialDiasRows.forEach((row) => {
    const current = ensureMaterialLink(row);
    current.diasQuantity += Number(row.measureNum || row.quantity || 0);
    current.diasMoney += Number(row.adjustMoney || row.money || 0);
  });
  materialArrivalRows.forEach((row) => {
    const current = ensureMaterialLink(row);
    current.arrivalQuantity += Number(row.measureNum || row.quantity || 0);
    current.arrivalMoney += Number(row.money || 0);
  });
  const materialLinks = Array.from(materialLinkMap.values()).map((row) => {
    const coverageRate = row.diasQuantity ? (row.arrivalQuantity / row.diasQuantity) * 100 : (row.arrivalQuantity > 0 ? 100 : 0);
    return {
      ...row,
      diasQuantity: round2(row.diasQuantity),
      diasMoney: round2(row.diasMoney),
      arrivalQuantity: round2(row.arrivalQuantity),
      arrivalMoney: round2(row.arrivalMoney),
      coverageRate: round2(coverageRate),
      status: row.diasQuantity > 0 && row.arrivalQuantity > 0
        ? (row.arrivalQuantity + 0.0001 >= row.diasQuantity ? "到场覆盖补差数量" : "到场数量低于补差数量")
        : (row.diasQuantity > 0 ? "仅有补差记录" : "仅有到场记录")
    };
  }).sort((a, b) => String(a.sectionName).localeCompare(String(b.sectionName), "zh-CN") || String(a.materialName).localeCompare(String(b.materialName), "zh-CN"));
  const sectionTotals = sections.reduce((acc, row) => {
    acc.contractMoney += Number(row.contractMoney || 0);
    acc.finalMoney += Number(row.finalMoney || 0);
    acc.measuredMoney += Number(row.measureMoney || row.currentPayMoney || 0);
    acc.materialDiasMoney += Number(row.materialDiasMoney || 0);
    acc.materialArrivalMoney += Number(row.materialArrivalMoney || 0);
    acc.manualMoney += Number(row.manualMoney || 0);
    acc.totalPayMoney += Number(row.totalPayMoney || 0);
    return acc;
  }, { contractMoney: 0, finalMoney: 0, measuredMoney: 0, materialDiasMoney: 0, materialArrivalMoney: 0, manualMoney: 0, totalPayMoney: 0 });
  Object.keys(sectionTotals).forEach((key) => { sectionTotals[key] = round2(sectionTotals[key]); });

  const expectedFinal = round2(summary.contractSumMoney + summary.varyMoney);
  const expectedPayable = round2(engine.calculatePayable({
    measuredMoney: summary.measuredMoney,
    materialDiasMoney: summary.materialDiasMoney,
    materialArrivalMoney,
    manualMoney: summary.manualMoney
  }));
  const auditSubmit = round2(auditRows.reduce((sum, row) => sum + Number(row.usertask1 || row.submitMoney || 0), 0));
  const auditSupervisor = round2(auditRows.reduce((sum, row) => sum + Number(row.usertask2 || row.engineerAuditMoney || 0), 0));
  const auditOwner = round2(auditRows.reduce((sum, row) => sum + Number(row.usertask3 || row.supervisorAuditMoney || 0), 0));
  const auditFinal = round2(auditRows.reduce((sum, row) => sum + Number(row.ownerAuditMoney || 0), 0));
  const periodPayable = round2(periodRows.reduce((sum, period) => {
    const check = checkGather({ body: { gatherId: period.gatherId }, query: {} });
    return sum + Number((check.summary && check.summary.payableMoney) || 0);
  }, 0));

  const checks = [
    {
      key: "final-money",
      name: "最终金额 = 合同金额 + 工程变更",
      expected: expectedFinal,
      actual: round2(summary.finalMoney),
      passed: Math.abs(expectedFinal - round2(summary.finalMoney)) < 0.01
    },
    {
      key: "payable-money",
      name: "JL104实际支付 = 小计 + 价格调整 + 材料设备垫付款 - 扣回/保留金",
      expected: expectedPayable,
      actual: round2(summary.payableMoney),
      passed: Math.abs(expectedPayable - round2(summary.payableMoney)) < 0.01
    },
    {
      key: "section-final",
      name: "合同段最终金额汇总 = 项目最终金额",
      expected: round2(summary.finalMoney),
      actual: sectionTotals.finalMoney,
      passed: Math.abs(sectionTotals.finalMoney - round2(summary.finalMoney)) < 0.01
    },
    {
      key: "section-payable",
      name: "合同段累计支付汇总 = 项目应付金额",
      expected: round2(summary.payableMoney),
      actual: sectionTotals.totalPayMoney,
      passed: Math.abs(sectionTotals.totalPayMoney - round2(summary.payableMoney)) < 0.01
    },
    {
      key: "audit-chain",
      name: "审核金额链路不高于上报金额",
      expected: auditSubmit,
      actual: auditFinal,
      passed: auditSubmit >= auditSupervisor && auditSupervisor >= auditOwner && auditOwner >= auditFinal
    },
    {
      key: "audit-payable-coverage",
      name: "审核上报金额覆盖清单计量、材料补差和手动计量",
      expected: expectedPayable,
      actual: auditSubmit,
      passed: Math.abs(auditSubmit - expectedPayable) < 0.01
    },
    {
      key: "period-coverage",
      name: "数据采集期次已覆盖可计算应付金额",
      expected: round2(summary.payableMoney),
      actual: periodPayable,
      passed: periodRows.length > 0 && periodPayable >= 0
    },
    {
      key: "material-arrival-tracking",
      name: "材料到场金额按预付率形成材料设备垫付款",
      expected: materialArrivalMoney,
      actual: round2(summary.materialAdvanceMoney || 0),
      passed: Math.abs(expectedPayable - round2(summary.payableMoney)) < 0.01 && materialArrivalMoney >= 0
    },
    {
      key: "material-quantity-coverage",
      name: "材料补差与到场按合同段和材料形成联动台账",
      expected: materialDiasQuantity,
      actual: materialArrivalQuantity,
      passed: materialLinks.length > 0
        && materialLinks.some((row) => row.diasQuantity > 0)
        && materialLinks.some((row) => row.arrivalQuantity > 0)
        && materialLinks.every((row) => row.diasQuantity >= 0 && row.arrivalQuantity >= 0)
    }
  ];

  const moduleTotals = {
    contractMoney: round2(summary.contractSumMoney),
    varyMoney: round2(summary.varyMoney),
    finalMoney: round2(summary.finalMoney),
    measuredMoney: round2(summary.measuredMoney),
    materialDiasMoney: round2(summary.materialDiasMoney),
    materialAdvanceMoney: round2(summary.materialAdvanceMoney),
    materialDeductionMoney: round2(summary.materialDeductionMoney),
    retentionMoney: round2(summary.retentionMoney),
    mobilizationDeductionMoney: round2(summary.mobilizationDeductionMoney),
    manualMoney: round2(summary.manualMoney),
    payableMoney: round2(summary.payableMoney),
    payRate: round2(summary.payRate),
    billCount: bills.length,
    measureCount: engine.measureRows().length,
    materialDiasCount: materialDiasRows.length,
    materialDiasQuantity,
    materialArrivalCount: materialArrivalRows.length,
    materialArrivalQuantity,
    materialArrivalMoney,
    manualCount: engine.manualMeasureRows().length,
    variationCount: engine.variationRows().length,
    auditRows: auditRows.length,
    gatherPeriods: periodRows.length,
    gatherSnapshots: snapshots.length
  };

  return {
    ok: checks.every((row) => row.passed),
    moduleTotals,
    sectionTotals,
    auditTotals: {
      submit: auditSubmit,
      supervisor: auditSupervisor,
      owner: auditOwner,
      final: auditFinal,
      deduction: round2(auditSubmit - auditFinal)
    },
    checks,
    materialLinks,
    sections: sections.map((row) => ({
      sectionId: row.sectionId,
      sectionName: row.sectionName,
      contractNo: row.contractNo,
      finalMoney: round2(row.finalMoney),
      measuredMoney: round2(row.measureMoney || row.currentPayMoney || 0),
      materialDiasMoney: round2(row.materialDiasMoney),
      materialArrivalMoney: round2((materialArrivalBySection.get(Number(row.sectionId || 0)) || {}).money),
      materialArrivalQuantity: round2((materialArrivalBySection.get(Number(row.sectionId || 0)) || {}).quantity),
      manualMoney: round2(row.manualMoney),
      totalPayMoney: round2(row.totalPayMoney),
      payRate: round2(row.payRate)
    }))
  };
}

function fiveDCostModelData() {
  const summary = engine.contractSummary();
  const sections = engine.reportProjectRows();
  const bills = engine.billRows();
  const plans = engine.planRows();
  const audit = costReconciliationData().auditTotals;
  let plannedCumulative = 0;
  const actualTarget = Number(summary.payableMoney || 0);
  const sCurve = plans.map((plan, index) => {
    const plannedMoney = Number(plan.finishMoney || plan.amount || 0);
    plannedCumulative += plannedMoney;
    const progress = plans.length ? (index + 1) / plans.length : 1;
    const actualCumulative = number2(actualTarget * progress);
    const earnedValue = Math.min(actualCumulative, Number(summary.finalMoney || 0));
    return {
      period: plan.planYm || plan.planNo || String(index + 1),
      planNo: plan.planNo,
      plannedMoney: number2(plannedMoney),
      plannedCumulative: number2(plannedCumulative),
      actualCumulative,
      earnedValue: number2(earnedValue),
      scheduleVariance: number2(earnedValue - plannedCumulative),
      costVariance: number2(earnedValue - actualCumulative),
      spi: plannedCumulative ? number2(earnedValue / plannedCumulative) : 0,
      cpi: actualCumulative ? number2(earnedValue / actualCumulative) : 0
    };
  });
  const boqBySection = sections.map((row) => ({
    sectionId: row.sectionId,
    sectionName: row.sectionName,
    contractNo: row.contractNo,
    billCount: bills.filter((bill) => Number(bill.sectionId || 0) === Number(row.sectionId || 0)).length,
    contractMoney: number2(row.contractMoney),
    variationMoney: number2(Number(row.finalMoney || 0) - Number(row.contractMoney || 0)),
    finalMoney: number2(row.finalMoney),
    measuredMoney: number2(row.measureMoney || row.currentPayMoney || 0),
    materialDiasMoney: number2(row.materialDiasMoney),
    materialArrivalMoney: number2(row.materialArrivalMoney),
    manualMoney: number2(row.manualMoney),
    payableMoney: number2(row.totalPayMoney),
    payRate: number2(row.payRate)
  }));
  const resourceCosts = {
    billMeasure: number2(summary.measuredMoney),
    materialDias: number2(summary.materialDiasMoney),
    materialArrivalTracking: number2(engine.materialArrivalRows().reduce((sum, row) => sum + Number(row.money || 0), 0)),
    materialAdvance: number2(summary.materialAdvanceMoney),
    materialDeduction: number2(summary.materialDeductionMoney),
    retention: number2(summary.retentionMoney),
    mobilizationDeduction: number2(summary.mobilizationDeductionMoney),
    manualMeasure: number2(summary.manualMoney),
    variation: number2(summary.varyMoney)
  };
  const contactCostImpacts = (engine.db.contactBills || []).map((row) => ({
    contactId: row.contactId || row.id,
    contactNo: row.contactNo || row.skillNo || "",
    title: row.title || row.contactContent || "",
    sectionId: row.sectionId || 0,
    sectionName: row.sectionName || row.workAreaName || "",
    costImpactType: row.costImpactType || "技术联系",
    estimateMoney: number2(row.estimateMoney || row.money || 0),
    state: row.states || ""
  }));
  const contactEstimateMoney = number2(contactCostImpacts.reduce((sum, row) => sum + Number(row.estimateMoney || 0), 0));
  const estimateAtCompletion = summary.payRate ? number2(summary.payableMoney / (summary.payRate / 100)) : number2(summary.finalMoney);
  return {
    model: "BOQ-5D-COST",
    formulas: {
      finalMoney: "contractMoney + variationMoney",
      payableMoney: "JL104: subtotal + materialDias + materialAdvance - materialDeduction - retention - mobilizationDeduction",
      contactEstimateMoney: "engineering contact pre-change cost signal, excluded until formal variation/payment",
      materialArrival: "JL109 material arrival value * materialAdvanceRate -> materialAdvance",
      payRate: "payableMoney / finalMoney * 100"
    },
    totals: {
      contractMoney: number2(summary.contractSumMoney),
      variationMoney: number2(summary.varyMoney),
      finalMoney: number2(summary.finalMoney),
      payableMoney: number2(summary.payableMoney),
      contactEstimateMoney,
      payRate: number2(summary.payRate),
      estimateAtCompletion
    },
    resourceCosts,
    audit,
    contactCostImpacts,
    boqBySection,
    sCurve,
    takeoffRows: bills.map((row) => ({
      billId: row.billId,
      billNo: row.billNo,
      billName: row.billName,
      unit: row.measureUnit,
      contractNum: number2(row.contractNum),
      finalNum: number2(row.finalNum),
      measuredNum: number2(row.measuredNum),
      price: number2(row.price),
      finalMoney: number2(row.finalMoney),
      measuredMoney: number2(row.measuredMoney),
      remainMoney: number2(row.remainMoney)
    }))
  };
}

function boqValidationData() {
  const bills = engine.billRows();
  const variations = engine.variationRows();
  const checks = [];
  const rows = bills.map((bill) => {
    const contractNum = number2(bill.contractNum);
    const finalNum = number2(bill.finalNum ?? bill.contractNum);
    const measuredNum = number2(bill.measuredNum);
    const price = number2(bill.price);
    const contractMoney = number2(contractNum * price);
    const finalMoney = number2(finalNum * price);
    const measuredMoney = number2(bill.measuredMoney);
    const varyMoney = number2(variations
      .filter((row) => Number(row.billId || 0) === Number(bill.billId || 0))
      .reduce((sum, row) => sum + Number(row.varyMoney || 0), 0));
    const remainMoney = number2(finalMoney - measuredMoney);
    const rowChecks = [
      { key: "quantity-positive", passed: contractNum >= 0 && finalNum >= 0, message: "合同数量和变更后数量应为非负数" },
      { key: "price-positive", passed: price >= 0, message: "综合单价应为非负数" },
      { key: "contract-formula", passed: Math.abs(contractMoney - Number(bill.contractMoney || contractMoney)) < 0.01, message: "合同金额应等于合同数量乘综合单价" },
      { key: "final-formula", passed: Math.abs(finalMoney - Number(bill.finalMoney || finalMoney)) < 0.01, message: "最终金额应等于变更后数量乘综合单价" },
      { key: "measure-limit", passed: measuredNum <= finalNum + 0.000001, message: "累计计量数量不应超过变更后数量" },
      { key: "remain-nonnegative", passed: remainMoney >= -0.01, message: "剩余金额不应为负" }
    ];
    const failed = rowChecks.filter((item) => !item.passed);
    const riskLevel = failed.some((item) => item.key === "measure-limit" || item.key === "remain-nonnegative")
      ? "高"
      : failed.length
        ? "中"
        : varyMoney
          ? "低"
          : "正常";
    checks.push(...rowChecks.map((item) => ({
      billId: bill.billId,
      billNo: bill.billNo,
      key: item.key,
      passed: item.passed,
      message: item.message
    })));
    return {
      billId: bill.billId,
      billNo: bill.billNo,
      billName: bill.billName,
      sectionId: bill.sectionId,
      sectionName: bill.sectionName,
      unit: bill.measureUnit,
      contractNum,
      finalNum,
      measuredNum,
      price,
      contractMoney,
      finalMoney,
      measuredMoney,
      varyMoney,
      remainMoney,
      measureRate: finalMoney ? number2(measuredMoney / finalMoney * 100) : 0,
      riskLevel,
      failedChecks: failed.map((item) => item.key)
    };
  });
  const failedChecks = checks.filter((item) => !item.passed);
  const totals = rows.reduce((acc, row) => {
    acc.contractMoney += row.contractMoney;
    acc.finalMoney += row.finalMoney;
    acc.measuredMoney += row.measuredMoney;
    acc.varyMoney += row.varyMoney;
    acc.remainMoney += row.remainMoney;
    return acc;
  }, { contractMoney: 0, finalMoney: 0, measuredMoney: 0, varyMoney: 0, remainMoney: 0 });
  Object.keys(totals).forEach((key) => { totals[key] = number2(totals[key]); });
  return {
    ok: failedChecks.length === 0,
    formulas: {
      contractMoney: "contractNum * price",
      finalMoney: "finalNum * price",
      remainMoney: "finalMoney - measuredMoney",
      measureRate: "measuredMoney / finalMoney * 100"
    },
    totals,
    summary: {
      billCount: rows.length,
      checkedCount: checks.length,
      failedCount: failedChecks.length,
      highRiskCount: rows.filter((row) => row.riskLevel === "高").length,
      changedBillCount: rows.filter((row) => row.varyMoney !== 0).length
    },
    checks,
    rows
  };
}

function unitPriceAnalysisData() {
  const ratios = {
    labor: 0.15,
    material: 0.55,
    machine: 0.10,
    management: 0.08,
    profit: 0.05,
    tax: 0.07
  };
  const rows = engine.billRows().map((bill) => {
    const unitPrice = number2(bill.price || 0);
    const quantity = number2(bill.contractNum || bill.quantity || 0);
    const component = {
      labor: number2(unitPrice * ratios.labor),
      material: number2(unitPrice * ratios.material),
      machine: number2(unitPrice * ratios.machine),
      management: number2(unitPrice * ratios.management),
      profit: number2(unitPrice * ratios.profit),
      tax: number2(unitPrice * ratios.tax)
    };
    const componentPrice = number2(Object.values(component).reduce((sum, value) => sum + Number(value || 0), 0));
    const variance = number2(unitPrice - componentPrice);
    return {
      billId: bill.billId,
      billNo: bill.billNo,
      billName: bill.billName,
      sectionId: bill.sectionId,
      sectionName: bill.sectionName,
      unit: bill.measureUnit || bill.unit || "",
      quantity,
      unitPrice,
      contractMoney: number2(quantity * unitPrice),
      component,
      componentPrice,
      variance,
      materialShare: unitPrice ? number2(component.material / unitPrice * 100) : 0,
      riskLevel: Math.abs(variance) > 0.01 ? "需复核" : component.material / Math.max(unitPrice, 1) > 0.7 ? "材料占比高" : "正常"
    };
  });
  const totals = rows.reduce((acc, row) => {
    acc.contractMoney += row.contractMoney;
    Object.keys(row.component).forEach((key) => {
      acc.components[key] += number2(row.component[key] * row.quantity);
    });
    return acc;
  }, { contractMoney: 0, components: { labor: 0, material: 0, machine: 0, management: 0, profit: 0, tax: 0 } });
  totals.contractMoney = number2(totals.contractMoney);
  Object.keys(totals.components).forEach((key) => { totals.components[key] = number2(totals.components[key]); });
  return {
    formulas: {
      labor: "综合单价 * 15%",
      material: "综合单价 * 55%",
      machine: "综合单价 * 10%",
      management: "综合单价 * 8%",
      profit: "综合单价 * 5%",
      tax: "综合单价 * 7%",
      contractMoney: "合同数量 * 综合单价"
    },
    ratios,
    totals,
    rows
  };
}

function costReconciliationPageHtml() {
  const data = costReconciliationData();
  const cards = [
    ["合同金额", moneyText(data.moduleTotals.contractMoney), "清单合同金额"],
    ["变更金额", moneyText(data.moduleTotals.varyMoney), "工程变更净额"],
    ["最终金额", moneyText(data.moduleTotals.finalMoney), "合同 + 变更"],
    ["清单计量", moneyText(data.moduleTotals.measuredMoney), "已计量清单金额"],
    ["材料补差", moneyText(data.moduleTotals.materialDiasMoney), "材料价差金额"],
    ["材料到场", moneyText(data.moduleTotals.materialArrivalMoney), `${data.moduleTotals.materialArrivalCount} 条到场跟踪`],
    ["累计支付", moneyText(data.moduleTotals.payableMoney), `支付比例 ${percentText(data.moduleTotals.payRate)}`]
  ].map(([label, value, hint]) => `
    <div class="recon-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const checkRows = data.checks.map((row) => `
    <tr>
      <td>${row.passed ? "通过" : "异常"}</td>
      <td class="left">${htmlEscape(row.name)}</td>
      <td>${moneyText(row.expected)}</td>
      <td>${moneyText(row.actual)}</td>
    </tr>`).join("");
  const sectionRows = data.sections.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.contractNo || "")}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${moneyText(row.measuredMoney)}</td>
      <td>${moneyText(row.materialDiasMoney)}</td>
      <td>${moneyText(row.materialArrivalMoney)}</td>
      <td>${moneyText(row.manualMoney)}</td>
      <td>${moneyText(row.totalPayMoney)}</td>
      <td>${percentText(row.payRate)}</td>
    </tr>`).join("");
  const materialLinkRows = data.materialLinks.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.materialName || "")}</td>
      <td>${htmlEscape(row.unit || "")}</td>
      <td>${htmlEscape(String(row.diasQuantity))}</td>
      <td>${moneyText(row.diasMoney)}</td>
      <td>${htmlEscape(String(row.arrivalQuantity))}</td>
      <td>${moneyText(row.arrivalMoney)}</td>
      <td>${percentText(row.coverageRate)}</td>
      <td>${htmlEscape(row.status || "")}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid cost-reconciliation-page">
      <style>
        .cost-reconciliation-page { padding:16px; background:#f4f7fb; color:#172033; }
        .recon-shell { max-width:1380px; margin:0 auto; }
        .recon-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .recon-head h2 { margin:0; font-size:22px; font-weight:600; }
        .recon-head p { margin:6px 0 0; color:#64748b; }
        .recon-cards { display:grid; grid-template-columns:repeat(7, minmax(120px, 1fr)); gap:10px; margin-bottom:12px; }
        .recon-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .recon-card span, .recon-card small { display:block; color:#64748b; font-size:12px; }
        .recon-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .recon-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .recon-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; }
        .recon-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .recon-panel table { margin:0; min-width:720px; }
        .recon-wide { grid-column:1 / -1; }
        .left { text-align:left; }
        @media (max-width:1100px) { .recon-cards { grid-template-columns:repeat(3, 1fr); } .recon-grid { grid-template-columns:1fr; } .recon-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .recon-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="recon-shell">
        <div class="recon-head">
          <div>
            <h2>造价联动校核</h2>
            <p>集中核对清单、变更、材料补差、手动计量、支付报表、审核金额和数据采集之间的计算闭合关系。</p>
          </div>
          <button class="layui-btn layui-btn-sm" onclick="location.href='/api/cost/reconciliation'">查看接口数据</button>
        </div>
        <div class="recon-cards">${cards}</div>
        <div class="recon-grid">
          <div class="recon-panel">
            <h3>公式校核</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>状态</th><th>校核项</th><th>应为</th><th>实际</th></tr></thead>
              <tbody>${checkRows}</tbody>
            </table>
          </div>
          <div class="recon-panel">
            <h3>审核链路</h3>
            <table class="layui-table" lay-size="sm">
              <tbody>
                <tr><th>施工单位上报</th><td>${moneyText(data.auditTotals.submit)}</td></tr>
                <tr><th>监理单位审核</th><td>${moneyText(data.auditTotals.supervisor)}</td></tr>
                <tr><th>业主单位审批</th><td>${moneyText(data.auditTotals.owner)}</td></tr>
                <tr><th>最终审核金额</th><td>${moneyText(data.auditTotals.final)}</td></tr>
                <tr><th>累计核减</th><td>${moneyText(data.auditTotals.deduction)}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="recon-panel recon-wide">
            <h3>合同段联动明细</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>合同段</th><th>合同编号</th><th>最终金额</th><th>清单计量</th><th>材料补差</th><th>材料到场</th><th>手动计量</th><th>累计支付</th><th>支付比例</th></tr></thead>
              <tbody>${sectionRows}</tbody>
            </table>
          </div>
          <div class="recon-panel recon-wide">
            <h3>材料补差与到场台账</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>合同段</th><th>材料</th><th>单位</th><th>补差数量</th><th>补差金额</th><th>到场数量</th><th>到场金额</th><th>覆盖率</th><th>状态</th></tr></thead>
              <tbody>${materialLinkRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function boqValidationPageHtml() {
  const data = boqValidationData();
  const cards = [
    ["清单数量", String(data.summary.billCount), "参与校验的 BOQ 条目"],
    ["校验项", String(data.summary.checkedCount), "数量、单价、金额、剩余"],
    ["异常项", String(data.summary.failedCount), data.ok ? "全部通过" : "需要复核"],
    ["高风险", String(data.summary.highRiskCount), "超量或负剩余"],
    ["变更清单", String(data.summary.changedBillCount), "存在变更金额的清单"],
    ["最终金额", moneyText(data.totals.finalMoney), "变更后清单金额"]
  ].map(([label, value, hint]) => `
    <div class="boq-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const formulaRows = Object.entries(data.formulas).map(([key, value]) => `
    <tr><td>${htmlEscape(key)}</td><td class="left">${htmlEscape(value)}</td></tr>`).join("");
  const failedRows = data.checks.filter((row) => !row.passed).map((row) => `
    <tr><td>${htmlEscape(row.billNo || "")}</td><td>${htmlEscape(row.key || "")}</td><td class="left">${htmlEscape(row.message || "")}</td></tr>`).join("");
  const rowBody = data.rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.riskLevel)}</td>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.unit || "")}</td>
      <td>${htmlEscape(String(row.contractNum))}</td>
      <td>${htmlEscape(String(row.finalNum))}</td>
      <td>${htmlEscape(String(row.measuredNum))}</td>
      <td>${moneyText(row.price)}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${moneyText(row.measuredMoney)}</td>
      <td>${moneyText(row.remainMoney)}</td>
      <td>${percentText(row.measureRate)}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid boq-validation-page">
      <style>
        .boq-validation-page { padding:16px; background:#f5f7fb; color:#172033; }
        .boq-shell { max-width:1380px; margin:0 auto; }
        .boq-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .boq-head h2 { margin:0; font-size:22px; font-weight:600; }
        .boq-head p { margin:6px 0 0; color:#64748b; }
        .boq-actions { display:flex; gap:8px; flex-wrap:wrap; }
        .boq-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .boq-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .boq-card span, .boq-card small { display:block; color:#64748b; font-size:12px; }
        .boq-card strong { display:block; margin:8px 0; color:#155e75; font-size:20px; }
        .boq-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .boq-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; }
        .boq-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .boq-panel table { margin:0; min-width:720px; }
        .boq-wide { grid-column:1 / -1; }
        .left { text-align:left; }
        .boq-empty { text-align:center; color:#94a3b8; padding:20px; }
        @media (max-width:1100px) { .boq-cards { grid-template-columns:repeat(3, 1fr); } .boq-grid { grid-template-columns:1fr; } .boq-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .boq-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="boq-shell">
        <div class="boq-head">
          <div>
            <h2>BOQ清单校验</h2>
            <p>逐项核对合同数量、变更后数量、综合单价、最终金额、累计计量和剩余金额，定位超量计量和清单金额异常。</p>
          </div>
          <div class="boq-actions">
            <button class="layui-btn layui-btn-sm" onclick="location.href='/api/cost/boq_validation'">查看接口数据</button>
            <button class="layui-btn layui-btn-sm layui-btn-primary" onclick="location.href='/costBase/reconciliation_page'">造价联动校核</button>
          </div>
        </div>
        <div class="boq-cards">${cards}</div>
        <div class="boq-grid">
          <div class="boq-panel">
            <h3>校验公式</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>字段</th><th>公式</th></tr></thead>
              <tbody>${formulaRows}</tbody>
            </table>
          </div>
          <div class="boq-panel">
            <h3>异常清单</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>清单编号</th><th>校验项</th><th>说明</th></tr></thead>
              <tbody>${failedRows || `<tr><td colspan="3" class="boq-empty">当前清单校验通过</td></tr>`}</tbody>
            </table>
          </div>
          <div class="boq-panel boq-wide">
            <h3>清单逐项金额</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>风险</th><th>合同段</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>合同数量</th><th>最终数量</th><th>累计计量</th><th>单价</th><th>最终金额</th><th>计量金额</th><th>剩余金额</th><th>计量比例</th></tr></thead>
              <tbody>${rowBody}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function unitPriceAnalysisPageHtml() {
  const data = unitPriceAnalysisData();
  const componentLabels = {
    labor: "人工费",
    material: "材料费",
    machine: "机械费",
    management: "管理费",
    profit: "利润",
    tax: "税金"
  };
  const cards = [
    ["清单数量", String(data.rows.length), "参与单价分析的清单"],
    ["合同金额", moneyText(data.totals.contractMoney), "合同数量 * 综合单价"],
    ["人工费", moneyText(data.totals.components.labor), data.formulas.labor],
    ["材料费", moneyText(data.totals.components.material), data.formulas.material],
    ["机械费", moneyText(data.totals.components.machine), data.formulas.machine],
    ["管理利润税", moneyText(data.totals.components.management + data.totals.components.profit + data.totals.components.tax), "管理费 + 利润 + 税金"]
  ].map(([label, value, hint]) => `
    <div class="unit-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const formulaRows = Object.entries(data.formulas).map(([key, value]) => `
    <tr><td>${htmlEscape(componentLabels[key] || key)}</td><td class="left">${htmlEscape(value)}</td></tr>`).join("");
  const rowBody = data.rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.riskLevel)}</td>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.unit || "")}</td>
      <td>${htmlEscape(String(row.quantity))}</td>
      <td>${moneyText(row.unitPrice)}</td>
      <td>${moneyText(row.component.labor)}</td>
      <td>${moneyText(row.component.material)}</td>
      <td>${moneyText(row.component.machine)}</td>
      <td>${moneyText(row.component.management)}</td>
      <td>${moneyText(row.component.profit)}</td>
      <td>${moneyText(row.component.tax)}</td>
      <td>${percentText(row.materialShare)}</td>
      <td>${moneyText(row.contractMoney)}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid unit-price-page">
      <style>
        .unit-price-page { padding:16px; background:#f5f7fb; color:#172033; }
        .unit-shell { max-width:1380px; margin:0 auto; }
        .unit-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .unit-head h2 { margin:0; font-size:22px; font-weight:600; }
        .unit-head p { margin:6px 0 0; color:#64748b; }
        .unit-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .unit-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .unit-card span, .unit-card small { display:block; color:#64748b; font-size:12px; }
        .unit-card strong { display:block; margin:8px 0; color:#7c2d12; font-size:20px; }
        .unit-grid { display:grid; grid-template-columns:340px 1fr; gap:12px; }
        .unit-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; }
        .unit-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .unit-panel table { margin:0; min-width:1040px; }
        .unit-formulas table { min-width:0; }
        .unit-wide { grid-column:1 / -1; }
        .left { text-align:left; }
        .unit-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .unit-cards { grid-template-columns:repeat(3, 1fr); } .unit-grid { grid-template-columns:1fr; } .unit-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .unit-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="unit-shell">
        <div class="unit-head">
          <div>
            <h2>综合单价分析</h2>
            <p>按人工、材料、机械、管理费、利润和税金拆分清单综合单价，辅助清单造价审核和合同金额复核。</p>
          </div>
          <div>
            <button class="layui-btn layui-btn-sm" onclick="location.href='/api/cost/unit_price_analysis'">查看接口数据</button>
            <button class="layui-btn layui-btn-sm layui-btn-primary" onclick="location.href='/costBase/export_unit_price_analysis'">导出单价分析</button>
          </div>
        </div>
        <div class="unit-cards">${cards}</div>
        <div class="unit-grid">
          <div class="unit-panel unit-formulas">
            <h3>单价构成公式</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>费用项</th><th>公式</th></tr></thead>
              <tbody>${formulaRows}</tbody>
            </table>
          </div>
          <div class="unit-panel">
            <h3>费用构成汇总</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>人工费</th><th>材料费</th><th>机械费</th><th>管理费</th><th>利润</th><th>税金</th><th>合同金额</th></tr></thead>
              <tbody><tr><td>${moneyText(data.totals.components.labor)}</td><td>${moneyText(data.totals.components.material)}</td><td>${moneyText(data.totals.components.machine)}</td><td>${moneyText(data.totals.components.management)}</td><td>${moneyText(data.totals.components.profit)}</td><td>${moneyText(data.totals.components.tax)}</td><td>${moneyText(data.totals.contractMoney)}</td></tr></tbody>
            </table>
          </div>
          <div class="unit-panel unit-wide">
            <h3>清单综合单价明细</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>风险</th><th>合同段</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>合同数量</th><th>综合单价</th><th>人工费</th><th>材料费</th><th>机械费</th><th>管理费</th><th>利润</th><th>税金</th><th>材料占比</th><th>合同金额</th></tr></thead>
              <tbody>${rowBody || `<tr><td colspan="15" class="unit-empty">暂无清单数据</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function fiveDCostModelPageHtml() {
  const data = fiveDCostModelData();
  const resourceRows = Object.entries(data.resourceCosts || {}).map(([key, value]) => `
    <tr><td>${htmlEscape(key)}</td><td>${moneyText(value)}</td></tr>`).join("");
  const formulaRows = Object.entries(data.formulas || {}).map(([key, value]) => `
    <tr><td>${htmlEscape(key)}</td><td class="left">${htmlEscape(value)}</td></tr>`).join("");
  const sCurveRows = (data.sCurve || []).map((row) => `
    <tr>
      <td>${htmlEscape(row.period || "")}</td>
      <td>${moneyText(row.plannedMoney)}</td>
      <td>${moneyText(row.plannedCumulative)}</td>
      <td>${moneyText(row.actualCumulative)}</td>
      <td>${moneyText(row.earnedValue)}</td>
      <td>${moneyText(row.scheduleVariance)}</td>
      <td>${moneyText(row.costVariance)}</td>
      <td>${htmlEscape(String(row.spi))}</td>
      <td>${htmlEscape(String(row.cpi))}</td>
    </tr>`).join("");
  const sectionRows = (data.boqBySection || []).map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.contractNo || "")}</td>
      <td>${htmlEscape(String(row.billCount || 0))}</td>
      <td>${moneyText(row.contractMoney)}</td>
      <td>${moneyText(row.variationMoney)}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${moneyText(row.payableMoney)}</td>
      <td>${percentText(row.payRate)}</td>
    </tr>`).join("");
  const contactRows = (data.contactCostImpacts || []).map((row) => `
    <tr>
      <td>${htmlEscape(row.contactNo || "")}</td>
      <td class="left">${htmlEscape(row.title || "")}</td>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.costImpactType || "")}</td>
      <td>${moneyText(row.estimateMoney)}</td>
      <td>${htmlEscape(row.state || "")}</td>
    </tr>`).join("");
  const cards = [
    ["合同金额", moneyText(data.totals.contractMoney), "原合同 BOQ 金额"],
    ["变更金额", moneyText(data.totals.variationMoney), "正式变更净额"],
    ["最终金额", moneyText(data.totals.finalMoney), "合同 + 变更"],
    ["应付金额", moneyText(data.totals.payableMoney), "清单计量 + 材料补差 + 手动计量"],
    ["联系单估算", moneyText(data.totals.contactEstimateMoney), "未正式进入支付"],
    ["EAC", moneyText(data.totals.estimateAtCompletion), "按当前支付比例预测"]
  ].map(([label, value, hint]) => `
    <div class="five-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  return `
    <div class="layui-fluid five-cost-page">
      <style>
        .five-cost-page { padding:16px; background:#f5f7fb; color:#172033; }
        .five-shell { max-width:1380px; margin:0 auto; }
        .five-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .five-head h2 { margin:0; font-size:22px; font-weight:600; }
        .five-head p { margin:6px 0 0; color:#64748b; }
        .five-actions { display:flex; gap:8px; flex-wrap:wrap; }
        .five-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .five-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .five-card span, .five-card small { display:block; color:#64748b; font-size:12px; }
        .five-card strong { display:block; margin:8px 0; color:#7c2d12; font-size:20px; }
        .five-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .five-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; }
        .five-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .five-panel table { margin:0; min-width:680px; }
        .five-wide { grid-column:1 / -1; }
        .left { text-align:left; }
        .five-empty { text-align:center; color:#94a3b8; padding:20px; }
        @media (max-width:1100px) { .five-cards { grid-template-columns:repeat(3, 1fr); } .five-grid { grid-template-columns:1fr; } .five-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .five-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="five-shell">
        <div class="five-head">
          <div>
            <h2>5D成本模型</h2>
            <p>把 BOQ、进度计划、计量支付、材料补差、工程变更、联系单估算和审核金额汇总为可追踪的成本模型。</p>
          </div>
          <div class="five-actions">
            <button class="layui-btn layui-btn-sm" onclick="location.href='/api/cost/5d_model'">查看接口数据</button>
            <button class="layui-btn layui-btn-sm layui-btn-primary" onclick="location.href='/costBase/boq_validation_page'">BOQ校验</button>
          </div>
        </div>
        <div class="five-cards">${cards}</div>
        <div class="five-grid">
          <div class="five-panel">
            <h3>计算公式</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>字段</th><th>公式</th></tr></thead>
              <tbody>${formulaRows}</tbody>
            </table>
          </div>
          <div class="five-panel">
            <h3>资源成本构成</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>模块</th><th>金额</th></tr></thead>
              <tbody>${resourceRows}</tbody>
            </table>
          </div>
          <div class="five-panel five-wide">
            <h3>S曲线与EVM</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>期次</th><th>本期计划</th><th>计划累计PV</th><th>实际累计AC</th><th>挣值EV</th><th>进度偏差SV</th><th>成本偏差CV</th><th>SPI</th><th>CPI</th></tr></thead>
              <tbody>${sCurveRows || `<tr><td colspan="9" class="five-empty">暂无计划数据</td></tr>`}</tbody>
            </table>
          </div>
          <div class="five-panel five-wide">
            <h3>合同段BOQ汇总</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>合同段</th><th>合同编号</th><th>清单数</th><th>合同金额</th><th>变更金额</th><th>最终金额</th><th>应付金额</th><th>支付比例</th></tr></thead>
              <tbody>${sectionRows}</tbody>
            </table>
          </div>
          <div class="five-panel five-wide">
            <h3>工程联系单估算影响</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>联系单</th><th>内容</th><th>合同段</th><th>影响类型</th><th>建议金额</th><th>状态</th></tr></thead>
              <tbody>${contactRows || `<tr><td colspan="6" class="five-empty">暂无联系单估算影响</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function costCalculatorPageHtml() {
  return `
    <div class="layui-fluid cost-calculator-page">
      <style>
        .cost-calculator-page { padding:16px; background:#f5f7fb; color:#172033; }
        .calc-shell { max-width:1180px; margin:0 auto; }
        .calc-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .calc-head h2 { margin:0; font-size:22px; font-weight:600; }
        .calc-head p { margin:6px 0 0; color:#64748b; }
        .calc-grid { display:grid; grid-template-columns:repeat(2, minmax(280px, 1fr)); gap:12px; }
        .calc-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; }
        .calc-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .calc-row { display:grid; grid-template-columns:110px 1fr; gap:8px; align-items:center; margin-bottom:8px; }
        .calc-row label { color:#475569; }
        .calc-row input { height:30px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; }
        .calc-result { display:grid; grid-template-columns:repeat(4, minmax(120px, 1fr)); gap:10px; margin-top:12px; }
        .calc-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:12px; }
        .calc-card span { display:block; color:#64748b; font-size:12px; }
        .calc-card strong { display:block; margin-top:8px; color:#0f766e; font-size:18px; }
        .calc-actions { display:flex; gap:8px; flex-wrap:wrap; }
        .calc-detail { margin-top:12px; background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:12px; }
        .calc-detail h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .calc-detail td, .calc-detail th { white-space:nowrap; }
        .calc-empty { color:#94a3b8; text-align:center; padding:18px; }
        @media (max-width:900px) { .calc-grid { grid-template-columns:1fr; } .calc-result { grid-template-columns:1fr 1fr; } .calc-head { align-items:flex-start; flex-direction:column; } }
      </style>
      <div class="calc-shell">
        <div class="calc-head">
          <div>
            <h2>造价计算器</h2>
            <p>按清单、变更、材料补差、材料到场和手动计量即时测算合同金额、最终金额、应付金额和支付比例。</p>
          </div>
          <div class="calc-actions">
            <button class="layui-btn layui-btn-sm layui-btn-primary" id="calc-run">计算</button>
            <button class="layui-btn layui-btn-sm layui-btn-normal" id="calc-ledger">载入当前台账</button>
          </div>
        </div>
        <form id="cost-calculator-form" class="calc-grid">
          <div class="calc-panel">
            <h3>清单计量</h3>
            <div class="calc-row"><label>清单编号</label><input name="billNo" value="101-1"></div>
            <div class="calc-row"><label>清单名称</label><input name="billName" value="临时道路"></div>
            <div class="calc-row"><label>合同数量</label><input name="quantity" value="100"></div>
            <div class="calc-row"><label>综合单价</label><input name="price" value="10"></div>
            <div class="calc-row"><label>计量数量</label><input name="measureNum" value="40"></div>
          </div>
          <div class="calc-panel">
            <h3>工程变更</h3>
            <div class="calc-row"><label>变更编号</label><input name="varyNo" value="BG-CALC-001"></div>
            <div class="calc-row"><label>变更前数量</label><input name="beforeNum" value="100"></div>
            <div class="calc-row"><label>变更前单价</label><input name="beforePrice" value="10"></div>
            <div class="calc-row"><label>变更后数量</label><input name="afterNum" value="120"></div>
            <div class="calc-row"><label>变更后单价</label><input name="afterPrice" value="10"></div>
          </div>
          <div class="calc-panel">
            <h3>材料补差/到场</h3>
            <div class="calc-row"><label>材料编号</label><input name="materialNo" value="CL-001"></div>
            <div class="calc-row"><label>材料名称</label><input name="materialName" value="钢筋"></div>
            <div class="calc-row"><label>补差数量</label><input name="materialQuantity" value="5"></div>
            <div class="calc-row"><label>基准价</label><input name="basePrice" value="10"></div>
            <div class="calc-row"><label>现行价</label><input name="currentPrice" value="13"></div>
            <div class="calc-row"><label>到场数量</label><input name="arrivalQuantity" value="8"></div>
          </div>
          <div class="calc-panel">
            <h3>手动计量</h3>
            <div class="calc-row"><label>清单编号</label><input name="manualBillNo" value="900-1"></div>
            <div class="calc-row"><label>清单名称</label><input name="manualBillName" value="零星工程"></div>
            <div class="calc-row"><label>计量数量</label><input name="manualQuantity" value="1"></div>
            <div class="calc-row"><label>单价</label><input name="manualPrice" value="50"></div>
          </div>
        </form>
        <div class="calc-result" id="cost-calculator-result">
          <div class="calc-card"><span>合同金额</span><strong>0.00</strong></div>
          <div class="calc-card"><span>最终金额</span><strong>0.00</strong></div>
          <div class="calc-card"><span>应付金额</span><strong>0.00</strong></div>
          <div class="calc-card"><span>支付比例</span><strong>0.00%</strong></div>
        </div>
        <div class="calc-detail">
          <h3>材料联动台账</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>材料编号</th><th>材料名称</th><th>补差数量</th><th>补差金额</th><th>到场数量</th><th>到场金额</th><th>覆盖率</th></tr></thead>
            <tbody id="cost-calculator-ledger"><tr><td colspan="7" class="calc-empty">暂无计算结果</td></tr></tbody>
          </table>
        </div>
      </div>
      <script>
        (function(){
          function value(name){ return document.querySelector('[name="'+name+'"]').value; }
          function money(value){ return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
          function fetchJson(url){ return fetch(url).then(function(r){ return r.json(); }).then(function(r){ return r.data || []; }); }
          function rowValue(row, names){ for(var i=0;i<names.length;i++){ if(row[names[i]] !== undefined && row[names[i]] !== null && row[names[i]] !== '') return row[names[i]]; } return ''; }
          function render(data){
            document.getElementById('cost-calculator-result').innerHTML = [
              ['合同金额', money(data.contractMoney)],
              ['变更金额', money(data.variationMoney)],
              ['最终金额', money(data.finalMoney)],
              ['清单计量', money(data.measuredMoney)],
              ['材料补差', money(data.materialAdjustMoney)],
              ['材料到场', money(data.materialArrivalMoney) + '（跟踪）'],
              ['手动计量', money(data.manualMoney)],
              ['应付金额', money(data.payableMoney) + ' / ' + money(data.payRate) + '%']
            ].map(function(row){ return '<div class="calc-card"><span>'+row[0]+'</span><strong>'+row[1]+'</strong></div>'; }).join('');
            var ledger = (((data.details || {}).materialLedger) || []);
            document.getElementById('cost-calculator-ledger').innerHTML = ledger.length ? ledger.map(function(row){
              return '<tr><td>'+ (row.materialNo || '') +'</td><td>'+ (row.materialName || '') +'</td><td>'+ money(row.diasQuantity) +'</td><td>'+ money(row.diasMoney) +'</td><td>'+ money(row.arrivalQuantity) +'</td><td>'+ money(row.arrivalMoney) +'</td><td>'+ money(row.coverageRate) +'%</td></tr>';
            }).join('') : '<tr><td colspan="7" class="calc-empty">暂无材料联动台账</td></tr>';
          }
          function calculate(payload){
            fetch('/api/cost/calculate', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify(payload)
            }).then(function(r){ return r.json(); }).then(function(r){ render(r.data || {}); });
          }
          document.getElementById('calc-run').onclick = function(){
            calculate({
                bills:[{ billNo:value('billNo'), billName:value('billName'), quantity:Number(value('quantity')), price:Number(value('price')), measureNum:Number(value('measureNum')) }],
                measures:[{ billNo:value('billNo'), measureNum:Number(value('measureNum')) }],
                variations:[{ varyNo:value('varyNo'), beforeNum:Number(value('beforeNum')), beforePrice:Number(value('beforePrice')), afterNum:Number(value('afterNum')), afterPrice:Number(value('afterPrice')) }],
                materialAdjustments:[{ materialNo:value('materialNo'), materialName:value('materialName'), quantity:Number(value('materialQuantity')), basePrice:Number(value('basePrice')), currentPrice:Number(value('currentPrice')) }],
                materialArrivals:[{ materialNo:value('materialNo'), materialName:value('materialName'), quantity:Number(value('arrivalQuantity')), price:Number(value('currentPrice')) }],
                manualMeasures:[{ billNo:value('manualBillNo'), billName:value('manualBillName'), quantity:Number(value('manualQuantity')), price:Number(value('manualPrice')) }]
              });
          };
          document.getElementById('calc-ledger').onclick = function(){
            Promise.all([
              fetchJson('/api/cost/bills?page=1&limit=10000'),
              fetchJson('/vary_measure/list?page=1&limit=10000'),
              fetchJson('/meterialdiasmeasure/meterial_dias_measure_list?page=1&limit=10000'),
              fetchJson('/meterialInMeasure/meterial_in_measure_list?page=1&limit=10000'),
              fetchJson('/manualMeasure/detail_list?page=1&limit=10000')
            ]).then(function(all){
              calculate({
                bills: all[0].map(function(row){ return { billId:row.billId, billNo:row.billNo, billName:row.billName, quantity:row.contractNum || row.quantity, price:row.price, measureNum:row.measuredNum }; }),
                variations: all[1].map(function(row){ return { varyNo:row.varyNo, varyReason:row.varyReason, beforeNum:row.beforeNum, beforePrice:row.beforePrice, afterNum:row.afterNum, afterPrice:row.afterPrice }; }),
                materialAdjustments: all[2].map(function(row){ return { materialNo:row.materialNo, materialName:row.materialName, quantity:row.quantity || row.measureNum, basePrice:row.basePrice, currentPrice:row.currentPrice }; }),
                materialArrivals: all[3].map(function(row){ return { materialNo:row.materialNo, materialName:row.materialName, quantity:row.quantity || row.measureNum, price:row.price || row.currentPrice || row.measurePrice }; }),
                manualMeasures: all[4].map(function(row){ return { billNo:row.billNo, billName:row.billName, quantity:row.measureNum || row.quantity, price:row.price }; })
              });
            });
          };
          document.getElementById('calc-run').click();
        })();
      </script>
    </div>`;
}

function businessInfoDashboardHtml(req) {
  const projectId = Number(req.query.projectId || req.body.projectId || 0);
  const project = engine.db.projects.find((row) => !projectId || Number(row.projectId || row.id) === projectId) || engine.db.projects[0] || {};
  const sections = engine.db.sections.filter((row) => !project.projectId || Number(row.projectId || 0) === Number(project.projectId || project.id));
  const sectionIds = new Set(sections.map((row) => Number(row.sectionId || row.id)));
  const reportRows = reportPaymentRows([...sectionIds]);
  const measures = engine.measureRows().filter((row) => !sectionIds.size || sectionIds.has(Number(row.sectionId)));
  const variations = engine.variationRows().filter((row) => !sectionIds.size || sectionIds.has(Number(row.sectionId)));
  const contacts = engine.db.contactBills.filter((row) => !sectionIds.size || sectionIds.has(Number(row.sectionId || 0)) || !row.sectionId);
  const documents = engine.documentRows();
  const summary = reportRows.reduce((acc, row) => {
    acc.contractMoney += Number(row.contractMoney || 0);
    acc.finalMoney += Number(row.finalMoney || 0);
    acc.totalPayMoney += Number(row.totalPayMoney || 0);
    acc.materialDiasMoney += Number(row.materialDiasMoney || 0);
    acc.materialArrivalMoney += Number(row.materialArrivalMoney || 0);
    acc.manualMoney += Number(row.manualMoney || 0);
    return acc;
  }, { contractMoney: 0, finalMoney: 0, totalPayMoney: 0, materialDiasMoney: 0, materialArrivalMoney: 0, manualMoney: 0 });
  summary.varyMoney = variations.reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
  summary.payRate = summary.finalMoney ? (summary.totalPayMoney / summary.finalMoney) * 100 : 0;

  const cards = [
    ["合同金额", moneyText(summary.contractMoney), "所有合同段清单金额汇总"],
    ["最终金额", moneyText(summary.finalMoney), "合同金额加变更后的控制金额"],
    ["累计支付", moneyText(summary.totalPayMoney), `支付比例 ${percentText(summary.payRate)}`],
    ["材料到场", moneyText(summary.materialArrivalMoney), "到场跟踪不计入应付"],
    ["变更金额", moneyText(summary.varyMoney), `${variations.length} 条变更记录`],
    ["工程联系单", String(contacts.length), "技术联系、会议纪要、审批流"],
    ["工程资料", String(documents.length), "资料节点与归档文件"]
  ].map(([label, value, hint]) => `
    <div class="biz-card">
      <div class="biz-label">${htmlEscape(label)}</div>
      <div class="biz-value">${htmlEscape(value)}</div>
      <div class="biz-hint">${htmlEscape(hint)}</div>
    </div>`).join("");

  const sectionRows = reportRows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.contractNo || "")}</td>
      <td>${moneyText(row.contractMoney)}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${moneyText(row.materialArrivalMoney)}</td>
      <td>${moneyText(row.totalPayMoney)}</td>
      <td>${percentText(row.payRate)}</td>
    </tr>`).join("");
  const contactRows = contacts.slice(0, 8).map((row) => `
    <tr>
      <td>${htmlEscape(row.contactNo || row.skillNo || "")}</td>
      <td>${htmlEscape(row.title || row.contactContent || "")}</td>
      <td>${htmlEscape(row.sectionName || row.workAreaName || "")}</td>
      <td>${htmlEscape(row.states || "")}</td>
      <td>${htmlEscape(row.createDate || "")}</td>
    </tr>`).join("");
  const variationRows = variations.slice(0, 8).map((row) => `
    <tr>
      <td>${htmlEscape(row.varyNo || "")}</td>
      <td>${htmlEscape(row.billName || row.varyItem || "")}</td>
      <td>${moneyText(row.varyMoney)}</td>
      <td>${htmlEscape(row.states || "")}</td>
    </tr>`).join("");

  return `
    <div class="layui-fluid business-info-page">
      <style>
        .business-info-page { padding:16px; background:#f4f7fb; color:#172033; }
        .biz-shell { max-width:1280px; margin:0 auto; }
        .biz-title { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .biz-title h2 { margin:0; font-size:22px; font-weight:600; }
        .biz-title p { margin:6px 0 0; color:#64748b; }
        .biz-grid { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:14px; }
        .biz-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px 16px; min-height:86px; }
        .biz-label { color:#64748b; font-size:13px; }
        .biz-value { margin-top:8px; font-size:22px; font-weight:700; color:#0f766e; }
        .biz-hint { margin-top:8px; color:#6b7280; font-size:12px; }
        .biz-panels { display:grid; grid-template-columns:1.25fr .75fr; gap:12px; margin-top:12px; }
        .biz-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; }
        .biz-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .biz-panel table { margin:0; }
        .biz-empty { text-align:center; color:#94a3b8; padding:22px; }
        @media (max-width:1100px) { .biz-grid { grid-template-columns:repeat(3, 1fr); } .biz-panels { grid-template-columns:1fr; } }
        @media (max-width:640px) { .biz-grid { grid-template-columns:1fr 1fr; } .biz-title { display:block; } }
      </style>
      <div class="biz-shell">
        <div class="biz-title">
          <div>
            <h2>业务信息</h2>
            <p>${htmlEscape(project.projectName || "工程项目")} · 合同、计量、变更、联系单、资料归档综合看板</p>
          </div>
          <button class="layui-btn layui-btn-sm" onclick="location.href='/reportManager/reportViewSecurity?reportCode=MEASUREREOPORT'">生成支付报表</button>
        </div>
        <div class="biz-grid">${cards}</div>
        <div class="biz-panel">
          <h3>合同段支付汇总</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>合同段</th><th>合同编号</th><th>合同金额</th><th>最终金额</th><th>材料到场</th><th>累计支付</th><th>支付比例</th></tr></thead>
            <tbody>${sectionRows || `<tr><td colspan="7" class="biz-empty">暂无合同段数据</td></tr>`}</tbody>
          </table>
        </div>
        <div class="biz-panels">
          <div class="biz-panel">
            <h3>工程联系单</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>联系单号</th><th>标题</th><th>合同段</th><th>状态</th><th>日期</th></tr></thead>
              <tbody>${contactRows || `<tr><td colspan="5" class="biz-empty">暂无工程联系单</td></tr>`}</tbody>
            </table>
          </div>
          <div class="biz-panel">
            <h3>变更动态</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>变更编号</th><th>项目</th><th>金额</th><th>状态</th></tr></thead>
              <tbody>${variationRows || `<tr><td colspan="4" class="biz-empty">暂无变更数据</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function contactPrintableReportHtml(req, ids) {
  const rows = engine.db.contactBills
    .filter((row) => !ids.length || ids.includes(Number(row.contactId || row.id)))
    .map((row) => ({
      ...row,
      skillNo: row.skillNo || row.contactNo,
      contactContent: row.contactContent || row.title,
      changeMeetingText: row.changeMeetingText || "现场技术联系记录",
      userName: row.userName || "ys1"
    }));
  const body = rows.map((row) => `
    <section class="contact-sheet">
      <table>
        <tr><th>联系单号</th><td>${htmlEscape(row.skillNo || "")}</td><th>合同段</th><td>${htmlEscape(row.sectionName || row.workAreaName || "")}</td></tr>
        <tr><th>标题</th><td colspan="3">${htmlEscape(row.title || "")}</td></tr>
        <tr><th>填报人</th><td>${htmlEscape(row.userName || "")}</td><th>填报日期</th><td>${htmlEscape(row.createDate || "")}</td></tr>
        <tr><th>当前状态</th><td>${htmlEscape(row.states || "")}</td><th>流程编号</th><td>${htmlEscape(row.processInstanceId || "")}</td></tr>
        <tr><th>影响类型</th><td>${htmlEscape(row.costImpactType || "技术联系")}</td><th>建议金额</th><td>${moneyText(row.estimateMoney || row.money || 0)}</td></tr>
        <tr><th>联系内容</th><td colspan="3" class="long-text">${htmlEscape(row.contactContent || "")}</td></tr>
        <tr><th>会议纪要</th><td colspan="3" class="long-text">${htmlEscape(row.changeMeetingText || "")}</td></tr>
      </table>
    </section>`).join("");
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>工程技术联系单</title>
      <link rel="stylesheet" href="/assets/layui/css/layui.css">
      <style>
        body { background:#f3f6fb; padding:22px; font-family:"Microsoft YaHei", Arial, sans-serif; color:#172033; }
        .report { background:#fff; max-width:980px; margin:0 auto; padding:28px 34px; box-shadow:0 8px 30px rgba(15,23,42,.12); }
        h1 { text-align:center; font-size:24px; margin:0 0 10px; }
        .meta { display:flex; justify-content:space-between; color:#64748b; margin-bottom:16px; font-size:13px; }
        table { width:100%; border-collapse:collapse; margin-top:10px; }
        th, td { border:1px solid #d8dee9; padding:10px 12px; font-size:14px; vertical-align:top; }
        th { width:120px; background:#eef3f8; text-align:center; font-weight:600; }
        .long-text { min-height:72px; line-height:1.8; text-align:left; white-space:pre-wrap; }
        .contact-sheet + .contact-sheet { margin-top:28px; padding-top:20px; border-top:2px dashed #cbd5e1; }
        @media print { body { background:#fff; padding:0; } .report { box-shadow:none; max-width:none; } }
      </style>
    </head>
    <body>
      <div class="report">
        <h1>工程技术联系单</h1>
        <div class="meta"><span>报表编码：vary_skill_contact</span><span>生成日期：${today()}</span></div>
        ${body || `<div style="text-align:center;color:#94a3b8;padding:36px;">暂无工程联系单数据</div>`}
      </div>
    </body>
    </html>`;
}

function variationReportIds(req) {
  return idsFromQueryValue(
    req.query.varyIds ||
    req.body.varyIds ||
    req.query.varyId ||
    req.body.varyId ||
    req.query.ids ||
    req.body.ids
  );
}

function variationOrderReportHtml(req) {
  const ids = variationReportIds(req);
  const rows = engine.variationRows()
    .filter((row) => !ids.length || ids.includes(Number(row.varyId || row.varyDetailId || row.id)))
    .map((row) => ({
      ...row,
      varyGradeName: row.varyGrade && row.varyGrade.bdName,
      varyTypeName: row.varyType && row.varyType.bdName
    }));
  const totalBefore = rows.reduce((sum, row) => sum + Number(row.beforeVaryMoney || 0), 0);
  const totalAfter = rows.reduce((sum, row) => sum + Number(row.afterVaryMoney || 0), 0);
  const totalVary = rows.reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
  const body = rows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${htmlEscape(row.varyNo || "")}</td>
      <td>${htmlEscape(row.sectionName || row.workAreaName || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || row.varyContent || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.beforeVaryNum || row.beforeNum || 0)}</td>
      <td>${moneyText(row.beforeVaryPrice || row.beforePrice)}</td>
      <td>${moneyText(row.beforeVaryMoney)}</td>
      <td>${Number(row.afterVaryNum || row.afterNum || 0)}</td>
      <td>${moneyText(row.afterVaryPrice || row.afterPrice)}</td>
      <td>${moneyText(row.afterVaryMoney)}</td>
      <td>${moneyText(row.varyMoney)}</td>
      <td>${htmlEscape(row.varyGradeName || "")}</td>
      <td>${htmlEscape(row.states || "")}</td>
    </tr>
    <tr class="reason-row">
      <th>变更原因</th>
      <td colspan="14" class="left">${htmlEscape(row.varyReason || row.varyItem || "")}</td>
    </tr>`).join("");
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>工程变更申请报表</title>
      <link rel="stylesheet" href="/assets/layui/css/layui.css">
      <style>
        body { background:#f3f6fb; padding:22px; font-family:"Microsoft YaHei", Arial, sans-serif; color:#172033; }
        .report { background:#fff; max-width:1320px; margin:0 auto; padding:28px 34px; box-shadow:0 8px 30px rgba(15,23,42,.12); }
        h1 { text-align:center; font-size:24px; margin:0 0 10px; }
        .meta { display:flex; justify-content:space-between; color:#64748b; margin-bottom:16px; font-size:13px; }
        .summary { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin:14px 0 18px; }
        .summary div { border:1px solid #d8dee9; background:#f8fafc; padding:10px 12px; }
        .summary span { display:block; color:#64748b; font-size:12px; }
        .summary strong { display:block; margin-top:4px; font-size:18px; color:#0f766e; }
        table { width:100%; border-collapse:collapse; }
        th, td { border:1px solid #d8dee9; padding:8px 9px; font-size:12px; text-align:center; vertical-align:middle; }
        th { background:#eef3f8; font-weight:600; }
        .left { text-align:left; }
        .reason-row th { background:#f8fafc; width:90px; }
        .empty { color:#94a3b8; padding:32px; text-align:center; }
        @media print { body { background:#fff; padding:0; } .report { box-shadow:none; max-width:none; padding:0; } }
      </style>
    </head>
    <body>
      <div class="report">
        <h1>工程变更申请报表</h1>
        <div class="meta"><span>报表编码：report_vary_apply</span><span>生成日期：${today()}</span></div>
        <div class="summary">
          <div><span>变更前金额</span><strong>${moneyText(totalBefore)}</strong></div>
          <div><span>变更后金额</span><strong>${moneyText(totalAfter)}</strong></div>
          <div><span>变更金额合计</span><strong>${moneyText(totalVary)}</strong></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>序号</th><th>变更编号</th><th>合同段</th><th>清单编号</th><th>清单名称</th><th>单位</th>
              <th>变更前数量</th><th>变更前单价</th><th>变更前金额</th>
              <th>变更后数量</th><th>变更后单价</th><th>变更后金额</th>
              <th>变更金额</th><th>变更等级</th><th>状态</th>
            </tr>
          </thead>
          <tbody>${body || `<tr><td colspan="15" class="empty">暂无工程变更数据</td></tr>`}</tbody>
        </table>
      </div>
    </body>
    </html>`;
}

function idsFromQueryValue(value) {
  if (!value || value === "*") return [];
  return String(value)
    .split(",")
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function printableReportHtml(req) {
  const reportCode = String(req.query.reportCode || req.body.reportCode || "");
  const ids = idsFromQueryValue(req.query.ids || req.body.ids || req.query.rpId || req.body.rpId);
  if (reportCode === "vary_skill_contact") return contactPrintableReportHtml(req, ids);
  let title = "计量支付报表";
  let columns = [
    { title: "合同段", field: "sectionName" },
    { title: "合同编号", field: "contractNo" },
    { title: "合同金额", field: "contractMoney" },
    { title: "最终金额", field: "finalMoney" },
    { title: "清单计量", field: "billMeasureMoney" },
    { title: "材料补差", field: "materialDiasMoney" },
    { title: "材料到场", field: "materialArrivalMoney" },
    { title: "手动计量", field: "manualMoney" },
    { title: "累计支付", field: "totalPayMoney" },
    { title: "支付比例", field: "payRate" }
  ];
  let rows = reportPaymentRows(ids);

  if (reportCode === "report_bill_measure") {
    title = "清单计量报表";
    rows = engine.measureRows().filter((row) => !ids.length || ids.includes(Number(row.billMeasureId || row.measureId)));
    columns = [
      { title: "计量单号", field: "measureNo" },
      { title: "图号", field: "drawNo" },
      { title: "桩号", field: "pegNo" },
      { title: "交工证书", field: "certifyNo" },
      { title: "部位", field: "position" },
      { title: "计量日期", field: "measureDate" },
      { title: "计量金额", field: "measureMoney" },
      { title: "状态", field: "states" }
    ];
  } else if (reportCode === "report_vary_apply") {
    title = "工程变更申请报表";
    rows = engine.variationRows().filter((row) => !ids.length || ids.includes(Number(row.varyId)));
    columns = [
      { title: "变更编号", field: "varyNo" },
      { title: "变更等级", field: "varyGradeName" },
      { title: "变更类型", field: "varyTypeName" },
      { title: "变更项目", field: "varyItem" },
      { title: "变更金额", field: "varyMoney" },
      { title: "状态", field: "states" }
    ];
    rows = rows.map((row) => ({
      ...row,
      varyGradeName: row.varyGrade && row.varyGrade.bdName,
      varyTypeName: row.varyType && row.varyType.bdName
    }));
  } else if (reportCode === "vary_skill_contact") {
    title = "工程技术联系单";
    rows = engine.db.contactBills
      .filter((row) => !ids.length || ids.includes(Number(row.contactId || row.id)))
      .map((row) => ({
        ...row,
        skillNo: row.skillNo || row.contactNo,
        contactContent: row.contactContent || row.title,
        userName: row.userName || "ys1"
      }));
    columns = [
      { title: "联系单号", field: "skillNo" },
      { title: "标题", field: "title" },
      { title: "内容", field: "contactContent" },
      { title: "填报人", field: "userName" },
      { title: "创建日期", field: "createDate" },
      { title: "状态", field: "states" }
    ];
  } else if (reportCode === "MEASUREREOPORT" || req.query.rpId) {
    title = "计量支付报表";
    rows = reportPaymentRows(ids);
    columns = [
      { title: "合同段", field: "sectionName" },
      { title: "合同编号", field: "contractNo" },
      { title: "合同金额", field: "contractMoney" },
      { title: "最终金额", field: "finalMoney" },
      { title: "清单计量", field: "billMeasureMoney" },
      { title: "材料补差", field: "materialDiasMoney" },
      { title: "材料到场", field: "materialArrivalMoney" },
      { title: "手动计量", field: "manualMoney" },
      { title: "累计支付", field: "totalPayMoney" },
      { title: "支付比例", field: "payRate" }
    ];
  }

  const header = columns.map((col) => `<th>${htmlEscape(col.title)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map((col) => `<td>${htmlEscape(row[col.field] ?? "")}</td>`).join("")}</tr>`).join("");
  const summary = engine.contractSummary();
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${htmlEscape(title)}</title>
      <link rel="stylesheet" href="/assets/layui/css/layui.css">
      <style>
        body { background:#f3f6fb; padding:22px; font-family:"Microsoft YaHei", Arial, sans-serif; }
        .report { background:#fff; max-width:1100px; margin:0 auto; padding:28px 34px; box-shadow:0 8px 30px rgba(15,23,42,.12); }
        h1 { text-align:center; font-size:24px; margin:0 0 18px; }
        .meta { display:flex; justify-content:space-between; color:#64748b; margin-bottom:16px; font-size:13px; }
        table { width:100%; border-collapse:collapse; }
        th, td { border:1px solid #d8dee9; padding:9px 10px; font-size:13px; text-align:center; }
        th { background:#eef3f8; }
        .summary { margin-bottom:16px; }
        @media print { body { background:#fff; padding:0; } .report { box-shadow:none; max-width:none; } }
      </style>
    </head>
    <body>
      <div class="report">
        <h1>${htmlEscape(title)}</h1>
        <div class="meta"><span>报表编码：${htmlEscape(reportCode || "MEASUREREOPORT")}</span><span>生成日期：${today()}</span></div>
        <table class="summary">
          <tr><th>合同金额</th><td>${summary.contractSumMoney}</td><th>变更金额</th><td>${summary.varyMoney}</td><th>累计支付</th><td>${summary.payableMoney}</td></tr>
        </table>
        <table>
          <thead><tr>${header}</tr></thead>
          <tbody>${body || `<tr><td colspan="${columns.length}">暂无数据</td></tr>`}</tbody>
        </table>
      </div>
    </body>
    </html>`;
}

function importMeasureRows() {
  return engine.allMeasureDetails().map((row, index) => ({
    id: index + 1,
    fileName: row.fileName || "measure-import-template.xlsx",
    size: row.size || 28672,
    fileDate: row.measureDate || today(),
    sort: index + 1,
    status: row.status ?? 0,
    attId: 1,
    importStatus: "已解析",
    checkStatus: "通过",
    billNo: row.billNo,
    billName: row.billName,
    measureUnit: row.measureUnit,
    measureNum: row.measureNum,
    price: row.price,
    money: row.money,
    remark: "来自本地计量明细"
  }));
}

function importMeasurePreviewRows(attId = 0) {
  const attachment = importAttachmentRows().find((row) => Number(row.attId || row.attachmentId || row.id) === Number(attId));
  const parsedRows = attachment && Array.isArray(attachment.parsedRows) ? attachment.parsedRows : [];
  if (!parsedRows.length) return importMeasureRows();
  return parsedRows.map((row, index) => {
    const bill = engine.db.bills.find((item) => {
      if (Number(row.billId || 0) && Number(item.billId || 0) === Number(row.billId)) return true;
      if (row.billNo && String(item.billNo || "") === String(row.billNo)) return true;
      return false;
    }) || {};
    const measureNum = Number(row.measureNum ?? row.quantity ?? row.currentNum ?? row.num ?? 0);
    const price = Number(row.price ?? bill.price ?? bill.contractPrice ?? 0);
    return {
      id: index + 1,
      fileName: attachment.fileName,
      size: attachment.size,
      fileDate: attachment.fileDate || attachment.uploadDate || today(),
      sort: index + 1,
      status: 0,
      attId: attachment.attId,
      importStatus: attachment.state || "已解析",
      checkStatus: bill.billId ? "通过" : "未匹配清单",
      billId: bill.billId || row.billId || "",
      billNo: row.billNo || bill.billNo || "",
      billName: row.billName || bill.billName || row.name || "",
      measureUnit: row.measureUnit || row.unit || bill.measureUnit || bill.unit || "",
      measureNum,
      price,
      money: Number((measureNum * price).toFixed(2)),
      remark: row.remark || "来自上传解析明细"
    };
  });
}

function defaultAnalyzeNodes() {
  return [
    { id: 1, nodeId: 1, parentId: 0, pId: 0, nodeName: "路基工程", name: "路基工程", countNum: 2 },
    { id: 2, nodeId: 2, parentId: 1, pId: 1, nodeName: "土石方", name: "土石方", countNum: 0 },
    { id: 3, nodeId: 3, parentId: 1, pId: 1, nodeName: "基层", name: "基层", countNum: 0 },
    { id: 4, nodeId: 4, parentId: 0, pId: 0, nodeName: "桥梁工程", name: "桥梁工程", countNum: 2 },
    { id: 5, nodeId: 5, parentId: 4, pId: 4, nodeName: "混凝土", name: "混凝土", countNum: 0 },
    { id: 6, nodeId: 6, parentId: 4, pId: 4, nodeName: "钢筋", name: "钢筋", countNum: 0 }
  ];
}

function ensureAnalyzeNodes() {
  if (!Array.isArray(engine.db.analyzeNodes) || !engine.db.analyzeNodes.length) {
    engine.db.analyzeNodes = defaultAnalyzeNodes();
  }
  return engine.db.analyzeNodes;
}

function analyzeNodeRows() {
  ensureBillAnalyzeAssignments();
  const nodes = ensureAnalyzeNodes();
  const parentIds = new Set(nodes.map((row) => Number(row.parentId || row.pId || 0)).filter(Boolean));
  return nodes.map((row) => ({
    ...row,
    id: row.nodeId || row.id,
    nodeId: row.nodeId || row.id,
    pId: row.parentId || row.pId || 0,
    parentId: row.parentId || row.pId || 0,
    name: row.name || row.nodeName,
    nodeName: row.nodeName || row.name,
    billCount: engine.db.bills.filter((bill) => Number(bill.analyzeNodeId) === Number(row.nodeId || row.id)).length,
    isParent: parentIds.has(Number(row.nodeId || row.id))
  }));
}

function analyzeNodeIdFrom(req) {
  return Number(
    req.body.nodeId ||
    req.query.nodeId ||
    req.body.analyzeId ||
    req.query.analyzeId ||
    req.params.id ||
    idsFrom(req, "ids")[0] ||
    0
  );
}

function analyzeNodeById(id) {
  return ensureAnalyzeNodes().find((row) => Number(row.nodeId || row.id) === Number(id));
}

function analyzeNodeFormHtml(req) {
  const body = { ...req.query, ...req.body };
  const sourceId = analyzeNodeIdFrom(req);
  const actionType = String(body.type || "showOwn");
  const isEdit = actionType === "showOwn" && sourceId > 0;
  const source = analyzeNodeById(sourceId) || {};
  const item = isEdit ? source : {};
  const parentId = actionType === "addLevel"
    ? Number(source.parentId || source.pId || 0)
    : actionType === "addNext"
      ? sourceId
      : Number(item.parentId || item.pId || 0);
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="analyze-node-form">
        <input type="hidden" name="nodeId" value="${isEdit ? htmlEscape(item.nodeId || item.id || "") : ""}">
        <input type="hidden" name="sourceNodeId" value="${sourceId || ""}">
        <input type="hidden" name="parentId" value="${parentId || 0}">
        <input type="hidden" name="type" value="${htmlEscape(actionType)}">
        <div class="layui-form-item">
          <label class="layui-form-label">节点名称</label>
          <div class="layui-input-block"><input class="layui-input" name="nodeName" value="${htmlEscape(item.nodeName || item.name || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">父级节点</label>
          <div class="layui-input-block"><input class="layui-input" name="parentName" readonly value="${htmlEscape(parentId ? ((analyzeNodeById(parentId) || {}).nodeName || "") : "根节点")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">挂接清单数</label>
          <div class="layui-input-block"><input class="layui-input" readonly value="${Number(item.billCount || item.countNum || 0)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">备注</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="remark">${htmlEscape(item.remark || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/billAnalyzeNode/save_node',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存节点</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveAnalyzeNode(req) {
  const body = { ...req.query, ...req.body };
  const nodes = ensureAnalyzeNodes();
  let id = analyzeNodeIdFrom(req);
  let item = analyzeNodeById(id);
  if (!item) {
    id = nextId(nodes, "nodeId");
    item = { id, nodeId: id };
    nodes.push(item);
  }
  const parentId = numeric(body.parentId, item.parentId || item.pId || 0);
  const nodeName = body.nodeName || body.name || item.nodeName || `节点 ${id}`;
  item.id = item.id || id;
  item.nodeId = item.nodeId || id;
  item.parentId = parentId;
  item.pId = parentId;
  item.nodeName = nodeName;
  item.name = nodeName;
  item.remark = body.remark || item.remark || "";
  item.countNum = engine.db.bills.filter((bill) => Number(bill.analyzeNodeId) === Number(item.nodeId)).length;
  return { changed: 1, nodeId: item.nodeId, row: analyzeNodeRows().find((row) => Number(row.nodeId) === Number(item.nodeId)) };
}

function removeAnalyzeNodes(ids) {
  const nodes = ensureAnalyzeNodes();
  const pending = [...ids];
  const toRemove = new Set(ids);
  while (pending.length) {
    const parentId = pending.pop();
    nodes.forEach((row) => {
      const id = Number(row.nodeId || row.id);
      if (Number(row.parentId || row.pId || 0) === parentId && !toRemove.has(id)) {
        toRemove.add(id);
        pending.push(id);
      }
    });
  }
  engine.db.bills.forEach((bill) => {
    if (toRemove.has(Number(bill.analyzeNodeId))) {
      delete bill.analyzeNodeId;
    }
  });
  return removeRows(nodes, "nodeId", [...toRemove]);
}

function ensureBillAnalyzeAssignments() {
  ensureAnalyzeNodes();
  const fallbackByChapter = { "100": 2, "200": 2, "300": 3, "400": 5, "900": 6 };
  engine.db.bills.forEach((bill) => {
    if (bill.analyzeNodeId === undefined || bill.analyzeNodeId === null) {
      bill.analyzeNodeId = fallbackByChapter[String(bill.chapter || "").slice(0, 3)] || 6;
    }
  });
}

function billAnalyzeRows(req) {
  ensureBillAnalyzeAssignments();
  const nodeId = Number(req && ((req.query && req.query.nodeId) || (req.body && req.body.nodeId)) || 0);
  const rows = nodeId > 0
    ? engine.billRows().filter((row) => Number(row.analyzeNodeId) === nodeId)
    : engine.billRows();
  return rows.map((row) => ({
    ...row,
    analyzeId: row.billId,
    analyzeNodeId: row.analyzeNodeId || 0,
    amount: row.contractNum,
    unitPrice: row.price,
    workDrawAmount: row.contractNum,
    workDrawMoney: row.contractMoney,
    modifyAmount: row.correctedNum,
    modifyMoney: row.correctedMoney,
    finalAmount: row.finalNum,
    cumulativeAmount: row.measuredNum
  }));
}

function subItemLedgerRows(req) {
  const nodeId = Number(req && ((req.query && req.query.nodeId) || (req.body && req.body.nodeId)) || 0);
  const nodes = analyzeNodeRows();
  const selected = nodeId > 0 ? nodes.filter((node) => Number(node.nodeId) === nodeId) : nodes;
  const billRows = engine.billRows();
  return selected.map((node) => {
    const bills = billRows.filter((bill) => Number(bill.analyzeNodeId || 0) === Number(node.nodeId));
    const contractMoney = bills.reduce((sum, bill) => sum + Number(bill.contractMoney || 0), 0);
    const finalMoney = bills.reduce((sum, bill) => sum + Number(bill.finalMoney || 0), 0);
    const measuredMoney = bills.reduce((sum, bill) => sum + Number(bill.measuredMoney || 0), 0);
    const remainMoney = finalMoney - measuredMoney;
    return {
      nodeId: node.nodeId,
      nodeName: node.nodeName || node.name,
      billCount: bills.length,
      contractMoney: Number(contractMoney.toFixed(2)),
      finalMoney: Number(finalMoney.toFixed(2)),
      measuredMoney: Number(measuredMoney.toFixed(2)),
      remainMoney: Number(remainMoney.toFixed(2)),
      measureRate: finalMoney ? Number(((measuredMoney / finalMoney) * 100).toFixed(2)) : 0
    };
  });
}

function subItemLedgerHtml(req) {
  const rows = subItemLedgerRows(req);
  const total = rows.reduce((acc, row) => {
    acc.billCount += Number(row.billCount || 0);
    acc.contractMoney += Number(row.contractMoney || 0);
    acc.finalMoney += Number(row.finalMoney || 0);
    acc.measuredMoney += Number(row.measuredMoney || 0);
    acc.remainMoney += Number(row.remainMoney || 0);
    return acc;
  }, { billCount: 0, contractMoney: 0, finalMoney: 0, measuredMoney: 0, remainMoney: 0 });
  const body = rows.map((row) => `
        <tr>
          <td>${htmlEscape(row.nodeName)}</td>
          <td>${row.billCount}</td>
          <td>${row.contractMoney}</td>
          <td>${row.finalMoney}</td>
          <td>${row.measuredMoney}</td>
          <td>${row.remainMoney}</td>
          <td>${row.measureRate}%</td>
        </tr>`).join("");
  return `
    <div class="layui-card" style="margin:10px;">
      <div class="layui-card-header">分项台账</div>
      <div class="layui-card-body">
        <table class="layui-table" lay-size="sm" id="sub-item-ledger-table">
          <thead><tr><th>分项名称</th><th>清单数</th><th>合同金额</th><th>最终金额</th><th>已计量金额</th><th>剩余金额</th><th>计量比例</th></tr></thead>
          <tbody>${body || '<tr><td colspan="7" style="text-align:center;">暂无分项数据</td></tr>'}</tbody>
          <tfoot><tr><th>合计</th><th>${total.billCount}</th><th>${Number(total.contractMoney.toFixed(2))}</th><th>${Number(total.finalMoney.toFixed(2))}</th><th>${Number(total.measuredMoney.toFixed(2))}</th><th>${Number(total.remainMoney.toFixed(2))}</th><th>${total.finalMoney ? Number(((total.measuredMoney / total.finalMoney) * 100).toFixed(2)) : 0}%</th></tr></tfoot>
        </table>
      </div>
    </div>`;
}

function billAnalyzeDashboardHtml(req) {
  ensureBillAnalyzeAssignments();
  const nodes = analyzeNodeRows();
  const selectedNodeId = Number(req.query.nodeId || req.body.nodeId || nodes.find((node) => Number(node.billCount || 0) > 0)?.nodeId || nodes[0]?.nodeId || 0);
  const selectedNode = nodes.find((node) => Number(node.nodeId) === selectedNodeId) || nodes[0] || {};
  const ledgerRows = subItemLedgerRows({ query: { nodeId: 0 }, body: {} });
  const selectedBills = billAnalyzeRows({ query: { nodeId: selectedNodeId }, body: {} });
  const totals = ledgerRows.reduce((acc, row) => {
    acc.billCount += Number(row.billCount || 0);
    acc.contractMoney += Number(row.contractMoney || 0);
    acc.finalMoney += Number(row.finalMoney || 0);
    acc.measuredMoney += Number(row.measuredMoney || 0);
    acc.remainMoney += Number(row.remainMoney || 0);
    return acc;
  }, { billCount: 0, contractMoney: 0, finalMoney: 0, measuredMoney: 0, remainMoney: 0 });
  const treeBody = nodes.map((node) => {
    const active = Number(node.nodeId) === Number(selectedNodeId) ? " active" : "";
    const depth = Number(node.parentId || node.pId || 0) ? 1 : 0;
    return `
      <li class="${active}">
        <a href="/billAnalyze/dashboard_page?nodeId=${node.nodeId}" style="padding-left:${12 + depth * 18}px;">
          <strong>${htmlEscape(node.nodeName || node.name || "")}</strong>
          <span>${Number(node.billCount || 0)} 项清单</span>
        </a>
      </li>`;
  }).join("");
  const billBody = selectedBills.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.contractNum || 0)}</td>
      <td>${moneyText(row.price)}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${moneyText(row.measuredMoney)}</td>
      <td>${moneyText(row.remainMoney)}</td>
    </tr>`).join("");
  const ledgerBody = ledgerRows.map((row) => `
    <tr>
      <td class="left">${htmlEscape(row.nodeName || "")}</td>
      <td>${row.billCount}</td>
      <td>${moneyText(row.contractMoney)}</td>
      <td>${moneyText(row.finalMoney)}</td>
      <td>${moneyText(row.measuredMoney)}</td>
      <td>${moneyText(row.remainMoney)}</td>
      <td>${percentText(row.measureRate)}</td>
    </tr>`).join("");
  const cards = [
    ["分项节点", String(nodes.length), "分部分项树节点数"],
    ["挂接清单", String(totals.billCount), "已归类清单数量"],
    ["合同金额", moneyText(totals.contractMoney), "挂接清单合同金额"],
    ["最终金额", moneyText(totals.finalMoney), "含变更后的金额"],
    ["累计计量", moneyText(totals.measuredMoney), "分项累计计量"],
    ["计量比例", percentText(totals.finalMoney ? (totals.measuredMoney / totals.finalMoney) * 100 : 0), "累计计量 / 最终金额"]
  ].map(([label, value, hint]) => `
    <div class="analyze-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  return `
    <div class="layui-fluid bill-analyze-dashboard">
      <style>
        .bill-analyze-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .analyze-shell { max-width:1380px; margin:0 auto; }
        .analyze-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .analyze-head h2 { margin:0; font-size:22px; font-weight:600; }
        .analyze-head p { margin:6px 0 0; color:#64748b; }
        .analyze-actions { display:flex; gap:8px; flex-wrap:wrap; }
        .analyze-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .analyze-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .analyze-card span, .analyze-card small { display:block; color:#64748b; font-size:12px; }
        .analyze-card strong { display:block; margin:8px 0; color:#4338ca; font-size:20px; }
        .analyze-grid { display:grid; grid-template-columns:280px 1fr; gap:12px; }
        .analyze-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .analyze-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .analyze-tree { list-style:none; margin:0; padding:0; }
        .analyze-tree li { border:1px solid #e2e8f0; border-radius:5px; margin-bottom:8px; }
        .analyze-tree li.active { border-color:#6366f1; background:#eef2ff; }
        .analyze-tree a { display:block; color:#172033; padding:10px 11px; }
        .analyze-tree strong, .analyze-tree span { display:block; }
        .analyze-tree span { margin-top:4px; color:#64748b; font-size:12px; }
        .analyze-panel table { margin:0; min-width:900px; }
        .analyze-wide { grid-column:1 / -1; }
        .left { text-align:left; }
        .analyze-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .analyze-cards { grid-template-columns:repeat(3, 1fr); } .analyze-grid { grid-template-columns:1fr; } .analyze-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .analyze-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="analyze-shell">
        <div class="analyze-head">
          <div>
            <h2>分部分项管理</h2>
            <p>维护分项节点与清单挂接关系，按分项汇总合同金额、最终金额、累计计量和剩余金额。</p>
          </div>
          <div class="analyze-actions">
            <a class="layui-btn layui-btn-sm" href="/billAnalyzeNode/edit_node?type=addLevel">新增节点</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/billAnalyze/sec_bill_list?nodeId=${selectedNodeId}">挂接清单</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/leaderquery/find_sub_item_page">分项台账</a>
          </div>
        </div>
        <div class="analyze-cards">${cards}</div>
        <div class="analyze-grid">
          <div class="analyze-panel">
            <h3>分项节点树</h3>
            <ul class="analyze-tree">${treeBody || `<li><a>暂无节点</a></li>`}</ul>
          </div>
          <div class="analyze-panel">
            <h3>挂接清单：${htmlEscape(selectedNode.nodeName || selectedNode.name || "")}</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>合同段</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>合同数量</th><th>单价</th><th>最终金额</th><th>累计计量</th><th>剩余金额</th></tr></thead>
              <tbody>${billBody || `<tr><td colspan="9" class="analyze-empty">当前分项暂无挂接清单</td></tr>`}</tbody>
            </table>
          </div>
          <div class="analyze-panel analyze-wide">
            <h3>分项金额汇总</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>分项名称</th><th>清单数</th><th>合同金额</th><th>最终金额</th><th>累计计量</th><th>剩余金额</th><th>计量比例</th></tr></thead>
              <tbody>${ledgerBody || `<tr><td colspan="7" class="analyze-empty">暂无分项汇总</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function canAddAnalyzeChild(req) {
  const nodeId = Number((req.query && req.query.nodeId) || (req.body && req.body.nodeId) || 0);
  if (nodeId <= 0) return false;
  ensureBillAnalyzeAssignments();
  return engine.db.bills.some((bill) => Number(bill.analyzeNodeId) === nodeId);
}

function assignAnalyzeBills(req) {
  ensureBillAnalyzeAssignments();
  const nodeId = Number(req.body.nodeId || req.query.nodeId || 0);
  const ids = idsFrom(req, "billIds").concat(idsFrom(req, "billId"), idsFrom(req, "analyzeId"));
  if (nodeId <= 0 || !ids.length) return { changed: 0, nodeId };
  let changed = 0;
  engine.db.bills.forEach((bill) => {
    if (ids.includes(Number(bill.billId || bill.id))) {
      bill.analyzeNodeId = nodeId;
      changed += 1;
    }
  });
  return { changed, nodeId };
}

function unassignAnalyzeBills(req) {
  ensureBillAnalyzeAssignments();
  const ids = idsFrom(req, "analyzeId").concat(idsFrom(req, "billId"), idsFrom(req, "billIds"));
  let changed = 0;
  engine.db.bills.forEach((bill) => {
    if (ids.includes(Number(bill.billId || bill.id))) {
      bill.analyzeNodeId = 0;
      changed += 1;
    }
  });
  return { changed };
}

function billAnalyzeSelectionHtml(req) {
  ensureBillAnalyzeAssignments();
  const nodeId = Number(req.query.nodeId || req.body.nodeId || 0);
  const analyzeId = Number(req.query.analyzeId || req.body.analyzeId || req.query.billId || req.body.billId || 0);
  const node = analyzeNodeRows().find((item) => Number(item.nodeId) === nodeId);
  const rows = engine.billRows();
  const selectedBill = rows.find((row) => Number(row.billId || row.analyzeId) === analyzeId);
  if (selectedBill && !nodeId) {
    const nodeOptions = analyzeNodeRows().map((item) => {
      const id = Number(item.nodeId || item.id || 0);
      const selected = Number(selectedBill.analyzeNodeId || 0) === id ? " selected" : "";
      return `<option value="${id}"${selected}>${htmlEscape(item.nodeName || item.name || "")}</option>`;
    }).join("");
    return `
      <div style="padding:16px 20px;">
        <form class="layui-form" id="bill-analyze-hang-form">
          <input type="hidden" name="billIds" value="${Number(selectedBill.billId || selectedBill.analyzeId || 0)}">
          <div class="layui-form-item">
            <label class="layui-form-label">清单编号</label>
            <div class="layui-input-block"><input class="layui-input" readonly value="${htmlEscape(selectedBill.billNo || "")}"></div>
          </div>
          <div class="layui-form-item">
            <label class="layui-form-label">清单名称</label>
            <div class="layui-input-block"><input class="layui-input" readonly value="${htmlEscape(selectedBill.billName || "")}"></div>
          </div>
          <div class="layui-form-item">
            <label class="layui-form-label">分项节点</label>
            <div class="layui-input-block"><select name="nodeId">${nodeOptions}</select></div>
          </div>
          <div class="layui-form-item">
            <label class="layui-form-label">最终金额</label>
            <div class="layui-input-block"><input class="layui-input" readonly value="${moneyText(selectedBill.finalMoney)}"></div>
          </div>
          <div class="layui-form-item">
            <div class="layui-input-block">
              <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={nodeId:form.nodeId.value,billIds:form.billIds.value};fetch('/billAnalyze/hang_bill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'挂接成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存挂接</button>
            </div>
          </div>
        </form>
      </div>`;
  }
  const body = rows.map((row) => {
    const checked = Number(row.analyzeNodeId) === nodeId ? " checked" : "";
    return `
      <tr>
        <td><input type="checkbox" name="billIds" value="${row.billId}"${checked}></td>
        <td>${htmlEscape(row.billNo)}</td>
        <td>${htmlEscape(row.billName)}</td>
        <td>${htmlEscape(row.measureUnit)}</td>
        <td>${row.contractNum}</td>
        <td>${row.price}</td>
        <td>${row.finalMoney}</td>
      </tr>`;
  }).join("");
  return `
    <div style="padding:12px 16px;">
      <div class="layui-card">
        <div class="layui-card-header">挂接到：${htmlEscape(node ? node.nodeName : "当前分项")}</div>
        <div class="layui-card-body">
          <form class="layui-form" id="bill-analyze-batch-hang-form">
            <table class="layui-table" lay-size="sm">
              <thead><tr><th style="width:50px;">选择</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>数量</th><th>单价</th><th>最终金额</th></tr></thead>
              <tbody>${body}</tbody>
            </table>
            <button type="button" class="layui-btn layui-btn-sm" onclick="(function(btn){var root=btn.closest('form');var ids=Array.prototype.map.call(root.querySelectorAll('input[name=billIds]:checked'),function(el){return el.value}).join(',');fetch('/billAnalyze/hang_bill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nodeId:${nodeId},billIds:ids})}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'挂接成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存挂接</button>
          </form>
        </div>
      </div>
    </div>`;
}

function variationPayRows() {
  return engine.variationRows().map((row) => ({
    ...row,
    contractAmount: row.beforeVaryPrice,
    contractMoney: row.beforeVaryNum,
    modifyAmount: row.beforeVaryMoney,
    modifyMoney: row.afterVaryPrice,
    varyAmount: row.varyNum,
    afterVaryNum: row.afterVaryNum,
    afterVaryMoney: row.afterVaryMoney,
    varyDetail: {
      varyDetailId: row.varyDetailId,
      beforeVaryPrice: row.beforeVaryPrice,
      beforeVaryNum: row.beforeVaryNum,
      varyBefortMoney: row.beforeVaryMoney,
      afterVaryPrice: row.afterVaryPrice,
      afterVaryNum: row.afterVaryNum,
      varyAfterMoney: row.afterVaryMoney
    }
  }));
}

function variationGatherDataLegacy(req) {
  const varyDetailId = Number(req.body.varyDetailId || req.query.varyDetailId || 0);
  const billNo = req.body.billNo || req.query.billNo || "";
  const vary = engine.variationRows().find((row) => Number(row.varyDetailId) === varyDetailId)
    || engine.variationRows().find((row) => row.billNo === billNo)
    || engine.variationRows()[0];
  if (!vary) return [];
  const relatedMeasures = engine.db.measures
    .map((measure) => {
      const detail = (measure.details || []).find((item) => Number(item.billId) === Number(vary.billId));
      if (!detail) return null;
      const period = engine.db.measurePeriods.find((item) => Number(item.id) === Number(measure.periodId))
        || engine.db.measurePeriods.find((item) => Number(item.gatherId) === Number(measure.periodId));
      return {
        periodNo: Number(measure.periodId || measure.measureId || 0),
        label: period ? period.periodDesc : `第 ${measure.periodId || measure.measureId} 期`,
        quantity: Number(detail.measureNum || 0),
        money: Number(detail.measureNum || 0) * Number(vary.afterVaryPrice || vary.beforeVaryPrice || 0)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.periodNo - b.periodNo);
  if (relatedMeasures.length) {
    return relatedMeasures.map((item, index) => [
      String(item.periodNo || index + 1),
      Number(item.quantity.toFixed(3)),
      Number(item.money.toFixed(2))
    ]);
  }
  const quantity = Number(vary.afterVaryNum || vary.varyNum || 0);
  const money = Number(vary.afterVaryMoney || vary.varyMoney || 0);
  return [["1", Number(quantity.toFixed(3)), Number(money.toFixed(2))]];
}

function variationGatherData(req) {
  const varyDetailId = Number(req.body.varyDetailId || req.query.varyDetailId || 0);
  const billNo = req.body.billNo || req.query.billNo || "";
  const vary = engine.variationRows().find((row) => Number(row.varyDetailId) === varyDetailId)
    || engine.variationRows().find((row) => row.billNo === billNo)
    || engine.variationRows()[0];
  if (!vary) return [];
  const paidForMeasured = (measuredNum) => {
    const beforeNum = Number(vary.beforeVaryNum || vary.beforeNum || 0);
    const afterNum = Number(vary.afterVaryNum || vary.afterNum || 0);
    const beforePrice = Number(vary.beforeVaryPrice || vary.beforePrice || 0);
    const afterPrice = Number(vary.afterVaryPrice || vary.afterPrice || 0);
    const beforePaidNum = Math.min(Math.max(Number(measuredNum || 0), 0), Math.max(beforeNum, 0));
    const afterPaidNum = Math.min(Math.max(Number(measuredNum || 0), 0), Math.max(afterNum, 0));
    return Number(((afterPaidNum * afterPrice) - (beforePaidNum * beforePrice)).toFixed(2));
  };
  let cumulativeQuantity = 0;
  let cumulativePaidMoney = 0;
  const periodRows = (engine.db.measurePeriods || []).map((period, index) => {
    const periodNo = Number(period.gatherId || period.id || index + 1);
    const quantity = (engine.db.measures || [])
      .filter((measure) => Number(measure.periodId || measure.gatherId || 0) === periodNo)
      .flatMap((measure) => Array.isArray(measure.details) ? measure.details : [])
      .filter((detail) => Number(detail.billId || 0) === Number(vary.billId))
      .reduce((sum, detail) => sum + Number(detail.measureNum || detail.currentNum || 0), 0);
    cumulativeQuantity += quantity;
    const paidToDate = paidForMeasured(cumulativeQuantity);
    const currentPaidMoney = Number((paidToDate - cumulativePaidMoney).toFixed(2));
    cumulativePaidMoney = paidToDate;
    return [
      String(period.gatherNo || period.periodDesc || periodNo),
      Number(quantity.toFixed(3)),
      currentPaidMoney
    ];
  });
  if (periodRows.some((row) => Number(row[1] || 0) !== 0 || Number(row[2] || 0) !== 0)) {
    return periodRows;
  }
  const quantity = Number(vary.afterVaryNum || vary.varyNum || 0);
  const money = Number(vary.afterVaryMoney || vary.varyMoney || 0);
  return [["1", Number(quantity.toFixed(3)), Number(money.toFixed(2))]];
}

function variationPaidMoney(row) {
  const bill = engine.billRows().find((item) => Number(item.billId) === Number(row.billId)) || {};
  const measuredNum = Number(bill.measuredNum || 0);
  const beforeNum = Number(row.beforeVaryNum || row.beforeNum || 0);
  const afterNum = Number(row.afterVaryNum || row.afterNum || 0);
  const beforePrice = Number(row.beforeVaryPrice || row.beforePrice || 0);
  const afterPrice = Number(row.afterVaryPrice || row.afterPrice || 0);
  const beforePaidNum = Math.min(Math.max(measuredNum, 0), Math.max(beforeNum, 0));
  const afterPaidNum = Math.min(Math.max(measuredNum, 0), Math.max(afterNum, 0));
  return Number(((afterPaidNum * afterPrice) - (beforePaidNum * beforePrice)).toFixed(2));
}

function variationPayRowsWithProgress(rows = variationPayRows()) {
  return rows.map((row) => {
    const paidMoney = variationPaidMoney(row);
    const varyMoney = Number(row.varyMoney || 0);
    const remainMoney = Number((varyMoney - paidMoney).toFixed(2));
    const payRate = varyMoney ? Number(((paidMoney / varyMoney) * 100).toFixed(2)) : 0;
    return {
      ...row,
      paidMoney,
      paidVaryMoney: paidMoney,
      remainMoney,
      remainVaryMoney: remainMoney,
      payRate,
      paymentFormula: "已计变更支付 = 已计量数量按变更前后单价差折算"
    };
  });
}

function variationPaymentDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const rows = variationPayRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const enriched = variationPayRowsWithProgress(rows);
  const totalVary = enriched.reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
  const totalPaid = enriched.reduce((sum, row) => sum + Number(row.paidMoney || 0), 0);
  const totalRemain = enriched.reduce((sum, row) => sum + Number(row.remainMoney || 0), 0);
  const majorCount = enriched.filter((row) => row.varyGrade && row.varyGrade.bdCode === "ZD").length;
  const cardData = [
    ["变更金额", moneyText(totalVary), "全部变更差额"],
    ["已计变更支付", moneyText(totalPaid), "按累计计量数量折算"],
    ["剩余变更支付", moneyText(totalRemain), "变更金额 - 已计变更支付"],
    ["支付比例", percentText(totalVary ? (totalPaid / totalVary) * 100 : 0), "变更支付进度"],
    ["变更数量", String(enriched.length), "当前筛选范围"],
    ["重大变更", String(majorCount), "按变更等级统计"]
  ].map(([label, value, hint]) => `
    <div class="vpay-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const body = enriched.map((row) => `
    <tr>
      <td>${htmlEscape(row.varyNo || "")}</td>
      <td>${htmlEscape(row.sectionName || row.workAreaName || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || row.varyContent || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.beforeVaryNum || 0)}</td>
      <td>${Number(row.afterVaryNum || 0)}</td>
      <td>${moneyText(row.beforeVaryMoney)}</td>
      <td>${moneyText(row.afterVaryMoney)}</td>
      <td>${moneyText(row.varyMoney)}</td>
      <td>${moneyText(row.paidMoney)}</td>
      <td>${moneyText(row.remainMoney)}</td>
      <td>${percentText(row.payRate)}</td>
      <td>${htmlEscape((row.varyGrade && row.varyGrade.bdName) || "")}</td>
      <td>${htmlEscape(row.states || "")}</td>
    </tr>`).join("");
  const sectionOptionsHtml = [`<option value="0"${sectionId ? "" : " selected"}>全部合同段</option>`]
    .concat(engine.db.sections.map((section) => {
      const selected = Number(section.sectionId || section.id) === sectionId ? " selected" : "";
      return `<option value="${section.sectionId || section.id}"${selected}>${htmlEscape(section.sectionName || "")}</option>`;
    })).join("");
  return `
    <div class="layui-fluid variation-payment-dashboard">
      <style>
        .variation-payment-dashboard { padding:16px; background:#f4f7fb; color:#172033; }
        .vpay-shell { max-width:1380px; margin:0 auto; }
        .vpay-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .vpay-head h2 { margin:0; font-size:22px; font-weight:600; }
        .vpay-head p { margin:6px 0 0; color:#64748b; }
        .vpay-filter { display:flex; gap:8px; align-items:center; }
        .vpay-filter select { height:32px; min-width:180px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .vpay-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .vpay-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .vpay-card span, .vpay-card small { display:block; color:#64748b; font-size:12px; }
        .vpay-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .vpay-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; }
        .vpay-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .vpay-panel table { min-width:1280px; margin:0; }
        .left { text-align:left; }
        .vpay-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .vpay-cards { grid-template-columns:repeat(3, 1fr); } .vpay-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .vpay-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="vpay-shell">
        <div class="vpay-head">
          <div>
            <h2>变更支付看板</h2>
            <p>按累计计量数量折算变更已支付金额，跟踪剩余变更支付和支付比例。</p>
          </div>
          <div class="vpay-filter">
            <select onchange="location.href='/varyMeasurePay/dashboard_page?sectionId='+this.value">${sectionOptionsHtml}</select>
            <button class="layui-btn layui-btn-sm" onclick="location.href='/varyMeasurePay/export_vary_measure_pay?returnType=url'">导出变更支付</button>
          </div>
        </div>
        <div class="vpay-cards">${cardData}</div>
        <div class="vpay-panel">
          <h3>变更支付明细</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>变更编号</th><th>合同段</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>变更前数量</th><th>变更后数量</th><th>变更前金额</th><th>变更后金额</th><th>变更金额</th><th>已计变更支付</th><th>剩余变更支付</th><th>支付比例</th><th>等级</th><th>状态</th></tr></thead>
            <tbody>${body || `<tr><td colspan="15" class="vpay-empty">暂无变更支付数据</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function variationManagementDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const stateFilter = String(req.query.state || req.body.state || "");
  let rows = engine.variationRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  if (stateFilter) rows = rows.filter((row) => String(row.states || "").includes(stateFilter));
  const payMap = new Map(variationPayRows().map((row) => [Number(row.varyId || row.id || 0), row]));
  const enriched = variationPayRowsWithProgress(rows).map((row) => ({ ...row, ...(payMap.get(Number(row.varyId || row.id || 0)) || {}) }));
  const totalBefore = enriched.reduce((sum, row) => sum + Number(row.beforeVaryMoney || 0), 0);
  const totalAfter = enriched.reduce((sum, row) => sum + Number(row.afterVaryMoney || 0), 0);
  const totalVary = enriched.reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
  const totalPaid = enriched.reduce((sum, row) => sum + Number(row.paidMoney || 0), 0);
  const pending = enriched.filter((row) => /待|上报|审核中/.test(row.states || "")).length;
  const approved = enriched.filter((row) => /已审核|审核通过/.test(row.states || "")).length;
  const archived = enriched.filter((row) => /归档/.test(row.states || "") || row.isArchive || row.archivePicName).length;
  const major = enriched.filter((row) => row.varyGrade && row.varyGrade.bdCode === "ZD").length;
  const variationIds = new Set(enriched.map((row) => Number(row.varyId || row.id || 0)).filter(Boolean));
  const logs = ensureWorkflowLogs()
    .filter((log) => log.module === "varyapplication" && (!variationIds.size || variationIds.has(Number(log.businessId || 0))))
    .slice(-12)
    .reverse();
  const cards = [
    ["变更数量", enriched.length, "当前筛选范围"],
    ["变更前金额", moneyText(totalBefore), "变更前清单金额"],
    ["变更后金额", moneyText(totalAfter), "变更后控制金额"],
    ["变更金额", moneyText(totalVary), "变更净增减"],
    ["已计变更支付", moneyText(totalPaid), `支付比例 ${percentText(totalVary ? (totalPaid / totalVary) * 100 : 0)}`],
    ["待处理/已审核/已归档", `${pending}/${approved}/${archived}`, `${major} 条重大变更`]
  ].map(([label, value, hint]) => `
    <div class="vary-card">
      <span>${htmlEscape(label)}</span>
      <strong>${htmlEscape(value)}</strong>
      <small>${htmlEscape(hint)}</small>
    </div>`).join("");
  const sectionOptionsHtml = [`<option value="">全部合同段</option>`].concat(engine.db.sections.map((section) => {
    const id = Number(section.sectionId || section.id || 0);
    const selected = sectionId && id === sectionId ? " selected" : "";
    return `<option value="${id}"${selected}>${htmlEscape(section.sectionName || "")}</option>`;
  })).join("");
  const stateOptions = ["", "待上报", "审核中", "已审核", "已归档"].map((state) => {
    const selected = state === stateFilter ? " selected" : "";
    return `<option value="${htmlEscape(state)}"${selected}>${htmlEscape(state || "全部状态")}</option>`;
  }).join("");
  const mainRows = enriched.map((row) => {
    const id = Number(row.varyId || row.id || 0);
    return `
      <tr>
        <td>${htmlEscape(row.varyNo || "")}</td>
        <td>${htmlEscape(row.sectionName || row.workAreaName || "")}</td>
        <td>${htmlEscape((row.varyGrade && row.varyGrade.bdName) || "")}</td>
        <td>${htmlEscape((row.varyType && row.varyType.bdName) || "")}</td>
        <td class="left">${htmlEscape(row.varyReason || row.varyItem || row.billName || "")}</td>
        <td>${moneyText(row.beforeVaryMoney)}</td>
        <td>${moneyText(row.afterVaryMoney)}</td>
        <td>${moneyText(row.varyMoney)}</td>
        <td>${moneyText(row.paidMoney)}</td>
        <td>${percentText(row.payRate)}</td>
        <td><span class="vary-state">${htmlEscape(row.states || "")}</span></td>
        <td class="vary-actions">
          <a href="/vary_measure/edit_page?varyId=${id}">编辑</a>
          <a href="/vary_measure/edit_detail_page?varyId=${id}">明细</a>
          <a href="/vary_measure/up_order?varyIds=${id}">上报</a>
          <a href="/vary_measure/agree_order?varyId=${id}">审核</a>
          <a href="/vary_measure/archive_upload_pic_page?varyId=${id}">归档</a>
          <a href="/vary_measure/track_page?measureType=varyapplication&ids=${id}">流程</a>
          <a href="/vary_measure/render_order_page?varyIds=${id}">报表</a>
        </td>
      </tr>`;
  }).join("");
  const detailRows = enriched.map((row) => `
    <tr>
      <td>${htmlEscape(row.varyNo || "")}</td>
      <td>${htmlEscape(row.billNo || "")}</td>
      <td class="left">${htmlEscape(row.billName || "")}</td>
      <td>${htmlEscape(row.measureUnit || "")}</td>
      <td>${Number(row.beforeVaryNum || 0)}</td>
      <td>${moneyText(row.beforeVaryPrice)}</td>
      <td>${moneyText(row.beforeVaryMoney)}</td>
      <td>${Number(row.afterVaryNum || 0)}</td>
      <td>${moneyText(row.afterVaryPrice)}</td>
      <td>${moneyText(row.afterVaryMoney)}</td>
      <td>${moneyText(row.varyMoney)}</td>
      <td>${moneyText(row.remainMoney)}</td>
    </tr>`).join("");
  const logRows = logs.map((log) => `
    <tr>
      <td>${htmlEscape(log.businessNo || "")}</td>
      <td>${htmlEscape(log.step || log.action || "")}</td>
      <td>${htmlEscape(log.result || "")}</td>
      <td>${htmlEscape(log.userName || "")}</td>
      <td>${htmlEscape(log.time || "")}</td>
      <td class="left">${htmlEscape(cleanBusinessText(log.remark, ""))}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid variation-dashboard">
      <style>
        .variation-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .vary-shell { max-width:1380px; margin:0 auto; }
        .vary-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .vary-head h2 { margin:0; font-size:22px; font-weight:600; }
        .vary-head p { margin:6px 0 0; color:#64748b; }
        .vary-tools { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .vary-tools select { height:32px; min-width:150px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .vary-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .vary-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .vary-card span, .vary-card small { display:block; color:#64748b; font-size:12px; }
        .vary-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .vary-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .vary-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .vary-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .vary-panel table { margin:0; min-width:920px; }
        .vary-wide { grid-column:1 / -1; }
        .vary-actions a { margin-right:8px; white-space:nowrap; }
        .vary-state { display:inline-block; min-width:54px; text-align:center; color:#075985; background:#e0f2fe; border:1px solid #bae6fd; border-radius:4px; padding:2px 6px; }
        .vary-empty { text-align:center; color:#94a3b8; padding:24px; }
        .left { text-align:left; }
        @media (max-width:1100px) { .vary-cards { grid-template-columns:repeat(3, 1fr); } .vary-grid { grid-template-columns:1fr; } .vary-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .vary-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="vary-shell">
        <div class="vary-head">
          <div>
            <h2>工程变更管理看板</h2>
            <p>集中管理变更令、清单明细、金额计算、审核流转、归档和变更支付。</p>
          </div>
          <div class="vary-tools">
            <select onchange="location.href='/vary_measure/dashboard_page?sectionId='+this.value+'&state=${encodeURIComponent(stateFilter)}'">${sectionOptionsHtml}</select>
            <select onchange="location.href='/vary_measure/dashboard_page?sectionId=${encodeURIComponent(sectionId || "")}&state='+this.value">${stateOptions}</select>
            <a class="layui-btn layui-btn-sm" href="/vary_measure/add_page">新增变更</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/varyMeasurePay/dashboard_page?sectionId=${sectionId || ""}">变更支付</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/bigVaryQuery/dashboard_page">重大变更</a>
          </div>
        </div>
        <div class="vary-cards">${cards}</div>
        <div class="vary-panel vary-wide">
          <h3>变更令清单</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>变更编号</th><th>合同段</th><th>等级</th><th>类型</th><th>变更内容</th><th>变更前金额</th><th>变更后金额</th><th>变更金额</th><th>已计支付</th><th>支付比例</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${mainRows || `<tr><td colspan="12" class="vary-empty">暂无工程变更数据</td></tr>`}</tbody>
          </table>
        </div>
        <div class="vary-grid">
          <div class="vary-panel">
            <h3>变更清单明细</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>变更编号</th><th>清单编号</th><th>清单名称</th><th>单位</th><th>变更前数量</th><th>变更前单价</th><th>变更前金额</th><th>变更后数量</th><th>变更后单价</th><th>变更后金额</th><th>变更金额</th><th>剩余支付</th></tr></thead>
              <tbody>${detailRows || `<tr><td colspan="12" class="vary-empty">暂无变更明细</td></tr>`}</tbody>
            </table>
          </div>
          <div class="vary-panel">
            <h3>最近流程记录</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>业务编号</th><th>环节</th><th>结果</th><th>处理人</th><th>时间</th><th>意见</th></tr></thead>
              <tbody>${logRows || `<tr><td colspan="6" class="vary-empty">暂无流程记录</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function bigVaryRowsForProject(projectId = 0) {
  const sections = engine.db.sections.filter((section) => !projectId || Number(section.projectId || 0) === Number(projectId));
  const sectionIds = new Set(sections.map((section) => Number(section.sectionId || section.id)));
  return engine.variationRows().filter((row) => !projectId || sectionIds.has(Number(row.sectionId || 0)));
}

function bigVaryProjectRows() {
  return engine.db.projects.map((project) => {
    const projectId = project.projectId || project.id;
    const rows = bigVaryRowsForProject(projectId);
    const majorRows = rows.filter((row) => row.varyGrade && row.varyGrade.bdCode === "ZD");
    const normalRows = rows.filter((row) => !row.varyGrade || row.varyGrade.bdCode !== "ZD");
    const varyMoney = rows.reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
    const majorVaryMoney = majorRows.reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
    const normalVaryMoney = normalRows.reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
    return {
      ...project,
      projectId,
      projectName: cleanBusinessText(project.projectName, `项目 ${projectId}`),
      varyCount: rows.length,
      majorVaryCount: majorRows.length,
      normalVaryCount: normalRows.length,
      varyMoney: Number(varyMoney.toFixed(2)),
      majorVaryMoney: Number(majorVaryMoney.toFixed(2)),
      normalVaryMoney: Number(normalVaryMoney.toFixed(2))
    };
  });
}

function bigVaryChartData(req) {
  const projectId = Number(req.query.projectId || req.body.projectId || 0);
  const rows = bigVaryRowsForProject(projectId);
  const normal = rows.filter((row) => !row.varyGrade || row.varyGrade.bdCode !== "ZD").reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
  const major = rows.filter((row) => row.varyGrade && row.varyGrade.bdCode === "ZD").reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
  return {
    "一般变更": Number(normal.toFixed(2)),
    "重大变更": Number(major.toFixed(2))
  };
}

function bigVaryDetailRows(req) {
  const projectId = Number(req.query.projectId || req.body.projectId || 0);
  return bigVaryRowsForProject(projectId).map((row) => ({
    ...row,
    projectId,
    sectionName: row.sysSection ? row.sysSection.sectionName : "",
    varyGradeName: row.varyGrade ? row.varyGrade.bdName : "",
    varyTypeName: row.varyType ? row.varyType.bdName : "",
    beforeMoney: row.beforeVaryMoney,
    afterMoney: row.afterVaryMoney
  }));
}

function bigVaryDetailHtml(req) {
  return simpleTableHtml("重大变更明细", [
    { title: "变更编号", field: "varyNo" },
    { title: "合同段", field: "sectionName" },
    { title: "变更等级", field: "varyGradeName" },
    { title: "变更类型", field: "varyTypeName" },
    { title: "清单编号", field: "billNo" },
    { title: "清单名称", field: "billName" },
    { title: "变更前金额", field: "beforeMoney" },
    { title: "变更后金额", field: "afterMoney" },
    { title: "变更金额", field: "varyMoney" },
    { title: "状态", field: "states" }
  ], bigVaryDetailRows(req));
}

function projectQueryRows() {
  const summary = engine.contractSummary();
  const paymentRows = reportPaymentRows();
  return engine.db.projects.map((project, index) => {
    const projectSectionIds = new Set(engine.db.sections
      .filter((section) => Number(section.projectId || 0) === Number(project.projectId || 0))
      .map((section) => Number(section.sectionId || section.id || 0)));
    const rows = paymentRows.filter((row) => projectSectionIds.has(Number(row.sectionId || 0)));
    const finalMoney = rows.reduce((sum, row) => sum + Number(row.finalMoney || 0), 0);
    const payableMoney = rows.reduce((sum, row) => sum + Number(row.totalPayMoney || 0), 0);
    const materialArrivalMoney = rows.reduce((sum, row) => sum + Number(row.materialArrivalMoney || 0), 0);
    return {
      ...project,
      projectNo: project.projectNo || `XM-${String(project.projectId || index + 1).padStart(3, "0")}`,
      consPeriod: project.consPeriod || `${project.startDate || ""} 至 ${project.endDate || ""}`,
      totalInvest: project.totalInvest || finalMoney || summary.finalMoney,
      sjzf: project.sjzf || payableMoney || summary.payableMoney,
      materialArrivalMoney,
      sectionNo: "",
      sectionName: "",
      secStartDate: project.startDate || "",
      secEndDate: project.endDate || "",
      contrDuration: project.contrDuration || "365",
      contractSumMoney: finalMoney || summary.finalMoney
    };
  });
}

function sectionQueryRows() {
  const reportRows = reportPaymentRows();
  return engine.db.sections.map((item, index) => {
    const report = reportRows.find((row) => Number(row.sectionId) === Number(item.sectionId)) || {};
    return {
      ...item,
      projectNo: item.projectNo || `XM-${String(item.projectId || 1).padStart(3, "0")}`,
      projectName: (engine.db.projects.find((project) => Number(project.projectId) === Number(item.projectId)) || engine.db.projects[0] || {}).projectName || "",
      sectionNo: item.sectionNo || item.contractNo || `BD-${String(item.sectionId || index + 1).padStart(3, "0")}`,
      secStartDate: item.secStartDate || "2026-01-01",
      secEndDate: item.secEndDate || "2026-12-31",
      contrDuration: item.contrDuration || "365",
      contractSumMoney: report.finalMoney || 0,
      totalInvest: report.finalMoney || 0,
      sjzf: report.totalPayMoney || 0,
      materialArrivalMoney: report.materialArrivalMoney || 0,
      consPeriod: item.consPeriod || "365"
    };
  });
}

function sectionChartData(req) {
  const projectId = Number(req.query.projectId || req.body.projectId || 0);
  const rows = sectionQueryRows().filter((row) => !projectId || Number(row.projectId || 0) === projectId);
  return rows.reduce((out, row) => {
    out[row.sectionName || row.sectionNo || `标段${row.sectionId}`] = Number(row.contractSumMoney || row.totalInvest || 0);
    return out;
  }, {});
}

function sectionDetailDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const section = sectionQueryRows().find((row) => Number(row.sectionId || row.id) === sectionId) || sectionQueryRows()[0] || {};
  const bills = engine.billRows().filter((row) => Number(row.sectionId || 0) === Number(section.sectionId || 0));
  const measures = engine.measureRows().filter((row) => Number(row.sectionId || 0) === Number(section.sectionId || 0));
  const variations = engine.variationRows().filter((row) => Number(row.sectionId || 0) === Number(section.sectionId || 0));
  const materials = engine.materialDiasRows().filter((row) => Number(row.sectionId || 0) === Number(section.sectionId || 0));
  const manual = engine.manualMeasureRows().filter((row) => Number(row.sectionId || 0) === Number(section.sectionId || 0));
  const measuredMoney = measures.reduce((sum, row) => sum + Number(row.measureMoney || 0), 0);
  const variationMoney = variations.reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
  const materialMoney = materials.reduce((sum, row) => sum + Number(row.adjustMoney || 0), 0);
  const materialArrivalMoney = Number(section.materialArrivalMoney || 0);
  const manualMoney = manual.reduce((sum, row) => sum + Number(row.measureMoney || 0), 0);
  const finalMoney = Number(section.contractSumMoney || 0);
  const payableMoney = measuredMoney + materialMoney + manualMoney;
  const billRows = bills.slice(0, 12).map((row) => `
        <tr><td>${htmlEscape(row.billNo)}</td><td>${htmlEscape(row.billName)}</td><td>${row.finalMoney}</td><td>${row.measuredMoney}</td><td>${row.remainMoney}</td></tr>`).join("");
  return `
    <div class="layui-fluid" style="padding:12px;">
      <div class="layui-card">
        <div class="layui-card-header">标段详情 - ${htmlEscape(section.sectionName || "")}</div>
        <div class="layui-card-body">
          <table class="layui-table" lay-size="sm" id="section-detail-dashboard">
            <tbody>
              <tr><th>项目名称</th><td>${htmlEscape(section.projectName || "")}</td><th>合同编号</th><td>${htmlEscape(section.contractNo || section.sectionNo || "")}</td></tr>
              <tr><th>施工单位</th><td>${htmlEscape(section.contractor || "")}</td><th>监理单位</th><td>${htmlEscape(section.supervisor || "")}</td></tr>
              <tr><th>合同金额</th><td>${section.contractSumMoney || 0}</td><th>累计支付</th><td>${Number(payableMoney.toFixed(2))}</td></tr>
              <tr><th>清单计量</th><td>${Number(measuredMoney.toFixed(2))}</td><th>材料补差</th><td>${Number(materialMoney.toFixed(2))}</td></tr>
              <tr><th>材料到场</th><td>${Number(materialArrivalMoney.toFixed(2))}（跟踪项）</td><th>手动计量</th><td>${Number(manualMoney.toFixed(2))}</td></tr>
              <tr><th>变更金额</th><td>${Number(variationMoney.toFixed(2))}</td><th>到场规则</th><td>到场跟踪不计入应付</td></tr>
              <tr><th>支付比例</th><td>${finalMoney ? Number(((payableMoney / finalMoney) * 100).toFixed(2)) : 0}%</td><th>清单数量</th><td>${bills.length}</td></tr>
            </tbody>
          </table>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>清单编号</th><th>清单名称</th><th>最终金额</th><th>已计量</th><th>剩余</th></tr></thead>
            <tbody>${billRows || '<tr><td colspan="5" style="text-align:center;">暂无清单</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function leadershipQueryDashboardHtml(req) {
  const projectId = Number(req.query.projectId || req.body.projectId || 0);
  const projects = projectQueryRows();
  const selectedProject = projects.find((row) => Number(row.projectId) === projectId) || projects[0] || {};
  const selectedProjectId = Number(selectedProject.projectId || projectId || 0);
  const sections = sectionQueryRows().filter((row) => !selectedProjectId || Number(row.projectId || 0) === selectedProjectId);
  const allSections = sectionQueryRows();
  const totalInvest = projects.reduce((sum, row) => sum + Number(row.totalInvest || row.contractSumMoney || 0), 0);
  const totalPay = projects.reduce((sum, row) => sum + Number(row.sjzf || 0), 0);
  const sectionFinal = sections.reduce((sum, row) => sum + Number(row.contractSumMoney || 0), 0);
  const sectionPay = sections.reduce((sum, row) => sum + Number(row.sjzf || 0), 0);
  const varyRows = engine.variationRows().filter((row) => sections.some((section) => Number(section.sectionId) === Number(row.sectionId)));
  const projectOptions = projects.map((project) => {
    const selected = Number(project.projectId) === selectedProjectId ? " selected" : "";
    return `<option value="${project.projectId}"${selected}>${htmlEscape(project.projectName || "")}</option>`;
  }).join("");
  const cards = [
    ["项目数量", String(projects.length), "当前授权项目"],
    ["标段数量", String(allSections.length), "全部合同段"],
    ["总投资额", moneyText(totalInvest), "项目总投资汇总"],
    ["累计支付", moneyText(totalPay), "全部项目累计支付"],
    ["当前项目合同额", moneyText(sectionFinal), "所选项目标段合同额"],
    ["当前项目支付率", percentText(sectionFinal ? (sectionPay / sectionFinal) * 100 : 0), "累计支付 / 合同额"]
  ].map(([label, value, hint]) => `
    <div class="leader-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const projectBody = projects.map((row) => `
    <tr>
      <td>${htmlEscape(row.projectNo || "")}</td>
      <td class="left">${htmlEscape(row.projectName || "")}</td>
      <td>${htmlEscape(row.consPeriod || "")}</td>
      <td>${moneyText(row.totalInvest || row.contractSumMoney)}</td>
      <td>${moneyText(row.sjzf)}</td>
      <td>${percentText(Number(row.totalInvest || row.contractSumMoney || 0) ? (Number(row.sjzf || 0) / Number(row.totalInvest || row.contractSumMoney || 0)) * 100 : 0)}</td>
      <td><a href="/mtilProjectQuer/dashboard_page?projectId=${row.projectId}">查看</a></td>
    </tr>`).join("");
  const sectionBody = sections.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionNo || row.contractNo || "")}</td>
      <td class="left">${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.secStartDate || "")}</td>
      <td>${htmlEscape(row.secEndDate || "")}</td>
      <td>${htmlEscape(row.contrDuration || "")}</td>
      <td>${moneyText(row.contractSumMoney)}</td>
      <td>${moneyText(row.sjzf)}</td>
      <td>${percentText(Number(row.contractSumMoney || 0) ? (Number(row.sjzf || 0) / Number(row.contractSumMoney || 0)) * 100 : 0)}</td>
      <td><a href="/mtilProjectQuer/get_mutil_detail?sectionId=${row.sectionId}">详情</a></td>
    </tr>`).join("");
  const varyBody = varyRows.slice(0, 12).map((row) => `
    <tr>
      <td>${htmlEscape(row.varyNo || "")}</td>
      <td class="left">${htmlEscape(row.varyReason || row.varyContent || "")}</td>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.varyGrade && row.varyGrade.bdName || "")}</td>
      <td>${moneyText(row.varyMoney)}</td>
      <td>${htmlEscape(row.states || "")}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid leader-dashboard">
      <style>
        .leader-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .leader-shell { max-width:1380px; margin:0 auto; }
        .leader-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .leader-head h2 { margin:0; font-size:22px; font-weight:600; }
        .leader-head p { margin:6px 0 0; color:#64748b; }
        .leader-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .leader-actions select { height:32px; min-width:220px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .leader-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .leader-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .leader-card span, .leader-card small { display:block; color:#64748b; font-size:12px; }
        .leader-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .leader-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .leader-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .leader-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .leader-panel table { margin:0; min-width:760px; }
        .leader-wide { grid-column:1 / -1; }
        .left { text-align:left; }
        .leader-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .leader-cards { grid-template-columns:repeat(3, 1fr); } .leader-grid { grid-template-columns:1fr; } .leader-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .leader-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="leader-shell">
        <div class="leader-head">
          <div>
            <h2>多项目领导查询看板</h2>
            <p>汇总项目、标段、投资额、累计支付、支付比例和项目内重大变更，支撑管理层快速查看工程造价执行情况。</p>
          </div>
          <div class="leader-actions">
            <select onchange="location.href='/mtilProjectQuer/dashboard_page?projectId='+this.value">${projectOptions}</select>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/bigVaryQuery/dashboard_page?projectId=${selectedProjectId}">重大变更</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/reportManager/dashboard_page">计量支付</a>
          </div>
        </div>
        <div class="leader-cards">${cards}</div>
        <div class="leader-grid">
          <div class="leader-panel leader-wide">
            <h3>项目列表</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>项目编号</th><th>项目名称</th><th>总工期</th><th>总投资额</th><th>累计支付</th><th>支付率</th><th>操作</th></tr></thead>
              <tbody>${projectBody || `<tr><td colspan="7" class="leader-empty">暂无项目</td></tr>`}</tbody>
            </table>
          </div>
          <div class="leader-panel leader-wide">
            <h3>标段信息 - ${htmlEscape(selectedProject.projectName || "")}</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>标段编号</th><th>标段名称</th><th>开工日期</th><th>竣工日期</th><th>合同工期</th><th>合同金额</th><th>累计支付</th><th>支付率</th><th>详情</th></tr></thead>
              <tbody>${sectionBody || `<tr><td colspan="9" class="leader-empty">暂无标段</td></tr>`}</tbody>
            </table>
          </div>
          <div class="leader-panel leader-wide">
            <h3>项目变更概览</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>变更编号</th><th>变更内容</th><th>合同段</th><th>变更等级</th><th>变更金额</th><th>状态</th></tr></thead>
              <tbody>${varyBody || `<tr><td colspan="6" class="leader-empty">暂无项目变更</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function bigVaryDashboardHtml(req) {
  const projectId = Number(req.query.projectId || req.body.projectId || 0);
  const projects = bigVaryProjectRows();
  const selectedProject = projects.find((row) => Number(row.projectId) === projectId) || projects[0] || {};
  const selectedProjectId = Number(selectedProject.projectId || projectId || 0);
  const detailRows = bigVaryDetailRows({ query: { projectId: selectedProjectId }, body: {} });
  const totalMoney = detailRows.reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
  const majorRows = detailRows.filter((row) => row.varyGrade && row.varyGrade.bdCode === "ZD");
  const normalRows = detailRows.filter((row) => !row.varyGrade || row.varyGrade.bdCode !== "ZD");
  const projectOptions = projects.map((project) => {
    const selected = Number(project.projectId) === selectedProjectId ? " selected" : "";
    return `<option value="${project.projectId}"${selected}>${htmlEscape(project.projectName || "")}</option>`;
  }).join("");
  const cards = [
    ["项目数量", String(projects.length), "纳入查询项目"],
    ["变更数量", String(detailRows.length), "当前项目变更"],
    ["重大变更", String(majorRows.length), "按变更等级识别"],
    ["一般变更", String(normalRows.length), "非重大变更"],
    ["变更金额", moneyText(totalMoney), "当前项目变更净额"],
    ["重大变更金额", moneyText(majorRows.reduce((sum, row) => sum + Number(row.varyMoney || 0), 0)), "重大变更净额"]
  ].map(([label, value, hint]) => `
    <div class="bigvary-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const projectBody = projects.map((row) => `
    <tr>
      <td>${htmlEscape(row.projectNo || "")}</td>
      <td class="left">${htmlEscape(row.projectName || "")}</td>
      <td>${row.varyCount}</td>
      <td>${row.majorVaryCount}</td>
      <td>${moneyText(row.varyMoney)}</td>
      <td>${moneyText(row.majorVaryMoney)}</td>
      <td><a href="/bigVaryQuery/dashboard_page?projectId=${row.projectId}">查看</a></td>
    </tr>`).join("");
  const detailBody = detailRows.map((row) => `
    <tr>
      <td>${htmlEscape(row.varyNo || "")}</td>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.varyGradeName || "")}</td>
      <td>${htmlEscape(row.varyTypeName || "")}</td>
      <td class="left">${htmlEscape(row.billNo || "")} ${htmlEscape(row.billName || "")}</td>
      <td>${moneyText(row.beforeMoney)}</td>
      <td>${moneyText(row.afterMoney)}</td>
      <td>${moneyText(row.varyMoney)}</td>
      <td>${htmlEscape(row.states || "")}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid bigvary-dashboard">
      <style>
        .bigvary-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .bigvary-shell { max-width:1380px; margin:0 auto; }
        .bigvary-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .bigvary-head h2 { margin:0; font-size:22px; font-weight:600; }
        .bigvary-head p { margin:6px 0 0; color:#64748b; }
        .bigvary-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .bigvary-actions select { height:32px; min-width:220px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .bigvary-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .bigvary-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .bigvary-card span, .bigvary-card small { display:block; color:#64748b; font-size:12px; }
        .bigvary-card strong { display:block; margin:8px 0; color:#991b1b; font-size:20px; }
        .bigvary-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .bigvary-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .bigvary-panel table { margin:0; min-width:920px; }
        .left { text-align:left; }
        .bigvary-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .bigvary-cards { grid-template-columns:repeat(3, 1fr); } .bigvary-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .bigvary-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="bigvary-shell">
        <div class="bigvary-head">
          <div>
            <h2>重大变更查询看板</h2>
            <p>按项目汇总一般变更、重大变更、变更前后金额和审批状态，支撑变更风险识别与造价控制。</p>
          </div>
          <div class="bigvary-actions">
            <select onchange="location.href='/bigVaryQuery/dashboard_page?projectId='+this.value">${projectOptions}</select>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/bigVaryQuery/varyQueryDetial?projectId=${selectedProjectId}">变更详情</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/mtilProjectQuer/dashboard_page?projectId=${selectedProjectId}">领导查询</a>
          </div>
        </div>
        <div class="bigvary-cards">${cards}</div>
        <div class="bigvary-panel">
          <h3>项目变更汇总</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>项目编号</th><th>项目名称</th><th>变更数量</th><th>重大变更</th><th>变更金额</th><th>重大变更金额</th><th>操作</th></tr></thead>
            <tbody>${projectBody || `<tr><td colspan="7" class="bigvary-empty">暂无项目变更</td></tr>`}</tbody>
          </table>
        </div>
        <div class="bigvary-panel">
          <h3>变更明细 - ${htmlEscape(selectedProject.projectName || "")}</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>变更编号</th><th>合同段</th><th>变更等级</th><th>变更类型</th><th>关联清单</th><th>变更前金额</th><th>变更后金额</th><th>变更金额</th><th>状态</th></tr></thead>
            <tbody>${detailBody || `<tr><td colspan="9" class="bigvary-empty">暂无变更明细</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function mutateStateByIds(rows, idField, req, fallbackState) {
  const ids = idsFrom(req, "ids").concat(idsFrom(req, `${idField}s`), idsFrom(req, idField));
  const state = req.body.state || req.body.states || req.query.state || fallbackState;
  return { changed: setState(rows, idField, ids, state, { module: workflowModuleFromIdField(idField), action: state, remark: req.body.remark || req.query.remark || "" }) };
}

function workflowConfig(type) {
  const configs = {
    billmeasure: { rows: engine.db.measures, key: "measureId", no: "measureNo", title: "清单计量" },
    meterialdiasmeasure: { rows: engine.db.materialAdjustments, key: "diasId", no: "measureNo", title: "材料补差" },
    meterialinmeasure: { rows: engine.db.materialArrivals, key: "arrivalId", no: "measureNo", title: "材料到场" },
    manualmeasure: { rows: engine.db.manualMeasures, key: "manualId", no: "measureNo", title: "手动计量" },
    varyapplication: { rows: engine.db.variations, key: "varyId", no: "varyNo", title: "工程变更" },
    engineeringcontactbill: { rows: engine.db.contactBills, key: "contactId", no: "contactNo", title: "工程联系单" }
  };
  return configs[String(type || "").toLowerCase()] || configs.billmeasure;
}

function normalizeWorkflowType(value) {
  const text = String(value || "").toLowerCase().replace(/[_-]/g, "");
  const aliases = {
    billmeasure: "billmeasure",
    measure: "billmeasure",
    materialdiasmeasure: "meterialdiasmeasure",
    meterialdiasmeasure: "meterialdiasmeasure",
    materialadjust: "meterialdiasmeasure",
    meterialinmeasure: "meterialinmeasure",
    materialinmeasure: "meterialinmeasure",
    materialarrival: "meterialinmeasure",
    manualmeasure: "manualmeasure",
    varyapplication: "varyapplication",
    varymeasure: "varyapplication",
    variation: "varyapplication",
    engineeringcontactbill: "engineeringcontactbill",
    contactbill: "engineeringcontactbill"
  };
  return aliases[text] || text;
}

function workflowRequestType(req) {
  const body = req.body || {};
  const query = req.query || {};
  return normalizeWorkflowType(body.measureType || query.measureType || body.businessType || query.businessType || body.type || query.type);
}

function workflowRequestIds(req, config) {
  const body = req.body || {};
  const query = req.query || {};
  const direct = [
    body.businessId,
    query.businessId,
    body.id,
    query.id
  ];
  return idsFrom(req, "ids")
    .concat(idsFrom(req, config.key))
    .concat(direct
      .filter((value) => value !== undefined && value !== null && value !== "")
      .flatMap((value) => String(value).split(","))
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0))
    .filter((item, index, ids) => ids.indexOf(item) === index);
}

function idsFromAny(req, keys) {
  return (Array.isArray(keys) ? keys : [keys])
    .flatMap((key) => idsFrom(req, key))
    .concat(idsFrom(req, "ids"))
    .filter((item, index, ids) => ids.indexOf(item) === index);
}

function workflowTargetOptions(type, selectedId) {
  const config = workflowConfig(type);
  return config.rows.map((row) => {
    const id = Number(row[config.key] || row.id);
    const selected = id === Number(selectedId) ? " selected" : "";
    const label = `${row[config.no] || config.title + id} ${row.title || row.billName || row.position || row.varyReason || ""}`;
    return `<option value="${id}"${selected}>${htmlEscape(label)}</option>`;
  }).join("");
}

function workflowTargetId(req, type) {
  const config = workflowConfig(type);
  return idsFrom(req, config.key)[0] || idsFrom(req, "ids")[0] || Number((config.rows[0] && (config.rows[0][config.key] || config.rows[0].id)) || 0);
}

function workflowValueFor(row, type, field) {
  if (!row) return 0;
  if (field === "quantity") {
    if (type === "billmeasure") return Number(((row.details || [])[0] || {}).measureNum || 0);
    if (type === "manualmeasure") return Number(row.measureNum || 0);
    if (type === "varyapplication") return Number(row.afterNum || 0);
    return Number(row.quantity || 0);
  }
  if (field === "price") {
    if (type === "billmeasure") {
      const detail = ((row.details || [])[0] || {});
      const bill = billById(detail.billId) || {};
      return Number(bill.price || 0);
    }
    if (type === "manualmeasure") return Number(row.price || 0);
    if (type === "varyapplication") return Number(row.afterPrice || 0);
    const material = materialById(row.materialId) || {};
    return Number(material.currentPrice || material.basePrice || 0);
  }
  return 0;
}

function adjustmentFormHtml(req, type, title) {
  const config = workflowConfig(type);
  const id = workflowTargetId(req, type);
  const item = config.rows.find((row) => Number(row[config.key] || row.id) === Number(id)) || config.rows[0] || {};
  const quantity = workflowValueFor(item, type, "quantity");
  const price = workflowValueFor(item, type, "price");
  const currentMoney = Number((Number(quantity || 0) * Number(price || 0)).toFixed(2));
  const cleanTitle = cleanBusinessText(title, `调整${config.title}`);
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="workflow-adjust-form">
        <input type="hidden" name="measureType" value="${htmlEscape(type)}">
        <div class="layui-form-item">
          <label class="layui-form-label">业务类型</label>
          <div class="layui-input-block"><input class="layui-input" readonly value="${htmlEscape(config.title)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">业务单据</label>
          <div class="layui-input-block"><select name="ids">${workflowTargetOptions(type, id)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">调整数量</label>
          <div class="layui-input-block"><input class="layui-input" name="quantity" value="${quantity}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">调整单价</label>
          <div class="layui-input-block"><input class="layui-input" name="price" value="${price}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">当前金额</label>
          <div class="layui-input-block"><input class="layui-input" readonly value="${moneyText(currentMoney)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">调整说明</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="remark">${htmlEscape(item.adjustRemark || item.remark || cleanTitle || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/workflow/adjust_order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'调整成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存调整</button>
          </div>
        </div>
      </form>
    </div>`;
}

function returnOrderFormHtml(req, type, title) {
  const config = workflowConfig(type);
  const id = workflowTargetId(req, type);
  const cleanTitle = cleanBusinessText(title, `退回${config.title}`);
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="workflow-return-form">
        <input type="hidden" name="measureType" value="${htmlEscape(type)}">
        <div class="layui-form-item">
          <label class="layui-form-label">业务类型</label>
          <div class="layui-input-block"><input class="layui-input" readonly value="${htmlEscape(config.title)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">业务单据</label>
          <div class="layui-input-block"><select name="ids">${workflowTargetOptions(type, id)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">退回原因</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="returnReason">${htmlEscape(cleanTitle || "退回补充修改")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn layui-btn-danger" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/workflow/withdraw_order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'已退回')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">确认退回</button>
          </div>
        </div>
      </form>
    </div>`;
}

function adjustWorkflow(req) {
  const body = { ...req.query, ...req.body };
  const type = workflowRequestType(req);
  const config = workflowConfig(type);
  const ids = workflowRequestIds(req, config);
  let changed = 0;
  config.rows.forEach((row) => {
    if (ids.includes(Number(row[config.key] || row.id))) {
      const quantity = numeric(body.quantity, workflowValueFor(row, type, "quantity"));
      const price = numeric(body.price, workflowValueFor(row, type, "price"));
      if (type === "billmeasure") {
        row.details = row.details || [];
        row.details[0] = row.details[0] || { billId: engine.db.bills.find((bill) => Number(bill.sectionId || 0) === Number(row.sectionId || 0))?.billId || (engine.db.bills[0] && engine.db.bills[0].billId) };
        row.details[0].measureNum = quantity;
      } else if (type === "manualmeasure") {
        row.measureNum = quantity;
        row.price = price;
      } else if (type === "varyapplication") {
        row.afterNum = quantity;
        row.afterPrice = price;
      } else {
        row.quantity = quantity;
      }
      row.adjustRemark = body.remark || row.adjustRemark || "";
      row.states = body.states || body.state || "已调整";
      row.states = cleanWorkflowText(row.states, "已调整");
      addWorkflowLog({
        module: type,
        businessId: Number(row[config.key] || row.id || 0),
        businessNo: workflowLabel(row, config.key),
        action: "调整",
        result: row.states,
        remark: row.adjustRemark
      });
      changed += 1;
    }
  });
  return { changed, measureType: type };
}

function smsFormHtml() {
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="workflow-sms-form">
        <div class="layui-form-item">
          <label class="layui-form-label">接收人</label>
          <div class="layui-input-block"><input class="layui-input" name="receivers" value="ys1"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">通知内容</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="message">工程计量流程待处理，请及时审核。</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/workflow/send_sms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'发送成功')}});})(this)">发送通知</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveSms(req) {
  engine.db.smsMessages = Array.isArray(engine.db.smsMessages) ? engine.db.smsMessages : [];
  const id = nextId(engine.db.smsMessages, "id");
  engine.db.smsMessages.push({
    id,
    receivers: req.body.receivers || req.query.receivers || "ys1",
    message: req.body.message || req.query.message || "",
    createDate: today(),
    sender: "ys1"
  });
  return { changed: 1, id };
}

function smsFormHtml() {
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="workflow-sms-form">
        <div class="layui-form-item">
          <label class="layui-form-label">接收人</label>
          <div class="layui-input-block"><input class="layui-input" name="receivers" value="ys1"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">通知内容</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="message">工程计量流程待处理，请及时审核。</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/workflow/send_sms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'发送成功')} location.href='/workflow/sms_record_page';});})(this)">发送通知</button>
            <a class="layui-btn layui-btn-primary" href="/workflow/sms_record_page">通知记录</a>
          </div>
        </div>
      </form>
    </div>`;
}

function saveSms(req) {
  engine.db.smsMessages = Array.isArray(engine.db.smsMessages) ? engine.db.smsMessages : [];
  const id = nextId(engine.db.smsMessages, "id");
  const row = {
    id,
    smsId: id,
    receivers: req.body.receivers || req.query.receivers || "ys1",
    message: req.body.message || req.query.message || "",
    createDate: today(),
    sendTime: new Date().toISOString().slice(0, 19).replace("T", " "),
    sender: "ys1",
    state: "已发送"
  };
  engine.db.smsMessages.push(row);
  return { changed: 1, id, row };
}

function smsRows() {
  engine.db.smsMessages = Array.isArray(engine.db.smsMessages) ? engine.db.smsMessages : [];
  return engine.db.smsMessages.map((row) => ({
    ...row,
    smsId: row.smsId || row.id,
    receivers: String(row.receivers || "ys1"),
    message: cleanBusinessText(row.message, "工程计量流程待处理，请及时审核。"),
    sender: row.sender || "ys1",
    sendTime: row.sendTime || row.createDate || "",
    state: row.state || "已发送"
  }));
}

function smsRecordHtml() {
  const rows = smsRows().slice().reverse();
  const body = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.smsId || row.id || "")}</td>
      <td>${htmlEscape(row.receivers || "")}</td>
      <td class="left">${htmlEscape(row.message || "")}</td>
      <td>${htmlEscape(row.sender || "")}</td>
      <td>${htmlEscape(row.sendTime || "")}</td>
      <td>${htmlEscape(row.state || "")}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid" style="padding:16px;background:#f4f7fb;">
      <div class="layui-card" style="border-radius:6px;">
        <div class="layui-card-header">
          流程通知记录
          <a class="layui-btn layui-btn-sm" style="float:right;margin-top:4px;" href="/workflow/isSendSMSpage">发送通知</a>
        </div>
        <div class="layui-card-body">
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>编号</th><th>接收人</th><th>通知内容</th><th>发送人</th><th>发送时间</th><th>状态</th></tr></thead>
            <tbody>${body || `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px;">暂无通知记录</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function archiveUploadFormHtml(req) {
  const id = workflowTargetId(req, "varyapplication");
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="archive-upload-form">
        <input type="hidden" name="measureType" value="varyapplication">
        <div class="layui-form-item">
          <label class="layui-form-label">变更单</label>
          <div class="layui-input-block"><select name="ids">${workflowTargetOptions("varyapplication", id)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">附件名称</label>
          <div class="layui-input-block"><input class="layui-input" name="fileName" value="archive-photo.jpg"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">归档说明</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="remark">现场影像资料归档</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/vary_measure/save_archive_pic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'归档成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存归档</button>
          </div>
        </div>
      </form>
    </div>`;
}

function archiveUploadFormHtmlClean(req) {
  const id = workflowTargetId(req, "varyapplication");
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="archive-upload-form">
        <input type="hidden" name="measureType" value="varyapplication">
        <div class="layui-form-item">
          <label class="layui-form-label">变更单</label>
          <div class="layui-input-block"><select name="ids">${workflowTargetOptions("varyapplication", id)}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">附件名称</label>
          <div class="layui-input-block"><input class="layui-input" name="fileName" value="archive-photo.jpg"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">归档说明</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="remark">现场影像资料归档</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/vary_measure/save_archive_pic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'归档成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存归档</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveArchivePicClean(req) {
  const ids = idsFrom(req, "ids").concat(idsFrom(req, "varyId"));
  let changed = 0;
  engine.db.variations.forEach((row) => {
    if (!ids.length || ids.includes(Number(row.varyId || row.id))) {
      row.archivePicName = cleanBusinessText(req.body.fileName || req.query.fileName || row.archivePicName, "archive-photo.jpg");
      row.archiveRemark = cleanBusinessText(req.body.remark || req.query.remark || row.archiveRemark, "");
      row.states = "已归档";
      row.isArchive = 1;
      row.archiveDate = today();
      addWorkflowLog({
        module: "varyapplication",
        businessId: Number(row.varyId || row.id || 0),
        businessNo: workflowLabel(row, "varyId"),
        action: "归档附件",
        result: "已归档",
        remark: `${row.archivePicName} ${row.archiveRemark || ""}`.trim()
      });
      changed += 1;
    }
  });
  return { changed, state: "已归档" };
}

function saveArchivePic(req) {
  const ids = idsFrom(req, "ids").concat(idsFrom(req, "varyId"));
  let changed = 0;
  engine.db.variations.forEach((row) => {
    if (ids.includes(Number(row.varyId || row.id))) {
      row.archivePicName = req.body.fileName || req.query.fileName || row.archivePicName || "archive-photo.jpg";
      row.archiveRemark = req.body.remark || req.query.remark || row.archiveRemark || "";
      row.states = "已归档";
      addWorkflowLog({
        module: "varyapplication",
        businessId: Number(row.varyId || row.id || 0),
        businessNo: workflowLabel(row, "varyId"),
        action: "归档附件",
        result: "已归档",
        remark: `${row.archivePicName} ${row.archiveRemark || ""}`.trim()
      });
      changed += 1;
    }
  });
  return { changed };
}

function importSecBillHtml() {
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="sec-bill-import-form">
        <div class="layui-form-item">
          <label class="layui-form-label">清单编号</label>
          <div class="layui-input-block"><input class="layui-input" name="billNo" value="IMP-001"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">清单名称</label>
          <div class="layui-input-block"><input class="layui-input" name="billName" value="导入工程量清单"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">单位</label>
          <div class="layui-input-block"><input class="layui-input" name="measureUnit" value="m3"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">数量</label>
          <div class="layui-input-block"><input class="layui-input" name="contractNum" value="100"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">单价</label>
          <div class="layui-input-block"><input class="layui-input" name="price" value="10"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/secBill/import_bill_data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'导入成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">导入清单</button>
          </div>
        </div>
      </form>
    </div>`;
}

function importBillModelHtml() {
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="bill-model-import-form">
        <div class="layui-form-item">
          <label class="layui-form-label">清单编号</label>
          <div class="layui-input-block"><input class="layui-input" name="billNo" value="TMP-001"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">中文名称</label>
          <div class="layui-input-block"><input class="layui-input" name="billName" value="导入清单范本"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">章节</label>
          <div class="layui-input-block"><input class="layui-input" name="chapter" value="900"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">计量单位</label>
          <div class="layui-input-block"><input class="layui-input" name="measureUnit" value="m3"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">工程数量</label>
          <div class="layui-input-block"><input class="layui-input" name="contractNum" value="100"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">单价</label>
          <div class="layui-input-block"><input class="layui-input" name="price" value="10"></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/billModel/import_bill_model_data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'导入成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">导入范本</button>
            <a class="layui-btn layui-btn-primary" href="/billModel/import_model_template">下载模板</a>
          </div>
        </div>
      </form>
    </div>`;
}

function meetingFormHtml(req) {
  const id = idsFrom(req, "meetingId")[0] || varyIdFrom(req);
  const item = variationById(id) || {};
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="vary-meeting-form">
        <input type="hidden" name="meetingId" value="${item.meetingId || item.varyId || ""}">
        <input type="hidden" name="varyId" value="${item.varyId || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">会议编号</label>
          <div class="layui-input-block"><input class="layui-input" name="meetingNo" value="${htmlEscape(item.meetingNo || item.varyNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">会议名称</label>
          <div class="layui-input-block"><input class="layui-input" name="meetingTitle" value="${htmlEscape(item.meetingTitle || item.varyReason || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">会议地点</label>
          <div class="layui-input-block"><input class="layui-input" name="meetingAddress" value="${htmlEscape(item.meetingAddress || item.sectionName || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">会议时间</label>
          <div class="layui-input-block"><input class="layui-input" name="meetingDate" value="${htmlEscape(item.meetingDate || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">会议纪要</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="meetingSummary">${htmlEscape(item.meetingSummary || item.varyContent || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/vary_meeting/save_meeting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存会议</button>
          </div>
        </div>
      </form>
    </div>`;
}

function meetingUserFormHtml(req) {
  const id = idsFrom(req, "meetingId")[0] || varyIdFrom(req);
  const item = variationById(id) || engine.db.variations[0] || {};
  const billOptions = engine.billRows().map((bill) => {
    const selected = Number(bill.billId) === Number(item.billId) ? " selected" : "";
    return `<option value="${bill.billId}"${selected}>${htmlEscape(bill.billNo)} ${htmlEscape(bill.billName)}</option>`;
  }).join("");
  const meetingUsers = item.meetingUsers || "建设单位,监理单位,施工单位";
  const beforeNum = item.beforeNum ?? item.contractNum ?? "";
  const beforePrice = item.beforePrice ?? item.price ?? "";
  const afterNum = item.afterNum ?? beforeNum;
  const afterPrice = item.afterPrice ?? beforePrice;
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="vary-meeting-user-form">
        <input type="hidden" name="meetingId" value="${item.meetingId || item.varyId || id || ""}">
        <input type="hidden" name="varyId" value="${item.varyId || id || ""}">
        <div class="layui-form-item">
          <label class="layui-form-label">会议编号</label>
          <div class="layui-input-block"><input class="layui-input" name="meetingNo" value="${htmlEscape(item.meetingNo || item.varyNo || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">会议名称</label>
          <div class="layui-input-block"><input class="layui-input" name="meetingTitle" value="${htmlEscape(item.meetingTitle || item.varyReason || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">参会人员</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="meetingUsers">${htmlEscape(meetingUsers)}</textarea></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">会议地点</label>
          <div class="layui-input-block"><input class="layui-input" name="meetingAddress" value="${htmlEscape(item.meetingAddress || item.sectionName || "")}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">会议时间</label>
          <div class="layui-input-block"><input class="layui-input" name="meetingDate" value="${htmlEscape(item.meetingDate || today())}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">关联清单</label>
          <div class="layui-input-block"><select name="billId" class="layui-select">${billOptions}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更前数量</label>
          <div class="layui-input-block"><input class="layui-input" name="beforeNum" value="${htmlEscape(beforeNum)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更前单价</label>
          <div class="layui-input-block"><input class="layui-input" name="beforePrice" value="${htmlEscape(beforePrice)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更后数量</label>
          <div class="layui-input-block"><input class="layui-input" name="afterNum" value="${htmlEscape(afterNum)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">变更后单价</label>
          <div class="layui-input-block"><input class="layui-input" name="afterPrice" value="${htmlEscape(afterPrice)}"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">会议纪要</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="meetingSummary">${htmlEscape(item.meetingSummary || item.varyContent || "")}</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/vary_meeting/save_meeting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">保存参会人员</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveMeeting(req) {
  const body = { ...req.query, ...req.body };
  let id = idsFrom(req, "meetingId")[0] || varyIdFrom(req);
  let item = variationById(id);
  if (!item) {
    id = nextId(engine.db.variations, "varyId");
    const bill = engine.db.bills[0] || {};
    item = {
      id,
      varyId: id,
      billId: bill.billId,
      billNo: bill.billNo,
      billName: bill.billName,
      measureUnit: bill.measureUnit,
      beforeNum: bill.contractNum || 0,
      beforePrice: bill.price || 0,
      afterNum: bill.contractNum || 0,
      afterPrice: bill.price || 0,
      states: "待上报"
    };
    engine.db.variations.push(item);
  }
  item.meetingId = item.meetingId || item.varyId;
  item.meetingNo = body.meetingNo || item.meetingNo || `HY-LOCAL-${String(item.meetingId).padStart(3, "0")}`;
  item.meetingTitle = body.meetingTitle || item.meetingTitle || body.title || "变更会议";
  item.meetingAddress = body.meetingAddress || item.meetingAddress || "";
  item.meetingDate = body.meetingDate || item.meetingDate || today();
  item.meetingSummary = body.meetingSummary || item.meetingSummary || "";
  item.varyReason = item.varyReason || item.meetingTitle;
  item.varyContent = item.varyContent || item.meetingSummary;
  const meetingBill = billById(body.billId) || billById(body.secBillId) || billById(item.billId) || engine.db.bills[0] || {};
  item.sectionId = numeric(body.sectionId, item.sectionId || meetingBill.sectionId || 101);
  item.billId = meetingBill.billId || item.billId;
  item.billNo = meetingBill.billNo || item.billNo || "";
  item.billName = meetingBill.billName || item.billName || "";
  item.measureUnit = meetingBill.measureUnit || item.measureUnit || "";
  item.meetingUsers = body.meetingUsers || body.attendees || item.meetingUsers || "";
  item.beforeNum = numeric(body.beforeNum, item.beforeNum ?? meetingBill.contractNum ?? 0);
  item.beforePrice = numeric(body.beforePrice, item.beforePrice ?? meetingBill.price ?? 0);
  item.afterNum = numeric(body.afterNum, item.afterNum ?? item.beforeNum);
  item.afterPrice = numeric(body.afterPrice, item.afterPrice ?? item.beforePrice);
  item.varyNo = body.varyNo || item.varyNo || `BG-MEETING-${String(item.varyId).padStart(3, "0")}`;
  item.varyReason = body.varyReason || item.meetingTitle || item.varyReason || "";
  item.varyContent = body.varyContent || item.meetingSummary || item.varyContent || "";
  item.states = body.states || body.state || item.states || "待上报";
  item.updateDate = today();
  return { changed: 1, meetingId: item.meetingId, varyId: item.varyId, row: engine.variationRows().find((row) => Number(row.varyId) === Number(item.varyId)) };
}

function variationMeetingDashboardHtml(req) {
  const sectionId = Number(req.query.sectionId || req.body.sectionId || 0);
  const rows = engine.variationRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const totalMoney = rows.reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
  const majorCount = rows.filter((row) => String(row.varyGrade && row.varyGrade.bdName || "").includes("重大")).length;
  const archivedCount = rows.filter((row) => String(row.states || "").includes("归档")).length;
  const attendeeCount = new Set(rows.flatMap((row) => String(row.meetingUsers || "建设单位,监理单位,施工单位").split(/[,\s，、]+/).filter(Boolean))).size;
  const sectionOptionsHtml = [`<option value="0"${sectionId ? "" : " selected"}>全部合同段</option>`]
    .concat(engine.db.sections.map((section) => {
      const selected = Number(section.sectionId || section.id) === sectionId ? " selected" : "";
      return `<option value="${section.sectionId || section.id}"${selected}>${htmlEscape(section.sectionName || "")}</option>`;
    })).join("");
  const cards = [
    ["会议数量", String(rows.length), "变更会议/申请记录"],
    ["变更金额", moneyText(totalMoney), "会议形成变更净额"],
    ["重大变更", String(majorCount), "按变更等级统计"],
    ["参会角色", String(attendeeCount), "参会单位/人员去重"],
    ["已归档", String(archivedCount), "归档完成会议"],
    ["处理中", String(Math.max(0, rows.length - archivedCount)), "待上报/审核会议"]
  ].map(([label, value, hint]) => `
    <div class="meeting-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const body = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.sectionName || "")}</td>
      <td>${htmlEscape(row.meetingNo || row.varyNo || "")}</td>
      <td class="left">${htmlEscape(row.meetingTitle || row.varyReason || "")}</td>
      <td>${htmlEscape(row.meetingDate || row.measureDate || "")}</td>
      <td>${htmlEscape(row.meetingAddress || row.workAreaName || "")}</td>
      <td class="left">${htmlEscape(row.billNo || "")} ${htmlEscape(row.billName || "")}</td>
      <td>${moneyText(row.varyMoney)}</td>
      <td>${htmlEscape(row.varyGrade && row.varyGrade.bdName || "")}</td>
      <td>${htmlEscape(row.states || "")}</td>
    </tr>`).join("");
  const summaryBody = rows.map((row) => `
    <tr>
      <td>${htmlEscape(row.meetingNo || row.varyNo || "")}</td>
      <td class="left">${htmlEscape(row.meetingSummary || row.varyContent || row.varyReason || "")}</td>
      <td>${htmlEscape(row.meetingUsers || "建设单位,监理单位,施工单位")}</td>
      <td><a href="/vary_measure/render_order_page?varyId=${row.varyId}">申请单</a></td>
    </tr>`).join("");
  return `
    <div class="layui-fluid variation-meeting-dashboard">
      <style>
        .variation-meeting-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .meeting-shell { max-width:1380px; margin:0 auto; }
        .meeting-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .meeting-head h2 { margin:0; font-size:22px; font-weight:600; }
        .meeting-head p { margin:6px 0 0; color:#64748b; }
        .meeting-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .meeting-actions select { height:32px; min-width:180px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .meeting-cards { display:grid; grid-template-columns:repeat(6, minmax(130px, 1fr)); gap:10px; margin-bottom:12px; }
        .meeting-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .meeting-card span, .meeting-card small { display:block; color:#64748b; font-size:12px; }
        .meeting-card strong { display:block; margin:8px 0; color:#7c2d12; font-size:20px; }
        .meeting-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .meeting-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .meeting-panel table { margin:0; min-width:980px; }
        .left { text-align:left; }
        .meeting-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .meeting-cards { grid-template-columns:repeat(3, 1fr); } .meeting-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .meeting-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="meeting-shell">
        <div class="meeting-head">
          <div>
            <h2>工程变更会议看板</h2>
            <p>汇总变更会议、参会单位、关联清单、变更等级和变更金额，支撑变更审批与计量支付。</p>
          </div>
          <div class="meeting-actions">
            <select onchange="location.href='/vary_meeting/dashboard_page?sectionId='+this.value">${sectionOptionsHtml}</select>
            <a class="layui-btn layui-btn-sm" href="/vary_meeting/vary_meeting_edit_page">新增会议</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/varyMeasurePay/dashboard_page?sectionId=${sectionId || ""}">变更支付</a>
          </div>
        </div>
        <div class="meeting-cards">${cards}</div>
        <div class="meeting-panel">
          <h3>会议变更明细</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>合同段</th><th>会议编号</th><th>会议名称</th><th>会议日期</th><th>会议地点</th><th>关联清单</th><th>变更金额</th><th>变更等级</th><th>状态</th></tr></thead>
            <tbody>${body || `<tr><td colspan="9" class="meeting-empty">暂无变更会议数据</td></tr>`}</tbody>
          </table>
        </div>
        <div class="meeting-panel">
          <h3>会议纪要与参会人员</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>会议编号</th><th>会议纪要</th><th>参会人员</th><th>关联报表</th></tr></thead>
            <tbody>${summaryBody || `<tr><td colspan="4" class="meeting-empty">暂无会议纪要</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function localEditPageHtml() {
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="local-note-form">
        <div class="layui-form-item">
          <label class="layui-form-label">编辑主题</label>
          <div class="layui-input-block"><input class="layui-input" name="title" value="本地业务记录"></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">内容</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="content">用于兼容原系统通用编辑弹窗。</textarea></div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){data[el.name]=el.value});fetch('/workflow/save_note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'保存成功')}});})(this)">保存</button>
          </div>
        </div>
      </form>
    </div>`;
}

function saveLocalNote(req) {
  engine.db.localNotes = Array.isArray(engine.db.localNotes) ? engine.db.localNotes : [];
  const id = nextId(engine.db.localNotes, "id");
  engine.db.localNotes.push({ id, title: req.body.title || "本地业务记录", content: req.body.content || "", createDate: today() });
  return { changed: 1, id };
}

function gatherIdFrom(req) {
  return Number(req.body.gatherId || req.query.gatherId || req.body.id || req.query.id || idsFrom(req, "ids")[0] || 0);
}

function dateOnly(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/\d{4}-\d{2}(?:-\d{2})?/);
  if (!match) return "";
  return match[0].length === 7 ? `${match[0]}-01` : match[0];
}

function rowBelongsToGather(row, gather, gatherId) {
  if (gatherId && Number(row.periodId || row.gatherId || 0) === Number(gatherId)) return true;
  const start = dateOnly(gather.startDate || gather.gatherStartDate);
  const end = dateOnly(gather.endDate || gather.gatherEndDate);
  const date = dateOnly(row.measureDate || row.diffYearMonth || row.createDate || row.updateDate);
  if (!start && !end) return true;
  if (!date) return true;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function buildGatherSnapshot(gatherId = 0) {
  const gather = engine.db.measurePeriods.find((row) => Number(row.gatherId || row.id) === Number(gatherId))
    || engine.db.measurePeriods[engine.db.measurePeriods.length - 1]
    || {};
  const selectedGatherId = Number(gather.gatherId || gather.id || gatherId || 0);
  const summary = engine.contractSummary();
  const measures = engine.measureRows().filter((row) => !selectedGatherId || Number(row.periodId || row.gatherId || 0) === selectedGatherId);
  const materialAdjustments = engine.materialDiasRows().filter((row) => rowBelongsToGather(row, gather, selectedGatherId));
  const materialArrivals = engine.materialArrivalRows().filter((row) => rowBelongsToGather(row, gather, selectedGatherId));
  const manuals = engine.manualMeasureRows().filter((row) => rowBelongsToGather(row, gather, selectedGatherId));
  const variations = engine.variationRows().filter((row) => rowBelongsToGather(row, gather, selectedGatherId));
  const measureMoney = measures.reduce((sum, row) => sum + Number(row.measureMoney || 0), 0);
  const materialAdjustMoney = materialAdjustments.reduce((sum, row) => sum + Number(row.adjustMoney || 0), 0);
  const materialArrivalMoney = materialArrivals.reduce((sum, row) => sum + Number(row.money || 0), 0);
  const manualMoney = manuals.reduce((sum, row) => sum + Number(row.measureMoney || 0), 0);
  const varyMoney = variations.reduce((sum, row) => sum + Number(row.varyMoney || 0), 0);
  const rules = engine.calculationRules();
  const certificate = engine.paymentCertificateForPeriod(selectedGatherId);
  const payableMoney = certificate.finalPayment;
  const auditSubmitMoney = payableMoney;
  const auditSupervisorMoney = payableMoney * (rules.auditSupervisorRate / 100);
  const auditOwnerMoney = payableMoney * (rules.auditOwnerRate / 100);
  const auditFinalMoney = payableMoney * (rules.auditFinalRate / 100);
  return {
    gatherId: selectedGatherId,
    gatherNo: gather.gatherNo || gather.periodDesc || "",
    collectTime: new Date().toISOString(),
    billMeasureCount: measures.length,
    materialAdjustCount: materialAdjustments.length,
    materialArrivalCount: materialArrivals.length,
    manualMeasureCount: manuals.length,
    variationCount: variations.length,
    billMeasureMoney: Number(measureMoney.toFixed(2)),
    materialAdjustMoney: Number(materialAdjustMoney.toFixed(2)),
    materialArrivalMoney: Number(materialArrivalMoney.toFixed(2)),
    materialAdvanceMoney: Number(certificate.materialAdvanceMoney.toFixed(2)),
    materialDeductionMoney: Number(certificate.materialDeductionMoney.toFixed(2)),
    retentionMoney: Number(certificate.retentionMoney.toFixed(2)),
    mobilizationDeductionMoney: Number(certificate.mobilizationDeductionMoney.toFixed(2)),
    manualMoney: Number(manualMoney.toFixed(2)),
    varyMoney: Number(varyMoney.toFixed(2)),
    payableMoney: Number(payableMoney.toFixed(2)),
    auditSubmitMoney: Number(auditSubmitMoney.toFixed(2)),
    auditSupervisorMoney: Number(auditSupervisorMoney.toFixed(2)),
    auditOwnerMoney: Number(auditOwnerMoney.toFixed(2)),
    auditFinalMoney: Number(auditFinalMoney.toFixed(2)),
    auditDeductionMoney: Number((auditSubmitMoney - auditFinalMoney).toFixed(2)),
    contractMoney: summary.contractSumMoney,
    finalMoney: summary.finalMoney,
    payRate: summary.finalMoney ? Number(((payableMoney / summary.finalMoney) * 100).toFixed(2)) : 0,
    payableFormula: engine.payableFormulaText(rules),
    paymentCertificate: certificate
  };
}

function ensureGatherSnapshots() {
  engine.db.gatherSnapshots = Array.isArray(engine.db.gatherSnapshots) ? engine.db.gatherSnapshots : [];
  const periodIds = new Set(engine.db.measurePeriods.map((row) => Number(row.gatherId || row.id || 0)).filter(Boolean));
  for (let index = engine.db.gatherSnapshots.length - 1; index >= 0; index -= 1) {
    const gatherId = Number(engine.db.gatherSnapshots[index].gatherId || 0);
    if (gatherId && !periodIds.has(gatherId)) engine.db.gatherSnapshots.splice(index, 1);
  }
  return engine.db.gatherSnapshots;
}

function collectGather(req) {
  const gatherId = gatherIdFrom(req);
  const snapshot = buildGatherSnapshot(gatherId);
  const snapshots = ensureGatherSnapshots();
  const id = nextId(snapshots, "snapshotId");
  snapshots.push({ id, snapshotId: id, ...snapshot });
  const target = engine.db.measurePeriods.find((row) => Number(row.gatherId || row.id) === Number(snapshot.gatherId));
  if (target) {
    target.collectTime = snapshot.collectTime.slice(0, 19).replace("T", " ");
    target.collectMoney = snapshot.payableMoney;
    target.billMeasureMoney = snapshot.billMeasureMoney;
    target.materialAdjustMoney = snapshot.materialAdjustMoney;
    target.materialArrivalMoney = snapshot.materialArrivalMoney;
    target.materialArrivalCount = snapshot.materialArrivalCount;
    target.manualMoney = snapshot.manualMoney;
    target.auditSubmitMoney = snapshot.auditSubmitMoney;
    target.auditSupervisorMoney = snapshot.auditSupervisorMoney;
    target.auditOwnerMoney = snapshot.auditOwnerMoney;
    target.auditFinalMoney = snapshot.auditFinalMoney;
    target.auditDeductionMoney = snapshot.auditDeductionMoney;
    target.gatherStateCode = 1;
    target.gatherState = "已汇总";
    target.remark = `累计应付 ${snapshot.payableMoney}`;
  }
  return { collected: true, snapshotId: id, snapshot, rows: snapshots.length };
}

function checkGather(req) {
  const snapshot = buildGatherSnapshot(gatherIdFrom(req));
  const problems = [];
  if (snapshot.contractMoney <= 0) problems.push("合同金额为空");
  if (snapshot.finalMoney < snapshot.contractMoney) problems.push("最终金额小于合同金额");
  if (snapshot.payableMoney < 0) problems.push("应付金额小于零");
  if (snapshot.payableMoney > snapshot.finalMoney && snapshot.finalMoney > 0) problems.push("应付金额超过最终金额");
  engine.db.lastGatherCheck = {
    checkTime: new Date().toISOString(),
    ok: problems.length === 0,
    problems,
    snapshot
  };
  return { checked: true, ok: problems.length === 0, problems, summary: snapshot };
}

function refreshGather(req) {
  const snapshots = ensureGatherSnapshots();
  const snapshot = buildGatherSnapshot(gatherIdFrom(req));
  return { refreshed: true, latestSnapshot: snapshots[snapshots.length - 1] || null, current: snapshot, gatherRows: gatherRows().length };
}

function deleteGatherPeriods(req) {
  const ids = idsFrom(req, "ids");
  const changed = removeRows(engine.db.measurePeriods, "gatherId", ids);
  if (ids.length) {
    const snapshots = ensureGatherSnapshots();
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      if (ids.includes(Number(snapshots[index].gatherId || 0))) snapshots.splice(index, 1);
    }
  }
  return { changed };
}

function dataGatherDashboardHtml(req) {
  const gatherId = gatherIdFrom(req);
  const current = buildGatherSnapshot(gatherId);
  const snapshots = ensureGatherSnapshots();
  const latest = snapshots
    .filter((row) => !current.gatherId || Number(row.gatherId || 0) === Number(current.gatherId))
    .slice(-1)[0] || null;
  const gather = engine.db.measurePeriods.find((row) => Number(row.gatherId || row.id) === Number(current.gatherId)) || {};
  const cards = [
    ["清单计量", moneyText(current.billMeasureMoney), `${current.billMeasureCount} 张计量单`],
    ["材料补差", moneyText(current.materialAdjustMoney), `${current.materialAdjustCount} 条补差`],
    ["材料到场", moneyText(current.materialArrivalMoney), `${current.materialArrivalCount} 条到场`],
    ["手动计量", moneyText(current.manualMoney), `${current.manualMeasureCount} 条手动计量`],
    ["变更金额", moneyText(current.varyMoney), `${current.variationCount} 条变更`],
    ["本期应付", moneyText(current.payableMoney), `支付比例 ${percentText(current.payRate)}`]
  ].map(([label, value, hint]) => `
    <div class="gather-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const auditCards = [
    ["最终审核", moneyText(current.auditFinalMoney), "本期应付按审核链折算"],
    ["本期核减", moneyText(current.auditDeductionMoney), "施工上报 - 最终审核"]
  ].map(([label, value, hint]) => `
    <div class="gather-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const gatherOptions = engine.db.measurePeriods.map((row) => {
    const id = row.gatherId || row.id;
    const selected = Number(id) === Number(current.gatherId) ? " selected" : "";
    return `<option value="${id}"${selected}>${htmlEscape(row.gatherNo || row.periodDesc || `第 ${id} 期`)}</option>`;
  }).join("");
  const snapshotRows = snapshots
    .slice(-8)
    .reverse()
    .map((row) => `
      <tr>
        <td>${htmlEscape(row.snapshotId || row.id || "")}</td>
        <td>${htmlEscape(row.gatherNo || "")}</td>
        <td>${htmlEscape(String(row.collectTime || "").slice(0, 19).replace("T", " "))}</td>
        <td>${moneyText(row.billMeasureMoney)}</td>
        <td>${moneyText(row.materialAdjustMoney)}</td>
        <td>${moneyText(row.materialArrivalMoney)}</td>
        <td>${moneyText(row.manualMoney)}</td>
        <td>${moneyText(row.payableMoney)}</td>
        <td>${moneyText(row.auditFinalMoney)}</td>
        <td>${moneyText(row.auditDeductionMoney)}</td>
        <td>${percentText(row.payRate)}</td>
      </tr>`).join("");
  const rows = [
    ["清单计量", current.billMeasureCount, current.billMeasureMoney, "清单计量金额进入本期应付"],
    ["材料补差", current.materialAdjustCount, current.materialAdjustMoney, "材料价差进入本期应付"],
    ["材料到场", current.materialArrivalCount, current.materialArrivalMoney, "到场金额用于材料跟踪，不直接计入应付"],
    ["手动计量", current.manualMeasureCount, current.manualMoney, "现场签证/零星工程进入本期应付"],
    ["工程变更", current.variationCount, current.varyMoney, "变更金额影响最终控制金额"]
  ].map(([name, count, money, note]) => `
    <tr>
      <td>${htmlEscape(name)}</td>
      <td>${Number(count || 0)}</td>
      <td>${moneyText(money)}</td>
      <td class="left">${htmlEscape(note)}</td>
    </tr>`).join("");
  return `
    <div class="layui-fluid data-gather-dashboard">
      <style>
        .data-gather-dashboard { padding:16px; background:#f4f7fb; color:#172033; }
        .gather-shell { max-width:1320px; margin:0 auto; }
        .gather-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .gather-head h2 { margin:0; font-size:22px; font-weight:600; }
        .gather-head p { margin:6px 0 0; color:#64748b; }
        .gather-actions { display:flex; gap:8px; align-items:center; }
        .gather-actions select { height:32px; min-width:190px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; background:#fff; }
        .gather-cards { display:grid; grid-template-columns:repeat(8, minmax(120px, 1fr)); gap:10px; margin-bottom:12px; }
        .gather-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .gather-card span, .gather-card small { display:block; color:#64748b; font-size:12px; }
        .gather-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .gather-panels { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .gather-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; }
        .gather-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .gather-panel table { margin:0; min-width:620px; }
        .gather-meta { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:12px 14px; margin-bottom:12px; color:#475569; }
        .left { text-align:left; }
        .gather-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .gather-cards { grid-template-columns:repeat(4, 1fr); } .gather-panels { grid-template-columns:1fr; } .gather-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .gather-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="gather-shell">
        <div class="gather-head">
          <div>
            <h2>期次数据汇总</h2>
            <p>按工期汇总清单计量、材料补差、材料到场、手动计量和变更金额。</p>
          </div>
          <div class="gather-actions">
            <select onchange="location.href='/dataGather/gather_dashboard_page?gatherId='+this.value">${gatherOptions}</select>
            <button class="layui-btn layui-btn-sm" onclick="fetch('/dataGather/data_collect_gather',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gatherId:${current.gatherId || 0}})}).then(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())})">采集本期</button>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/reportManager/dashboard_page">支付报表</a>
          </div>
        </div>
        <div class="gather-meta">
          当前期次：${htmlEscape(current.gatherNo || "未选择")}　
          日期：${htmlEscape(gather.startDate || gather.gatherStartDate || "")} 至 ${htmlEscape(gather.endDate || gather.gatherEndDate || "")}　
          状态：${htmlEscape(gather.gatherState || gather.states || "")}　
          最近采集：${htmlEscape(latest ? String(latest.collectTime || "").slice(0, 19).replace("T", " ") : "暂无")}
        </div>
        <div class="gather-cards">${cards}${auditCards}</div>
        <div class="gather-panels">
          <div class="gather-panel">
            <h3>本期组成</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>类别</th><th>数量</th><th>金额</th><th>说明</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div class="gather-panel">
            <h3>最近采集快照</h3>
            <table class="layui-table" lay-size="sm">
              <thead><tr><th>快照号</th><th>期次</th><th>采集时间</th><th>清单计量</th><th>材料补差</th><th>材料到场</th><th>手动计量</th><th>本期应付</th><th>支付比例</th></tr></thead>
              <tbody>${snapshotRows || `<tr><td colspan="9" class="gather-empty">暂无采集快照</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function sysGatherDashboardHtml(req) {
  const rows = gatherRows();
  const snapshots = ensureGatherSnapshots();
  const latestByGather = new Map();
  snapshots.forEach((snapshot) => latestByGather.set(Number(snapshot.gatherId || 0), snapshot));
  const auditValuesForGatherRow = (row, snapshot = {}) => {
    const submit = Number(row.collectMoney || row.payableMoney || snapshot.payableMoney || 0);
    const final = Number(row.auditFinalMoney || snapshot.auditFinalMoney || (submit ? submit * 0.985 : 0));
    const deduction = Number(row.auditDeductionMoney || snapshot.auditDeductionMoney || (submit ? submit - final : 0));
    return {
      final: Number(final.toFixed(2)),
      deduction: Number(deduction.toFixed(2))
    };
  };
  const totalCollected = rows.reduce((sum, row) => sum + Number(row.collectMoney || row.payableMoney || 0), 0);
  const totalAuditFinal = rows.reduce((sum, row) => {
    const snapshot = latestByGather.get(Number(row.gatherId || row.id)) || {};
    return sum + auditValuesForGatherRow(row, snapshot).final;
  }, 0);
  const totalAuditDeduction = rows.reduce((sum, row) => {
    const snapshot = latestByGather.get(Number(row.gatherId || row.id)) || {};
    return sum + auditValuesForGatherRow(row, snapshot).deduction;
  }, 0);
  const lockedCount = rows.filter((row) => Number(row.gatherStateCode ?? row.gatherState ?? 1) === 0 || String(row.states || "").includes("锁")).length;
  const collectedCount = rows.filter((row) => latestByGather.has(Number(row.gatherId || row.id)) || row.collectTime).length;
  const latest = snapshots[snapshots.length - 1] || null;
  const cards = [
    ["工期数量", String(rows.length), "全部计量汇总期"],
    ["已采集", String(collectedCount), "已有采集时间或快照"],
    ["锁定工期", String(lockedCount), "禁止继续调整"],
    ["启用工期", String(Math.max(0, rows.length - lockedCount)), "可继续采集"],
    ["采集金额", moneyText(totalCollected), "工期累计采集金额"],
    ["最近快照", latest ? String(latest.snapshotId || latest.id || "") : "-", latest ? String(latest.collectTime || "").slice(0, 19).replace("T", " ") : "暂无"]
  ].map(([label, value, hint]) => `
    <div class="period-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const auditCards = [
    ["最终审核", moneyText(totalAuditFinal), "已采集工期最终审核金额"],
    ["累计核减", moneyText(totalAuditDeduction), "已采集工期审核核减金额"]
  ].map(([label, value, hint]) => `
    <div class="period-card"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong><small>${htmlEscape(hint)}</small></div>`).join("");
  const periodBody = rows.map((row) => {
    const id = Number(row.gatherId || row.id || 0);
    const snapshot = latestByGather.get(id) || {};
    const audit = auditValuesForGatherRow(row, snapshot);
    const stateText = Number(row.gatherStateCode ?? row.gatherState ?? 1) === 0 ? "锁定" : cleanBusinessText(row.states || row.gatherState || "启用", "启用");
    return `
      <tr>
        <td>${htmlEscape(row.gatherNo || row.periodDesc || "")}<br><small>${htmlEscape(row.periodDesc && row.periodDesc !== row.gatherNo ? row.periodDesc : "")}</small></td>
        <td>${htmlEscape(row.gatherFileNo || "")}</td>
        <td>${htmlEscape(row.gatherStartDate || row.startDate || "")}</td>
        <td>${htmlEscape(row.gatherEndDate || row.endDate || "")}</td>
        <td>${htmlEscape(stateText)}</td>
        <td>${htmlEscape(row.collectTime || "")}</td>
        <td>${moneyText(row.collectMoney || snapshot.payableMoney || 0)}</td>
        <td>${moneyText(audit.final)}</td>
        <td>${moneyText(audit.deduction)}</td>
        <td class="left">${htmlEscape(row.gatherShow || row.remark || "")}</td>
        <td>
          <a href="/sysGather/edit_gatherData_page?gatherId=${id}">编辑</a>
          <a href="/dataGather/gather_dashboard_page?gatherId=${id}">采集</a>
          <a href="/sysGather/update_gather_state?gatherId=${id}&gatherState=0">锁定</a>
          <a href="/sysGather/update_gather_state?gatherId=${id}&gatherState=1">启用</a>
        </td>
      </tr>`;
  }).join("");
  const snapshotBody = snapshots.slice(-12).reverse().map((row) => {
    const audit = auditValuesForGatherRow({}, row);
    return `
    <tr>
      <td>${htmlEscape(row.snapshotId || row.id || "")}</td>
      <td>${htmlEscape(row.gatherNo || "")}</td>
      <td>${htmlEscape(String(row.collectTime || "").slice(0, 19).replace("T", " "))}</td>
      <td>${Number(row.billMeasureCount || 0)}</td>
      <td>${Number(row.materialAdjustCount || 0)}</td>
      <td>${Number(row.materialArrivalCount || 0)}</td>
      <td>${Number(row.manualMeasureCount || 0)}</td>
      <td>${moneyText(row.billMeasureMoney)}</td>
      <td>${moneyText(row.materialAdjustMoney)}</td>
      <td>${moneyText(row.materialArrivalMoney)}</td>
      <td>${moneyText(row.manualMoney)}</td>
      <td>${moneyText(row.payableMoney)}</td>
      <td>${moneyText(audit.final)}</td>
      <td>${moneyText(audit.deduction)}</td>
    </tr>`;
  }).join("");
  return `
    <div class="layui-fluid period-dashboard">
      <style>
        .period-dashboard { padding:16px; background:#f5f7fb; color:#172033; }
        .period-shell { max-width:1380px; margin:0 auto; }
        .period-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:14px; }
        .period-head h2 { margin:0; font-size:22px; font-weight:600; }
        .period-head p { margin:6px 0 0; color:#64748b; }
        .period-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .period-cards { display:grid; grid-template-columns:repeat(8, minmax(120px, 1fr)); gap:10px; margin-bottom:12px; }
        .period-card { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:13px 14px; min-height:88px; }
        .period-card span, .period-card small { display:block; color:#64748b; font-size:12px; }
        .period-card strong { display:block; margin:8px 0; color:#0f766e; font-size:20px; }
        .period-panel { background:#fff; border:1px solid #dbe4f0; border-radius:6px; padding:14px; overflow:auto; margin-bottom:12px; }
        .period-panel h3 { margin:0 0 10px; font-size:16px; font-weight:600; }
        .period-panel table { margin:0; min-width:980px; }
        .period-panel td a { margin-right:8px; }
        .left { text-align:left; }
        .period-empty { text-align:center; color:#94a3b8; padding:24px; }
        @media (max-width:1100px) { .period-cards { grid-template-columns:repeat(4, 1fr); } .period-head { align-items:flex-start; flex-direction:column; } }
        @media (max-width:640px) { .period-cards { grid-template-columns:1fr 1fr; } }
      </style>
      <div class="period-shell">
        <div class="period-head">
          <div>
            <h2>工期汇总管理看板</h2>
            <p>维护计量支付工期，管理文件编号、锁定启用、工期说明，并查看每期采集快照和应付金额。</p>
          </div>
          <div class="period-actions">
            <a class="layui-btn layui-btn-sm" href="/sysGather/edit_gatherData_page">添加工期</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/dataGather/gather_dashboard_page">数据采集</a>
            <a class="layui-btn layui-btn-sm layui-btn-primary" href="/reportManager/dashboard_page">支付报表</a>
          </div>
        </div>
        <div class="period-cards">${cards}${auditCards}</div>
        <div class="period-panel">
          <h3>工期列表</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>工期</th><th>文件编号</th><th>开始日期</th><th>结束日期</th><th>状态</th><th>最后采集</th><th>采集金额</th><th>说明</th><th>操作</th></tr></thead>
            <tbody>${periodBody || `<tr><td colspan="9" class="period-empty">暂无工期</td></tr>`}</tbody>
          </table>
        </div>
        <div class="period-panel">
          <h3>采集快照</h3>
          <table class="layui-table" lay-size="sm">
            <thead><tr><th>快照号</th><th>工期</th><th>采集时间</th><th>清单数</th><th>补差数</th><th>到场数</th><th>手动数</th><th>清单计量</th><th>材料补差</th><th>材料到场</th><th>手动计量</th><th>本期应付</th></tr></thead>
            <tbody>${snapshotBody || `<tr><td colspan="12" class="period-empty">暂无采集快照</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function collectReportData(req) {
  const result = checkGather(req);
  engine.db.reportCollectState = {
    collectTime: new Date().toISOString(),
    reportRows: engine.reportProjectRows().length,
    summary: result.summary,
    ok: result.ok
  };
  return { collected: true, ...engine.db.reportCollectState };
}

function importAnalyze(req) {
  const nodes = ensureAnalyzeNodes();
  const existingByName = new Map(nodes.map((node) => [String(node.nodeName || node.name), node]));
  const customNames = String(req.body.nodeNames || req.query.nodeNames || "")
    .split(/\r?\n|,|，/)
    .map((name) => cleanBusinessText(name.trim(), ""))
    .filter(Boolean);
  const chapterNames = {
    "100": "临建工程",
    "200": "路基工程",
    "300": "路面工程",
    "400": "桥梁工程",
    "900": "其他工程"
  };
  customNames.forEach((name) => {
    if (!existingByName.has(name)) {
      const id = nextId(nodes, "nodeId");
      const parentId = Number(req.body.parentId || req.query.parentId || 0);
      const node = { id, nodeId: id, parentId, pId: parentId, nodeName: name, name, countNum: 0, source: "import_analyze_custom" };
      nodes.push(node);
      existingByName.set(name, node);
    }
  });
  let created = 0;
  if (!customNames.length || String(req.body.mode || req.query.mode || "chapter") === "chapter") {
    Object.keys(chapterNames).forEach((chapter) => {
      const name = chapterNames[chapter];
      if (!existingByName.has(name)) {
        const id = nextId(nodes, "nodeId");
        const node = { id, nodeId: id, parentId: 0, pId: 0, nodeName: name, name, countNum: 0, source: "import_analyze" };
        nodes.push(node);
        existingByName.set(name, node);
        created += 1;
      }
    });
  }
  let assigned = 0;
  if (String(req.body.assignBills ?? req.query.assignBills ?? "1") !== "") {
    engine.db.bills.forEach((bill) => {
      const chapter = String(bill.chapter || bill.billNo || "").slice(0, 3);
      const node = existingByName.get(chapterNames[chapter] || "其他工程");
      if (node && Number(bill.analyzeNodeId) !== Number(node.nodeId)) {
        bill.analyzeNodeId = node.nodeId;
        assigned += 1;
      }
    });
  }
  return { imported: true, created: created + customNames.length, assigned, rows: analyzeNodeRows().length };
}

function importAnalyzeFormHtml(req) {
  const defaultNames = ["临建工程", "路基工程", "路面工程", "桥梁工程", "其他工程"].join("\n");
  const parentOptions = [`<option value="0">根节点</option>`].concat(analyzeNodeRows().map((node) => {
    const id = Number(node.nodeId || node.id || 0);
    return `<option value="${id}">${htmlEscape(node.nodeName || node.name || "")}</option>`;
  })).join("");
  return `
    <div style="padding:16px 20px;">
      <form class="layui-form" id="bill-analyze-import-form">
        <div class="layui-form-item">
          <label class="layui-form-label">导入方式</label>
          <div class="layui-input-block">
            <select name="mode">
              <option value="chapter">按清单章节自动导入</option>
              <option value="custom">按下方节点名称导入</option>
            </select>
          </div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">父级节点</label>
          <div class="layui-input-block"><select name="parentId">${parentOptions}</select></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">节点名称</label>
          <div class="layui-input-block"><textarea class="layui-textarea" name="nodeNames" rows="6">${htmlEscape(defaultNames)}</textarea></div>
        </div>
        <div class="layui-form-item">
          <label class="layui-form-label">挂接清单</label>
          <div class="layui-input-block">
            <input type="checkbox" name="assignBills" value="1" checked>
            <span style="margin-left:6px;color:#64748b;">按清单编号章节自动挂接已有清单</span>
          </div>
        </div>
        <div class="layui-form-item">
          <div class="layui-input-block">
            <button type="button" class="layui-btn" onclick="(function(btn){var form=btn.closest('form');var data={};Array.prototype.forEach.call(form.querySelectorAll('[name]'),function(el){if(el.type==='checkbox'){data[el.name]=el.checked?el.value:''}else{data[el.name]=el.value}});fetch('/billAnalyze/import_analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(r){if(window.layer){layer.msg(r.msg||'导入成功')} setTimeout(function(){(window.zwkjyReloadCurrentContent?window.zwkjyReloadCurrentContent():location.reload())},500)});})(this)">开始导入</button>
            <a class="layui-btn layui-btn-primary" href="/billAnalyze/dashboard_page">返回看板</a>
          </div>
        </div>
      </form>
    </div>`;
}

function deleteGenericNode(req) {
  const ids = idsFrom(req, "ids").concat(idsFrom(req, "nodeId"));
  const documentChanged = removeRows(engine.db.documents, "nodeId", ids);
  const analyzeChanged = removeAnalyzeNodes(ids);
  return { changed: documentChanged + analyzeChanged, documentChanged, analyzeChanged };
}

app.get("/", (req, res) => {
  const fileName = authCookie(req) ? "index.html" : "login.html";
  html(res, readText(path.join(root, fileName)));
});

app.get("/index", (req, res) => res.redirect("/"));
app.get("/index.html", (req, res) => html(res, readText(path.join(root, "index.html"))));
app.get("/main", (req, res) => html(res, dashboardHtml("综合工作台")));

app.post("/dologin", (req, res) => {
  if (req.body.user_account === "ys1" && req.body.password === "000000") {
    res.setHeader("Set-Cookie", "zwkjy_local_auth=1; Path=/; HttpOnly; SameSite=Lax");
    operationOk(res, {
      userId: 563,
      userAccount: "ys1",
      userName: "ys1",
      userStatus: 1,
      avatarPath: "",
      sysUserDept: { deptName: engine.db.client.deptName },
      sysRoleType: { roleTypeName: engine.db.client.roleTypeName, roleTypeCode: "SBSJ" }
    });
    return;
  }
  json(res, { code: 0, msg: "用户不存在或密码错误" });
});

app.get("/loginout", (req, res) => {
  res.setHeader("Set-Cookie", "zwkjy_local_auth=; Path=/; Max-Age=0");
  operationOk(res);
});

app.get("/user/curr_user_info", (req, res) => {
  operationOk(res, {
    userId: 563,
    userAccount: "ys1",
    userName: "ys1",
    avatarPath: "",
    deptName: engine.db.client.deptName,
    roleTypeName: engine.db.client.roleTypeName
  });
});

app.get("/menu/header_menu", (req, res) => {
  const href = String(req.query.href || "");
  let selected = topMenu[0] ? topMenu[0].id : 0;
  if (href.startsWith("sbr/sbr_com/")) {
    const id = href.split("/").pop();
    for (const [parentId, items] of leftMenus.entries()) {
      if (allLeaves(items).some((leaf) => String(leaf.resourceId) === id)) selected = Number(parentId);
    }
  }
  json(res, engine.ok(topMenu, { id: selected }));
});

app.get("/menu/left_menu", (req, res) => {
  const parentId = String(req.query.parentId || (topMenu[0] && topMenu[0].id) || "");
  const raw = leftMenus.get(parentId) || [];
  operationOk(res, raw.map(normalizeNode));
});

app.get("/position/chose_page", (req, res) => {
  const match = String(req.query.href || "").match(/sbr\/sbr_com\/(\d+)/);
  html(res, match ? workPositionForId(match[1]) : `<div class="layui-breadcrumb"><a>首页</a><a><cite>工作台</cite></a></div>`);
});

app.get("/main", (req, res) => html(res, dashboardHtml("工作台")));
app.get("/sbr/header_content", (req, res) => html(res, dashboardHtml("模块首页")));
app.get("/admin/dashboard_page", (req, res) => html(res, adminDashboardHtml()));
app.get("/system/dashboard_page", (req, res) => html(res, adminDashboardHtml()));
app.get("/admin/calculation_rules_page", (req, res) => html(res, calculationRulesPageHtml()));
app.get("/system/calculation_rules_page", (req, res) => html(res, calculationRulesPageHtml()));
app.all("/payment/jl_report_page", (req, res) => html(res, jlPaymentReportPageHtml(req)));
app.get("/sbr/sbr_com/:id", (req, res) => html(res, contentForId(req.params.id)));
app.all("/sbr/sbr_com", (req, res) => html(res, contentForId(req.body.leftId || req.query.leftId || "")));

app.get("/js/ColResizable/colResizable-1.6.min.js", (req, res) => {
  res.type("application/javascript").send("(function($){if($&&!$.fn.colResizable){$.fn.colResizable=function(){return this;};}})(window.jQueryZW||window.jQuery);");
});

app.post("/sbr/sbr_find", (req, res) => {
  if (req.body.type === "menu") {
    operationOk(res, topMenuRaw);
    return;
  }
  operationOk(res, leftMenus.get(String(req.body.parentId || "")) || []);
});

app.all("/workPosition/getWorkPositionPageTest", (req, res) => {
  html(res, workPositionForId(req.body.leftId || req.query.leftId || ""));
});

app.all("/workPosition/getValue", (req, res) => {
  operationOk(res, { priceDecimals: 2, moneyDecimals: 2, quantityDecimals: 3 });
});

app.get("/api/cost/summary", (req, res) => operationOk(res, engine.dashboard()));
app.get("/api/admin/calculation_rules", (req, res) => operationOk(res, {
  rules: engine.calculationRules(),
  summary: engine.contractSummary()
}));
app.post("/api/admin/calculation_rules", (req, res) => mutate(res, () => saveCalculationRules(req.body)));
app.get("/api/cost/bills", (req, res) => table(res, req, engine.billRows()));
app.get("/api/cost/measures", (req, res) => table(res, req, engine.measureRows()));
app.get("/api/cost/ledger", (req, res) => table(res, req, engine.billLedgerRows()));
app.get("/api/payment/jl113", (req, res) => table(res, req, engine.jl113Rows({ periodId: queryNumber(req, "periodId") || queryNumber(req, "gatherId"), sectionId: queryNumber(req, "sectionId") })));
app.get("/api/payment/jl105", (req, res) => table(res, req, engine.jl105LedgerRows({ periodId: queryNumber(req, "periodId") || queryNumber(req, "gatherId"), sectionId: queryNumber(req, "sectionId") })));
app.get("/api/payment/jl104_chapters", (req, res) => table(res, req, engine.jl104ChapterRows({ periodId: queryNumber(req, "periodId") || queryNumber(req, "gatherId"), sectionId: queryNumber(req, "sectionId") })));
app.get("/api/payment/certificate", (req, res) => operationOk(res, engine.paymentCertificateForPeriod(queryNumber(req, "periodId") || queryNumber(req, "gatherId"), { sectionId: queryNumber(req, "sectionId") })));
app.get("/api/payment/jl_validation", (req, res) => operationOk(res, engine.jlPaymentValidation({ periodId: queryNumber(req, "periodId") || queryNumber(req, "gatherId"), sectionId: queryNumber(req, "sectionId") })));
app.get("/api/payment/jl_lifecycle", (req, res) => operationOk(res, engine.jlFormLifecycle({ periodId: queryNumber(req, "periodId") || queryNumber(req, "gatherId"), sectionId: queryNumber(req, "sectionId") })));
app.get("/api/cost/reconciliation", (req, res) => operationOk(res, costReconciliationData()));
app.get("/api/cost/5d_model", (req, res) => operationOk(res, fiveDCostModelData()));
app.get("/api/cost/boq_validation", (req, res) => operationOk(res, boqValidationData()));
app.get("/api/cost/unit_price_analysis", (req, res) => operationOk(res, unitPriceAnalysisData()));
app.get("/api/debug/runtime", (req, res) => {
  operationOk(res, {
    serverFile: __filename,
    dataDir,
    runtimeFile: path.join(dataDir, "runtime-db.json"),
    runtimeExists: fs.existsSync(path.join(dataDir, "runtime-db.json"))
  });
});
app.post("/api/cost/calculate", (req, res) => {
  const bills = Array.isArray(req.body.bills) ? req.body.bills : [];
  const variations = Array.isArray(req.body.variations) ? req.body.variations : [];
  const measures = Array.isArray(req.body.measures) ? req.body.measures : [];
  const materialAdjustments = Array.isArray(req.body.materialAdjustments) ? req.body.materialAdjustments : [];
  const materialArrivals = Array.isArray(req.body.materialArrivals) ? req.body.materialArrivals : [];
  const manualMeasures = Array.isArray(req.body.manualMeasures) ? req.body.manualMeasures : [];
  const sum = (rows, fn) => rows.reduce((total, row) => total + fn(row), 0);
  const round = (value) => Number(Number(value || 0).toFixed(2));
  const keyForBill = (row, index) => String(row.billId || row.billNo || row.code || index + 1);
  const measuredByBill = measures.reduce((map, row) => {
    const key = String(row.billId || row.billNo || row.code || "");
    if (key) map.set(key, (map.get(key) || 0) + Number(row.measureNum ?? row.quantity ?? row.currentNum ?? 0));
    return map;
  }, new Map());
  const billDetails = bills.map((row, index) => {
    const quantity = Number(row.quantity || row.contractNum || 0);
    const price = Number(row.price || row.unitPrice || 0);
    const measuredNum = Number(row.measureNum ?? row.measuredNum ?? measuredByBill.get(keyForBill(row, index)) ?? 0);
    return {
      index: index + 1,
      billId: row.billId || "",
      billNo: row.billNo || row.code || "",
      billName: row.billName || row.name || "",
      measureUnit: row.measureUnit || row.unit || "",
      quantity,
      price,
      amount: round(quantity * price),
      measuredNum,
      measureMoney: round(measuredNum * price)
    };
  });
  const variationDetails = variations.map((row, index) => {
    const beforeAmount = round(Number(row.beforeNum || 0) * Number(row.beforePrice || row.price || 0));
    const afterAmount = round(Number(row.afterNum || 0) * Number(row.afterPrice || row.price || 0));
    return {
      index: index + 1,
      varyNo: row.varyNo || row.code || "",
      varyReason: row.varyReason || row.reason || "",
      beforeAmount,
      afterAmount,
      varyMoney: round(afterAmount - beforeAmount)
    };
  });
  const materialDetails = materialAdjustments.map((row, index) => {
    const quantity = Number(row.quantity || row.measureNum || 0);
    const priceDiff = Number(row.priceDiff ?? (Number(row.currentPrice || 0) - Number(row.basePrice || 0)));
    return {
      index: index + 1,
      materialNo: row.materialNo || "",
      materialName: row.materialName || row.name || "",
      quantity,
      basePrice: Number(row.basePrice || 0),
      currentPrice: Number(row.currentPrice || 0),
      priceDiff,
      adjustMoney: round(quantity * priceDiff)
    };
  });
  const materialArrivalDetails = materialArrivals.map((row, index) => {
    const quantity = Number(row.quantity || row.measureNum || 0);
    const price = Number(row.price ?? row.currentPrice ?? row.unitPrice ?? 0);
    return {
      index: index + 1,
      materialNo: row.materialNo || "",
      materialName: row.materialName || row.name || "",
      quantity,
      price,
      arrivalMoney: round(quantity * price)
    };
  });
  const materialLinkMap = new Map();
  const materialKey = (row) => String(row.materialId || row.materialNo || row.materialName || row.name || row.index || "");
  materialDetails.forEach((row) => {
    const key = materialKey(row);
    const current = materialLinkMap.get(key) || {
      materialNo: row.materialNo,
      materialName: row.materialName,
      diasQuantity: 0,
      diasMoney: 0,
      arrivalQuantity: 0,
      arrivalMoney: 0
    };
    current.diasQuantity += Number(row.quantity || 0);
    current.diasMoney += Number(row.adjustMoney || 0);
    materialLinkMap.set(key, current);
  });
  materialArrivalDetails.forEach((row) => {
    const key = materialKey(row);
    const current = materialLinkMap.get(key) || {
      materialNo: row.materialNo,
      materialName: row.materialName,
      diasQuantity: 0,
      diasMoney: 0,
      arrivalQuantity: 0,
      arrivalMoney: 0
    };
    current.arrivalQuantity += Number(row.quantity || 0);
    current.arrivalMoney += Number(row.arrivalMoney || 0);
    materialLinkMap.set(key, current);
  });
  const materialLedger = Array.from(materialLinkMap.values()).map((row) => ({
    ...row,
    diasQuantity: round(row.diasQuantity),
    diasMoney: round(row.diasMoney),
    arrivalQuantity: round(row.arrivalQuantity),
    arrivalMoney: round(row.arrivalMoney),
    coverageRate: row.diasQuantity ? round((row.arrivalQuantity / row.diasQuantity) * 100) : (row.arrivalQuantity > 0 ? 100 : 0)
  }));
  const manualDetails = manualMeasures.map((row, index) => {
    const quantity = Number(row.quantity || row.measureNum || 0);
    const price = Number(row.price || 0);
    return {
      index: index + 1,
      billNo: row.billNo || "",
      billName: row.billName || row.name || "",
      quantity,
      price,
      measureMoney: round(quantity * price)
    };
  });
  const contractMoney = round(sum(billDetails, (row) => row.amount));
  const measuredMoney = round(sum(billDetails, (row) => row.measureMoney));
  const variationMoney = round(sum(variationDetails, (row) => row.varyMoney));
  const materialAdjustMoney = round(sum(materialDetails, (row) => row.adjustMoney));
  const materialArrivalMoney = round(sum(materialArrivalDetails, (row) => row.arrivalMoney));
  const manualMoney = round(sum(manualDetails, (row) => row.measureMoney));
  const finalMoney = round(contractMoney + variationMoney);
  const rules = engine.calculationRules();
  const paymentCertificate = engine.calculatePaymentCertificate({
    measuredMoney,
    materialAdjustMoney,
    materialArrivalMoney,
    manualMoney,
    contractTotal: finalMoney,
    cumulativeSubtotal: measuredMoney + manualMoney
  }, rules);
  const payableMoney = paymentCertificate.finalPayment;
  operationOk(res, {
    contractMoney,
    measuredMoney,
    variationMoney,
    materialAdjustMoney,
    materialArrivalMoney,
    manualMoney,
    finalMoney,
    payableMoney,
    paymentCertificate,
    payRate: finalMoney ? round((payableMoney / finalMoney) * 100) : 0,
    payableFormula: engine.payableFormulaText(rules),
    calculationRules: rules,
    details: {
      bills: billDetails,
      measures,
      variations: variationDetails,
      materialAdjustments: materialDetails,
      materialArrivals: materialArrivalDetails,
      materialLedger,
      manualMeasures: manualDetails
    }
  });
});

app.post("/api/local/save", (req, res) => {
  mutate(res, () => saveLocalRecord(req.body));
});

app.all("/billModel/", (req, res) => table(res, req, billModelRowsClean()));
app.all("/billModel/dashboard_page", (req, res) => html(res, modelCenterDashboardHtml(req)));
app.all("/billModel/billModel_page", (req, res) => html(res, modelCenterDashboardHtml(req)));
app.all("/billModel/get_bill_model_list", (req, res) => table(res, req, billModelRowsClean()));
app.all("/billModel/bill_page_list", (req, res) => table(res, req, billModelRowsClean()));
app.all("/billModel/bill_model_delete", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.billModels, "modelId", idsFrom(req, "ids")) })));
app.all("/billModel/edit_model_page", (req, res) => html(res, billModelFormHtmlClean(req)));
app.all("/edit_model_page", (req, res) => html(res, billModelFormHtmlClean(req)));
app.all("/billModel/save_model", (req, res) => mutate(res, () => saveBillModelClean(req)));
app.all("/billModel/import_model", (req, res) => html(res, importBillModelHtml()));
app.all("/billModel/import_bill_model_data", (req, res) => mutate(res, () => saveBillModelClean(req)));
app.all("/billModel/import_model_template", (req, res) => csv(res, "bill-model-template.csv", [
  { billNo: "MB-001", billName: "清单范本名称", chapter: "100", measureUnit: "m3", contractNum: 100, correctedNum: 100, price: 10 }
]));
app.all("/billModel/export_model", (req, res) => csv(res, "bill-model-export.csv", billModelRowsClean().map((row) => ({
  billNo: row.billNo,
  billName: row.billName,
  measureUnit: row.measureUnit,
  chapter: row.chapter,
  contractNum: row.contractNum,
  correctedNum: row.correctedNum,
  price: row.price,
  contractMoney: row.contractMoney,
  finalMoney: row.finalMoney
}))));
app.all("/billModel/edit_model_page", (req, res) => html(res, modalFormHtml("清单范本", "billModel/edit_model_page")));
app.all("/edit_model_page", (req, res) => html(res, modalFormHtml("清单范本", "billModel/edit_model_page")));
app.all("/billModel/import_model_template", (req, res) => csv(res, "bill-model-template.csv", [
  { billNo: "101-1", billName: "清单名称", chapter: "100", measureUnit: "m3", contractNum: 100, correctedNum: 100, price: 10 }
]));
app.all("/manual_model/find_manual_model_page", (req, res) => table(res, req, engine.materialRows()));
app.all("/manual_model/dashboard_page", (req, res) => html(res, modelCenterDashboardHtml(req)));
app.all("/manual_model/manual_model_page", (req, res) => html(res, modelCenterDashboardHtml(req)));
app.all("/manual_model/del_MaterialModel", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.materials, "materialId", idsFrom(req, "ids")) })));
app.all("/manual_model/edit_manual_model_add_page", (req, res) => html(res, materialFormHtml(req)));
app.all("/manual_model/save_material", (req, res) => mutate(res, () => saveMaterial(req)));
app.all("/manual_model/export_material", (req, res) => csv(res, "material-model-export.csv", engine.materialRows().map((row) => ({
  materialNo: row.materialNo,
  materialName: row.materialName,
  specType: row.specType,
  measureUnit: row.measureUnit,
  basePrice: row.basePrice,
  currentPrice: row.currentPrice,
  priceDiff: Number((Number(row.currentPrice || 0) - Number(row.basePrice || 0)).toFixed(2)),
  sendersRange: row.sendersRange
}))));
app.all("/manual_model/import_material_template", (req, res) => csv(res, "material-template.csv", [
  { materialNo: "CL-001", materialName: "材料名称", specType: "规格型号", measureUnit: "t", basePrice: 100, currentPrice: 120, sendersRange: "按合同调差" }
]));
app.all("/manual_model/edit_manual_model_add_page", (req, res) => html(res, modalFormHtml("材料范本", "manual_model/edit_manual_model_add_page")));
app.all("/secBill/", (req, res) => table(res, req, engine.billRows()));
app.all("/secBill/dashboard_page", (req, res) => html(res, secBillDashboardHtml(req)));
app.all("/secBill/sec_bill_page", (req, res) => html(res, secBillDashboardHtml(req)));
app.all("/secBill/bill_page_list", (req, res) => table(res, req, engine.billRows()));
app.all("/secBill/sec_bill_detail_list_page", (req, res) => html(res, billDetailHtml()));
app.all("/secBill/sec_bill_collect_list_page", (req, res) => html(res, billCollectHtml()));
app.all("/secBill/delete", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.bills, "billId", idsFrom(req, "ids")) })));
app.all("/secBill/del_sec_bill", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.bills, "billId", idsFrom(req, "ids")) })));
app.all("/save_sec_bill_page", (req, res) => html(res, billFormHtml(req)));
app.all("/secBill/save_bill", (req, res) => mutate(res, () => saveSecBill(req)));
app.all("/import_sec_bill", (req, res) => html(res, importSecBillHtml()));
app.all("/secBill/import_bill_data", (req, res) => mutate(res, () => saveSecBill(req)));
app.all("/save_sec_bill_page", (req, res) => html(res, modalFormHtml("清单编辑", "secBill/save_sec_bill_page")));
app.all("/import_sec_bill", (req, res) => html(res, modalFormHtml("导入清单", "secBill/import_sec_bill")));
app.all("/bill_collect", (req, res) => html(res, billCollectHtml()));
app.all("/costBase/dashboard_page", (req, res) => html(res, costBaseDashboardHtml(req)));
app.all("/costBase/reconciliation_page", (req, res) => html(res, costReconciliationPageHtml()));
app.all("/costBase/boq_validation_page", (req, res) => html(res, boqValidationPageHtml()));
app.all("/costBase/5d_model_page", (req, res) => html(res, fiveDCostModelPageHtml()));
app.all("/costBase/unit_price_analysis_page", (req, res) => html(res, unitPriceAnalysisPageHtml()));
app.all("/costBase/calculator_page", (req, res) => html(res, costCalculatorPageHtml()));
app.all("/costBase/export_unit_price_analysis", (req, res) => csv(res, "unit-price-analysis.csv", unitPriceAnalysisData().rows.map((row) => ({
  sectionName: row.sectionName,
  billNo: row.billNo,
  billName: row.billName,
  unit: row.unit,
  quantity: row.quantity,
  unitPrice: row.unitPrice,
  labor: row.component.labor,
  material: row.component.material,
  machine: row.component.machine,
  management: row.component.management,
  profit: row.component.profit,
  tax: row.component.tax,
  materialShare: row.materialShare,
  contractMoney: row.contractMoney,
  riskLevel: row.riskLevel
}))));
app.all("/secMateria/find_sec_materia_list", (req, res) => table(res, req, engine.materialRows()));
app.all("/secMateria/dashboard_page", (req, res) => html(res, modelCenterDashboardHtml(req)));
app.all("/secMateria/sec_materia_page", (req, res) => html(res, modelCenterDashboardHtml(req)));
app.all("/secMateria/del_sec_materia", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.materials, "materialId", idsFrom(req, "ids")) })));
app.all("/secMateria/sec_materia_add_page", (req, res) => html(res, materialFormHtml(req)));
app.all("/secMateria/save_material", (req, res) => mutate(res, () => saveMaterial(req)));
app.all("/secMateria/import_material_data", (req, res) => mutate(res, () => saveMaterial(req)));
app.all("/secMateria/export_sec_materia", (req, res) => csv(res, "section-materials.csv", engine.materialRows().map((row) => ({
  materialNo: row.materialNo,
  materialName: row.materialName,
  specType: row.specType,
  measureUnit: row.measureUnit,
  basePrice: row.basePrice,
  currentPrice: row.currentPrice,
  priceDiff: Number((Number(row.currentPrice || 0) - Number(row.basePrice || 0)).toFixed(2)),
  sendersRange: row.sendersRange
}))));
app.all("/secMateria/sec_materia_add_page", (req, res) => html(res, modalFormHtml("材料清单", "secMateria/sec_materia_add_page")));
app.all("/billAnalyze/dashboard_page", (req, res) => html(res, billAnalyzeDashboardHtml(req)));
app.all("/billAnalyzeNode/designBillList_page", (req, res) => html(res, billAnalyzeDashboardHtml(req)));
app.all("/billAnalyze/sec_bill_list", (req, res) => html(res, billAnalyzeSelectionHtml(req)));
app.all("/billAnalyze/get_bill_analyze_by_node_id", (req, res) => table(res, req, billAnalyzeRows(req)));
app.all("/billAnalyze/hang_bill", (req, res) => mutate(res, () => assignAnalyzeBills(req)));
app.all("/billAnalyze/del_analyze", (req, res) => mutate(res, () => unassignAnalyzeBills(req)));
app.all("/billAnalyze/isCanHang", (req, res) => operationOk(res, canAddAnalyzeChild(req)));
app.get("/billAnalyze/import_analyze", (req, res) => html(res, importAnalyzeFormHtml(req)));
app.post("/billAnalyze/import_analyze", (req, res) => mutate(res, () => importAnalyze(req)));
app.all("/billAnalyze/edit_analyze", (req, res) => html(res, billAnalyzeSelectionHtml(req)));
app.all("/billAnalyze/edit_analyze", (req, res) => html(res, modalFormHtml("分项挂接", "billAnalyze/edit_analyze")));
app.all("/billAnalyzeNode/", (req, res) => operationOk(res, analyzeNodeRows()));
app.all("/billAnalyzeNode/tree", (req, res) => operationOk(res, analyzeNodeRows()));
app.all("/billAnalyzeNode/edit_node", (req, res) => html(res, analyzeNodeFormHtml(req)));
app.all("/billAnalyzeNode/save_node", (req, res) => mutate(res, () => saveAnalyzeNode(req)));
app.all("/billAnalyzeNode/update_node", (req, res) => mutate(res, () => saveAnalyzeNode(req)));
app.all("/billAnalyzeNode/edit_node", (req, res) => html(res, modalFormHtml("分部分项节点", "billAnalyzeNode/edit_node")));

app.all("/contract_survey/dashboard_page", (req, res) => html(res, contractSurveyDashboardHtml(req)));
app.all("/contract_survey/contract_survey_page/:projectId?", (req, res) => html(res, contractSurveyDashboardHtml(req)));
app.all("/contract_survey/find_other_mation", (req, res) => operationOk(res, engine.contractSummary()));
app.all("/billAnalyzeNode/init_analyze", (req, res) => mutate(res, () => {
  engine.db.analyzeNodes = defaultAnalyzeNodes();
  engine.db.bills.forEach((bill) => {
    delete bill.analyzeNodeId;
  });
  ensureBillAnalyzeAssignments();
  return { initialized: true, rows: engine.db.analyzeNodes.length };
}));
app.all("/billAnalyzeNode/delete_node", (req, res) => mutate(res, () => ({ changed: removeAnalyzeNodes(idsFrom(req, "ids")) })));
app.all("/secProjectPlan/get_plan_list", (req, res) => table(res, req, engine.planRows()));
app.all("/secProjectPlan/plan_dashboard_page", (req, res) => html(res, projectPlanDashboardHtml(req)));
app.all("/secProjectPlan/plan_list_page", (req, res) => html(res, projectPlanDashboardHtml(req)));
app.all("/secProjectPlan/plan_edit_page", (req, res) => html(res, planFormHtml(req)));
app.all("/secProjectPlan/delete_plan", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.plans, "planId", idsFrom(req, "ids")) })));
app.all("/secProjectPlan/create_project_plan", (req, res) => {
  const body = { ...req.query, ...req.body };
  const hasPlanInput = ["planId", "planName", "name", "startDate", "endDate", "amount", "finishMoney"].some((key) => body[key] !== undefined && body[key] !== "");
  if (!hasPlanInput) {
    operationOk(res, { created: false, reason: "missing_plan_input", rows: engine.planRows().length });
    return;
  }
  mutate(res, () => saveProjectPlan(req));
});
app.all("/secProjectPlan/save_plan", (req, res) => mutate(res, () => saveProjectPlan(req)));
app.all("/secProjectPlan/update_plan", (req, res) => mutate(res, () => {
  let planData = {};
  if (req.body.planData) {
    try {
      planData = JSON.parse(req.body.planData);
    } catch {
      planData = {};
    }
  }
  const ids = idsFrom(req, "planId");
  let changed = 0;
  engine.db.plans.forEach((row) => {
    if (ids.includes(Number(row.planId || row.id))) {
      Object.assign(row, planData);
      row.status = req.body.status || planData.status || row.status || "已更新";
      changed += 1;
    }
  });
  return { changed };
}));
app.all("/sysGather/get_gather_data_list", (req, res) => table(res, req, gatherRows()));
app.all("/sysGather/dashboard_page", (req, res) => html(res, sysGatherDashboardHtml(req)));
app.all("/sysGather/gatherData_page/:projectId?", (req, res) => html(res, sysGatherManagementPageHtml(req)));
app.all("/sysGather/update_gather_state", (req, res) => mutate(res, () => {
  const ids = idsFrom(req, "gatherId");
  const nextState = req.body.gatherState ?? req.query.gatherState ?? req.body.state ?? req.query.state ?? 1;
  let changed = 0;
  engine.db.measurePeriods.forEach((row) => {
    if (!ids.length || ids.includes(Number(row.gatherId || row.id))) {
      row.gatherStateCode = numeric(nextState, row.gatherStateCode ?? 1);
      row.states = row.gatherStateCode === 0 ? "\u9501\u5b9a" : "\u542f\u7528";
      changed += 1;
    }
  });
  return { changed };
}));
app.all("/sysGather/del_gather", (req, res) => mutate(res, () => deleteGatherPeriods(req)));
app.all("/sysGather/update_gather_state", (req, res) => mutate(res, () => {
  const ids = idsFrom(req, "gatherId");
  const nextState = req.body.gatherState ?? req.query.gatherState ?? req.body.state ?? req.query.state ?? 1;
  let changed = 0;
  engine.db.measurePeriods.forEach((row) => {
    if (!ids.length || ids.includes(Number(row.gatherId || row.id))) {
      row.gatherStateCode = numeric(nextState, row.gatherStateCode ?? 1);
      row.states = row.gatherStateCode === 0 ? "锁定" : "启用";
      row.states = row.gatherStateCode === 0 ? "锁定" : "启用";
      changed += 1;
    }
  });
  return { changed };
}));
app.all("/sysGather/updateGatherNo", (req, res) => mutate(res, () => {
  const ids = idsFrom(req, "gatherId");
  let changed = 0;
  engine.db.measurePeriods.forEach((row) => {
    if (ids.includes(Number(row.gatherId || row.id))) {
      row.gatherFileNo = req.body.gatherFileNo || req.query.gatherFileNo || row.gatherFileNo;
      changed += 1;
    }
  });
  return { changed };
}));
app.all("/sysGather/updateGatherShow", (req, res) => mutate(res, () => {
  const ids = idsFrom(req, "gatherId");
  let changed = 0;
  engine.db.measurePeriods.forEach((row) => {
    if (ids.includes(Number(row.gatherId || row.id))) {
      row.gatherShow = req.body.gatherShow || req.query.gatherShow || "";
      changed += 1;
    }
  });
  return { changed };
}));
app.all("/sysGather/edit_gatherData_page", (req, res) => html(res, gatherFormHtml(req)));
app.all("/sysGather/save_gather", (req, res) => mutate(res, () => saveGather(req)));
app.all("/extend_gather", (req, res) => html(res, gatherFormHtml(req)));
app.all("/dataGather/data_collect_gather", (req, res) => mutate(res, () => collectGather(req)));
app.all("/dataGather/data_check_gather", (req, res) => mutate(res, () => checkGather(req)));
app.all("/dataGather/data_collect", (req, res) => mutate(res, () => collectReportData(req)));
app.all("/dataGather/data_refresh_gather", (req, res) => operationOk(res, refreshGather(req)));
app.all("/dataGather/gather_dashboard_page", (req, res) => html(res, dataGatherDashboardHtml(req)));
app.all("/main_controller/mainReturnSectionFlag", (req, res) => operationOk(res, { sectionType: 0, isSuperSection: 0, sectionId: 101 }));
app.all("/bill_measure/dashboard_page", (req, res) => html(res, billMeasureDashboardHtml(req)));
app.all("/bill_measure/page", (req, res) => html(res, billMeasureManagementPageHtml(req)));
app.all("/bill_measure/list", (req, res) => table(res, req, engine.measureRows()));
app.all("/bill_measure/list/:typeCode", (req, res) => table(res, req, engine.measureRows()));
app.all("/bill_measure/export_bill_measure", (req, res) => exportCsvOrTicket(req, res, "bill-measure-export.csv", filteredBillMeasureRows(req), "url"));
app.all("/bill_measure/export_measure", (req, res) => exportCsvOrTicket(req, res, "bill-measure-export.csv", filteredBillMeasureRows(req), "url"));
app.all("/bill_measure/add_page", (req, res) => html(res, billMeasureFormHtml(req, "add")));
app.all("/bill_measure/detail_page", (req, res) => html(res, billMeasureDetailHtml(req)));
app.all("/bill_measure/add_measure_page", (req, res) => html(res, billMeasureAddDetailHtml(req)));
app.all("/bill_measure/save_measure", (req, res) => mutate(res, () => saveBillMeasure(req)));
app.all("/bill_measure/save_detail", (req, res) => mutate(res, () => saveBillMeasureDetail(req)));
app.all("/bill_measure/delete_detail", (req, res) => mutate(res, () => deleteBillMeasureDetail(req)));
app.all("/bill_measure/edit_page", (req, res) => html(res, billMeasureFormHtml(req, "edit")));
app.all("/bill_measure/adjust_page", (req, res) => html(res, adjustmentFormHtml(req, "billmeasure", "调整清单计量")));
app.all("/bill_measure/return_order_page", (req, res) => html(res, returnOrderFormHtml(req, "billmeasure", "退回清单计量")));
app.all("/bill_measure/return_all_order_page", (req, res) => html(res, returnOrderFormHtml(req, "billmeasure", "批量退回清单计量")));
app.all("/bill_measure/adjust_page", (req, res) => html(res, modalFormHtml("调整清单计量", "bill_measure/adjust_page")));
app.all("/bill_measure/copy_page", (req, res) => html(res, billMeasureFormHtml(req, "copy")));
app.all("/bill_measure/render_order_page", (req, res) => html(res, billMeasureOrderHtml(req)));
app.all("/bill_measure/return_order_page", (req, res) => html(res, modalFormHtml("退回计量", "bill_measure/return_order_page")));
app.all("/bill_measure/return_all_order_page", (req, res) => html(res, modalFormHtml("批量退回计量", "bill_measure/return_all_order_page")));
app.all("/bill_measure/track_bill_measure_page", (req, res) => html(res, workflowTrackHtml("清单计量流程追踪", req)));
app.all("/bill_measure/up_order", (req, res) => mutate(res, () => ({ changed: setState(engine.db.measures, "measureId", idsFromAny(req, ["measureIds", "measureId", "billMeasureIds", "billMeasureId"]), "审核中") })));
app.all("/bill_measure/agree_order", (req, res) => mutate(res, () => ({ changed: setState(engine.db.measures, "measureId", idsFromAny(req, ["measureIds", "measureId", "billMeasureIds", "billMeasureId"]), "已审核") })));
app.all("/bill_measure/agree_all_order", (req, res) => mutate(res, () => ({ changed: setState(engine.db.measures, "measureId", idsFromAny(req, ["measureIds", "measureId", "billMeasureIds", "billMeasureId"]), "已审核") })));
app.all("/bill_measure/archive_measure", (req, res) => mutate(res, () => ({ changed: setState(engine.db.measures, "measureId", idsFromAny(req, ["measureIds", "measureId", "billMeasureIds", "billMeasureId"]), "已归档") })));
app.all("/bill_measure/delete/:id?", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.measures, "measureId", idsFromAny(req, ["measureIds", "measureId", "billMeasureIds", "billMeasureId"])) })));
app.all("/bill_measure/next_task_list", (req, res) => operationOk(res, 3));
app.all("/bill_measure/next_task_rows", (req, res) => operationOk(res, [
  { id: 1, taskName: "施工单位提交", roleTypeCode: "SBSJ" },
  { id: 2, taskName: "监理审核", roleTypeCode: "SHSJ" },
  { id: 3, taskName: "业主审批", roleTypeCode: "PFSJ" }
]));
app.all("/bill_measure/order_measure_no", (req, res) => mutate(res, () => orderBillMeasureNo(req)));
app.all("/bill_measure/check_detail_count", (req, res) => {
  const count = measureDetailRowsFor(billMeasureIdFrom(req)).length;
  operationOk(res, count);
});
app.all("/import_measure/dashboard_page", (req, res) => html(res, importMeasureDashboardHtml(req)));
app.all("/import_measure/get_attachment_list", (req, res) => table(res, req, importAttachmentRows()));
app.all("/import_measure/get_measure_by_att", (req, res) => table(res, req, importMeasurePreviewRows(queryNumber(req, "attId") || queryNumber(req, "attachmentId"))));
app.all("/meterialdiasmeasure/meterial_dias_measure_list", (req, res) => table(res, req, engine.materialDiasRows()));
app.all("/meterialdiasmeasure/dashboard_page", (req, res) => html(res, materialDiasDashboardHtml(req)));
app.all("/meterialdiasmeasure/meterialdiasmeasurePage", (req, res) => html(res, materialDiasManagementPageHtml(req)));
app.all("/meterialdiasmeasure/export_meterial_dias_measure", (req, res) => exportCsvOrTicket(req, res, "material-dias-measure-export.csv", filteredMaterialDiasRows(req), "url"));
app.all("/meterialdiasmeasure/export_material_dias_measure", (req, res) => exportCsvOrTicket(req, res, "material-dias-measure-export.csv", filteredMaterialDiasRows(req), "url"));
app.all("/meterialdiasmeasure/detail_page", (req, res) => html(res, materialDiasDetailHtml(req)));
app.all("/meterialdiasmeasure/edit_meterial_dias_measure_page", (req, res) => html(res, materialDiasFormHtml(req)));
app.all("/meterialdiasmeasure/save_detail", (req, res) => mutate(res, () => saveMaterialDias(req)));
app.all("/meterialdiasmeasure/adjust_page", (req, res) => html(res, adjustmentFormHtml(req, "meterialdiasmeasure", "调整材料补差")));
app.all("/meterialdiasmeasure/return_order_page", (req, res) => html(res, returnOrderFormHtml(req, "meterialdiasmeasure", "退回材料补差")));
app.all("/meterialdiasmeasure/edit_meterial_dias_measure_page", (req, res) => html(res, modalFormHtml("材料补差计量", "meterialdiasmeasure/edit_meterial_dias_measure_page")));
app.all("/meterialdiasmeasure/adjust_page", (req, res) => html(res, modalFormHtml("调整材料补差", "meterialdiasmeasure/adjust_page")));
app.all("/meterialdiasmeasure/return_order_page", (req, res) => html(res, modalFormHtml("退回材料补差", "meterialdiasmeasure/return_order_page")));
app.all("/meterialdiasmeasure/track_meterial_dias_reasoure_page", (req, res) => html(res, workflowTrackHtml("材料补差流程追踪", req)));
app.all("/meterialdiasmeasure/up_order", (req, res) => mutate(res, () => ({ changed: setState(engine.db.materialAdjustments, "diasId", idsFromAny(req, ["diasId", "mdmIds", "meterialMeasureId", "meterialDiasMeasureId", "meterialDiasMeasureIds"]), req.body.state || req.body.states || req.query.state || "审核中", { module: "meterialdiasmeasure", action: req.body.state || req.body.states || req.query.state || "审核中", remark: req.body.remark || req.query.remark || "" }) })));
app.all("/meterialdiasmeasure/agree_order", (req, res) => mutate(res, () => ({ changed: setState(engine.db.materialAdjustments, "diasId", idsFromAny(req, ["diasId", "mdmIds", "meterialMeasureId", "meterialDiasMeasureId", "meterialDiasMeasureIds"]), req.body.state || req.body.states || req.query.state || "已审核", { module: "meterialdiasmeasure", action: req.body.state || req.body.states || req.query.state || "已审核", remark: req.body.remark || req.query.remark || "" }) })));
app.all("/meterialdiasmeasure/archive", (req, res) => mutate(res, () => ({ changed: setState(engine.db.materialAdjustments, "diasId", idsFromAny(req, ["diasId", "mdmIds", "meterialMeasureId", "meterialDiasMeasureId", "meterialDiasMeasureIds"]), "已归档") })));
app.all("/meterialdiasmeasure/del_meterial_dias_measure", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.materialAdjustments, "diasId", idsFromAny(req, ["diasId", "mdmIds", "meterialMeasureId", "meterialDiasMeasureId", "meterialDiasMeasureIds"])) })));
app.all("/meterialdiasmeasure/delete/:id?", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.materialAdjustments, "diasId", idsFromAny(req, ["diasId", "mdmIds", "meterialMeasureId", "meterialDiasMeasureId", "meterialDiasMeasureIds"])) })));
app.all("/meterialdiasmeasure/delete_meterial_dias_measure/:id?", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.materialAdjustments, "diasId", idsFromAny(req, ["diasId", "mdmIds", "meterialMeasureId", "meterialDiasMeasureId", "meterialDiasMeasureIds"])) })));
app.all("/meterialInMeasure/meterial_in_measure_list", (req, res) => table(res, req, engine.materialArrivalRows()));
app.all("/meterialInMeasure/dashboard_page", (req, res) => html(res, materialArrivalDashboardHtml(req)));
app.all("/meterialInMeasure/meterialInMeasureList", (req, res) => html(res, materialArrivalManagementPageHtml(req)));
app.all("/meterialInMeasure/export_meterial_in_measure", (req, res) => exportCsvOrTicket(req, res, "material-arrival-measure-export.csv", filteredMaterialArrivalRows(req), "url"));
app.all("/meterialInMeasure/export_material_in_measure", (req, res) => exportCsvOrTicket(req, res, "material-arrival-measure-export.csv", filteredMaterialArrivalRows(req), "url"));
app.all("/meterialInMeasure/detail_page", (req, res) => html(res, materialArrivalDetailHtml(req)));
app.all("/meterialInMeasure/add_page", (req, res) => html(res, materialArrivalFormHtml(req)));
app.all("/meterialInMeasure/form_page", (req, res) => html(res, materialArrivalFormHtml(req)));
app.all("/meterialInMeasure/save_detail", (req, res) => mutate(res, () => saveMaterialArrival(req)));
app.all("/meterialInMeasure/adjust_page", (req, res) => html(res, adjustmentFormHtml(req, "meterialinmeasure", "调整材料到场")));
app.all("/meterialInMeasure/return_order_page", (req, res) => html(res, returnOrderFormHtml(req, "meterialinmeasure", "退回材料到场")));
app.all("/meterialInMeasure/add_page", (req, res) => html(res, modalFormHtml("材料到场计量", "meterialInMeasure/add_page")));
app.all("/meterialInMeasure/form_page", (req, res) => html(res, modalFormHtml("材料到场表单", "meterialInMeasure/form_page")));
app.all("/meterialInMeasure/adjust_page", (req, res) => html(res, modalFormHtml("调整材料到场", "meterialInMeasure/adjust_page")));
app.all("/meterialInMeasure/return_order_page", (req, res) => html(res, modalFormHtml("退回材料到场", "meterialInMeasure/return_order_page")));
app.all("/meterialInMeasure/record_page", (req, res) => html(res, workflowTrackHtml("材料到场处理记录", req)));
app.all("/meterialInMeasure/up_order", (req, res) => mutate(res, () => ({ changed: setState(engine.db.materialArrivals, "arrivalId", idsFromAny(req, ["arrivalId", "meterialInMeasureId", "meterialInMeasureIds"]), req.body.state || req.body.states || req.query.state || "审核中", { module: "meterialinmeasure", action: req.body.state || req.body.states || req.query.state || "审核中", remark: req.body.remark || req.query.remark || "" }) })));
app.all("/meterialInMeasure/update_measure_state", (req, res) => mutate(res, () => ({ changed: setState(engine.db.materialArrivals, "arrivalId", idsFromAny(req, ["arrivalId", "meterialInMeasureId", "meterialInMeasureIds"]), req.body.state || req.body.states || req.query.state || "已更新", { module: "meterialinmeasure", action: req.body.state || req.body.states || req.query.state || "已更新", remark: req.body.remark || req.query.remark || "" }) })));
app.all("/meterialInMeasure/archive", (req, res) => mutate(res, () => ({ changed: setState(engine.db.materialArrivals, "arrivalId", idsFromAny(req, ["arrivalId", "meterialInMeasureId", "meterialInMeasureIds"]), "已归档") })));
app.all("/meterialInMeasure/delete/:id?", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.materialArrivals, "arrivalId", idsFromAny(req, ["arrivalId", "meterialInMeasureId", "meterialInMeasureIds"])) })));
app.all("/manualMeasure/detail_list", (req, res) => table(res, req, engine.manualMeasureRows()));
app.all("/manualMeasure/dashboard_page", (req, res) => html(res, manualMeasureDashboardHtml(req)));
app.all("/manualMeasure/manualMeasureList/:projectId?", (req, res) => html(res, manualMeasureManagementPageHtml(req)));
app.all("/manualMeasure/export_manual_measure", (req, res) => exportCsvOrTicket(req, res, "manual-measure-export.csv", filteredManualMeasureRows(req), "url"));
app.all("/manualMeasure/detail_columns", (req, res) => operationOk(res, [
  [
    { type: "checkbox" },
    { field: "measureNo", title: "计量单号", align: "center", minWidth: 130 },
    { field: "billNo", title: "清单编号", align: "center" },
    { field: "billName", title: "清单名称", align: "center", minWidth: 180 },
    { field: "measureUnit", title: "单位", align: "center" },
    { field: "measureNum", title: "计量数量", align: "center" },
    { field: "price", title: "单价", align: "center" },
    { field: "measureMoney", title: "计量金额", align: "center" },
    { field: "measureDate", title: "计量日期", align: "center" },
    { field: "states", title: "状态", align: "center" },
    { title: "操作", align: "center", toolbar: "#manualMeasureTableBar", minWidth: 180 }
  ]
]));
app.all("/manualMeasure/manualMeasure_edit_page", (req, res) => html(res, manualMeasureFormHtml(req)));
app.all("/manualMeasure/save_measure", (req, res) => mutate(res, () => saveManualMeasure(req)));
app.all("/manualMeasure/adjust_page", (req, res) => html(res, adjustmentFormHtml(req, "manualmeasure", "调整手动计量")));
app.all("/manualMeasure/return_order_page", (req, res) => html(res, returnOrderFormHtml(req, "manualmeasure", "退回手动计量")));
app.all("/manualMeasure/adjust_page", (req, res) => html(res, modalFormHtml("调整手动计量", "manualMeasure/adjust_page")));
app.all("/manualMeasure/return_order_page", (req, res) => html(res, modalFormHtml("退回手动计量", "manualMeasure/return_order_page")));
app.all("/manualMeasure/record_page", (req, res) => html(res, workflowTrackHtml("手动计量处理记录", req)));
app.all("/manualMeasure/up_order", (req, res) => mutate(res, () => ({ changed: setState(engine.db.manualMeasures, "manualId", idsFromAny(req, ["manualId", "manualIds", "manualMeasureId", "manualMeasureIds"]), req.body.state || req.body.states || req.query.state || "审核中", { module: "manualmeasure", action: req.body.state || req.body.states || req.query.state || "审核中", remark: req.body.remark || req.query.remark || "" }) })));
app.all("/manualMeasure/update_measure_state", (req, res) => mutate(res, () => ({ changed: setState(engine.db.manualMeasures, "manualId", idsFromAny(req, ["manualId", "manualIds", "manualMeasureId", "manualMeasureIds"]), req.body.state || req.body.states || req.query.state || "已更新", { module: "manualmeasure", action: req.body.state || req.body.states || req.query.state || "已更新", remark: req.body.remark || req.query.remark || "" }) })));
app.all("/manualMeasure/archive", (req, res) => mutate(res, () => ({ changed: setState(engine.db.manualMeasures, "manualId", idsFromAny(req, ["manualId", "manualIds", "manualMeasureId", "manualMeasureIds"]), "已归档") })));
app.all("/manualMeasure/delete/:id?", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.manualMeasures, "manualId", idsFromAny(req, ["manualId", "manualIds", "manualMeasureId", "manualMeasureIds"])) })));
app.all("/vary_measure/dashboard_page", (req, res) => html(res, variationManagementDashboardHtml(req)));
app.all("/vary_measure/page", (req, res) => html(res, variationManagementDashboardHtml(req)));
app.all("/vary_measure/list", (req, res) => table(res, req, engine.variationRows()));
app.all("/vary_detail/list", (req, res) => table(res, req, variationDetailRows(req)));
app.all("/vary_measure/add_page", (req, res) => html(res, variationFormHtml(req)));
app.all("/vary_measure/edit_page", (req, res) => html(res, variationFormHtml(req)));
app.all("/vary_measure/edit_detail_page", (req, res) => html(res, variationDetailFormHtml(req)));
app.all("/vary_measure/editVaryMeasureDetailPage", (req, res) => html(res, variationDetailFormHtml(req)));
app.all("/vary_measure/save_measure", (req, res) => mutate(res, () => saveVariation(req)));
app.all("/vary_detail/save", (req, res) => mutate(res, () => saveVariationDetail(req)));
app.all("/vary_measure/adjust_page", (req, res) => html(res, adjustmentFormHtml(req, "varyapplication", "调整变更")));
app.all("/vary_measure/return_order_page", (req, res) => html(res, returnOrderFormHtml(req, "varyapplication", "退回变更")));
app.all("/vary_measure/archive_upload_pic_page", (req, res) => html(res, archiveUploadFormHtmlClean(req)));
app.all("/vary_measure/save_archive_pic", (req, res) => mutate(res, () => saveArchivePicClean(req)));
app.all("/vary_measure/adjust_page", (req, res) => html(res, modalFormHtml("调整变更", "vary_measure/adjust_page")));
app.all("/vary_measure/return_order_page", (req, res) => html(res, modalFormHtml("退回变更", "vary_measure/return_order_page")));
app.all("/vary_measure/render_order_page", (req, res) => html(res, variationOrderReportHtml(req)));
app.all("/vary_measure/track_page", (req, res) => html(res, workflowTrackHtml("变更流程追踪", req)));
app.all("/vary_measure/archive_upload_pic_page", (req, res) => html(res, modalFormHtml("归档附件", "vary_measure/archive_upload_pic_page")));
app.all("/vary_detail/delete/:id?", (req, res) => mutate(res, () => deleteVariationDetail(req)));
app.all("/vary_measure/up_order", (req, res) => mutate(res, () => ({ changed: setState(engine.db.variations, "varyId", idsFromAny(req, ["varyId", "varyIds"]), "审核中") })));
app.all("/vary_measure/agree_order", (req, res) => mutate(res, () => ({ changed: setState(engine.db.variations, "varyId", idsFromAny(req, ["varyId", "varyIds"]), "已审核") })));
app.all("/vary_measure/agree_all_order", (req, res) => mutate(res, () => ({ changed: setState(engine.db.variations, "varyId", idsFromAny(req, ["varyId", "varyIds"]), "已审核") })));
app.all("/vary_measure/archive_measure", (req, res) => mutate(res, () => ({ changed: setState(engine.db.variations, "varyId", idsFromAny(req, ["varyId", "varyIds"]), "已归档") })));
app.all("/vary_measure/delete/:id?", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.variations, "varyId", idsFromAny(req, ["varyId", "varyIds"])) })));
app.all("/vary_measure/next_task_list", (req, res) => operationOk(res, 3));
app.all("/vary_measure/next_task_rows", (req, res) => operationOk(res, [
  { id: 1, taskName: "变更申报", roleTypeCode: "SBSJ" },
  { id: 2, taskName: "变更审核", roleTypeCode: "SHSJ" },
  { id: 3, taskName: "变更审批", roleTypeCode: "PFSJ" }
]));
app.all("/varyMeasurePay/get_vary_measure_list", (req, res) => table(res, req, variationPayRowsWithProgress()));
app.all("/varyMeasurePay/get_gather_data", (req, res) => operationOk(res, variationGatherData(req)));
app.all("/varyMeasurePay/dashboard_page", (req, res) => html(res, variationPaymentDashboardHtml(req)));
app.all("/varyMeasurePay/get_vary_measure_page", (req, res) => html(res, variationPaymentDashboardHtml(req)));
app.all("/reportManager/dashboard_page", (req, res) => html(res, reportManagerDashboardHtml(req)));
app.all("/reportManager/report_project_page/:projectId?", (req, res) => html(res, reportManagerDashboardHtml(req)));
app.all("/reportManager/export_report_project_page/:projectId?", (req, res) => html(res, reportExportProjectPageHtml(req)));
app.all("/reportManager/report_project_list", (req, res) => operationOk(res, {
  rpId: 0,
  reportName: "计量支付报表",
  children: reportPaymentRows().map((row) => ({
    rpId: row.sectionId,
    reportName: row.sectionName,
    reportNo: row.contractNo,
    reportCode: "MEASUREREOPORT",
    reportTitle: `${row.sectionName} 支付报表`,
    signParam: "",
    queryModeType: "section"
  }))
}));
app.all("/reportManager/reoirtMangerDetail", (req, res) => html(res, reportDetailHtml()));
app.all("/leaderquery/project_measure_pay_ledger", (req, res) => html(res, reportDetailHtml()));
app.all("/reportManager/reportView", (req, res) => html(res, printableReportHtml(req)));
app.all("/reportManager/reportViewSecurity", (req, res) => html(res, printableReportHtml(req)));
app.all("/u", (req, res) => html(res, printableReportHtml({ ...req, query: { ...req.query, reportCode: "MEASUREREOPORT" } })));
app.all("/reportManager/reportPreviewSecond", (req, res) => html(res, secondPaymentReportHtml(req)));
app.all("/reportManager/findReportBillPayLastGather", (req, res) => table(res, req, engine.billLedgerRows()));
app.all("/reportManager/findReportBillPayAllGather", (req, res) => operationOk(res, reportBillPayPeriodRows(req)));
app.all("/measure_data/audit_money_page", (req, res) => html(res, auditMoneyDashboardHtml(req)));
app.all("/measure_data/audit_money_list", (req, res) => table(res, req, engine.auditMoneyRows()));
app.all("/reportManager/export_project_measure_pay", (req, res) => exportCsvOrTicket(req, res, "project-measure-pay.csv", engine.billLedgerRows(), "url"));
app.all("/varyMeasurePay/export_vary_measure_pay", (req, res) => exportCsvOrTicket(req, res, "vary-measure-pay.csv", variationPayRowsWithProgress(), "url"));
app.all("/reportManager/exportReport", (req, res) => exportReport(req, res));
app.all("/reportManager/exportReports", (req, res) => downloadExport(req, res, "payment-report.csv", reportPaymentRows()));
app.all("/file_upload/down_load", (req, res) => downloadExport(req, res, "export.csv", engine.billLedgerRows()));
app.all("/import_measure/upload_excel", (req, res) => mutate(res, () => {
  const rows = ensureImportAttachments();
  const id = nextId(rows, "attId");
  const fileName = req.body.fileName || req.query.fileName || req.body.name || "\u672c\u5730\u5bfc\u5165\u6587\u4ef6.xlsx";
  const parsedRows = uploadImportRows(req);
  rows.push({
    id,
    attachmentId: id,
    attId: id,
    fileName: cleanBusinessText(fileName, "\u672c\u5730\u5bfc\u5165\u6587\u4ef6.xlsx"),
    size: Number(req.body.size || req.query.size || 28672),
    uploadDate: today(),
    status: 0,
    state: "\u5df2\u89e3\u6790",
    parsedRows,
    sort: parsedRows.length || undefined
  });
  return { fileName: cleanBusinessText(fileName, "\u672c\u5730\u5bfc\u5165\u6587\u4ef6.xlsx"), parsed: true, parsedRows: parsedRows.length, attId: id };
}));
app.all("/import_measure/upload_excel", (req, res) => mutate(res, () => {
  const rows = ensureImportAttachments();
  const id = nextId(rows, "attId");
  const fileName = req.body.fileName || req.query.fileName || req.body.name || "本地导入文件.xlsx";
  rows.push({
    id,
    attachmentId: id,
    attId: id,
    fileName: cleanBusinessText(fileName, "本地导入文件.xlsx"),
    size: Number(req.body.size || req.query.size || 28672),
    uploadDate: today(),
    status: 0,
    state: "已解析"
  });
  return { fileName, parsed: true, attId: id };
}));
app.all("/import_measure/import_excel", (req, res) => mutate(res, () => importMeasureFromAttachments(idsFrom(req, "attIds"))));
app.all("/import_measure/reload_import", (req, res) => mutate(res, () => {
  const ids = idsFrom(req, "attId");
  const attachments = ensureImportAttachments();
  let changed = 0;
  attachments.forEach((item) => {
    if (!ids.length || ids.includes(Number(item.attId || item.attachmentId || item.id))) {
      item.status = 0;
      item.state = "\u5df2\u91cd\u65b0\u89e3\u6790";
      item.uploadDate = today();
      changed += 1;
    }
  });
  return { reloaded: true, changed };
}));
app.all("/import_measure/reload_import", (req, res) => mutate(res, () => {
  const ids = idsFrom(req, "attId");
  const attachments = ensureImportAttachments();
  let changed = 0;
  attachments.forEach((item) => {
    if (!ids.length || ids.includes(Number(item.attId || item.attachmentId || item.id))) {
      item.status = 0;
      item.state = "已重新解析";
      item.uploadDate = today();
      changed += 1;
    }
  });
  return { reloaded: true, changed };
}));
app.all("/import_measure/delete", (req, res) => mutate(res, () => deleteImportAttachments(idsFrom(req, "attIds"))));
app.all("/import_measure/delete_data", (req, res) => mutate(res, () => clearImportedMeasureData(idsFrom(req, "attId"))));
app.all("/secBill/export_sec_bill", (req, res) => csv(res, "section-bills.csv", engine.billRows()));
app.all("/billModel/import_model", (req, res) => csv(res, "bill-model-template.csv", [
  { billNo: "101-1", billName: "清单名称", measureUnit: "m3", contractNum: 100, price: 10 }
]));
app.all("/bigVaryQuery/getBigVarQueryData", (req, res) => table(res, req, bigVaryProjectRows()));
app.all("/leaderquery/find_sub_item_page", (req, res) => html(res, subItemLedgerHtml(req)));
app.all("/leaderquery/sub_item_page", (req, res) => html(res, subItemLedgerHtml(req)));
app.all("/bigVaryQuery/dashboard_page", (req, res) => html(res, bigVaryDashboardHtml(req)));
app.all("/bigVaryQuery/getBigVaryQueryPage", (req, res) => html(res, bigVaryDashboardHtml(req)));
app.all("/bigVaryQuery/get_vary_data_by_project", (req, res) => operationOk(res, bigVaryChartData(req)));
app.all("/bigVaryQuery/detail_titles", (req, res) => operationOk(res, [
  [
    { field: "projectName", title: "项目名称", align: "center" },
    { field: "varyCount", title: "变更数量", align: "center" },
    { field: "normalVaryMoney", title: "一般变更金额", align: "center" },
    { field: "majorVaryMoney", title: "重大变更金额", align: "center" },
    { field: "varyMoney", title: "变更合计", align: "center" },
    { title: "操作", align: "center", toolbar: "#bigVaryQueryLineBtn", width: 120 }
  ]
]));
app.all("/bigVaryQuery/varyQueryDetial", (req, res) => html(res, bigVaryDetailHtml(req)));
app.all("/mtilProjectQuer/dashboard_page", (req, res) => html(res, leadershipQueryDashboardHtml(req)));
app.all("/mtilProjectQuer/page", (req, res) => html(res, leadershipQueryDashboardHtml(req)));
app.all("/mtilProjectQuer/get_project_list_by_user", (req, res) => table(res, req, projectQueryRows()));
app.all("/mtilProjectQuer/query_section_list", (req, res) => table(res, req, sectionQueryRows()));
app.all("/mtilProjectQuer/get_section_data_by_project", (req, res) => operationOk(res, sectionChartData(req)));
app.all("/mtilProjectQuer/get_mutil_detail", (req, res) => html(res, sectionDetailDashboardHtml(req)));
app.all("/busineInfo/busine_info_page", (req, res) => html(res, businessInfoDashboardHtml(req)));
app.all("/sys_project/get_section_contract", (req, res) => table(res, req, engine.db.sections));
app.all("/leaderquery/find_sub_item_page", (req, res) => html(res, simpleTableHtml("分项台账", [
  { title: "清单编号", field: "billNo" },
  { title: "清单名称", field: "billName" },
  { title: "单位", field: "measureUnit" },
  { title: "合同金额", field: "contractMoney" },
  { title: "最终金额", field: "finalMoney" },
  { title: "累计计量", field: "measureMoney" },
  { title: "剩余金额", field: "remainMoney" }
], engine.billLedgerRows())));
app.all("/engineering_contact_bill/list", (req, res) => table(res, req, engine.db.contactBills.map((item) => ({
  ...item,
  skillNo: item.skillNo || item.contactNo,
  contactContent: item.contactContent || item.title,
  changeMeetingText: item.changeMeetingText || "现场技术联系记录",
  remark: item.remark || item.title || "",
  userName: item.userName || "ys1",
  taskUser: item.taskUser ?? true,
  processInstanceId: item.processInstanceId || "",
  workAreaName: item.workAreaName || item.sectionName || ""
}))));
app.all("/engineering_contact_bill/dashboard_page", (req, res) => html(res, engineeringContactDashboardHtml(req)));
app.all("/engineering_contact_bill/page", (req, res) => html(res, engineeringContactDashboardHtml(req)));
app.all("/engineering_contact_bill/edit_page", (req, res) => html(res, contactFormHtml(req)));
app.all("/engineering_contact_bill/save_bill", (req, res) => mutate(res, () => saveContactBill(req)));
app.all("/engineering_contact_bill/return_order_page", (req, res) => html(res, returnOrderFormHtml(req, "engineeringcontactbill", "退回工程联系单")));
app.all("/engineering_contact_bill/up_order", (req, res) => mutate(res, () => mutateStateByIds(engine.db.contactBills, "contactId", req, "审核中")));
app.all("/engineering_contact_bill/agree_order", (req, res) => mutate(res, () => mutateStateByIds(engine.db.contactBills, "contactId", req, "已审核")));
app.all("/engineering_contact_bill/return_order_page", (req, res) => html(res, modalFormHtml("退回联系单", "engineering_contact_bill/return_order_page")));
app.all("/engineering_contact_bill/track_engineering_contact_bill_page", (req, res) => html(res, workflowTrackHtml("工程联系单流程追踪", req)));
app.all("/engineering_contact_bill/del", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.contactBills, "contactId", idsFrom(req, "ids")) })));
app.all("/vary_meeting/get_vary_meeting_data", (req, res) => table(res, req, engine.variationRows().map((item, index) => ({ ...item, zizeng: index + 1 }))));
app.all("/vary_meeting/dashboard_page", (req, res) => html(res, variationMeetingDashboardHtml(req)));
app.all("/vary_meeting/vary_meeting_page", (req, res) => html(res, variationMeetingDashboardHtml(req)));
app.all("/vary_meeting/vary_meeting_edit_page", (req, res) => html(res, meetingFormHtml(req)));
app.all("/vary_meeting/save_meeting", (req, res) => mutate(res, () => saveMeeting(req)));
app.all("/vary_meeting/vary_meeting_edit_page", (req, res) => html(res, modalFormHtml("变更会议", "vary_meeting/vary_meeting_edit_page")));
app.all("/vary_meeting/vary_meeting_user_page", (req, res) => html(res, meetingUserFormHtml(req)));
app.all("/vary_meeting/delete_vary_meeting", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.variations, "varyId", idsFrom(req, "ids")) })));
app.all("/oaDataNode/get_data_node_by_clientId", (req, res) => operationOk(res, documentNodePayload()));
app.all("/oaDataNode/dashboard_page", (req, res) => html(res, documentManagementDashboardHtml(req)));
app.all("/oaDataNode/get_data_manage_page", (req, res) => html(res, documentManagementDashboardHtml(req)));
app.all("/oaDataNode/downLoadZipFile", (req, res) => downloadDocumentZip(req, res));
app.all("/oaDataNode/delete_data_node", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.documents, "nodeId", idsFrom(req, "ids")) })));
app.all("/oaDataNode/get_data_detail_page", (req, res) => html(res, documentDetailHtml()));
app.all("/oaDataNode/add_data_node_page", (req, res) => html(res, documentFormHtmlClean(req, "add")));
app.all("/oaDataNode/edit_data_node_page", (req, res) => html(res, documentFormHtmlClean(req, "node")));
app.all("/oaDataNode/edit_data_detail_page", (req, res) => html(res, documentFormHtmlClean(req, "detail")));
app.all("/oaDataNode/save_data_node", (req, res) => mutate(res, () => saveDocument(req)));
app.all("/oaDataNode/save_data_detail", (req, res) => mutate(res, () => saveDocument(req)));
app.all("/oaDataNode/add_data_node_page", (req, res) => html(res, modalFormHtml("新增资料节点", "oaDataNode/add_data_node_page")));
app.all("/oaDataNode/edit_data_node_page", (req, res) => html(res, modalFormHtml("编辑资料节点", "oaDataNode/edit_data_node_page")));
app.all("/oaDataNode/edit_data_detail_page", (req, res) => html(res, modalFormHtml("编辑资料明细", "oaDataNode/edit_data_detail_page")));
app.all("/oaDataNode/get_node_user_power_page", (req, res) => html(res, documentPowerFormHtml(req)));
app.all("/oaDataNode/save_node_user_power", (req, res) => mutate(res, () => saveDocumentPower(req)));
app.all("/oaDataNode/move_node", (req, res) => mutate(res, () => ({ moved: true, ...moveDocumentNode(req) })));
app.all("/oaDataNode/get_is_hase_data_detail", (req, res) => operationOk(res, { hasData: engine.db.documents.length > 0 }));
app.all("/oaDataNode/get_user_is_can_oper", (req, res) => operationOk(res, { canOper: true }));
app.all("/projectInformationNode/hang_page", (req, res) => html(res, projectInformationHangHtml(req)));
app.all("/projectInformationNode/dashboard_page", (req, res) => html(res, documentManagementDashboardHtml(req)));
app.all("/projectInformationNode/page/:type?", (req, res) => html(res, documentManagementDashboardHtml(req)));
app.all("/projectInformationNode/edit_page", (req, res) => html(res, projectInformationEditorHtml(req)));
app.all("/projectInformationParam/edit_page", (req, res) => html(res, projectInformationEditorHtml(req)));
app.all("/projectInformationParam/page", (req, res) => html(res, documentManagementDashboardHtml(req)));
app.all("/projectInformationNode/get_node_tree", (req, res) => operationOk(res, projectInformationTreeRows()));
app.all("/projectInformationParam/get_node_tree", (req, res) => operationOk(res, { data: projectInformationTreeRows(), closeData: [] }));
app.all("/projectInformationNode/find_hang_by_param", (req, res) => table(res, req, projectInformationHangRows()));
app.all("/projectInformationNode/find_hang_param", (req, res) => table(res, req, projectInformationHangRows()));
app.all("/project_information_hang_file/page", (req, res) => html(res, documentAttachmentPageHtml(req)));
app.all("/projectInformationNode/attachment_list", (req, res) => table(res, req, documentAttachmentRows(req)));
app.all("/projectInformationNode/upload_attachment", (req, res) => mutate(res, () => saveDocumentAttachment(req)));
app.all("/projectInformationNode/delete_attachment", (req, res) => mutate(res, () => deleteDocumentAttachment(req)));
app.all("/projectInformationNode/delete_hang_param", (req, res) => mutate(res, () => ({ deleted: true, changed: deleteDocumentHang(idsFrom(req, "hangId")) })));
app.all("/projectInformationNode/init_node", (req, res) => mutate(res, () => {
  engine.db.documents = defaultDocuments();
  return { initialized: true, rows: engine.db.documents.length };
}));
app.all("/projectInformationNode/delete_node", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.documents, "nodeId", idsFrom(req, "ids")) })));
app.all("/syzl/list", (req, res) => table(res, req, engine.documentRows()));
app.all("/syzl/dashboard_page", (req, res) => html(res, documentManagementDashboardHtml(req)));
app.all("/syzl/page", (req, res) => html(res, documentManagementDashboardHtml(req)));
app.all("/syzl/edit_page", (req, res) => html(res, documentFormHtmlClean(req, "syzl")));
app.all("/syzl/save", (req, res) => mutate(res, () => saveDocument(req)));
app.all("/syzl/edit_page", (req, res) => html(res, modalFormHtml("试验资料", "syzl/edit_page")));
app.all("/syzl/h_page", (req, res) => html(res, documentDetailHtml()));
app.all("/syzl/see_page", (req, res) => html(res, documentDetailHtml()));
app.all("/syzl/del", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.documents, "nodeId", idsFrom(req, "ids")) })));
app.all("/online/list", (req, res) => operationOk(res, [
  { userId: 563, userAccount: "ys1", userName: "ys1", loginTime: new Date().toISOString(), deptName: engine.db.client.deptName, roleTypeName: engine.db.client.roleTypeName }
]));
app.all("/workflow/isSendSMSpage", (req, res) => html(res, smsFormHtml()));
app.all("/workflow/dashboard_page", (req, res) => html(res, workflowDashboardHtml(req)));
app.all("/workflow/send_sms", (req, res) => mutate(res, () => saveSms(req)));
app.all("/workflow/sms_record_page", (req, res) => html(res, smsRecordHtml(req)));
app.all("/workflow/sms_record_list", (req, res) => table(res, req, smsRows()));
app.all("/workflow/delete_sms", (req, res) => mutate(res, () => ({ changed: removeRows(engine.db.smsMessages || [], "id", idsFrom(req, "ids")) })));
app.all("/workflow/isSendSMSpage", (req, res) => html(res, modalFormHtml("短信通知", "workflow/isSendSMSpage")));
app.all("/workflow/see_process_img", (req, res) => {
  res.type("image/svg+xml").send(workflowSvg());
});
app.all("/workflow/adjust_order", (req, res) => mutate(res, () => adjustWorkflow(req)));
app.all("/workflow/withdraw_order", (req, res) => mutate(res, () => ({ withdrawn: true, ...withdrawWorkflow(req) })));
app.all("/page_office/project_information_open_word", (req, res) => html(res, projectInformationWordHtml(req)));
app.all("/editindex_information", (req, res) => html(res, projectInformationWordHtml(req)));
app.all("/edit_page", (req, res) => html(res, localEditPageHtml()));
app.all("/workflow/save_note", (req, res) => mutate(res, () => saveLocalNote(req)));
app.all("/edit_node", (req, res) => html(res, analyzeNodeFormHtml(req)));
app.all("/edit_page", (req, res) => html(res, modalFormHtml("本地编辑", req.path)));
app.all("/edit_node", (req, res) => html(res, modalFormHtml("节点编辑", req.path)));
app.all("/delete_node", (req, res) => mutate(res, () => deleteGenericNode(req)));
app.get("/import_model", (req, res) => html(res, importBillModelHtml()));
app.post("/import_model", (req, res) => mutate(res, () => saveBillModelClean(req)));

app.all(/^\/.*(_page|page|detail|track|record|form)(\/.*)?$/i, (req, res, next) => {
  if (req.path.startsWith("/assets/") || req.path.startsWith("/js/") || req.path.startsWith("/css/") || req.path.startsWith("/img/") || req.path.startsWith("/common/")) {
    next();
    return;
  }
  html(res, modalFormHtml(req.path.split("/").pop() || "本地表单", req.path));
});

const okOperations = [
  /\/(delete|del|archive|agree|return|up|withdraw|update|create|save|edit|add|move|init|upload|import|export|copy|track|record|form|detail|preview)/i,
  /^\/dataGather\//,
  /^\/main_controller\//,
  /^\/workflow\//,
  /^\/reportManager\/(export|reoirtMangerDetail)/,
  /^\/error_page\//
];

app.all("*", (req, res, next) => {
  if (req.path.startsWith("/assets/") || req.path.startsWith("/js/") || req.path.startsWith("/css/") || req.path.startsWith("/img/") || req.path.startsWith("/common/")) {
    next();
    return;
  }
  if (okOperations.some((rule) => rule.test(req.path))) {
    operationOk(res, { path: req.path, success: true, rows: [] });
    return;
  }
  next();
});

app.use(express.static(root, {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}));

app.use((req, res) => {
  if (req.accepts("json") && !req.accepts("html")) {
    operationOk(res, { path: req.path, success: true, rows: [] });
    return;
  }
  html(res, modalFormHtml("本地页面", req.path));
});

app.listen(port, () => {
  console.log(`ZWKJY local clone running at http://localhost:${port}`);
});
