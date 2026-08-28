"use strict";

module.exports = Object.freeze({
  id: "cn-mainland",
  version: "1.1.0",
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
    menuItems: [
      {
        resourceId: 9001,
        parentId: 9000,
        order: 30,
        resourceCode: "990001",
        name: { "zh-CN": "计算规则管理", "en-US": "Calculation Rules" },
        description: { "zh-CN": "中国大陆工程计量与支付计算规则", "en-US": "China mainland measurement and payment rules" },
        resourceUrl: "",
        menuIcon: "layui-icon layui-icon-set",
        resourceNo: "root",
        children: [
          {
            resourceId: 9002, parentId: 9001, order: 10, resourceCode: "99000101",
            name: { "zh-CN": "计算规则后台", "en-US": "Rule Versions" },
            description: { "zh-CN": "修改计量支付公式、小数位和审核比例", "en-US": "Version formulas, precision and review ratios" },
            resourceUrl: "admin/calculation_rules_page", menuIcon: "layui-icon layui-icon-form", resourceNo: "model"
          },
          {
            resourceId: 9004, parentId: 9001, order: 20, resourceCode: "99000102",
            name: { "zh-CN": "JL计量支付报表", "en-US": "JL Payment Reports" },
            description: { "zh-CN": "按JL104、JL105和JL113核对计量支付报表", "en-US": "Reconcile JL104, JL105 and JL113 payment reports" },
            resourceUrl: "payment/jl_report_page", menuIcon: "layui-icon layui-icon-template-1", resourceNo: "model"
          }
        ]
      }
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
    ],
    workflowModules: ["billmeasure", "meterialdiasmeasure", "meterialinmeasure", "manualmeasure", "varyapplication", "engineeringcontactbill"]
  }
});
