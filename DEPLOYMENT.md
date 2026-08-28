# 网站部署与运维手册

本文档是当前版本的部署基线，适用于 Windows 本地验证和 Ubuntu/Debian 云服务器。简版步骤见 `DEPLOY.md`。

## 交付信息

```text
本机项目：G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone
GitHub：https://github.com/hanxiaochi/test/tree/codex/zwkjy-clone
默认端口：3100
初始账号：ys1 / 000000
运行要求：Node.js >= 22.5
```

收到代码的 AI 或运维人员必须先读本文件，并以实际 `package.json`、`.env` 和服务器数据目录为准。不得用仓库基线数据覆盖服务器运行数据。

## 当前架构

- Node.js + Express 提供前端、业务 API 和管理后台。
- `data/runtime.db` 保存默认租户/项目业务状态和不可变修订。
- `data/security.db` 保存账号、密码摘要、角色、权限、会话、安全审计、计算规则版本，以及审批流程定义、实例修订和事件链。
- `data/attachments.db` 保存附件租户、项目、资料节点、校验和、上传人和删除状态等元数据。
- `data/attachments/` 保存随机对象名的真实附件字节；下载和 ZIP 打包前会重新校验 SHA-256。
- 清单计量导入的 CSV/XLSX 原文件也存入上述附件库，业务库只保存逐行校验结果、来源 SHA-256 和生成计量单的关联信息。
- `data/tenants/` 保存其他租户和项目的隔离业务数据库。
- `data/backups/` 保存应用内创建或导入的项目级业务备份。
- `data/runtime-db.json` 是旧版数据源，仅用于首次非破坏迁移和应急 JSON 回滚。
- `lib/regions/packs/` 与 `config/region-profiles/` 组成地区版本装配流水线；同一模块清单控制前端展示、后端路由、能力和工作流。完整说明见 `REGION_MODULES.md`。

SQLite 是默认模式，不需要 MySQL 或 PostgreSQL。账号、RBAC、租户/项目隔离、审计、规则版本、备份恢复和数据交换后台均已包含在当前版本中。

国际合同设置中的语言、基础币种、合同汇率、币种精度、FIDIC 模板、指数调价规则、合同事件通知期限、保留金和最低证书额按项目生成不可变版本。每次修改必须填写原因；历史版本可重新启用。付款证书计算响应和合同事件通知判断会携带设置版本号、设置结构版本和 SHA-256，便于追溯当时采用的汇率、指数与合同参数。

指数调价采用 FIDIC 兼容公式 `Pn = a + sum(bn * Ln/L0n)`，调价额为 `适用金额 * (Pn - 1)`。`a` 是不调价系数，每个 `bn` 是成本要素权重，`L0n` 是基准指数，`Ln` 是本期指数；`a + sum(bn)` 必须严格等于 `1`，启用规则时至少配置一个成本要素，指数必须大于 `0`。正数自动生成 `priceAdjustment` 增项，负数自动生成 `priceAdjustmentDeduction` 扣项，零值不生成证书行；启用自动公式后不得再手工添加调价行，避免重复计算。

每期试算或签发时，应在“付款证书试算”的“本期指数”JSON 中填写 `eligibleAmount` 和按成本要素代码对应的 `currentIndices`。计算响应的 `priceAdjustment` 会返回公式、适用金额、基准/本期指数、比值、加权值、调价系数、调价额和增减方向；自动证书行带 `generated: true`。`settingsVersion`、`settingsSchemaVersion` 和 `settingsChecksum` 是审计追溯三要素，应与证书结果一起留存。

“签发并留档”会在当前租户和项目的 SQLite 业务状态中保存不可变付款证书台账。每张证书冻结原始计算输入、完整计算结果、合同参数版本、输入 SHA-256、结果 SHA-256 和签发 SHA-256；证书编号不可重复，客户端幂等键可安全重试而不会重复签发。签发后不允许修改或删除，只能填写原因作废；作废保留原签发快照并生成独立作废 SHA-256。签发、重复/冲突请求、作废成功和失败均进入安全审计。

