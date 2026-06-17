const db = require("./constructionData");

function round(value, digits = 2) {
  const n = Number(value || 0);
  return Number(n.toFixed(digits));
}

const defaultCalculationRules = {
  moneyDigits: 2,
  quantityDigits: 3,
  priceDigits: 2,
  includeBillMeasure: true,
  includeMaterialAdjust: true,
  includeMaterialArrival: false,
  includeManualMeasure: true,
  auditSupervisorRate: 99.5,
  auditOwnerRate: 99,
  auditFinalRate: 98.5
};

function calculationRules() {
  const saved = db.calculationRules && typeof db.calculationRules === "object" ? db.calculationRules : {};
  return {
    ...defaultCalculationRules,
    ...saved,
    moneyDigits: Math.max(0, Math.min(6, Number(saved.moneyDigits ?? defaultCalculationRules.moneyDigits))),
    quantityDigits: Math.max(0, Math.min(6, Number(saved.quantityDigits ?? defaultCalculationRules.quantityDigits))),
    priceDigits: Math.max(0, Math.min(6, Number(saved.priceDigits ?? defaultCalculationRules.priceDigits))),
    includeBillMeasure: saved.includeBillMeasure !== false,
    includeMaterialAdjust: saved.includeMaterialAdjust !== false,
    includeMaterialArrival: saved.includeMaterialArrival === true,
    includeManualMeasure: saved.includeManualMeasure !== false,
    auditSupervisorRate: Number(saved.auditSupervisorRate ?? defaultCalculationRules.auditSupervisorRate),
    auditOwnerRate: Number(saved.auditOwnerRate ?? defaultCalculationRules.auditOwnerRate),
    auditFinalRate: Number(saved.auditFinalRate ?? defaultCalculationRules.auditFinalRate)
  };
}

function payableFormulaText(rules = calculationRules()) {
  const parts = [];
  if (rules.includeBillMeasure) parts.push("清单计量");
  if (rules.includeMaterialAdjust) parts.push("材料补差");
  if (rules.includeMaterialArrival) parts.push("材料到场");
  if (rules.includeManualMeasure) parts.push("手动计量");
  return parts.length ? parts.join(" + ") : "未启用应付构成";
}

function calculatePayable(parts, rules = calculationRules()) {
  const total =
    (rules.includeBillMeasure ? Number(parts.measuredMoney || parts.billMeasureMoney || 0) : 0) +
    (rules.includeMaterialAdjust ? Number(parts.materialDiasMoney || parts.materialAdjustMoney || 0) : 0) +
    (rules.includeMaterialArrival ? Number(parts.materialArrivalMoney || 0) : 0) +
    (rules.includeManualMeasure ? Number(parts.manualMoney || parts.manualMeasureMoney || 0) : 0);
  return round(total, rules.moneyDigits);
}

function table(data, req) {
  const rows = Array.isArray(data) ? data : [];
  const page = Math.max(Number((req.query && req.query.page) || (req.body && req.body.page) || 1), 1);
  const limit = Math.max(Number((req.query && req.query.limit) || (req.body && req.body.limit) || rows.length || 10), 1);
  const start = (page - 1) * limit;
  return {
    code: 0,
    msg: "",
    count: rows.length,
    data: rows.slice(start, start + limit)
  };
}

function ok(data, other = "") {
  return {
    code: 1,
    count: "",
    data,
    draw: "",
    msg: "成功",
    other,
    recordsFiltered: "",
    recordsTotal: ""
  };
}

function section(id) {
  return db.sections.find((item) => Number(item.sectionId) === Number(id)) || db.sections[0];
}

function bill(id) {
  return db.bills.find((item) => Number(item.billId) === Number(id));
}

