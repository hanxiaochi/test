# 部署文档

本文档用于把 `app-local-clone` 部署到 Linux 云服务器。项目是 Node.js + Express 应用，默认监听 `3100` 端口，也可以通过 `PORT` 环境变量修改。

## 代码位置

本机代码目录：

```text
G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone
```

GitHub 分支：

```text
https://github.com/hanxiaochi/test/tree/codex/zwkjy-clone
```

草稿 PR：

```text
https://github.com/hanxiaochi/test/pull/1
```

## 交给其他 AI 或协作者部署时

如果把部署任务交给 MiniMax、其他 AI 或运维协作者，可以直接让对方先读本节。

```text
项目 GitHub：
https://github.com/hanxiaochi/test/tree/codex/zwkjy-clone

主要部署文档：
DEPLOYMENT.md

本机项目路径：
G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone

默认账号：
ys1 / 000000

云服务器建议部署目录：
/opt/zwkjy-clone

默认服务端口：
3100
```

关键提醒：

```text
1. 默认业务数据库是 data/runtime.db；账号、权限、审计和规则版本保存在 data/security.db；附件元数据和真实文件保存在 data/attachments.db 与 data/attachments/。
2. 首次启动会把旧 data/runtime-db.json 非破坏迁移到 SQLite，旧 JSON 会原样保留，不能删除或覆盖。
3. CALCULATION_USAGE.md 是本机计算使用文档，不上传 GitHub；部署网站本身不依赖它。
4. PAYMENT_REGRESSION_TEST_DATA.md 和 test-data/payment-regression-12-14.json 是给其他 AI/协作者验收用的三组非 PDF 测试数据。
5. 当前版本已经包含账号、RBAC、租户/项目隔离、审计、规则版本、备份恢复和数据交换后台。
6. 每次更新代码前，停服完整备份整个 data/，其中必须包含 data/attachments.db* 和 data/attachments/。
```

## 数据持久化与首次迁移

默认存储模式是 SQLite：

```text
data/runtime.db                 默认租户/项目业务数据和不可变修订
data/security.db                账号、角色、会话、安全审计和计算规则版本
data/attachments.db             附件租户/项目范围、校验和和删除状态
data/attachments/               真实附件对象字节
data/tenants/.../*.db           其他租户/项目隔离业务数据库
data/runtime-db.json            旧版 JSON 数据源，仅用于首次迁移和应急回滚
```

首次以默认配置启动时，如果对应 SQLite 库尚无业务状态，程序会读取旧 JSON 并创建 SQLite 第一个检查点。SQLite 一旦已有状态，后续启动不再重新导入 JSON；即使旧 JSON 比较新或已损坏，也不会覆盖已有 SQLite 数据。迁移不会修改或删除 JSON 源文件。

应急回滚到旧 JSON 模式时显式设置 `APP_STORAGE=json`。回滚模式不使用 SQLite 修订历史，只用于排障；确认问题后应回到默认 `sqlite`。

SQLite 版本按单个 Node.js 写入实例部署，不要启用 cluster 或同时运行多个服务副本。意外并发写入会返回 HTTP `409` 并重新加载已提交数据，刷新页面后再重试，避免静默覆盖。

服务器备份命令：

```bash
cd /opt/zwkjy-clone
systemctl stop zwkjy-clone
STAMP=$(date +%F-%H%M%S)
mkdir -p "/var/backups/zwkjy-clone/$STAMP"
cp -a data "/var/backups/zwkjy-clone/$STAMP/"
systemctl start zwkjy-clone
```

## 服务器网络先决条件

如果本机 SSH 连接超时，请先检查云服务器控制台和系统防火墙：

1. 云服务器安全组放行 TCP `22`。
2. 如果要直接访问 `http://服务器IP:3100`，安全组也放行 TCP `3100`。
3. 如果使用 Nginx 反向代理，安全组放行 TCP `80`。
4. 服务器内防火墙放行对应端口。

在 Windows 本机测试 SSH：

```powershell
Test-NetConnection -ComputerName 服务器IP -Port 22
```

如果 `TcpTestSucceeded` 不是 `True`，优先处理安全组、防火墙、服务器是否开机、公网 IP 是否正确。

## 方式一：从 GitHub 拉取部署

登录服务器：

```bash
ssh root@服务器IP
```

安装基础软件。Ubuntu/Debian：

```bash
apt update
apt install -y git curl nginx unzip rsync
```