国际合同事件把变更和索赔作为独立 maker-checker 业务处理。提交人申报事件编号、发生日期、通知日期、迟报原因、币种、金额、工期影响和合同条款后，事件进入待审核状态；另一名具备审批权限的用户才能审定或退回。后台可分别配置变更与索赔通知天数、启停期限检查，以及是否强制填写迟报原因。截止日按 UTC 日历日计算，通知日在截止日当天仍为及时，下一天开始标记为逾期；逾期只形成确定性的时效风险和证据记录，不自动否决实体权利，以保留专用条款、弃权和适用法律的人工判断空间。已批准金额可绑定到付款证书行，待审核或已批准证书申请会预占额度，防止重复使用同一审定权益。

待审核事件的原提交人可上传或删除证据附件，审批人和只读用户可在授权项目内查看、下载。批准前服务器会从附件对象库重新读取每个文件并复核大小与 SHA-256；任一对象缺失或损坏都会返回 HTTP `409`，事件状态和工作流修订不会前进。审批成功会冻结规范化证据清单、证据清单 SHA-256 和独立审定 SHA-256，批准后不得补传或删除。旧版 schema v1 事件继续按原校验规则读取，新事件使用 schema v2，升级不会改写历史数据。

有效付款证书按期间形成不可跳改的财务连续链。新一期开始日必须晚于最近一期结束日，基础币种必须一致，“上期保留金”必须等于前序证书的期末保留金，“上期累计签证额”必须等于前序证书的累计签证额；管理页面会自动带入这两个数值，并在台账中保存前序证书 ID 和签发 SHA-256。首次上线迁移历史余额时，可以在第一张有效证书填写“开账余额原因”；期初保留金或累计签证额非零而没有原因会拒绝签发，形成有效前序证书后则禁止再填写开账原因。证书只能按链条倒序作废：存在有效后继的前序证书会返回 HTTP `409`，必须先作废最新一期，再逐期向前处理。

付款证书台账可直接下载 XLSX、PDF 和 DOCX，也可通过 `GET /api/international/certificates/{id}/export?format=all` 下载完整 ZIP。导出前会重新验证输入、结果和签发三层 SHA-256，不会使用当前参数重新计算。XLSX 分为证书信息、计价行、合计、指数调价和完整性工作表；完整 ZIP 的 `manifest.json` 固定证书 ID、签发 SHA-256，并记录每个文件的字节数和 SHA-256。导出成功、非法格式和校验失败都会写入 `international_certificate.export` 安全审计。

已批准合同事件可通过 `GET /api/international/contract_events/{id}/export?format=xlsx|pdf|docx|all` 导出六语言审定单。导出内容包括发生日期、通知截止日、经过天数、及时性、迟报原因、通知参数版本/结构版本/SHA-256、证据数量、证据清单 SHA-256 和规范证据清单；ZIP 的 `manifest.json` 同时固定申报、证据和审定三层校验值，并记录每个生成文件的字节数与 SHA-256。

正式 XLSX、PDF、DOCX 按证书签发时冻结的 `locale` 输出简体中文、英语、西班牙语、法语、巴西葡萄牙语或阿拉伯语；后续修改项目界面语言不会改变旧证书的导出语言。阿拉伯语文件启用 RTL 工作表、段落和 PDF 双栏排版，PDF 使用项目随附的 `assets/fonts/NotoSansArabic-VF.ttf` 嵌入字体，许可文本为 `assets/fonts/OFL-NotoSansArabic.txt`。部署包必须保留这两个文件以及 `assets/fonts/NotoSansSC-VF.ttf`，否则对应语言的 PDF 导出会失败。