function material(id, fallback = {}) {
  const found = db.materials.find((item) => Number(item.materialId) === Number(id));
  if (found) return found;
  return {
    materialId: Number(id) || 0,
    materialNo: fallback.materialNo || fallback.secMaterialNo || `CL-MISSING-${id || "0"}`,
    materialName: fallback.materialName || fallback.secMaterialName || "未匹配材料",
    spec: fallback.spec || fallback.specType || "",
    specType: fallback.specType || fallback.spec || "",
    unit: fallback.unit || fallback.measureUnit || "项",
    measureUnit: fallback.measureUnit || fallback.unit || "项",
    basePrice: Number(fallback.basePrice || fallback.price || 0),
    currentPrice: Number(fallback.currentPrice || fallback.price || fallback.basePrice || 0)
  };
}

function billAmount(item, quantityKey = "contractNum", priceKey = "price") {
  return round(Number(item[quantityKey] || 0) * Number(item[priceKey] || 0));
}

function measureDetailRows(measure) {
  return measure.details.map((detail, index) => {
    const b = bill(detail.billId);
    const amount = round(detail.measureNum * b.price);
    return {
      ...b,
      measureId: measure.measureId,
      billMeasureId: measure.measureId,
      billMeasureDetailId: detail.detailId || `${measure.measureId}-${detail.billId}-${index + 1}`,
      detailIndex: index,
      measureNo: measure.measureNo,
      sectionName: section(measure.sectionId).sectionName,
      measureDate: measure.measureDate,
      measureNum: detail.measureNum,
      currentNum: detail.measureNum,
      currentMoney: amount,
      measureMoney: amount,
      money: amount
    };
  });
}

function allMeasureDetails() {
  return db.measures.flatMap(measureDetailRows);
}

function measuredByBillId(billId) {
  return allMeasureDetails()
    .filter((item) => Number(item.billId) === Number(billId))
    .reduce((sum, item) => sum + Number(item.measureNum || 0), 0);
}

function variationsByBillId(billId) {
  return db.variations.filter((item) => Number(item.billId) === Number(billId));
}

function billFinalQuantity(item) {
  const delta = variationsByBillId(item.billId).reduce((sum, vary) => sum + Number(vary.afterNum - vary.beforeNum), 0);
  return round(Number(item.correctedNum || item.contractNum) + delta, 3);
}

function billRows() {
  return db.bills.map((item) => {
    const finalNum = billFinalQuantity(item);
    const measuredNum = round(measuredByBillId(item.billId), 3);
    const contractMoney = billAmount(item, "contractNum");
    const correctedMoney = billAmount(item, "correctedNum");
    const varyMoney = round(variationsByBillId(item.billId).reduce((sum, vary) => {
      return sum + (Number(vary.afterNum || 0) * Number(vary.afterPrice || 0)) - (Number(vary.beforeNum || 0) * Number(vary.beforePrice || 0));
    }, 0));
    const finalMoney = round(contractMoney + varyMoney);
    return {
      ...item,
      sectionName: section(item.sectionId).sectionName,
      contractMoney,
      correctedMoney,
      finalNum,
      finalMoney,
      measuredNum,
      measuredMoney: round(measuredNum * item.price),
      remainNum: round(finalNum - measuredNum, 3),
      remainMoney: round(finalMoney - (measuredNum * item.price))
    };
  });
}

function contractSummary() {
  const rules = calculationRules();
  const rows = billRows();
  const contractSumMoney = round(rows.reduce((sum, item) => sum + item.contractMoney, 0));
  const varyMoney = round(variationRows().reduce((sum, item) => sum + item.varyMoney, 0));
  const finalMoney = round(rows.reduce((sum, item) => sum + item.finalMoney, 0));
  const measuredMoney = round(rows.reduce((sum, item) => sum + item.measuredMoney, 0));
  const materialDiasMoney = round(materialDiasRows().reduce((sum, item) => sum + item.adjustMoney, 0));
  const materialArrivalMoney = round(materialArrivalRows().reduce((sum, item) => sum + item.money, 0));
  const manualMoney = round(manualMeasureRows().reduce((sum, item) => sum + item.measureMoney, 0));
  const payableMoney = calculatePayable({ measuredMoney, materialDiasMoney, materialArrivalMoney, manualMoney }, rules);
  return {
    contractSumMoney,
    varyMoney,
    finalMoney,
    measuredMoney,
    materialDiasMoney,
    materialArrivalMoney,
    manualMoney,
    payableMoney,
    payRate: finalMoney ? round((payableMoney / finalMoney) * 100, 2) : 0,
    payableFormula: payableFormulaText(rules),
    calculationRules: rules
  };
}

