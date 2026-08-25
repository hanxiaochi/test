const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { authenticateTestSession } = require("./test-auth-client");

const root = path.resolve(__dirname, "..");
const fixtureFile = path.join(root, "test-data", "payment-regression-12-14.json");
const reportDir = path.join(root, "tmp", "payment-fixture-regression");
let sessionCookie = "";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function round(value, digits = 0) {
  return Number(Number(value || 0).toFixed(digits));
}

function sumValues(values) {
  return Object.values(values || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function clearRuntimeArrays(db) {
  Object.keys(db).forEach((key) => {
    if (Array.isArray(db[key])) db[key] = [];
  });
}

function chapterName(chapter, fallback) {
  const names = {
    "100": "总则",
    "200": "路基土石方",
    "300": "路面",
    "400": "桥梁",
    "900": "暂定金额/预留合同额"
  };
  return names[chapter] || fallback || `${chapter}章`;
}

function buildFixture(baseDb, data) {
  const db = clone(baseDb);
  clearRuntimeArrays(db);

  const sectionId = Number(data.section.sectionId || 101);
  const opening = data.openingBeforePeriod12;
  const cases = data.testCases;
  const rules = data.calculationRules;

  db.client = {
    clientId: 1,
    clientName: "Payment Fixture Regression",
    deptName: "Regression",
    roleTypeName: "tester"
  };
  db.projects = [{
    id: 1,
    projectId: 1,
    projectName: data.name,
    shortName: "Payment Fixtures",
    owner: "local",
    startDate: "2018-01-01",
    endDate: "2018-12-31"
  }];
  db.sections = [{
    id: sectionId,
    sectionId,
    projectId: 1,
    sectionName: data.section.sectionName,
    contractor: "fixture",
    supervisor: "fixture",
    contractNo: "PAYMENT-FIXTURE-12-14"
  }];

  let billId = 1;
  db.bills = Object.entries(data.contractChapters).map(([chapter, info]) => ({
    id: billId,
    billId: billId++,
    sectionId,
    chapter,
    billNo: `${chapter}-FIXTURE`,
    billName: info.name || chapterName(chapter),
    itemCode: `${chapter}-FIXTURE`,
    itemName: info.name || chapterName(chapter),
    measureUnit: "元",
    contractNum: Number(info.contractAmount || 0),
    correctedNum: Number(info.contractAmount || 0),
    price: 1
  }));

  db.billModels = [];
  db.materials = [
    {
      id: 9001,
      materialId: 9001,
      materialNo: "FIXTURE-MATERIAL-ADVANCE",
      materialName: "材料设备垫付款折算",
      unit: "元",
      basePrice: 0,
      currentPrice: 1
    },
    {
      id: 9002,
      materialId: 9002,
      materialNo: "FIXTURE-PRICE-ADJUST",
      materialName: "永久性工程材料差价",
      unit: "元",
      basePrice: 0,
      currentPrice: 1
    }
  ];

  const billByChapter = new Map(db.bills.map((bill) => [String(bill.chapter), bill]));

  function measureDetails(amounts) {
    return Object.entries(amounts || {})
      .filter(([, amount]) => Number(amount || 0) !== 0)
      .map(([chapter, amount]) => {
        const bill = billByChapter.get(String(chapter));
        if (!bill) throw new Error(`Missing bill for chapter ${chapter}`);
        return {
          billId: bill.billId,
          billNo: bill.billNo,
          billName: bill.billName,
          chapter,
          measureUnit: bill.measureUnit,
          price: 1,
          measureNum: Number(amount || 0)
        };
      });
  }

  const openingPeriodId = Number(opening.periodId || 11);
  db.measurePeriods = [{
    id: openingPeriodId,
    gatherId: openingPeriodId,
    periodId: openingPeriodId,
    periodDesc: "期初累计基准",
    startDate: "2018-01-01",
    endDate: "2018-01-31",
    gatherState: "已归档"
  }];
  cases.forEach((item) => {
    db.measurePeriods.push({
      id: item.periodId,
      gatherId: item.periodId,
      periodId: item.periodId,
      periodDesc: item.periodName,
      startDate: `${item.yearMonth}-01`,
      endDate: `${item.yearMonth}-25`,
      gatherState: "已归档"
    });
  });

  db.measures = [{
    id: openingPeriodId,
    measureId: openingPeriodId,
    measureNo: "FIXTURE-OPENING",
    sectionId,
    periodId: openingPeriodId,
    gatherId: openingPeriodId,
    measureDate: "2018-01-31",
    states: "已归档",
    details: measureDetails(opening.chapters)
  }];
  cases.forEach((item) => {
    db.measures.push({
      id: item.periodId,
      measureId: item.periodId,
      measureNo: `FIXTURE-JL113-P${item.periodId}`,
      sectionId,
      periodId: item.periodId,
      gatherId: item.periodId,
      measureDate: `${item.yearMonth}-25`,
      states: "已归档",
      details: measureDetails(item.input.currentChapterAmounts)
    });
  });

  const advanceRate = Number(rules.materialAdvanceRate || 60) / 100;
  function arrivalQuantityFromAdvance(advance) {
    return Number(advance || 0) / advanceRate;
  }

  db.materialArrivals = [{
    id: openingPeriodId,
    arrivalId: openingPeriodId,
    sectionId,
    periodId: openingPeriodId,
    gatherId: openingPeriodId,
    measureNo: "FIXTURE-JL109-OPENING",
    materialId: 9001,
    measureDate: "2018-01-31",
    quantity: arrivalQuantityFromAdvance(opening.materialAdvanceCumulative),
    states: "已归档"
  }];
  cases.forEach((item) => {
    db.materialArrivals.push({
      id: item.periodId,
      arrivalId: item.periodId,
      sectionId,
      periodId: item.periodId,
      gatherId: item.periodId,
      measureNo: `FIXTURE-JL109-P${item.periodId}`,
      materialId: 9001,
      measureDate: `${item.yearMonth}-25`,
      quantity: arrivalQuantityFromAdvance(item.input.materialAdvanceMoney),
      states: "已归档"
    });
  });

  db.materialDeductions = [{
    id: openingPeriodId,
    deductionId: openingPeriodId,
    sectionId,
    periodId: openingPeriodId,
    gatherId: openingPeriodId,
    deductionMoney: Number(opening.materialDeductionCumulative || 0),
    measureDate: "2018-01-31"
  }];
  cases.forEach((item) => {
    db.materialDeductions.push({
      id: item.periodId,
      deductionId: item.periodId,
      sectionId,
      periodId: item.periodId,
      gatherId: item.periodId,
      deductionMoney: Number(item.input.materialDeductionMoney || 0),
      measureDate: `${item.yearMonth}-25`
    });
  });

  db.materialAdjustments = [];
  cases.forEach((item) => {
    const priceAdjustment = Number(item.input.priceAdjustment || 0);
    if (!priceAdjustment) return;
    db.materialAdjustments.push({
      id: item.periodId,
      diasId: item.periodId,
      sectionId,
      periodId: item.periodId,
      gatherId: item.periodId,
      measureNo: `FIXTURE-JL108-P${item.periodId}`,
      materialId: 9002,
      measureDate: `${item.yearMonth}-25`,
      quantity: priceAdjustment,
      states: "已归档"
    });
  });

  db.manualMeasures = [];
  db.variations = [];
  db.gatherSnapshots = [];
  db.calculationRules = {
    moneyDigits: Number(rules.moneyDigits || 0),
    quantityDigits: Number(rules.quantityDigits || 3),
    priceDigits: Number(rules.priceDigits || 2),
    includeBillMeasure: true,
    includeMaterialAdjust: true,
    includeMaterialArrival: false,
    includeManualMeasure: true,
    includeMaterialAdvance: true,
    includeRetention: true,
    materialAdvanceRate: Number(rules.materialAdvanceRate || 60),
    retentionRate: Number(rules.retentionRate || 10),
    mobilizationAdvanceRate: Number(rules.mobilizationAdvanceRate || 10),
    mobilizationDeductionStartRate: Number(rules.mobilizationDeductionStartRate || 30),
    mobilizationDeductionEndRate: Number(rules.mobilizationDeductionEndRate || 80),
    materialDeductionMoney: 0,
    previousMaterialDeductionMoney: 0,
    cumulativeMaterialDeductionMoney: 0,
    mobilizationAdvanceMoney: 0,
    claimsMoney: 0,
    penaltyMoney: 0,
    interestMoney: 0,
    otherAdjustmentMoney: 0,
    provisionalCurrentMoney: 0,
    jlPriceAdjustmentCoverageMode: "current",
    jlPriceAdjustmentCoveragePeriods: 1,
    jlPriceAdjustmentMonths: [1, 4, 7, 10],
    jl116NonAdjustableFactor: 0.35,
    jl108RawMaterialConversionFactors: {},
    jl116MaterialWeights: {}
  };

  return db;
}

function requestJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      headers: { Accept: "application/json", ...(sessionCookie ? { Cookie: sessionCookie } : {}) }
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${pathname} returned HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`${pathname} returned non-JSON: ${body.slice(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error(`${pathname} timed out`));
    });
  });
}

async function login(port) {
  sessionCookie = await authenticateTestSession(port);
}

function freePort(start = 3320) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once("error", () => tryPort(port + 1));
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}

async function waitForServer(port, child) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode}`);
    try {
      await requestJson(port, "/api/health");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`server on port ${port} did not become ready`);
}