国际模块采用独立职责权限：`international:read`、`international:calculate`、`international:submit`、`international:review`、`international:export`、`international:issue`、`international:void`。业务编辑者可试算、提交证书申请和合同事件，并管理本人待审核事件的证据，但不能审批、签发或作废；国际证书审批人可审阅他人申请与事件、签发和作废，但不能审批自己的申请/事件，也没有合同参数后台或其他业务写权限；系统管理员保留全部权限。操作人员使用 `/international/certificates_page`，管理员使用 `/admin/international_settings_page` 维护不可变参数版本。旧菜单兼容地址与标准地址执行相同权限检查，不能通过页面 ID 绕过。

当前 SQLite 部署应保持一个 Node.js 写入实例，不要启用 Node cluster 或同时启动多个 systemd 副本。存储层带版本化乐观并发保护：意外重复实例或外部写入不会静默覆盖数据，陈旧表单会收到 HTTP `409`，服务端会重新加载已提交状态，用户刷新后可重试。需要水平扩展时，应先升级为共享数据库和跨实例事务架构。

## 首次 JSON 到 SQLite 迁移

首次启动时，如果目标 SQLite 库中没有业务状态，程序会读取对应旧 JSON，创建 SQLite 第一个检查点，并保留 JSON 原文件。

迁移规则：

1. 已有 SQLite 状态永远优先，不会被较新、陈旧或损坏的 JSON 覆盖。
2. 每个租户/项目独立判断和迁移。
3. JSON 解析失败时启动失败并保留空 SQLite，不会写入半份业务状态。
4. 不要在迁移后删除旧 JSON；它仍是回滚证据。
5. 仅排障时设置 `APP_STORAGE=json`。该模式没有 SQLite 修订历史，不应长期作为生产模式。

## 必须持久化的数据

更新、迁移、换机和备份时，把以下内容作为一个整体处理：

```text
data/runtime.db
data/runtime.db-wal
data/runtime.db-shm
data/security.db
data/security.db-wal
data/security.db-shm
data/attachments.db
data/attachments.db-wal
data/attachments.db-shm
data/attachments/
data/tenants/
data/backups/
data/runtime-db.json
```

SQLite 正在运行时不能只复制主 `.db` 文件。最稳妥的全量文件备份方式是短暂停服后复制整个 `data/` 目录。应用后台中的“备份恢复管理”可在线导出项目业务状态，但它不能替代账号/权限数据库和全租户文件备份。

应用还提供可验证的在线全系统备份命令。它使用 Node SQLite 官方备份 API 合并已提交 WAL 数据，忽略 `.db-wal`、`.db-shm`、临时文件和可再生的 `exports/`，并把其余 `data/` 内容写入 ZIP。每个文件和清单都有 SHA-256，验包还会执行 ZIP CRC、路径安全、数量/总量和 SQLite `quick_check`：

```bash
cd /opt/zwkjy-clone
npm run backup:system
npm run backup:verify -- data/system-backups/system-时间.zip
```

默认输出到 `data/system-backups/`。必须把该目录同步到独立服务器或对象存储；只留在应用服务器本机不构成灾备。当前工具打包 `APP_DATA_DIR`（默认项目 `data/`）；如将数据库或附件通过环境变量放在该目录之外，仍必须按照“必须持久化的数据”清单额外备份这些外部路径。

管理员后台“备份恢复管理”也可创建、列出、验包和下载全系统备份。同一实例只允许一个全系统备份任务，重复请求返回 HTTP `409`；创建、验包和下载的成功或失败均写入安全审计。后台不提供全系统在线覆盖恢复或自动删除，恢复仍必须执行离线新目录门禁。

全系统备份前会强制巡检附件元数据与对象目录，包括软删除历史：缺失对象、非法类型、大小或 SHA-256 不一致会拒绝备份；未登记孤立对象作为警告保留并继续打包。管理员也可在备份页面单独运行该巡检，结果写入安全审计。

## Windows 本地运行

```powershell
cd G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone
node --version
npm.cmd ci
npm.cmd run test:all
npm.cmd start
```