function measureRows() {
  return db.measures.map((item) => {
    const details = measureDetailRows(item);
    const money = round(details.reduce((sum, detail) => sum + detail.measureMoney, 0));
    const area = section(item.sectionId).sectionName;
    return {
      ...item,
      billMeasureId: item.measureId,
      sectionName: area,
      workAreaName: area,
      sysWorkArea: { workAreaName: area },
      processInstanceId: item.processInstanceId || "",
      taskUser: item.taskUser ?? true,
      measureState: item.measureState ?? 0,
      lineColor: item.lineColor || "",
      measureMoney: money,
      money,
      amount: money
    };
  });
}

function materialDiasRows() {
  return db.materialAdjustments.map((item) => {
    const m = material(item.materialId, item);
    const priceDiff = round(m.currentPrice - m.basePrice);
    const adjustMoney = round(item.quantity * priceDiff);
    return {
      ...item,
      meterialDiasMeasureId: item.diasId || item.id,
      diffYearMonth: String(item.measureDate || "").slice(0, 7),
      approveNo: item.approveNo || item.measureNo,
      provider: item.provider || section(item.sectionId).contractor || section(item.sectionId).sectionName,
      sectionName: section(item.sectionId).sectionName,
      materialNo: m.materialNo,
      materialName: m.materialName,
      secMaterialName: m.materialName,
      measureUnit: m.unit,
      unit: m.unit,
      basePrice: m.basePrice,
      currentPrice: m.currentPrice,
      priceDiff,
      measureNum: item.quantity,
      taskUser: item.taskUser ?? true,
      processInstanceId: item.processInstanceId || "",
      lineColor: item.lineColor || "",
      adjustMoney,
      money: adjustMoney
    };
  });
}

function materialRows() {
  return db.materials.map((item) => ({
    ...item,
    secMateriaId: item.secMateriaId || item.materialId,
    secMaterialId: item.secMaterialId || item.secMateriaId || item.materialId,
    unitPrice: item.unitPrice || item.currentPrice || item.basePrice || 0,
    specType: item.spec || item.specType || "",
    measureUnit: item.unit || item.measureUnit || "项",
    sendersRange: item.sendersRange || "按合同调差",
    materialModel: {
      materialNo: item.materialNo,
      materialName: item.materialName,
      specType: item.spec || item.specType || "",
      measureUnit: item.unit || item.measureUnit || "项"
    }
  }));
}

function materialArrivalRows() {
  return db.materialArrivals.map((item) => {
    const m = material(item.materialId, item);
    const price = m.currentPrice;
    return {
      ...item,
      meterialInMeasureId: item.arrivalId || item.id,
      certifyNo: item.certifyNo || item.measureNo,
      sectionName: section(item.sectionId).sectionName,
      materialNo: m.materialNo,
      materialName: m.materialName,
      measureUnit: m.unit,
      unit: m.unit,
      measureNum: item.quantity,
      price,
      measurePrice: price,
      taskUser: item.taskUser ?? true,
      processInstanceId: item.processInstanceId || "",
      lineColor: item.lineColor || "",
      money: round(item.quantity * price)
    };
  });
}

function manualMeasureRows() {
  return db.manualMeasures.map((item) => ({
    ...item,
    sectionName: section(item.sectionId).sectionName,
    roleTypeName: item.roleTypeName || "SBSJ",
    isSuperSection: item.isSuperSection || "0",
    taskUser: item.taskUser ?? true,
    measureState: item.measureState ?? 0,
    processInstanceId: item.processInstanceId || "",
    measureMoney: round(item.measureNum * item.price),
    money: round(item.measureNum * item.price)
  }));
}

