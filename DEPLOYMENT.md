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
cat >/etc/systemd/system/zwkjy-clone.service <<'EOF'
[Unit]
Description=Engineering Payment Platform
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/zwkjy-clone
Environment=NODE_ENV=production
Environment=PORT=3100
Environment=APP_STORAGE=sqlite
ExecStart=/usr/bin/node /opt/zwkjy-clone/server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now zwkjy-clone
systemctl status zwkjy-clone --no-pager
curl -fsS http://127.0.0.1:3100/api/health
```

生产环境后续应改为专用低权限系统用户，并确保该用户只对项目 `data/`、日志和必要临时目录有写权限。

## Nginx

```bash
cat >/etc/nginx/sites-available/zwkjy-clone <<'EOF'
server {
    listen 80;
    server_name _;
    client_max_body_size 100m;

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

公网开放 `80`；若直接访问 Node 服务才开放 `3100`。正式商用必须配置 HTTPS、域名、防火墙和最小权限运行用户。

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
6. 重启服务后业务数据、账号、规则版本和审计仍存在。
7. 执行第 12/13/14 期 fixture 回归，结果与基准一致。

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
APP_SHUTDOWN_TIMEOUT_MS 优雅停机等待毫秒数，默认 5000
APP_LOGIN_MAX_ATTEMPTS  同一IP、租户和账号在窗口内的失败上限，默认 10
APP_LOGIN_WINDOW_MS     登录失败计数窗口毫秒数，默认 900000
APP_LOGIN_MAX_ENTRIES   内存中登录限流身份上限，默认 10000
APP_TRUST_PROXY         仅在可信反向代理后配置；单层 Nginx 可设 true
```

修改路径后必须同步调整 systemd 权限、全量备份范围和监控规则。不要在应用直接暴露公网时启用 `APP_TRUST_PROXY`，否则攻击者可能伪造来源地址绕过登录限流。

首次初始化的管理员会被强制进入密码修改页。新密码至少 10 位，并同时包含字母、数字和特殊字符；修改成功后全部已有会话会立即失效，必须使用新密码重新登录。