访问 `http://localhost:3100/`。首次启动后检查：

```powershell
Get-ChildItem .\data\runtime.db*
Get-ChildItem .\data\security.db*
Get-ChildItem .\data\attachments.db*
Get-ChildItem .\data\attachments -Recurse -File
```

应急 JSON 模式只在独立排障窗口使用：

```powershell
$env:APP_STORAGE = "json"
npm.cmd start
Remove-Item Env:APP_STORAGE
```

## Linux 首次部署

安装依赖：

```bash
apt update
apt install -y git curl nginx rsync unzip
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node --version
```

拉取代码：

```bash
mkdir -p /opt/zwkjy-clone
cd /opt/zwkjy-clone
git clone -b codex/zwkjy-clone https://github.com/hanxiaochi/test.git .
npm ci
npm run test:all
```

如果需要带入本机旧 JSON 基线，必须在首次启动前上传：

```powershell
scp G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone\data\runtime-db.json root@服务器IP:/opt/zwkjy-clone/data/runtime-db.json
```

如果迁移的是已经运行过的 SQLite 实例，不要只上传 JSON。先停止源实例，再把完整 `data/` 目录传到服务器，并核对文件数量与 SHA-256。

## systemd 服务

```bash
useradd --system --home-dir /opt/zwkjy-clone --shell /usr/sbin/nologin zwkjy 2>/dev/null || true
install -d -o zwkjy -g zwkjy -m 0750 /opt/zwkjy-clone/data
chown -R zwkjy:zwkjy /opt/zwkjy-clone/data
install -d -o root -g root -m 0700 /etc/zwkjy-clone
cat >/etc/zwkjy-clone/app.env <<'EOF'
NODE_ENV=production
PORT=3100
APP_STORAGE=sqlite
APP_BOOTSTRAP_PASSWORD=请替换为至少10位且含字母数字特殊字符的初始密码
APP_COOKIE_SECURE=true
APP_TRUST_PROXY=true
APP_ATTACHMENT_MAX_BYTES=20971520
APP_MEASURE_IMPORT_MAX_BYTES=10485760
APP_MEASURE_IMPORT_MAX_ROWS=5000
APP_MEASURE_IMPORT_MAX_SHEETS=5
# 国内商业版；国际版可改为 fidic-international-commercial.json
APP_REGION_PROFILE_PATH=/opt/zwkjy-clone/config/region-profiles/cn-mainland-commercial.json
# APP_AMAP_KEY=请在需要地图功能时填写并限制生产域名
# APP_AMAP_SECURITY_CODE=请填写与 Key 配套的安全密钥
EOF
chmod 0600 /etc/zwkjy-clone/app.env

cat >/etc/systemd/system/zwkjy-clone.service <<'EOF'
[Unit]
Description=Engineering Payment Platform
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/zwkjy-clone
EnvironmentFile=/etc/zwkjy-clone/app.env
ExecStart=/usr/bin/node /opt/zwkjy-clone/server.js
Restart=always
RestartSec=3
User=zwkjy
Group=zwkjy
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/zwkjy-clone/data

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now zwkjy-clone
systemctl status zwkjy-clone --no-pager
curl -fsS http://127.0.0.1:3100/api/health
```

上面的初始密码只在目标账号尚不存在时使用；已有账号不会因重启被重置。环境文件仅允许 root 读取，应用进程使用专用 `zwkjy` 账号运行，并且只能写入项目 `data/` 和 systemd 提供的私有临时目录。不要把真实密码提交到 Git。

## Nginx

```bash
cat >/etc/nginx/sites-available/zwkjy-clone <<'EOF'
server {
    listen 80;
    server_name _;
    client_max_body_size 21m;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/zwkjy-clone /etc/nginx/sites-enabled/zwkjy-clone
nginx -t
systemctl reload nginx
```