function addCheck(checks, period, field, expected, actual, source) {
  const normalizedExpected = Number(expected || 0);
  const normalizedActual = Number(actual || 0);
  checks.push({
    period,
    field,
    source,
    expected: normalizedExpected,
    actual: normalizedActual,
    passed: normalizedExpected === normalizedActual
  });
}

function sumJl113ByChapter(rows) {
  const result = {};
  rows.forEach((row) => {
    const chapter = String(row.chapter || row.itemCode || row.billNo || "").padEnd(3, "0").slice(0, 3);
    if (!chapter.trim()) return;
    result[chapter] = round((result[chapter] || 0) + Number(row.amount || row.currentAmount || 0), 0);
  });
  return result;
}

async function runApiRegression(port, data) {
  const checks = [];
  for (const item of data.testCases) {
    const period = String(item.periodId);
    const expected = item.expected;
    const certificate = (await requestJson(port, `/api/payment/certificate?periodId=${item.periodId}&sectionId=${data.section.sectionId}`)).data;
    const deductions = (await requestJson(port, `/api/payment/jl_deductions?periodId=${item.periodId}&sectionId=${data.section.sectionId}`)).data;
    const jl113 = (await requestJson(port, `/api/payment/jl113?periodId=${item.periodId}&sectionId=${data.section.sectionId}&limit=1000`)).data;
    const jl113ByChapter = sumJl113ByChapter(jl113);
    const materialRow = deductions.materialDeductionLedger.find((row) => Number(row.periodId) === Number(item.periodId)) || {};
    const mobilizationRow = deductions.mobilizationDeductionLedger.find((row) => Number(row.periodId) === Number(item.periodId)) || {};

    addCheck(checks, period, "JL104小计", expected.subtotal, certificate.subtotal, "fixture expected -> API certificate.subtotal");
    addCheck(checks, period, "JL104到上期末小计", expected.previousCumulativeSubtotal, certificate.previousCumulativeSubtotal, "fixture expected -> API certificate.previousCumulativeSubtotal");
    addCheck(checks, period, "JL104到本期末小计", expected.cumulativeSubtotal, certificate.cumulativeSubtotal, "fixture expected -> API certificate.cumulativeSubtotal");
    addCheck(checks, period, "JL108价格调整", expected.priceAdjustment, certificate.priceAdjustment, "fixture expected -> API certificate.priceAdjustment");
    addCheck(checks, period, "JL109材料设备垫付款", expected.materialAdvanceMoney, certificate.materialAdvanceMoney, "fixture expected -> API certificate.materialAdvanceMoney");
    addCheck(checks, period, "JL110扣回材料设备垫付款", expected.materialDeductionMoney, certificate.materialDeductionMoney, "fixture expected -> API certificate.materialDeductionMoney");
    addCheck(checks, period, "JL104保留金", expected.retentionMoney, certificate.retentionMoney, "fixture expected -> API certificate.retentionMoney");
    addCheck(checks, period, "JL111扣回动员预付款", expected.mobilizationDeductionMoney, certificate.mobilizationDeductionMoney, "fixture expected -> API certificate.mobilizationDeductionMoney");
    addCheck(checks, period, "JL104实际支付", expected.finalPayment, certificate.finalPayment, "fixture expected -> API certificate.finalPayment");
    addCheck(checks, period, "JL110台账累计垫付", expected.materialLedger.cumulativeAdvance, materialRow.cumulativeAdvance, "fixture expected -> API material ledger");
    addCheck(checks, period, "JL110台账本期扣回", expected.materialLedger.periodDeduction, materialRow.periodDeduction, "fixture expected -> API material ledger");
    addCheck(checks, period, "JL110台账累计扣回", expected.materialLedger.cumulativeDeduction, materialRow.cumulativeDeduction, "fixture expected -> API material ledger");
    addCheck(checks, period, "JL111台账本期扣回", expected.mobilizationLedger.periodDeduction, mobilizationRow.periodDeduction, "fixture expected -> API mobilization ledger");
    addCheck(checks, period, "JL111台账累计扣回", expected.mobilizationLedger.cumulativeDeduction, mobilizationRow.cumulativeDeduction, "fixture expected -> API mobilization ledger");

    Object.entries(expected.jl113ByChapter).forEach(([chapter, amount]) => {
      addCheck(checks, period, `JL113 ${chapter}章合计`, amount, jl113ByChapter[chapter] || 0, "fixture expected -> API jl113 row sum");
    });
  }
  return checks;
}

