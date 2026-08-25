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
- `data/security.db` 保存账号、密码摘要、角色、权限、会话、安全审计和计算规则版本。
- `data/attachments.db` 保存附件租户、项目、资料节点、校验和、上传人和删除状态等元数据。
- `data/attachments/` 保存随机对象名的真实附件字节；下载和 ZIP 打包前会重新校验 SHA-256。
- 清单计量导入的 CSV/XLSX 原文件也存入上述附件库，业务库只保存逐行校验结果、来源 SHA-256 和生成计量单的关联信息。
- `data/tenants/` 保存其他租户和项目的隔离业务数据库。
- `data/backups/` 保存应用内创建或导入的项目级业务备份。
- `data/runtime-db.json` 是旧版数据源，仅用于首次非破坏迁移和应急 JSON 回滚。

SQLite 是默认模式，不需要 MySQL 或 PostgreSQL。账号、RBAC、租户/项目隔离、审计、规则版本、备份恢复和数据交换后台均已包含在当前版本中。

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

命令门禁：

```bash
npm run test:all
npm audit
curl -fsS http://127.0.0.1:3100/api/health
```

人工门禁：

1. 登录、退出、错误密码和会话失效正常。
2. 项目切换后数据互相隔离。
3. 代表性清单、材料到场、手动计量和支付证书表单可保存并重开。
4. 计算规则必须填写变更原因，历史版本可查看和重新启用。
5. 用户/RBAC、审计、备份恢复、数据交换和国际设置页面正常。
6. 工程资料可上传允许类型的真实文件；列表、单文件下载和资料 ZIP 字节一致，只读用户不能上传或删除。
7. 清单计量导入可下载模板并真实上传 CSV/XLSX；错误行可下载报告，重复上传/导入不重复生成计量单，源文件下载字节和 SHA-256 一致。
8. 重启服务后业务数据、账号、规则版本、审计和附件仍存在。
9. 执行第 12/13/14 期 fixture 回归，结果与基准一致。

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

## 常用环境变量

```text
PORT                    HTTP 端口，默认 3100
APP_STORAGE             sqlite（默认）或 json（应急回滚）
APP_RUNTIME_DB_PATH     旧 JSON 路径
APP_SQLITE_DB_PATH      默认业务 SQLite 路径
APP_SECURITY_DB_PATH    账号、权限和审计 SQLite 路径
APP_RULE_DB_PATH        规则版本库路径，默认复用 security.db
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
