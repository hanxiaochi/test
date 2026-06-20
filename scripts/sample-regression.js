const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const runtimeFile = path.join(root, "data", "runtime-db.json");
const reportDir = path.join(root, "tmp", "sample-regression");
const sampleRoot = process.env.SAMPLE_REGRESSION_ROOT
  ? path.resolve(process.env.SAMPLE_REGRESSION_ROOT)
  : reportDir;
const pythonExe = process.env.CODEX_PYTHON
  || "C:\\Users\\hxc\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";

function round(value, digits = 0) {
  return Number(Number(value || 0).toFixed(digits));
}

function unique(values) {
  const seen = new Set();
  const out = [];
  values.forEach((value) => {
    const key = String(value);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  });
  return out;
}

function extractSamples() {
  const python = String.raw`
import json
import pathlib
import re
import sys
import pdfplumber

def chars(*codes):
    return "".join(chr(code) for code in codes)

LABELS = {
    "subtotal": chars(0x5c0f, 0x8ba1),
    "price_adjustment": chars(0x4ef7, 0x683c, 0x8c03, 0x6574),
    "material_advance": chars(0x6750, 0x6599, 0x8bbe, 0x5907, 0x57ab, 0x4ed8, 0x6b3e),
    "material_deduction": chars(0x6263, 0x56de, 0x6750, 0x6599, 0x8bbe, 0x5907, 0x57ab, 0x4ed8, 0x6b3e),
    "retention": chars(0x4fdd, 0x7559, 0x91d1),
    "mobilization_deduction": chars(0x6263, 0x56de, 0x52a8, 0x5458, 0x9884, 0x4ed8, 0x6b3e),
    "final_payment": chars(0x5b9e, 0x9645, 0x652f, 0x4ed8),
}
CHAPTER_TOTAL = chars(0x7ae0, 0x5408, 0x8ba1)
TOTAL_YUAN = chars(0x5171, 0x0020, 0x8ba1)
CURRENT_PAYBACK = chars(0x672c, 0x671f, 0x56de, 0x6263, 0x91d1, 0x989d)

def find_pdf(folder, code, exclude=None):
    files = [p for p in folder.glob(code + "*.pdf") if not (exclude and p.name.startswith(exclude))]
    if not files:
        raise FileNotFoundError(str(folder / (code + "*.pdf")))
    return sorted(files, key=lambda item: item.name)[0]

def pdf_text(path):
    with pdfplumber.open(str(path)) as pdf:
        return "\n".join((page.extract_text() or "") for page in pdf.pages)

def numbers(line):
    out = []
    for raw in re.findall(r"-?\d[\d,]*(?:\.\d+)?", line or ""):
        text = raw.replace(",", "")
        value = float(text) if "." in text else int(text)
        out.append(int(round(value)))
    return out

def line_starting(lines, label):
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(label):
            return stripped
    return ""

def line_containing(lines, text):
    for line in lines:
        if text in line:
            return line.strip()
    return ""

def current_amount(line):
    ns = numbers(line)
    return abs(ns[-1]) if ns else 0

def triple_amount(line):
    ns = numbers(line)
    if len(ns) >= 3:
        return {"cumulative": abs(ns[0]), "previous": abs(ns[1]), "current": abs(ns[2])}
    if len(ns) == 2:
        return {"cumulative": abs(ns[0]), "previous": 0, "current": abs(ns[1])}
    if len(ns) == 1:
        return {"cumulative": abs(ns[0]), "previous": 0, "current": 0}
    return {"cumulative": 0, "previous": 0, "current": 0}

def subtotal_amount(line):
    ns = numbers(line)
    if len(ns) >= 5:
        return {
            "contract": ns[0],
            "adjustedContract": ns[1],
            "cumulative": ns[-3],
            "previous": ns[-2],
            "current": ns[-1],
        }
    return {"contract": 0, "adjustedContract": 0, "cumulative": 0, "previous": 0, "current": 0}

def parse_jl104(text):
    lines = text.splitlines()
    subtotal = subtotal_amount(line_starting(lines, LABELS["subtotal"]))
    price_line = line_starting(lines, LABELS["price_adjustment"])
    price_nums = numbers(price_line)
    price_current = price_nums[-1] if len(price_nums) >= 3 else 0
    material_advance = triple_amount(line_starting(lines, LABELS["material_advance"]))
    material_deduction = triple_amount(line_starting(lines, LABELS["material_deduction"]))
    retention = triple_amount(line_starting(lines, LABELS["retention"]))
    final_payment = triple_amount(line_starting(lines, LABELS["final_payment"]))
    mobilization_deduction = current_amount(line_starting(lines, LABELS["mobilization_deduction"]))
    chapters = {}
    for line in lines:
        m = re.match(r"^(\d{3})\s+", line.strip())
        if not m:
            continue
        ns = numbers(line)
        if not ns or ns[0] != int(m.group(1)):
            continue
        values = ns[1:]
        if len(values) < 2:
            continue
        cumulative = values[2] if len(values) >= 3 else 0
        previous = values[3] if len(values) >= 4 else cumulative
        current = values[4] if len(values) >= 5 else max(0, cumulative - previous)
        chapters[m.group(1)] = {
            "contract": values[0],
            "adjustedContract": values[1] if len(values) >= 2 else values[0],
            "cumulative": cumulative,
            "previous": previous,
            "current": current,
        }
    return {
        "contractTotal": subtotal["contract"],
        "previousSubtotal": subtotal["previous"],
        "cumulativeSubtotal": subtotal["cumulative"],
        "subtotal": subtotal["current"],
        "priceAdjustment": price_current,
        "materialAdvance": material_advance,
        "materialDeduction": material_deduction,
        "retention": retention,
        "mobilizationDeduction": mobilization_deduction,
        "finalPayment": final_payment["current"],
        "chapters": chapters,
    }

def parse_jl113(text):
    pattern = re.compile(r"(\d{3})" + re.escape(CHAPTER_TOTAL) + r"\s+(-?[\d,]+)")
    return {chapter: int(amount.replace(",", "")) for chapter, amount in pattern.findall(text)}

def parse_jl108(text):
    ns = []
    for line in text.splitlines():
        if TOTAL_YUAN in line:
            ns = numbers(line)
    return ns[-1] if ns else 0

def parse_jl110(text, year, month):
    target = f"{year} {month:02d}"
    line = ""
    for candidate in text.splitlines():
        if candidate.strip().startswith(target):
            line = candidate.strip()
    ns = numbers(line)
    body = ns[2:] if len(ns) > 2 else []
    positives = unique([n for n in body if n >= 0])
    negatives = unique([abs(n) for n in body if n < 0])
    return {
        "line": line,
        "cumulativeAdvance": positives[0] if len(positives) >= 1 else 0,
        "periodAdvance": positives[1] if len(positives) >= 2 else 0,
        "cumulativeDeduction": negatives[0] if len(negatives) >= 1 else 0,
        "previousDeduction": negatives[1] if len(negatives) >= 2 else 0,
        "periodDeduction": negatives[2] if len(negatives) >= 3 else 0,
    }

def parse_jl111(text):
    lines = text.splitlines()
    def last_number(needle):
        line = line_containing(lines, needle)
        ns = numbers(line)
        return abs(ns[-1]) if ns else 0
    return {
        "contractTotal": last_number("A:"),
        "advance": last_number("B:"),
        "cumulativeSubtotal": last_number("C:"),
        "threshold": last_number("D"),
        "periodDeduction": last_number(CURRENT_PAYBACK),
    }

def parse_period(folder_name, period_id, year, month):
    folder = pathlib.Path(sys.argv[1]) / folder_name
    jl104 = parse_jl104(pdf_text(find_pdf(folder, "JL104")))
    jl113 = parse_jl113(pdf_text(find_pdf(folder, "JL113")))
    jl108 = parse_jl108(pdf_text(find_pdf(folder, "JL108", exclude="JL108-1")))
    jl110 = parse_jl110(pdf_text(find_pdf(folder, "JL110")), year, month)
    jl111 = parse_jl111(pdf_text(find_pdf(folder, "JL111")))
    return {
        "periodId": period_id,
        "folder": folder_name,
        "month": month,
        "jl104": jl104,
        "jl113ChapterTotals": jl113,
        "jl108Adjustment": jl108,
        "jl110": jl110,
        "jl111": jl111,
    }

def unique(values):
    seen = set()
    out = []
    for value in values:
        if value not in seen:
            seen.add(value)
            out.append(value)
    return out

result = {
    "13": parse_period("p13", 13, 2018, 3),
    "14": parse_period("p14", 14, 2018, 4),
}
print(json.dumps(result, ensure_ascii=True))
`;
  const result = spawnSync(pythonExe, ["-c", python, sampleRoot], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`PDF extraction failed:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildFixture(baseDb, extracted) {
  const db = clone(baseDb);
  Object.keys(db).forEach((key) => {
    if (Array.isArray(db[key])) db[key] = [];
  });

  const p13 = extracted["13"];
  const p14 = extracted["14"];
  const sectionId = 101;
  const contractTotal = p14.jl104.contractTotal;
  const chapterCodes = unique([
    ...Object.keys(p13.jl104.chapters),
    ...Object.keys(p14.jl104.chapters),
    ...Object.keys(p13.jl113ChapterTotals),
    ...Object.keys(p14.jl113ChapterTotals)
  ]).sort();

  db.client = {
    clientId: 1,
    clientName: "Sample Regression Project",
    deptName: "Regression",
    roleTypeName: "tester"
  };
  db.projects = [{
    id: 1,
    projectId: 1,
    projectName: "第1合同段计量支付样本回归",
    shortName: "JL Regression",
    owner: "sample",
    startDate: "2018-01-01",
    endDate: "2018-12-31"
  }];
  db.sections = [{
    id: sectionId,
    sectionId,
    projectId: 1,
    sectionName: "第1合同段",
    contractor: "中铁十五局集团有限公司",
    supervisor: "浙江公路水运工程咨询公司",
    contractNo: "REG-JL-001"
  }];
  db.billModels = [];
  db.materials = [
    {
      id: 9001,
      materialId: 9001,
      materialNo: "REG-MATERIAL-ADVANCE",
      materialName: "材料设备垫付款折算",
      unit: "元",
      basePrice: 0,
      currentPrice: 1
    },
    {
      id: 9002,
      materialId: 9002,
      materialNo: "REG-PRICE-ADJUST",
      materialName: "永久性工程材料差价",
      unit: "元",
      basePrice: 0,
      currentPrice: 1
    }
  ];

  let billId = 1;
  let contractSum = 0;
  db.bills = chapterCodes.map((chapter) => {
    const contract = (p14.jl104.chapters[chapter] || p13.jl104.chapters[chapter] || {}).contract || 0;
    contractSum += contract;
    return {
      id: billId,
      billId: billId++,
      sectionId,
      chapter,
      billNo: `${chapter}-REG`,
      billName: `${chapter}章样本汇总`,
      measureUnit: "元",
      contractNum: contract,
      correctedNum: contract,
      price: 1
    };
  }).filter((row) => row.contractNum > 0 || p13.jl113ChapterTotals[row.chapter] || p14.jl113ChapterTotals[row.chapter]);

  const provisional = round(contractTotal - contractSum, 0);
  if (provisional > 0) {
    db.bills.push({
      id: billId,
      billId: billId++,
      sectionId,
      chapter: "900",
      billNo: "900-PROVISIONAL",
      billName: "暂定金额",
      measureUnit: "元",
      contractNum: provisional,
      correctedNum: provisional,
      price: 1
    });
  }

  const billByChapter = new Map(db.bills.map((row) => [row.chapter, row]));
  const previousByChapter = {};
  chapterCodes.forEach((chapter) => {
    const row = p13.jl104.chapters[chapter] || {};
    const current = Number(p13.jl113ChapterTotals[chapter] || 0);
    previousByChapter[chapter] = Number((row.previous ?? (Number(row.cumulative || 0) - current)) || 0);
  });

  function detailsFor(amounts) {
    return Object.entries(amounts)
      .filter(([, amount]) => Number(amount || 0) !== 0)
      .map(([chapter, amount]) => {
        const bill = billByChapter.get(chapter);
        if (!bill) throw new Error(`Missing bill for chapter ${chapter}`);
        return {
          billId: bill.billId,
          billNo: bill.billNo,
          billName: bill.billName,
          chapter,
          measureUnit: bill.measureUnit,
          price: 1,
          measureNum: Number(amount)
        };
      });
  }

  db.measurePeriods = [
    { id: 12, gatherId: 12, periodId: 12, periodDesc: "第12期", startDate: "2018-02-01", endDate: "2018-02-25", gatherState: "已归档" },
    { id: 13, gatherId: 13, periodId: 13, periodDesc: "第13期", startDate: "2018-03-01", endDate: "2018-03-25", gatherState: "已归档" },
    { id: 14, gatherId: 14, periodId: 14, periodDesc: "第14期", startDate: "2018-04-01", endDate: "2018-04-25", gatherState: "已归档" }
  ];
  db.measures = [
    {
      id: 12,
      measureId: 12,
      measureNo: "REG-JL113-P12",
      sectionId,
      periodId: 12,
      gatherId: 12,
      measureDate: "2018-02-25",
      states: "已归档",
      details: detailsFor(previousByChapter)
    },
    {
      id: 13,
      measureId: 13,
      measureNo: "REG-JL113-P13",
      sectionId,
      periodId: 13,
      gatherId: 13,
      measureDate: "2018-03-25",
      states: "已归档",
      details: detailsFor(p13.jl113ChapterTotals)
    },
    {
      id: 14,
      measureId: 14,
      measureNo: "REG-JL113-P14",
      sectionId,
      periodId: 14,
      gatherId: 14,
      measureDate: "2018-04-25",
      states: "已归档",
      details: detailsFor(p14.jl113ChapterTotals)
    }
  ];

  function addArrival(id, periodId, date, advanceMoney) {
    db.materialArrivals.push({
      id,
      arrivalId: id,
      sectionId,
      periodId,
      gatherId: periodId,
      measureNo: `REG-JL109-P${periodId}`,
      materialId: 9001,
      measureDate: date,
      quantity: Number(advanceMoney || 0) / 0.6,
      states: "已归档"
    });
  }

  addArrival(12, 12, "2018-02-25", p13.jl104.materialAdvance.previous);
  addArrival(13, 13, "2018-03-25", p13.jl104.materialAdvance.current);
  addArrival(14, 14, "2018-04-25", p14.jl104.materialAdvance.current);

  db.materialDeductions = [
    {
      id: 12,
      deductionId: 12,
      sectionId,
      periodId: 12,
      gatherId: 12,
      deductionMoney: p13.jl104.materialDeduction.previous,
      measureDate: "2018-02-25"
    },
    {
      id: 13,
      deductionId: 13,
      sectionId,
      periodId: 13,
      gatherId: 13,
      deductionMoney: p13.jl104.materialDeduction.current,
      measureDate: "2018-03-25"
    },
    {
      id: 14,
      deductionId: 14,
      sectionId,
      periodId: 14,
      gatherId: 14,
      deductionMoney: p14.jl104.materialDeduction.current,
      measureDate: "2018-04-25"
    }
  ];

  db.materialAdjustments = [];
  if (p13.jl108Adjustment) {
    db.materialAdjustments.push({
      id: 13,
      diasId: 13,
      sectionId,
      periodId: 13,
      gatherId: 13,
      measureNo: "REG-JL108-P13",
      materialId: 9002,
      measureDate: "2018-03-25",
      quantity: p13.jl108Adjustment,
      states: "已归档"
    });
  }
  if (p14.jl108Adjustment) {
    db.materialAdjustments.push({
      id: 14,
      diasId: 14,
      sectionId,
      periodId: 14,
      gatherId: 14,
      measureNo: "REG-JL108-P14",
      materialId: 9002,
      measureDate: "2018-04-25",
      quantity: p14.jl108Adjustment,
      states: "已归档"
    });
  }

  db.manualMeasures = [];
  db.variations = [];
  db.gatherSnapshots = [];
  db.calculationRules = {
    moneyDigits: 0,
    quantityDigits: 3,
    priceDigits: 2,
    includeBillMeasure: true,
    includeMaterialAdjust: true,
    includeMaterialArrival: false,
    includeManualMeasure: true,
    includeMaterialAdvance: true,
    includeRetention: true,
    materialAdvanceRate: 60,
    retentionRate: 10,
    mobilizationAdvanceRate: 10,
    mobilizationDeductionStartRate: 30,
    mobilizationDeductionEndRate: 80,
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
      headers: { Accept: "application/json" }
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

function requestText(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: pathname }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${pathname} returned HTTP ${res.statusCode}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error(`${pathname} timed out`));
    });
  });
}

function freePort(start = 3310) {
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
      await requestJson(port, "/api/debug/runtime");
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

async function runApiRegression(port, extracted) {
  const checks = [];
  const apiSnapshots = {};
  for (const period of ["13", "14"]) {
    const periodId = Number(period);
    const expected = extracted[period];
    const certificate = (await requestJson(port, `/api/payment/certificate?periodId=${periodId}&sectionId=101`)).data;
    const deductions = (await requestJson(port, `/api/payment/jl_deductions?periodId=${periodId}&sectionId=101`)).data;
    const jl113 = (await requestJson(port, `/api/payment/jl113?periodId=${periodId}&sectionId=101&limit=1000`)).data;
    const continuity = (await requestJson(port, `/api/payment/jl_financial_continuity?periodId=${periodId}&sectionId=101`)).data;
    const html = await requestText(port, `/payment/jl_report_page?periodId=${periodId}&sectionId=101`);
    const pdf = await requestText(port, `/payment/export_jl_form_pdf?formCode=JL104&periodId=${periodId}&sectionId=101`);
    const materialRow = deductions.materialDeductionLedger.find((row) => Number(row.periodId) === periodId) || {};
    const mobilizationRow = deductions.mobilizationDeductionLedger.find((row) => Number(row.periodId) === periodId) || {};
    const jl113ByChapter = sumJl113ByChapter(jl113);

    addCheck(checks, period, "JL104小计", expected.jl104.subtotal, certificate.subtotal, "PDF JL113章合计 -> API payment/certificate.subtotal");
    addCheck(checks, period, "JL104到上期末小计", expected.jl104.previousSubtotal, certificate.previousCumulativeSubtotal, "PDF JL104小计到上期末 -> API certificate");
    addCheck(checks, period, "JL104到本期末小计", expected.jl104.cumulativeSubtotal, certificate.cumulativeSubtotal, "PDF JL104小计到本期末 -> API certificate");
    addCheck(checks, period, "JL108价格调整", expected.jl108Adjustment, certificate.priceAdjustment, "PDF JL108共计 -> API certificate.priceAdjustment");
    addCheck(checks, period, "JL109材料设备垫付款", expected.jl104.materialAdvance.current, certificate.materialAdvanceMoney, "PDF JL110/JL104本期预付 -> API certificate.materialAdvanceMoney");
    addCheck(checks, period, "JL110扣回材料设备垫付款", expected.jl104.materialDeduction.current, certificate.materialDeductionMoney, "PDF JL110本期扣回 -> API certificate.materialDeductionMoney");
    addCheck(checks, period, "JL104保留金", expected.jl104.retention.current, certificate.retentionMoney, "PDF JL104保留金 -> API certificate.retentionMoney");
    addCheck(checks, period, "JL111扣回动员预付款", expected.jl111.periodDeduction, certificate.mobilizationDeductionMoney, "PDF JL111本期回扣 -> API certificate.mobilizationDeductionMoney");
    addCheck(checks, period, "JL104实际支付", expected.jl104.finalPayment, certificate.finalPayment, "PDF JL104实际支付 -> API certificate.finalPayment");
    addCheck(checks, period, "JL110台账本期预付", expected.jl110.periodAdvance, materialRow.periodAdvance, "PDF JL110行 -> API jl_deductions.materialDeductionLedger");
    addCheck(checks, period, "JL110台账本期扣回", expected.jl110.periodDeduction, materialRow.periodDeduction, "PDF JL110行 -> API jl_deductions.materialDeductionLedger");
    addCheck(checks, period, "JL111台账累计小计", expected.jl111.cumulativeSubtotal, mobilizationRow.cumulativeSubtotal, "PDF JL111 C栏 -> API jl_deductions.mobilizationDeductionLedger");
    addCheck(checks, period, "JL111台账本期扣回", expected.jl111.periodDeduction, mobilizationRow.periodDeduction, "PDF JL111本期回扣 -> API jl_deductions.mobilizationDeductionLedger");
    Object.entries(expected.jl113ChapterTotals).forEach(([chapter, amount]) => {
      addCheck(checks, period, `JL113 ${chapter}章合计`, amount, jl113ByChapter[chapter] || 0, "PDF JL113章合计 -> API jl113 row sum");
    });
    addCheck(checks, period, "JL报表页面可渲染", 1, html.length > 1000 ? 1 : 0, "GET /payment/jl_report_page returned HTML bytes");
    addCheck(checks, period, "JL104导出PDF可生成", 1, pdf.length > 1000 ? 1 : 0, "GET /payment/export_jl_form_pdf?formCode=JL104");

    apiSnapshots[period] = {
      certificate,
      materialDeductionLedger: deductions.materialDeductionLedger,
      mobilizationDeductionLedger: deductions.mobilizationDeductionLedger,
      jl113ByChapter,
      financialContinuitySummary: continuity.summary,
      reportHtmlBytes: html.length,
      exportedJl104PdfBytes: pdf.length
    };
  }
  return { checks, apiSnapshots };
}

function writeReports(extracted, fixture, regression, port) {
  fs.mkdirSync(reportDir, { recursive: true });
  const result = {
    ok: regression.checks.every((check) => check.passed),
    generatedAt: new Date().toISOString(),
    port,
    sampleRoot,
    checks: regression.checks,
    extracted,
    apiSnapshots: regression.apiSnapshots,
    fixtureSummary: {
      bills: fixture.bills.length,
      periods: fixture.measurePeriods.map((row) => row.periodDesc),
      measures: fixture.measures.map((row) => ({
        periodId: row.periodId,
        details: row.details.length,
        amount: row.details.reduce((sum, detail) => sum + Number(detail.measureNum || 0), 0)
      })),
      materialArrivals: fixture.materialArrivals.length,
      materialAdjustments: fixture.materialAdjustments.length,
      materialDeductions: fixture.materialDeductions.length,
      calculationRules: fixture.calculationRules
    }
  };
  const jsonPath = path.join(reportDir, "latest-result.json");
  const mdPath = path.join(reportDir, "latest-result.md");
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf8");
  const lines = [
    "# Sample Regression Result",
    "",
    `- ok: ${result.ok}`,
    `- generatedAt: ${result.generatedAt}`,
    `- sampleRoot: ${sampleRoot}`,
    `- localApiPort: ${port}`,
    "",
    "## Method",
    "",
    "1. Extracted source totals from JL113, JL108, JL110, JL111, and expected JL104 fields with pdfplumber.",
    "2. Built a temporary runtime database with periods 12, 13, and 14. Period 12 is only the previous cumulative base needed by periods 13 and 14.",
    "3. Started server.js on an isolated local port and called the same payment APIs used by the website.",
    "4. Restored data/runtime-db.json after the regression run.",
    "",
    "## Checks",
    "",
    "| Period | Field | PDF Expected | Website Actual | Source | Result |",
    "| --- | --- | ---: | ---: | --- | --- |",
    ...regression.checks.map((check) => `| ${check.period} | ${check.field} | ${check.expected} | ${check.actual} | ${check.source} | ${check.passed ? "PASS" : "FAIL"} |`)
  ];
  fs.writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
  return { jsonPath, mdPath, result };
}

async function main() {
  const originalExists = fs.existsSync(runtimeFile);
  const originalContent = originalExists ? fs.readFileSync(runtimeFile, "utf8") : "";
  const extracted = extractSamples();
  const baseDb = require(path.join(root, "constructionData"));
  const fixture = buildFixture(baseDb, extracted);
  const port = await freePort(Number(process.env.SAMPLE_REGRESSION_PORT || 3310));
  let server = null;
  try {
    fs.writeFileSync(runtimeFile, JSON.stringify(fixture, null, 2), "utf8");
    server = spawn(process.execPath, ["server.js"], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
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
    const regression = await runApiRegression(port, extracted);
    const report = writeReports(extracted, fixture, regression, port);
    if (!report.result.ok) {
      const failed = regression.checks.filter((check) => !check.passed);
      throw new Error(`Sample regression failed:\n${failed.map((check) => `${check.period} ${check.field}: expected ${check.expected}, actual ${check.actual}`).join("\n")}\n${serverOutput}`);
    }
    console.log(JSON.stringify({
      ok: true,
      checks: regression.checks.length,
      report: path.relative(root, report.mdPath),
      json: path.relative(root, report.jsonPath)
    }, null, 2));
  } finally {
    if (server) {
      server.kill();
      await new Promise((resolve) => server.once("exit", resolve));
    }
    if (originalExists) {
      fs.writeFileSync(runtimeFile, originalContent, "utf8");
    } else if (fs.existsSync(runtimeFile)) {
      fs.unlinkSync(runtimeFile);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