80 端口配置只用于域名解析和证书签发前的连通性检查。`APP_COOKIE_SECURE=true` 时浏览器登录必须使用 HTTPS；正式商用必须配置域名和 TLS 证书，只向公网开放 `80/443`，不要开放 `3100`。临时内网 HTTP 验收可将该变量改为 `false` 并重启，但上线前必须恢复。

## 更新部署

先停服并备份，再更新代码。不要执行会覆盖或清理 `data/` 的命令。

```bash
cd /opt/zwkjy-clone
systemctl stop zwkjy-clone
STAMP=$(date +%F-%H%M%S)
mkdir -p "/var/backups/zwkjy-clone/$STAMP"
cp -a data "/var/backups/zwkjy-clone/$STAMP/"
git pull --ff-only
npm ci
npm run test:all
systemctl start zwkjy-clone
npm run verify:external
```

任何一步失败都不要覆盖备份。保留失败现场、日志和当前 `data/`，查明原因后再决定回滚。

## 部署验收

负载均衡、容器或 systemd 的存活探针使用 `GET /api/health`；接流量前的就绪探针使用 `GET /api/ready`。后者会只读校验当前运行态数据库的校验和与 JSON 载荷、待决审批事务，以及安全、规则、审批和附件 SQLite 库的 `quick_check`。返回 HTTP `503` 时必须摘除实例并排查，不能只因首页可打开就继续提供写入服务。响应只包含检查名称和错误代码，不暴露数据库路径。

命令门禁：

```bash
npm run test:all
npm audit
npm run verify:region-ownership
npm run release:verify -- /path/to/zwkjy-clone-提交号.zip
curl -fsS http://127.0.0.1:3100/api/health
```

正式发布包必须由 `npm run release:build` 生成并通过 `release:verify`。ZIP 清单逐文件验签，并拒绝数据库、账号库、附件、备份、日志、环境变量文件和临时目录；解压验证应使用全新的目录，执行 `npm ci` 和 `npm run test:all`，不能只在开发工作区验收。

仓库内的 `.github/workflows/quality-gate.yml` 会在每次推送、Pull Request 和人工触发时，使用 Node.js 24 执行 `npm ci` 与同一套 `npm run test:all`。合并或部署前必须同时满足本地门禁和 GitHub Actions `Quality Gate` 成功；CI 失败时不得只凭本地一次通过继续发布。

`sample:regression` 支持两种可审计输入。存在 `SAMPLE_REGRESSION_ROOT/p13` 与 `p14` 时，它使用 `CODEX_PYTHON`（非 Windows 默认 `python3`）和 `pdfplumber` 从原始 PDF 实时抽取；干净克隆没有这两个目录时，使用已纳入 Git 版本管理的 `test-data/sample-regression-extracted.json`。只存在一个期次目录时会直接失败，避免把不完整 PDF 输入静默替换成基准数据。测试报告中的 `sampleInputMode` 会明确记录本次采用 `pdf` 还是 `committed-extraction`。

`npm audit` 依赖 npm 官方在线审计接口。若命令因 TLS、超时或接口不可用而失败，应记录为“依赖审计未完成”并重试，不能写成“未发现漏洞”；只有命令正常返回且报告为零时，才能作为依赖安全通过证据。

人工门禁：