function planRows() {
  const contract = contractSummary();
  let total = 0;
  return db.plans.map((item, index) => {
    const amount = Number(item.amount || item.finishMoney || 0);
    total += amount;
    return {
      ...item,
      planNo: item.planNo || `JH-${String(item.planId || item.id || index + 1).padStart(3, "0")}`,
      planStartDate: item.planStartDate || item.startDate,
      planEndDate: item.planEndDate || item.endDate,
      planYm: item.planYm || String(item.startDate || "").slice(0, 7),
      finishMoney: amount,
      contractSumMoney: contract.contractSumMoney,
      finishPercent: contract.contractSumMoney ? `${round((amount / contract.contractSumMoney) * 100, 2)}%` : "0%",
      finishTotalPercent: contract.contractSumMoney ? `${round((total / contract.contractSumMoney) * 100, 2)}%` : "0%",
      gatherState: item.gatherState || item.status || "执行中",
      isLast: index === db.plans.length - 1 ? 1 : 0
    };
  });
}

function variationRows() {
  return db.variations.map((item, index) => {
    const beforeVaryMoney = round(item.beforeNum * item.beforePrice);
    const afterVaryMoney = round(item.afterNum * item.afterPrice);
    const b = bill(item.billId);
    const varyMoney = round(afterVaryMoney - beforeVaryMoney);
    return {
      ...item,
      meetingId: item.meetingId || item.varyId,
      meetingNo: item.meetingNo || `HY-${String(item.varyId || index + 1).padStart(3, "0")}`,
      meetingTitle: item.meetingTitle || `${item.varyNo} 变更会议`,
      meetingAddress: item.meetingAddress || section(item.sectionId).sectionName,
      meetingDate: item.meetingDate || "2026-02-26",
      pegeNo: item.pegeNo || item.pegNo || "",
      varyContent: item.varyContent || item.billName,
      createUserId: item.createUserId || 563,
      sectionName: section(item.sectionId).sectionName,
      measureDate: item.measureDate || item.createDate || "2026-02-26",
      varyItem: item.varyReason,
      workAreaName: section(item.sectionId).sectionName,
      sysWorkArea: { workAreaName: section(item.sectionId).sectionName },
      varyGrade: { bdName: Math.abs(afterVaryMoney - beforeVaryMoney) > 300000 ? "重大变更" : "一般变更", bdCode: Math.abs(afterVaryMoney - beforeVaryMoney) > 300000 ? "ZD" : "YB" },
      varyType: { bdName: "工程数量变更", bdCode: "SL" },
      processInstanceId: "",
      taskUser: item.taskUser ?? true,
      measureState: item.measureState ?? 0,
      isArchive: item.states === "已归档" ? 1 : 0,
      srVaryMoney: varyMoney,
      beforeVaryNum: item.beforeNum,
      beforeVaryPrice: item.beforePrice,
      beforeVaryMoney,
      afterVaryNum: item.afterNum,
      afterVaryPrice: item.afterPrice,
      afterVaryMoney,
      varyNum: round(item.afterNum - item.beforeNum, 3),
      varyMoney,
      varyPrice: round(item.afterPrice - item.beforePrice),
      money: varyMoney,
      varyDetailId: item.varyDetailId || item.varyId,
      varyApplication: {
        varyId: item.varyId,
        isArchive: item.states === "已归档" ? 1 : 0,
        measureState: item.measureState ?? 0
      },
      secBill: {
        ...b,
        billModel: {
          billNo: item.billNo,
          billName: item.billName,
          measureUnit: item.measureUnit
        }
      }
    };
  });
}

