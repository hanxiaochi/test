# 部署文档

本文档用于把 `zwkjy-local-clone` 部署到 Linux 云服务器。项目是 Node.js + Express 应用，默认监听 `3100` 端口，也可以通过 `PORT` 环境变量修改。

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
1. data/runtime-db.json 是当前测试版数据库，部署和更新时不要覆盖。
2. 如果云端需要和本机当前数据一致，要把本机 data/runtime-db.json 上传到服务器的 /opt/zwkjy-clone/data/runtime-db.json。
3. CALCULATION_USAGE.md 是本机计算使用文档，不上传 GitHub；部署网站本身不依赖它。
4. 数据库、账号权限、角色管控、后台审计和正式后台系统放到下一阶段处理。
5. 每次更新代码前，先备份服务器上的 data/runtime-db.json。
```

## 当前测试版数据持久化

当前版本没有外接 MySQL、PostgreSQL 或 SQLite，运行数据保存在：

```text
data/runtime-db.json
```

这个文件就是测试版数据库。部署到云服务器后，只要服务器上的 `data/runtime-db.json` 不被删除或覆盖，重启服务后数据仍然保留。这个方案适合作为测试先行版、小范围试用和演示版；数据库升级、账号权限、角色管控、后台审计和更完整的管理后台放到下一阶段处理。

部署和更新时最重要的一点：保护 `data/runtime-db.json`。

服务器备份命令：

```bash
cd /opt/zwkjy-clone
mkdir -p data/backups
cp data/runtime-db.json data/backups/runtime-db-$(date +%F-%H%M%S).json
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
apt install -y git curl nginx
```

安装 Node.js 20 LTS：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
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

如果要把本机当前测试数据一起部署上去，在 Windows 本机上传 JSON 数据库：

```powershell
cd G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone
scp .\data\runtime-db.json root@服务器IP:/opt/zwkjy-clone/data/runtime-db.json
```

然后在服务器执行：

```bash
cd /opt/zwkjy-clone
git update-index --skip-worktree data/runtime-db.json
```

这样后续 `git pull` 时不容易把服务器运行数据覆盖成仓库里的基线数据。

安装依赖并验证：

```bash
npm ci
npm run verify
```

## 方式二：本地打包上传部署

在 Windows 本机项目目录执行：

```powershell
cd G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone
Compress-Archive -Path assets,common,css,data,img,js,scripts,constructionData.js,costEngine.js,index.html,login.html,package.json,package-lock.json,pageoffice.js,server.js,work_form_http.js,README.md,DEPLOY.md,DEPLOYMENT.md -DestinationPath zwkjy-clone.zip -Force
scp .\zwkjy-clone.zip root@服务器IP:/opt/
```

在服务器执行：

```bash
mkdir -p /opt/zwkjy-clone
cd /opt/zwkjy-clone
unzip -o /opt/zwkjy-clone.zip
npm ci
npm run verify
```

## 用 systemd 常驻运行

创建服务文件：

```bash
cat >/etc/systemd/system/zwkjy-clone.service <<'EOF'
[Unit]
Description=ZWKJY Local Clone
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/zwkjy-clone
Environment=NODE_ENV=production
Environment=PORT=3100
ExecStart=/usr/bin/node /opt/zwkjy-clone/server.js
Restart=always
RestartSec=3
User=root

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

## 直接用 3100 端口访问

如果安全组已经放行 TCP `3100`，访问：

```text
http://服务器IP:3100/
```

默认账号：

```text
ys1 / 000000
```

## 用 Nginx 反向代理到 80 端口

创建 Nginx 配置：

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

访问：

```text
http://服务器IP/
```

## 更新部署

如果使用 GitHub 部署：

```bash
cd /opt/zwkjy-clone
mkdir -p data/backups
cp data/runtime-db.json data/backups/runtime-db-$(date +%F-%H%M%S).json
cp data/runtime-db.json /tmp/zwkjy-runtime-db.json
git pull
npm ci
cp /tmp/zwkjy-runtime-db.json data/runtime-db.json
systemctl restart zwkjy-clone
npm run verify
```

如果使用 zip 上传部署，重新上传 zip 后执行：

```bash
cd /opt/zwkjy-clone
mkdir -p data/backups
cp data/runtime-db.json data/backups/runtime-db-$(date +%F-%H%M%S).json
cp data/runtime-db.json /tmp/zwkjy-runtime-db.json
unzip -o /opt/zwkjy-clone.zip
npm ci
cp /tmp/zwkjy-runtime-db.json data/runtime-db.json
systemctl restart zwkjy-clone
npm run verify
```

## 建议开启自动备份

创建每日备份脚本：

```bash
cat >/usr/local/bin/zwkjy-backup-jsondb.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/zwkjy-clone
BACKUP_DIR="$APP_DIR/data/backups"

mkdir -p "$BACKUP_DIR"
cp "$APP_DIR/data/runtime-db.json" "$BACKUP_DIR/runtime-db-$(date +%F-%H%M%S).json"
find "$BACKUP_DIR" -name 'runtime-db-*.json' -mtime +14 -delete
EOF

chmod +x /usr/local/bin/zwkjy-backup-jsondb.sh
```

加入每天凌晨 2 点自动备份：

```bash
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/zwkjy-backup-jsondb.sh") | crontab -
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

本地运行数据在：

```text
data/runtime-db.json
```

部署前建议保留该文件，它包含演示数据和当前复刻系统的运行数据。生成的导出文件在 `data/exports/`，该目录不需要提交到 Git。

如果更新后发现数据变回去了，通常是 `data/runtime-db.json` 被覆盖。先停止服务，再从 `data/backups/` 恢复一个最近的备份：

```bash
cd /opt/zwkjy-clone
systemctl stop zwkjy-clone
cp data/backups/你的备份文件.json data/runtime-db.json
systemctl start zwkjy-clone
```