1. 登录、退出、错误密码和会话失效正常。
2. 项目切换后数据互相隔离。
3. 代表性清单、材料到场、手动计量和支付证书表单可保存并重开。
4. 计算规则必须填写变更原因，历史版本可查看和重新启用。
5. 用户/RBAC、审计、备份恢复、数据交换、国际设置和审批流程配置页面正常。
6. 工程资料可上传允许类型的真实文件；列表、单文件下载和资料 ZIP 字节一致，只读用户不能上传或删除。
7. 清单计量导入可下载模板并真实上传 CSV/XLSX；错误行可下载报告，重复上传/导入不重复生成计量单，源文件下载字节和 SHA-256 一致。
8. 主计量支付报表可下载真实 XLSX、PDF、DOCX 和三格式 ZIP；XLSX/DOCX 必须能作为 OOXML 打开，PDF 必须以 `%PDF-` 开头，不能用 CSV/HTML 改扩展名代替。
9. 报表生成和下载成功/失败记录进入安全审计；只读用户只能导出已授权项目。
10. 重启服务后业务数据、账号、规则版本、审计和附件仍存在。
11. 执行第 12/13/14 期 fixture 回归，结果与基准一致。
12. 在流程工作台新建草稿并依次提交、审核、退回；旧修订号必须返回 HTTP `409`，退回未填写意见必须失败，事件链操作者必须是当前登录账号。
13. 旧模块页面的批量上报/确认必须整批成功或整批回滚；空选择必须返回 `WORKFLOW_SELECTION_REQUIRED`，删除后复用的显示 ID 不得继承旧流程实例。
14. 模拟业务库已写入但审批库提交失败后重启服务，系统必须恢复原业务行并清除待决事务；若审批已提交，则只清除待决标记并保留审批结果。
15. 打开“审批一致性巡检”，当前租户/项目不得存在错误；已删除业务保留的审批实例只能列为审计信息，不能误报为数据故障。

## 完整恢复

恢复前先保留故障现场，不要直接覆盖：

```bash
cd /opt/zwkjy-clone
systemctl stop zwkjy-clone
mv data "data.failed-$(date +%F-%H%M%S)"
cp -a /var/backups/zwkjy-clone/备份时间/data ./data
systemctl start zwkjy-clone
curl -fsS http://127.0.0.1:3100/api/health
```

恢复后必须重新执行计算回归和关键页面验收。若只需要恢复单个项目业务状态，优先使用管理后台的校验备份恢复功能。

也可以先把系统 ZIP 恢复到一个不存在的新目录进行离线检查。工具拒绝已有目标，绝不会覆盖当前 `data/`；成功后再由运维停服并人工切换目录：

```bash
npm run backup:verify -- /var/backups/zwkjy-clone/system-时间.zip
npm run backup:restore-new -- /var/backups/zwkjy-clone/system-时间.zip /var/tmp/zwkjy-restore-check
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/var/tmp/zwkjy-restore-check/data/runtime.db',{readOnly:true});console.log(db.prepare('PRAGMA quick_check').all());db.close()"
```

恢复命令失败时会保留唯一的 `.restoring-UUID` 暂存目录用于调查，不会把半恢复目录改名成目标。确认新目录完整前，不要移动、覆盖或删除原生产 `data/`。

## 常用环境变量

```text
PORT                    HTTP 端口，默认 3100
APP_STORAGE             sqlite（默认）或 json（应急回滚）
APP_DATA_DIR            统一持久化数据根目录，默认项目 data/；容器和测试环境应显式隔离
APP_RUNTIME_DB_PATH     旧 JSON 路径
APP_SQLITE_DB_PATH      默认业务 SQLite 路径
APP_SECURITY_DB_PATH    账号、权限和审计 SQLite 路径
APP_RULE_DB_PATH        规则版本库路径，默认复用 security.db
APP_WORKFLOW_DB_PATH    审批定义、实例和事件库路径，默认复用 security.db
APP_BACKUP_DIR          应用内项目备份目录
APP_ATTACHMENT_DB_PATH  附件元数据 SQLite 路径，默认 data/attachments.db
APP_ATTACHMENT_DIR      附件对象目录，默认 data/attachments
APP_ATTACHMENT_MAX_BYTES 单文件上限字节数，默认 20971520（20 MiB）
APP_MEASURE_IMPORT_MAX_BYTES 计量导入文件上限，默认 10485760（10 MiB），且不能超过附件上限
APP_MEASURE_IMPORT_MAX_ROWS  每个计量导入文件最大有效数据行数，默认 5000
APP_MEASURE_IMPORT_MAX_SHEETS XLSX 最大工作表数量，默认 5
APP_SHUTDOWN_TIMEOUT_MS 优雅停机等待毫秒数，默认 5000
APP_LOGIN_MAX_ATTEMPTS  同一IP、租户和账号在窗口内的失败上限，默认 10
APP_LOGIN_WINDOW_MS     登录失败计数窗口毫秒数，默认 900000
APP_LOGIN_MAX_ENTRIES   安全库中登录限流身份摘要上限，默认 10000
APP_TRUST_PROXY         仅在可信反向代理后配置；单层 Nginx 可设 true
APP_COOKIE_SECURE       HTTPS 生产环境必须设 true，为会话 Cookie 添加 Secure
APP_BOOTSTRAP_ACCOUNT   首次初始化管理员账号，默认 ys1
APP_BOOTSTRAP_PASSWORD  首次初始化管理员密码；生产环境必须满足强密码策略
APP_AMAP_KEY             可选；高德地图浏览器 Key，必须配置域名白名单
APP_AMAP_SECURITY_CODE   可选；与高德地图 Key 配套的安全密钥
```

