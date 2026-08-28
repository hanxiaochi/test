"use strict";

module.exports = Object.freeze({
  id: "cn-mainland",
  version: "1.0.0",
  displayName: { "zh-CN": "中国大陆工程计量", "en-US": "China Mainland Measurement" },
  dependencies: ["core-platform"],
  capabilities: ["cn-measurement", "cn-payment", "cn-variation", "cn-project-documents", "jl-reports"],
  frontend: {
    topMenuIds: [2, 3, 7, 409],
    resourceIds: [
      28, 29, 31, 39, 40, 41, 42, 44, 46, 47, 48, 49, 50, 60, 63, 64, 65, 68, 69,
      359, 355, 368, 369, 370, 371, 376, 377, 378, 410, 411, 568, 600, 640, 641,
      642, 670, 671, 672, 673, 688, 690, 691, 692, 693, 694, 695, 696, 697, 698,
      699, 700, 6998, 9001, 9002, 9004
    ],
    pages: [
      { id: "cn-jl-report", titleKey: "modules.cn.jlReport", href: "/payment/jl_report_page", permission: "business:read" }
    ]
  },
  backend: {
    exactRoutes: [
      "/delete_node", "/edit_model_page", "/edit_node", "/edit_page", "/editindex_information",
      "/extend_gather", "/import_model", "/import_sec_bill", "/save_sec_bill_page"
    ],
    routePrefixes: [
      "/api/cost", "/api/local", "/api/payment", "/api/admin/calculation_rules",
      "/bigVaryQuery", "/billAnalyze", "/billAnalyzeNode", "/billModel", "/bill_collect",
      "/bill_measure", "/busineInfo", "/contract_survey", "/costBase", "/dataGather",
      "/engineering_contact_bill", "/file_upload", "/import_measure", "/leaderquery",
      "/manualMeasure", "/manual_model", "/measure_data", "/meterialInMeasure",
      "/meterialdiasmeasure", "/mtilProjectQuer", "/oaDataNode", "/page_office", "/payment",
      "/projectInformationNode", "/projectInformationParam", "/project_information_hang_file",
      "/reportManager", "/secBill", "/secMateria", "/secProjectPlan", "/sysGather",
      "/sys_project", "/syzl", "/varyMeasurePay", "/vary_detail", "/vary_measure",
      "/vary_meeting", "/admin/calculation_rules_page", "/system/calculation_rules_page"
    ]
  }
});