function writeReports(data, checks, port) {
  fs.mkdirSync(reportDir, { recursive: true });
  const result = {
    ok: checks.every((check) => check.passed),
    generatedAt: new Date().toISOString(),
    port,
    fixtureFile: path.relative(root, fixtureFile),
    checks
  };
  fs.writeFileSync(path.join(reportDir, "latest-result.json"), JSON.stringify(result, null, 2), "utf8");

  const lines = [
    "# Payment Fixture Regression Result",
    "",
    `- ok: ${result.ok}`,
    `- generatedAt: ${result.generatedAt}`,
    `- fixtureFile: ${result.fixtureFile}`,
    `- localApiPort: ${port}`,
    "",
    "## Checks",
    "",
    "| Period | Field | Expected | Actual | Source | Result |",
    "| --- | --- | ---: | ---: | --- | --- |",
    ...checks.map((check) => `| ${check.period} | ${check.field} | ${check.expected} | ${check.actual} | ${check.source} | ${check.passed ? "PASS" : "FAIL"} |`)
  ];
  fs.writeFileSync(path.join(reportDir, "latest-result.md"), `${lines.join("\n")}\n`, "utf8");
  return result;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
  const baseDb = require(path.join(root, "constructionData"));
  const fixture = buildFixture(baseDb, data);
  const port = await freePort(Number(process.env.PAYMENT_FIXTURE_PORT || 3320));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zwkjy-payment-fixture-"));
  const runtimeFile = path.join(tempRoot, "runtime-db.json");
  let server = null;

  try {
    fs.writeFileSync(runtimeFile, JSON.stringify(fixture, null, 2), "utf8");
    server = spawn(process.execPath, ["server.js"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        APP_RUNTIME_DB_PATH: runtimeFile,
        APP_SECURITY_DB_PATH: path.join(tempRoot, "security.db"),
        APP_RULE_DB_PATH: path.join(tempRoot, "rules.db"),
        APP_SQLITE_DB_PATH: path.join(tempRoot, "runtime.db"),
        APP_EXPORT_DIR: path.join(tempRoot, "exports")
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let serverOutput = "";
    server.stdout.on("data", (chunk) => {
      serverOutput += chunk.toString();
    });
    server.stderr.on("data", (chunk) => {
      serverOutput += chunk.toString();
    });
    await waitForServer(port, server);
    await login(port);
    const checks = await runApiRegression(port, data);
    const result = writeReports(data, checks, port);
    if (!result.ok) {
      const failed = checks.filter((check) => !check.passed);
      throw new Error(`Payment fixture regression failed:\n${failed.map((check) => `${check.period} ${check.field}: expected ${check.expected}, actual ${check.actual}`).join("\n")}\n${serverOutput}`);
    }
    console.log(JSON.stringify({
      ok: true,
      checks: checks.length,
      report: path.relative(root, path.join(reportDir, "latest-result.md")),
      json: path.relative(root, path.join(reportDir, "latest-result.json"))
    }, null, 2));
  } finally {
    if (server) {
      server.kill();
      await new Promise((resolve) => server.once("exit", resolve));
    }
    const resolved = path.resolve(tempRoot);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("zwkjy-payment-fixture-")) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
