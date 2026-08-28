# 地区模块与版本装配手册

## 设计目标

系统采用“平台核心 + 地区业务包 + 部署配置”的装配方式。同一份地区模块注册表同时控制：

- 前端顶级菜单、左侧菜单和可访问页面。
- 后端页面地址、业务 API 和旧页面 ID。
- 可用业务能力与审批工作流类型。
- 客户端模块清单、版本和 SHA-256 校验和。

不能只隐藏前端菜单。关闭的模块在直接访问 URL 或调用 API 时也必须返回 HTTP `404` 和 `REGION_PACK_DISABLED`。

## 内置模块

| 模块 | 代码 | 责任 |
| --- | --- | --- |
| 平台基础能力 | `core-platform` | 登录、账号、RBAC、租户/项目隔离、审计、备份、通用工作流和数据交换 |
| 中国大陆工程计量 | `cn-mainland` | 国内清单、计量支付、材料、变更、JL 报表、工程资料、国内计算规则和国内导航资产 |
| FIDIC 国际合同 | `fidic-international` | 多语言、多币种、FIDIC 付款证书、合同事件和通知期限 |

模块定义位于 `lib/regions/packs/`，注册和校验逻辑位于 `lib/regions/pack-registry.js`。默认配置 `config/region-profile.json` 保留全部现有功能。

## 预置客户版本

```text
config/region-profile.json                                  全功能开发/兼容版
config/region-profiles/cn-mainland-commercial.json          国内商业版
config/region-profiles/fidic-international-commercial.json  国际商业版
```

Windows 启动国内商业版：

```powershell
$env:APP_REGION_PROFILE_PATH = "G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone\config\region-profiles\cn-mainland-commercial.json"
npm.cmd start
```

Linux `systemd` 环境文件示例：

```text
APP_REGION_PROFILE_PATH=/opt/zwkjy-clone/config/region-profiles/cn-mainland-commercial.json
```

也可以临时使用 `APP_REGION_PACKS=core-platform,cn-mainland` 覆盖配置，但正式交付必须使用受版本控制的配置文件，便于审计和重建。

## 客户端装配清单

登录后通过以下接口读取当前版本：

```text
GET /api/client/modules
```

响应包含 `profileId`、模块顺序、模块版本、能力、前端页面和 64 位 SHA-256。`/user/curr_user_info` 与 `/api/session/projects` 返回同一份清单。页面清单会继续按当前用户权限过滤，但部署校验和不随用户变化。

## 新地区包流水线

1. 在 `lib/regions/packs/` 新建地区包，声明唯一 ID、语义化版本、依赖、能力、前端菜单/页面、后端路由和审批工作流类型。
   地区专属 HTML 页面放在包内 `pages/`，并通过 `runtime.pages` 声明 `route`、`method`（仅允许 `get` 或 `all`）和 `render` 函数；不要在 `server.js` 重复注册同一路由。
2. 把地区包加入 `BUILTIN_PACKS`，并在 `config/region-profiles/` 新建客户版本配置。
3. 地区专属计算、表单、翻译、导入导出和报表必须由该包拥有；平台核心不得依赖地区包。
4. 为开启和关闭两种状态增加白盒及隔离 HTTP 测试，验证菜单、旧页面 ID、直接页面 URL、API 和工作流同时切换。
5. 执行 `npm.cmd run test:region-packs`、`npm.cmd run verify:region-profile` 和 `npm.cmd run test:all`。
6. 记录 `/api/client/modules` 的 `profileId` 与 `checksum`，再构建和部署客户版本。

未知模块、缺少依赖、重复资源 ID、非法路由、重复能力或损坏配置都会导致服务启动失败，不会自动回退到全功能版。

## 变更规则

- 已投入使用的包不得直接改变历史计算含义；规则变化应创建新规则版本或提升包版本。
- 模块顺序是部署配置的一部分，不能在不同服务器上人工调整。
- 模块只决定产品能力，不替代 RBAC。模块开启后，用户仍需具备对应权限。
- 不允许通过删除数据表或清空数据库切换地区。切换前必须备份，并在测试环境验证数据兼容性。
- 客户定制优先新增独立包或配置，不在共享核心中加入客户名称和一次性条件分支。

## 当前迁移边界

当前版本已经完成统一注册、前端菜单/页面暴露、后端路由阻断和能力选择。后台菜单的双语名称、图标、URL、稳定顺序以及国内/国际审批工作流类型已经迁入各自地区包，由注册表装配为旧 Layui 前端所需结构；中国大陆四组主菜单及左侧导航资产位于 `lib/regions/packs/cn-mainland/navigation/`，核心不再读取 `data/api_menu_utf8.json` 或 `data/api_left_*.json`，`server.js` 也不再维护地区菜单 ID、文件名和子页数量。国内造价计算器已迁入 `lib/regions/packs/cn-mainland/pages/`，由地区包运行时注册表挂载；非法方法、缺失渲染器、重复路由或路由归属错误都会阻止启动，公开清单只记录稳定的路由和方法，不序列化函数。原有大型 `server.js` 中的其余具体页面渲染函数仍将逐步迁移到包自有目录；迁移期间注册表是唯一对外暴露边界，每次搬迁必须保持接口和计算回归不变。
