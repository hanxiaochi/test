# 工程计量支付自动计算与报表生成系统

这是可本地或云端部署的工程计量支付与成本控制平台，包含前端页面、Node.js 后端、SQLite 持久化、账号与 RBAC、租户/项目隔离、审计、计算与审批规则版本管理、备份恢复、数据交换和工程造价计算逻辑。

## 运行方式

```bash
npm install
npm start
```

要求 Node.js 22.5 或更高版本。业务数据默认保存在 `data/runtime.db`，账号、权限、审计和规则版本默认保存在 `data/security.db`，真实附件元数据和文件分别保存在 `data/attachments.db` 与 `data/attachments/`。

默认地址：

```text
http://localhost:3100
```

默认开发账号（仅限本机首次体验，生产模式会拒绝弱初始密码）：

```text
ys1 / 000000
```

## 地区模块装配

系统由 `core-platform`、`cn-mainland` 和 `fidic-international` 模块装配。默认配置保留全部功能；国内版和国际版预置配置会使用同一注册表同步裁剪前端菜单/页面、后端路由、业务能力与审批工作流，关闭模块不能通过直接 URL 绕过。

地区版本的配置、部署方式和新增客户模块流水线见 `REGION_MODULES.md`。

## 验证

在 Windows PowerShell 中建议使用：

```bash
npm.cmd run verify
npm.cmd run verify:region-profile
npm.cmd run verify:security-baseline
npm.cmd run verify:commercial-security
```

验证内容包括：运行健康检查、接口契约、页面动作接口、静态资源、核心造价公式、清单/变更/材料补差/手动计量闭环、材料到场/联系单/资料/工期闭环、流程定义版本/权限/并发冲突/处理记录闭环和中文数据质量。

安全控制按照等保2.0二级常见技术基线和商业 Web 软件常见攻击面实现，包括密码历史与有效期、账号锁定、闲置会话、RBAC、自定义角色、管理员重置密码、安全审计、外网弱口令拒绝启动、静态资源白名单、请求体限制和基线报告。详细边界见 `SECURITY_BASELINE.md`；产品自检不等同于测评机构认证，也不代表不存在未知漏洞。

## 已实现范围

- 登录、退出、当前用户信息、菜单、面包屑和工作台汇总。
- 清单模板、材料、合同概况、工程计划、清单管理。
- 清单计量、材料补差计量、材料到场计量、手动计量。
- 变更申请、变更明细、变更会议、变更计量支付台账。
- 多项目/标段查询、计量台账、支付报表、各级审核金额台账。
- 工程资料、试验资料、质检资料、资料挂接和资料 ZIP 导出。
- 八类业务的版本化审批流程（含国际证书申请与国际合同事件）、批量原子提交、跨库故障补偿与重启恢复、不可复用实例标识、状态跳转权限、处理意见、乐观并发控制、完整事件链和流程工作台。
- 管理员只读审批一致性巡检，核对业务状态、审批实例、事件修订、重复实例键和待决事务，并保留已删除业务的审计历史。
- 报表预览、真实 XLSX/PDF/DOCX 与三格式 ZIP 导出、工程资料真实附件上传/校验/下载/ZIP 打包，以及带逐行错误、来源哈希和幂等提交的真实 CSV/XLSX 清单计量导入。
- 国际合同事件的变更/索赔申报、独立审批、金额与工期审定、付款证书额度占用，以及项目隔离的证据附件。项目可分别配置变更和索赔通知期限；系统按 UTC 日历日确定截止日与及时/逾期风险，迟报按配置要求填写原因但不会被自动否决，并冻结所用参数版本与 SHA-256。审批时会逐文件复核 SHA-256，冻结规范证据清单与证据清单 SHA-256；批准后证据不可增删。

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

部署和更新前应完整备份 `data/runtime.db*`、`data/security.db*`、`data/attachments.db*`、`data/attachments/`、`data/tenants/`、`data/backups/` 和旧 JSON 文件。不要通过删除数据库来“恢复初始数据”。

在线创建带逐文件校验和及 SQLite 一致快照的全系统备份：

```bash
npm run backup:system
npm run backup:verify -- data/system-backups/备份文件.zip
```

恢复命令只允许写入不存在的新目录，不会覆盖当前 `data/`：

```bash
npm run backup:restore-new -- data/system-backups/备份文件.zip /tmp/zwkjy-restore-check
```