function billLedgerRows() {
  return billRows().map((item, index) => ({
    billPayId: item.billId || index + 1,
    gatherNo: index + 1,
    sectionId: item.sectionId,
    sectionName: item.sectionName,
    contractNo: section(item.sectionId).contractNo,
    billNo: item.billNo,
    billName: item.billName,
    measureUnit: item.measureUnit,
    contractNum: item.contractNum,
    contractAmount: item.contractNum,
    contractPrice: item.price,
    contractMoney: item.contractMoney,
    updateNum: item.correctedNum,
    modifyAmount: item.correctedNum,
    updateMoney: item.correctedMoney,
    modifyMoney: item.correctedMoney,
    varyNum: round(item.finalNum - item.correctedNum, 3),
    varyAmount: round(item.finalNum - item.correctedNum, 3),
    varyMoney: round(item.finalMoney - item.correctedMoney),
    finalNum: item.finalNum,
    contractSumAmount: item.finalNum,
    finalMoney: item.finalMoney,
    contractSumMoney: item.finalMoney,
    measureNum: item.measuredNum,
    afterFinishNumSum: item.measuredNum,
    currentFinishNumSum: item.measuredNum,
    measureMoney: item.measuredMoney,
    remainNum: item.remainNum,
    remainAmount: item.remainNum,
    remainMoney: item.remainMoney,
    measureRate: item.finalMoney ? round((item.measuredMoney / item.finalMoney) * 100, 2) : 0
  }));
}

function reportProjectRows() {
  const summary = contractSummary();
  const rules = calculationRules();
  const materialAdjustments = materialDiasRows();
  const materialArrivals = materialArrivalRows();
  const manuals = manualMeasureRows();
  return db.sections.map((item) => {
    const sectionBills = billRows().filter((billItem) => billItem.sectionId === item.sectionId);
    const finalMoney = round(sectionBills.reduce((sum, billItem) => sum + billItem.finalMoney, 0));
    const measuredMoney = round(sectionBills.reduce((sum, billItem) => sum + billItem.measuredMoney, 0));
    const materialDiasMoney = round(materialAdjustments
      .filter((row) => Number(row.sectionId) === Number(item.sectionId))
      .reduce((sum, row) => sum + Number(row.adjustMoney || 0), 0));
    const materialArrivalMoney = round(materialArrivals
      .filter((row) => Number(row.sectionId) === Number(item.sectionId))
      .reduce((sum, row) => sum + Number(row.money || 0), 0));
    const manualMoney = round(manuals
      .filter((row) => Number(row.sectionId) === Number(item.sectionId))
      .reduce((sum, row) => sum + Number(row.measureMoney || 0), 0));
    const totalPayMoney = calculatePayable({ measuredMoney, materialDiasMoney, materialArrivalMoney, manualMoney }, rules);
    return {
      sectionId: item.sectionId,
      sectionName: item.sectionName,
      contractNo: item.contractNo,
      contractMoney: round(sectionBills.reduce((sum, billItem) => sum + billItem.contractMoney, 0)),
      finalMoney,
      measureMoney: measuredMoney,
      materialDiasMoney,
      materialArrivalMoney,
      manualMoney,
      currentPayMoney: measuredMoney,
      totalPayMoney,
      payRate: finalMoney ? round((totalPayMoney / finalMoney) * 100, 2) : 0,
      projectTotalPayMoney: summary.payableMoney,
      payableFormula: payableFormulaText(rules)
    };
  });
}