安装 Node.js 22 LTS（最低要求 22.5，项目使用内置 `node:sqlite`）：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
npm -v
```

创建目录并拉取代码：

```bash
mkdir -p /opt/zwkjy-clone
cd /opt/zwkjy-clone
git clone -b codex/zwkjy-clone https://github.com/hanxiaochi/test.git .
```

如果要让全新云端从本机旧 JSON 基线首次迁移，可在第一次启动前上传：

```powershell
cd G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone
scp .\data\runtime-db.json root@服务器IP:/opt/zwkjy-clone/data/runtime-db.json
```

JSON 是迁移源，不再对它设置 Git `skip-worktree`。正式运行后应以完整 `data/` 持久化文件集为准，并在更新前执行上面的完整备份。

安装依赖并验证：

```bash
npm ci
npm run verify
```

## 方式二：本地打包上传部署

在 Windows 本机项目目录执行：

```powershell
cd G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone
npm.cmd run release:build
npm.cmd run release:verify -- releases\zwkjy-clone-提交号.zip
git archive --format=zip --output zwkjy-clone.zip HEAD
scp .\zwkjy-clone.zip root@服务器IP:/opt/
```

推荐上传 `release:build` 生成的 ZIP。其 `RELEASE-MANIFEST.json` 记录源码提交、逐文件 SHA-256、文件数量和总字节数；构建器只读取 Git 已跟踪文件，发现数据库、账号库、附件、备份、日志、`.env`、`node_modules` 或临时目录会直接失败。`git archive` 可作为不带清单的兼容方案，同样只打包已提交文件。

在服务器执行：

```bash
mkdir -p /opt/zwkjy-clone
cd /opt/zwkjy-clone
unzip -o /opt/zwkjy-clone.zip
npm ci
npm run verify
```

## 用 systemd 常驻运行

先创建专用低权限用户、可写数据目录和仅 root 可读的环境文件：

```bash
useradd --system --home-dir /opt/zwkjy-clone --shell /usr/sbin/nologin zwkjy 2>/dev/null || true
install -d -o zwkjy -g zwkjy -m 0750 /opt/zwkjy-clone/data
chown -R zwkjy:zwkjy /opt/zwkjy-clone/data
install -d -o root -g root -m 0700 /etc/zwkjy-clone
cat >/etc/zwkjy-clone/app.env <<'EOF'
NODE_ENV=production
PORT=3100
APP_HOST=127.0.0.1
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
```

初始密码只在管理员账号尚不存在时使用；已有账号不会因重启被重置。不要把真实密码写入服务文件或提交到 Git。

地图能力默认关闭。只有取消上面两行注释并同时填写有效值时，已登录页面才会加载高德 SDK。

创建服务文件：

```bash
cat >/etc/systemd/system/zwkjy-clone.service <<'EOF'
[Unit]
Description=APP Local Clone
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
```

启动并设置开机自启：

```bash
systemctl daemon-reload
systemctl enable --now zwkjy-clone
systemctl status zwkjy-clone --no-pager
```

查看日志：

```bash
journalctl -u zwkjy-clone -f
```

## 3100 端口仅限隔离内网临时验收

正式版本默认只监听 `127.0.0.1`，公网无法直接访问 3100，这是预期的安全行为。仅在隔离内网临时验收、没有生产数据时，才可改用 `APP_HOST=0.0.0.0`、非生产模式和强初始密码后访问：

```text
http://服务器IP:3100/
```

生产环境首次初始化账号：

```text
账号：ys1
密码：/etc/zwkjy-clone/app.env 中配置的 APP_BOOTSTRAP_PASSWORD
```

生产模式缺少 `APP_COOKIE_SECURE=true` 或 `APP_TRUST_PROXY` 会直接拒绝启动。正式上线必须恢复 `APP_HOST=127.0.0.1`，使用下文的 Nginx、域名和 HTTPS，并在云安全组中关闭公网 3100。

## 用 Nginx 反向代理

创建 Nginx 配置：

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
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
```

启用配置：

```bash
ln -sf /etc/nginx/sites-available/zwkjy-clone /etc/nginx/sites-enabled/zwkjy-clone
nginx -t
systemctl reload nginx
```

下面的 80 端口配置只用于域名解析和证书签发前的连通性检查。完成 HTTPS 配置后再进行登录验收：

```text
https://你的域名/
```

## 更新部署

如果使用 GitHub 部署：

```bash
cd /opt/zwkjy-clone
systemctl stop zwkjy-clone
STAMP=$(date +%F-%H%M%S)
mkdir -p "/var/backups/zwkjy-clone/$STAMP"
cp -a data "/var/backups/zwkjy-clone/$STAMP/"
git pull
npm ci
systemctl restart zwkjy-clone
npm run verify:external
```

如果使用 zip 上传部署，重新上传 zip 后执行：

