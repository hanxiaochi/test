# 工程计量支付自动计算与报表生成系统

这是可本地或云端部署的工程计量支付与成本控制平台，包含前端页面、Node.js 后端、SQLite 持久化、账号与 RBAC、租户/项目隔离、审计、规则版本管理、备份恢复、数据交换和工程造价计算逻辑。

## 运行方式

```bash
npm install
npm start
```

要求 Node.js 22.5 或更高版本。业务数据默认保存在 `data/runtime.db`，账号、权限、审计和规则版本默认保存在 `data/security.db`。

默认地址：

```text
http://localhost:3100
```

默认账号：

```text
ys1 / 000000
```

## 验证

在 Windows PowerShell 中建议使用：

```bash
npm.cmd run verify
```

验证内容包括：运行健康检查、接口契约、页面动作接口、静态资源、核心造价公式、清单/变更/材料补差/手动计量闭环、材料到场/联系单/资料/工期闭环、流程状态与处理记录闭环和中文数据质量。

## 已实现范围

- 登录、退出、当前用户信息、菜单、面包屑和工作台汇总。
- 清单模板、材料、合同概况、工程计划、清单管理。
- 清单计量、材料补差计量、材料到场计量、手动计量。
- 变更申请、变更明细、变更会议、变更计量支付台账。
- 多项目/标段查询、计量台账、支付报表、各级审核金额台账。
- 工程资料、试验资料、质检资料、资料挂接和资料 ZIP 导出。
- 流程上报、审核、归档、退回、撤回和流程记录展示。
- 报表预览、CSV/Excel 类导出、附件下载和导入模拟。

## 核心计算

核心造价逻辑位于 `costEngine.js`：

- 合同金额：合同数量 * 合同单价
- 修正金额：修正数量 * 合同单价
- 变更金额：变更后金额 - 变更前金额
- 最终金额：修正金额 + 变更金额
- 已计量金额：累计计量数量 * 清单单价
- 材料补差：补差数量 * (当前价 - 基准价)
- 手动计量：计量数量 * 单价
- 应付金额：已计量金额 + 材料补差 + 手动计量
- 支付比例：应付金额 / 最终金额

## 常用接口

```text
GET  /api/cost/summary
GET  /api/cost/bills
GET  /api/cost/measures
GET  /api/cost/ledger
POST /api/cost/calculate
```

计算示例：

```json
{
  "bills": [{ "quantity": 100, "price": 20 }],
  "variations": [{ "beforeNum": 100, "beforePrice": 20, "afterNum": 120, "afterPrice": 20 }],
  "materialAdjustments": [{ "quantity": 10, "basePrice": 100, "currentPrice": 120 }],
  "manualMeasures": [{ "quantity": 1, "price": 500 }]
}
```

## 数据迁移与回滚

首次启动且 SQLite 为空时，程序会把旧 `data/runtime-db.json` 非破坏迁移到 `data/runtime.db`；已有 SQLite 状态始终优先，不会被 JSON 重复覆盖。旧 JSON 应继续保留。仅在应急排障时可设置 `APP_STORAGE=json` 回到旧存储模式。

部署和更新前应完整备份 `data/runtime.db*`、`data/security.db*`、`data/tenants/`、`data/backups/` 和旧 JSON 文件。不要通过删除数据库来“恢复初始数据”。
