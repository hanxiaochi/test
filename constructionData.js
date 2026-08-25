const appStore = require("./lib/app-store");

const db = {
  client: {
    clientId: 1,
    clientName: "示范高速改扩建工程",
    deptName: "工程科",
    roleTypeName: "申报数据"
  },
  projects: [
    { id: 1, projectId: 1, projectName: "示范高速改扩建工程", shortName: "示范高速", owner: "建设单位", startDate: "2026-01-01", endDate: "2026-12-31" }
  ],
  sections: [
    { id: 101, sectionId: 101, projectId: 1, sectionName: "TJ-01 合同段", contractor: "第一施工单位", supervisor: "第一监理单位", contractNo: "HT-2026-001" },
    { id: 102, sectionId: 102, projectId: 1, sectionName: "TJ-02 合同段", contractor: "第二施工单位", supervisor: "第二监理单位", contractNo: "HT-2026-002" }
  ],
  billModels: [
    { id: 1, modelId: 1, modelName: "公路工程清单范本", modelType: "计量支付", createDate: "2026-01-05", remark: "按工程量清单计价" },
    { id: 2, modelId: 2, modelName: "房建工程清单范本", modelType: "建筑工程", createDate: "2026-01-08", remark: "含分部分项、措施项目" }
  ],
  materials: [
    { id: 1, materialId: 1, materialNo: "CL-001", materialName: "钢筋 HRB400", unit: "t", basePrice: 4100, currentPrice: 4380, spec: "HRB400E" },
    { id: 2, materialId: 2, materialNo: "CL-002", materialName: "商品混凝土 C30", unit: "m3", basePrice: 420, currentPrice: 455, spec: "C30" },
    { id: 3, materialId: 3, materialNo: "CL-003", materialName: "沥青混合料 AC-13", unit: "t", basePrice: 520, currentPrice: 548, spec: "AC-13" }
  ],
  bills: [
    { id: 1, billId: 1, sectionId: 101, chapter: "100", billNo: "101-1", billName: "临时道路", measureUnit: "km", contractNum: 2.5, price: 185000, correctedNum: 2.5 },
    { id: 2, billId: 2, sectionId: 101, chapter: "200", billNo: "202-1", billName: "路基挖方", measureUnit: "m3", contractNum: 82000, price: 18.6, correctedNum: 82000 },
    { id: 3, billId: 3, sectionId: 101, chapter: "300", billNo: "304-1", billName: "水泥稳定碎石基层", measureUnit: "m2", contractNum: 96000, price: 62.5, correctedNum: 96000 },
    { id: 4, billId: 4, sectionId: 101, chapter: "400", billNo: "403-1", billName: "现浇箱梁混凝土", measureUnit: "m3", contractNum: 12800, price: 860, correctedNum: 12800 },
    { id: 5, billId: 5, sectionId: 102, chapter: "200", billNo: "202-1", billName: "路基填方", measureUnit: "m3", contractNum: 112000, price: 21.3, correctedNum: 112000 },
    { id: 6, billId: 6, sectionId: 102, chapter: "400", billNo: "403-2", billName: "钢筋加工安装", measureUnit: "t", contractNum: 1850, price: 5350, correctedNum: 1850 }
  ],
  plans: [
    { id: 1, planId: 1, sectionId: 101, planName: "2026 年 TJ-01 总体施工计划", startDate: "2026-01-01", endDate: "2026-12-31", amount: 18948300, status: "执行中" },
    { id: 2, planId: 2, sectionId: 102, planName: "2026 年 TJ-02 总体施工计划", startDate: "2026-02-01", endDate: "2026-12-31", amount: 12277100, status: "执行中" }
  ],
  measurePeriods: [
    { id: 1, gatherId: 1, periodDesc: "第 1 期", startDate: "2026-01-01", endDate: "2026-01-31", gatherState: "已归档" },
    { id: 2, gatherId: 2, periodDesc: "第 2 期", startDate: "2026-02-01", endDate: "2026-02-28", gatherState: "审核中" }
  ],
  measures: [
    {
      id: 1,
      measureId: 1,
      measureNo: "JL-2026-001",
      sectionId: 101,
      periodId: 1,
      measureDate: "2026-01-28",
      states: "已归档",
      drawNo: "DL-01",
      pegNo: "K0+000-K2+500",
      certifyNo: "JG-001",
      position: "临建及路基",
      details: [
        { billId: 1, measureNum: 1.2 },
        { billId: 2, measureNum: 18500 },
        { billId: 3, measureNum: 12000 }
      ]
    },
    {
      id: 2,
      measureId: 2,
      measureNo: "JL-2026-002",
      sectionId: 101,
      periodId: 2,
      measureDate: "2026-02-25",
      states: "审核中",
      drawNo: "DL-02",
      pegNo: "K2+500-K5+000",
      certifyNo: "JG-002",
      position: "路基及基层",
      details: [
        { billId: 2, measureNum: 24600 },
        { billId: 3, measureNum: 18000 },
        { billId: 4, measureNum: 1350 }
      ]
    },
    {
      id: 3,
      measureId: 3,
      measureNo: "JL-2026-003",
      sectionId: 102,
      periodId: 2,
      measureDate: "2026-02-26",
      states: "待上报",
      drawNo: "DL-03",
      pegNo: "K5+000-K8+000",
      certifyNo: "JG-003",
      position: "路基工程",
      details: [
        { billId: 5, measureNum: 31000 },
        { billId: 6, measureNum: 260 }
      ]
    }
  ],
  materialAdjustments: [
    { id: 1, diasId: 1, sectionId: 101, measureNo: "BC-2026-001", materialId: 1, measureDate: "2026-02-25", quantity: 120, states: "审核中" },
    { id: 2, diasId: 2, sectionId: 101, measureNo: "BC-2026-002", materialId: 2, measureDate: "2026-02-25", quantity: 680, states: "待上报" }
  ],
  materialArrivals: [
    { id: 1, arrivalId: 1, sectionId: 101, measureNo: "DC-2026-001", materialId: 1, measureDate: "2026-02-18", quantity: 145, states: "已归档" },
    { id: 2, arrivalId: 2, sectionId: 102, measureNo: "DC-2026-002", materialId: 3, measureDate: "2026-02-20", quantity: 850, states: "审核中" }
  ],
  manualMeasures: [
    { id: 1, manualId: 1, sectionId: 101, measureNo: "SD-2026-001", billNo: "900-1", billName: "现场签证零星工程", measureUnit: "项", measureNum: 1, price: 58000, measureDate: "2026-02-22", states: "审核中" }
  ],
  variations: [
    { id: 1, varyId: 1, varyNo: "BG-2026-001", sectionId: 101, billId: 2, billNo: "202-1", billName: "路基挖方", measureUnit: "m3", beforeNum: 82000, beforePrice: 18.6, afterNum: 90000, afterPrice: 18.6, states: "审核中", varyReason: "地质条件变化" },
    { id: 2, varyId: 2, varyNo: "BG-2026-002", sectionId: 101, billId: 4, billNo: "403-1", billName: "现浇箱梁混凝土", measureUnit: "m3", beforeNum: 12800, beforePrice: 860, afterNum: 13250, afterPrice: 860, states: "待上报", varyReason: "设计优化" }
  ],
  contactBills: [
    { id: 1, contactId: 1, contactNo: "LX-2026-001", title: "桥梁桩基施工技术联系单", createDate: "2026-02-16", states: "审核中", sectionName: "TJ-01 合同段" }
  ],
  documents: [
    { id: 1, nodeId: 1, title: "开工报告", type: "建设单位工程资料", createDate: "2026-01-10", fileCount: 3 },
    { id: 2, nodeId: 2, title: "试验检测资料", type: "试验室内部资料", createDate: "2026-02-02", fileCount: 8 }
  ]
};