修改路径后必须同步调整 systemd 权限、全量备份范围和监控规则。不要在应用直接暴露公网时启用 `APP_TRUST_PROXY`，否则攻击者可能伪造来源地址绕过登录限流。

Nginx 的 `client_max_body_size` 必须略大于 `APP_ATTACHMENT_MAX_BYTES` 以容纳 multipart 边界开销。应用只接受 PDF、Word、Excel、CSV、TXT、JPEG、PNG 和 ZIP，并同时检查扩展名、MIME、文件签名、大小和 SHA-256。后台“备份恢复管理”只覆盖项目业务状态，不包含附件对象；完整灾备必须停服复制整个 `data/` 目录。

计量导入仅接受 UTF-8 CSV 和无宏 `.xlsx`。公式、宏、外部链接、未知清单、重复清单、非正数工程量、异常合同段/工期以及超限文件都会被拒绝或标为逐行错误，系统不会替换清单或补造默认工程量。完整验收使用 `npm ci && npm run test:all`；验收完成后的纯运行镜像可执行 `npm prune --omit=dev`，但此后要重新运行全套测试必须先恢复开发依赖。

首次初始化的管理员会被强制进入密码修改页。新密码至少 10 位，并同时包含字母、数字和特殊字符；修改成功后全部已有会话会立即失效，必须使用新密码重新登录。

服务会校验浏览器写请求的 `Origin`、`Referer` 和 `Sec-Fetch-Site`，拒绝跨站提交。Nginx 必须保留原始 `Host`（推荐 `proxy_set_header Host $host`）；命令行和服务器间 API 客户端未发送浏览器来源头时不受影响。

用户可从右上角账号菜单主动修改密码。管理员可在账号权限管理中设置临时强密码；重置会撤销目标用户全部会话，并强制其下次登录再次修改密码，临时密码不会出现在审计详情中。

当 `NODE_ENV=production` 且目标管理员尚不存在时，弱初始密码会导致服务拒绝启动；这可防止全新公网实例意外使用默认 `000000`。已有数据库中的账号和密码不会被启动配置覆盖。

登录失败计数保存在安全 SQLite 数据库中，服务重启后不会清零。限流表只保存 IP、租户和账号组合的 SHA-256 摘要，并按 `APP_LOGIN_WINDOW_MS` 自动过期、按 `APP_LOGIN_MAX_ENTRIES` 限制容量。

账号权限后台支持按动作、结果、对象、用户、时间和关键词筛选安全审计，并可导出当前租户最多 10000 条匹配记录。审计清理必须由具备账号管理权限的管理员主动确认，保留期限制为 30–3650 天；删除动作本身会写入新的保留策略审计记录。

地图能力默认关闭。只有同时设置 `APP_AMAP_KEY` 与 `APP_AMAP_SECURITY_CODE` 时，已登录页面才会动态加载高德 SDK；凭据不得提交到 Git，并应在高德控制台限制允许访问的生产域名。