```bash
cd /opt/zwkjy-clone
systemctl stop zwkjy-clone
STAMP=$(date +%F-%H%M%S)
RELEASE_DIR="/tmp/zwkjy-release-$STAMP"
mkdir -p "/var/backups/zwkjy-clone/$STAMP" "$RELEASE_DIR"
cp -a data "/var/backups/zwkjy-clone/$STAMP/"
unzip -o /opt/zwkjy-clone.zip -d "$RELEASE_DIR"
rsync -a --exclude data/ "$RELEASE_DIR/" /opt/zwkjy-clone/
npm ci
systemctl restart zwkjy-clone
npm run verify:external
```

## 建议开启自动备份

创建每日备份脚本：

```bash
cat >/usr/local/bin/zwkjy-backup-data.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/zwkjy-clone
BACKUP_DIR=/var/backups/zwkjy-clone
STAMP=$(date +%F-%H%M%S)

mkdir -p "$BACKUP_DIR/$STAMP"
systemctl stop zwkjy-clone
trap 'systemctl start zwkjy-clone' EXIT
cp -a "$APP_DIR/data" "$BACKUP_DIR/$STAMP/"
systemctl start zwkjy-clone
trap - EXIT
EOF

chmod +x /usr/local/bin/zwkjy-backup-data.sh
```

加入每天凌晨 2 点自动备份：

```bash
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/zwkjy-backup-data.sh") | crontab -
```

## 常见问题

### SSH 连接超时

现象：

```text
ssh: connect to host 服务器IP port 22: Connection timed out
```

处理：

1. 检查云服务器安全组是否放行 TCP `22`。
2. 检查服务器系统防火墙：`ufw status` 或 `firewall-cmd --list-all`。
3. 检查 SSH 服务：`systemctl status ssh` 或 `systemctl status sshd`。
4. 确认公网 IP 是否正确。

### 页面打不开

在服务器上检查服务：

```bash
systemctl status zwkjy-clone --no-pager
curl -I http://127.0.0.1:3100/
```

如果本机能 `curl 127.0.0.1:3100`，但公网打不开，通常是安全组或防火墙没有放行 `3100` 或 `80`。

### 数据文件说明

必须作为一个整体保护的数据包括：

```text
data/runtime.db*、data/security.db*、data/attachments.db*、data/attachments/、data/tenants/、data/backups/、data/runtime-db.json
```

其中 SQLite 文件是当前运行状态，旧 JSON 是首次迁移和回滚来源。`data/attachments.db*` 与 `data/attachments/` 必须成套恢复，否则完整性校验会拒绝下载。生成的导出文件在 `data/exports/`，该目录不需要提交到 Git。

清单计量导入的 CSV/XLSX 源文件同样保存在附件库中。导入只接受 UTF-8 CSV 和无公式、无宏、无外部链接的 `.xlsx`，并严格校验清单编号、正数工程量、合同段、工期、行数和工作表数量；错误报告可在导入页面下载，系统不会自动替换未知清单或补造数量。默认限制为 10 MiB、5000 行和 5 个工作表，可通过 `APP_MEASURE_IMPORT_MAX_BYTES`、`APP_MEASURE_IMPORT_MAX_ROWS`、`APP_MEASURE_IMPORT_MAX_SHEETS` 调整。

完整验收必须使用 `npm ci` 后执行 `npm run test:all`。验收完成的纯运行环境可以执行 `npm prune --omit=dev` 减少开发依赖；需要再次运行全套回归前必须重新执行 `npm ci`。

上线前还必须执行 `npm run verify:security-baseline`、`npm run verify:commercial-security`、`npm run verify:browser-dependencies` 和 `npm audit --omit=dev`。系统按等保2.0二级常见技术基线实现密码历史/有效期、账号锁定、闲置会话、RBAC、自定义角色、管理员重置密码、安全审计、外网弱口令拒绝启动和静态资源白名单；浏览器依赖门禁会阻止已移除的旧漏洞包或旧版本副本重新进入发布。技术自检不代表已完成正式定级备案与测评，也不能证明没有未知漏洞，完整边界见 `SECURITY_BASELINE.md`。

主计量支付报表会生成真实 `.xlsx`、`.pdf`、`.docx`，一键导出 ZIP 同时包含三种文件和 `manifest.json`。验收不能只看扩展名：XLSX/DOCX 应检查 ZIP/OOXML 结构，PDF 应检查 `%PDF-` 文件签名；系统的接口回归已经执行这些检查。报表生成、成功下载和缺失文件下载都会进入安全审计。

如果更新后数据异常，先停止服务并把当前 `data/` 再留一份现场副本，然后整体恢复最近的完整备份：

```bash
cd /opt/zwkjy-clone
systemctl stop zwkjy-clone
mv data "data.failed-$(date +%F-%H%M%S)"
cp -a /var/backups/zwkjy-clone/备份时间/data ./data
systemctl start zwkjy-clone
```