try {
  Object.assign(db, appStore.load(db));
} catch {
  // Keep bundled demo data if the local runtime store is unavailable.
}

function assignById(rows, key, patches) {
  if (!Array.isArray(rows)) return;
  rows.forEach((row) => {
    const patch = patches[row[key] || row.id];
    if (patch) Object.assign(row, patch);
  });
}

function normalizeDemoText() {
  Object.assign(db.client, {
    clientName: "示范高速改扩建工程",
    deptName: "工程科",
    roleTypeName: "申报数据"
  });
  assignById(db.projects, "projectId", {
    1: {
      projectName: "示范高速改扩建工程",
      shortName: "示范高速",
      owner: "建设单位"
    }
  });
  assignById(db.sections, "sectionId", {
    101: {
      sectionName: "TJ-01 合同段",
      contractor: "第一施工单位",
      supervisor: "第一监理单位"
    },
    102: {
      sectionName: "TJ-02 合同段",
      contractor: "第二施工单位",
      supervisor: "第二监理单位"
    }
  });
  assignById(db.billModels, "modelId", {
    1: { modelName: "公路工程清单范本", modelType: "计量支付", remark: "按工程量清单计价" },
    2: { modelName: "房建工程清单范本", modelType: "建筑工程", remark: "含分部分项、措施项目" }
  });
  assignById(db.materials, "materialId", {
    1: { materialName: "钢筋 HRB400", unit: "t", spec: "HRB400E" },
    2: { materialName: "商品混凝土 C30", unit: "m3", spec: "C30" },
    3: { materialName: "沥青混合料 AC-13", unit: "t", spec: "AC-13" },
    4: { materialName: "本地新增砂砾", unit: "项", spec: "本地新增" }
  });
  assignById(db.bills, "billId", {
    1: { billName: "临时道路", measureUnit: "km" },
    2: { billName: "路基挖方", measureUnit: "m3" },
    3: { billName: "水泥稳定碎石基层", measureUnit: "m2" },
    4: { billName: "现浇箱梁混凝土", measureUnit: "m3" },
    5: { billName: "路基填方", measureUnit: "m3" },
    6: { billName: "钢筋加工安装", measureUnit: "t" },
    7: { billName: "本地新增清单", measureUnit: "项" }
  });
  assignById(db.plans, "planId", {
    1: { planName: "2026 年 TJ-01 总体施工计划", status: "执行中" },
    2: { planName: "2026 年 TJ-02 总体施工计划", status: "执行中" }
  });
  assignById(db.measurePeriods, "gatherId", {
    1: { periodDesc: "第 1 期", gatherState: "已归档" },
    2: { periodDesc: "第 2 期", gatherState: "审核中" }
  });
  assignById(db.measures, "measureId", {
    1: { states: "已归档", position: "临建及路基" },
    2: { states: "审核中", position: "路基及基层" },
    3: { states: "待上报", position: "路基工程" }
  });
  assignById(db.materialAdjustments, "diasId", {
    1: { states: "审核中" },
    2: { states: "待上报" }
  });
  assignById(db.materialArrivals, "arrivalId", {
    1: { states: "已归档" },
    2: { states: "审核中" }
  });
  assignById(db.manualMeasures, "manualId", {
    1: { billName: "现场签证零星工程", measureUnit: "项", states: "审核中", adjustRemark: "" }
  });
  assignById(db.variations, "varyId", {
    1: { billName: "路基挖方", measureUnit: "m3", states: "审核中", varyReason: "地质条件变化" },
    2: { billName: "现浇箱梁混凝土", measureUnit: "m3", states: "待上报", varyReason: "设计优化" }
  });
  assignById(db.contactBills, "contactId", {
    1: { title: "桥梁桩基施工技术联系单", states: "审核中", sectionName: "TJ-01 合同段" }
  });
  assignById(db.documents, "nodeId", {
    1: { title: "开工报告", type: "建设单位工程资料" },
    2: { title: "试验检测资料", type: "试验室内部资料" }
  });
  if (Array.isArray(db.contactBills)) {
    db.contactBills.forEach((item) => {
      item.title = item.title || `工程联系单 ${item.contactId || item.id}`;
      item.contactContent = item.contactContent || item.title;
      item.changeMeetingText = item.changeMeetingText || "现场技术联系记录";
      item.sectionName = item.sectionName || "TJ-01 合同段";
      item.states = item.states || "待上报";
    });
  }
  if (Array.isArray(db.materialArrivals)) {
    db.materialArrivals.forEach((item) => {
      item.measureNo = item.measureNo || `DC-LOCAL-${String(item.arrivalId || item.id).padStart(3, "0")}`;
      item.states = item.states || "待上报";
    });
  }
  if (Array.isArray(db.measurePeriods)) {
    db.measurePeriods.forEach((item) => {
      item.periodDesc = item.periodDesc || `第 ${item.gatherId || item.id} 期`;
      item.gatherState = item.gatherState || "待汇总";
    });
  }
}

normalizeDemoText();

module.exports = db;