function auditMoneyRows() {
  const rules = calculationRules();
  const buildAuditRow = (item, options = {}) => {
    const finishMoney = Number(options.finishMoney ?? item.finalMoney ?? item.finishContractMoney ?? item.measureMoney ?? item.adjustMoney ?? 0);
    const submitMoney = round(Number(options.submitMoney ?? item.measureMoney ?? item.adjustMoney ?? item.money ?? 0));
    const varyMoney = Number(options.varyMoney ?? item.varyMoney ?? 0);
    const varyFinishMoney = finishMoney ? round((submitMoney / finishMoney) * varyMoney) : 0;
    const supervisorMoney = round(submitMoney * (rules.auditSupervisorRate / 100));
    const ownerMoney = round(submitMoney * (rules.auditOwnerRate / 100));
    const finalMoney = round(submitMoney * (rules.auditFinalRate / 100));
    return {
      auditType: options.auditType || "清单计量",
      chapterNo: options.chapterNo || item.billNo || item.measureNo || "",
      chapterName: options.chapterName || item.billName || item.materialName || "",
      billId: options.billId || item.billId || item.diasId || item.manualId || item.id,
      billNo: options.billNo || item.billNo || item.measureNo || "",
      billName: options.billName || item.billName || item.materialName || "",
      measureUnit: options.measureUnit || item.measureUnit || item.unit || "",
      contractMoney: Number(options.contractMoney ?? item.contractMoney ?? 0),
      modifyMoney: Number(options.modifyMoney ?? item.modifyMoney ?? 0),
      varyMoney,
      finishContractMoney: finishMoney,
      usertask1: submitMoney,
      usertask1v: varyFinishMoney,
      usertask2: supervisorMoney,
      usertask2v: round(varyFinishMoney * (rules.auditSupervisorRate / 100)),
      usertask3: ownerMoney,
      usertask3v: round(varyFinishMoney * (rules.auditOwnerRate / 100)),
      submitMoney,
      engineerAuditMoney: supervisorMoney,
      supervisorAuditMoney: ownerMoney,
      ownerAuditMoney: finalMoney,
      states: item.states || "",
      measureDate: item.measureDate || ""
    };
  };
  const billAuditRows = billLedgerRows().map((item) => buildAuditRow(item));
  const materialAuditRows = materialDiasRows()
    .filter((item) => Number(item.adjustMoney || item.money || 0) !== 0)
    .map((item) => buildAuditRow(item, {
      auditType: "材料补差",
      chapterNo: item.measureNo || item.approveNo || `BC-${item.diasId || item.id}`,
      chapterName: item.materialName || item.secMaterialName || "材料补差",
      billNo: item.measureNo || item.approveNo || `BC-${item.diasId || item.id}`,
      billName: item.materialName || item.secMaterialName || "材料补差",
      measureUnit: item.measureUnit || item.unit,
      submitMoney: item.adjustMoney,
      finishMoney: item.adjustMoney
    }));
  const manualAuditRows = manualMeasureRows()
    .filter((item) => Number(item.measureMoney || item.money || 0) !== 0)
    .map((item) => buildAuditRow(item, {
      auditType: "手动计量",
      chapterNo: item.billNo || item.measureNo || `SD-${item.manualId || item.id}`,
      chapterName: item.billName || "手动计量",
      billNo: item.billNo || item.measureNo || `SD-${item.manualId || item.id}`,
      billName: item.billName || "手动计量",
      measureUnit: item.measureUnit || item.unit,
      submitMoney: item.measureMoney,
      finishMoney: item.measureMoney
    }));
  return billAuditRows.concat(materialAuditRows, manualAuditRows);
}

function documentRows() {
  return db.documents.map((item) => ({
    ...item,
    id: item.nodeId || item.id,
    nodeId: item.nodeId || item.id,
    text: item.title,
    name: item.title,
    dataName: item.title,
    nodeName: item.title,
    parentId: item.parentId || 0,
    type: item.type || "工程资料",
    testHouseName: item.testHouseName || item.title,
    testName: item.testName || item.type || "试验资料",
    createTime: item.createTime || item.createDate,
    remark: item.remark || item.type || "",
    isUser: item.isUser ?? 1,
    createUserName: item.createUserName || "ys1",
    updateDate: item.updateDate || item.createDate,
    fileCount: item.fileCount || 0,
    children: item.children || []
  }));
}

function dashboard() {
  const summary = contractSummary();
  return {
    ...summary,
    projectCount: db.projects.length,
    sectionCount: db.sections.length,
    billCount: db.bills.length,
    measureCount: db.measures.length,
    variationCount: db.variations.length
  };
}

module.exports = {
  db,
  ok,
  table,
  dashboard,
  billRows,
  materialRows,
  planRows,
  measureRows,
  materialDiasRows,
  materialArrivalRows,
  manualMeasureRows,
  variationRows,
  billLedgerRows,
  reportProjectRows,
  auditMoneyRows,
  documentRows,
  contractSummary,
  calculationRules,
  calculatePayable,
  payableFormulaText,
  allMeasureDetails
};
