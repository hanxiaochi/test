# 网站部署文档

本文档用于部署本地工程计量支付网站。项目是 Node.js + Express 应用，默认端口为 `3100`。

## 代码位置

本机项目目录：

```text
G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone
```

主要文件：

```text
server.js                 后端服务入口
costEngine.js             工程造价与计量支付计算引擎
constructionData.js       初始数据与运行数据加载
data/runtime-db.json      当前运行数据库
scripts/verify.js         全站自动验证
scripts/sample-regression.js  第13/14期样本回归验证
```

默认登录账号：

```text
账号：ys1
密码：000000
```

## 交给其他 AI 或协作者部署时

如果把部署任务交给 MiniMax、其他 AI 或运维协作者，可以直接让对方先读本节，再按本文档后续步骤执行。

核心信息：

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

重要注意事项：

```text
1. data/runtime-db.json 是当前测试版数据库，部署和更新时不要覆盖。
2. 如果云端需要和本机当前数据一致，要把本机 data/runtime-db.json 上传到服务器的 /opt/zwkjy-clone/data/runtime-db.json。
3. CALCULATION_USAGE.md 是本机计算使用文档，不上传 GitHub；部署网站本身不依赖它。
4. PAYMENT_REGRESSION_TEST_DATA.md 和 test-data/payment-regression-12-14.json 是给其他 AI/协作者验收用的三组非 PDF 测试数据。
5. 数据库、账号权限、角色管控、后台审计和正式后台系统放到下一阶段处理。
6. 每次更新代码前，先备份服务器上的 data/runtime-db.json。
```

如果对方从 GitHub 部署，按“方式 A：从 GitHub 拉取”执行；如果对方需要部署本机当前完整测试数据，除了拉代码以外，还必须额外上传本机的 `data/runtime-db.json`。

## 当前测试版数据说明

当前版本不依赖 MySQL、PostgreSQL 或 SQLite，运行数据保存在本项目内的 JSON 文件：

```text
data/runtime-db.json
```

这个文件就是当前测试版的本地数据库，包含工程数据、计量数据、计算规则、后台规则和业务操作后的状态。部署到云服务器后也是同样逻辑：只要服务器上的 `data/runtime-db.json` 不被删除或覆盖，重启服务后数据仍然会保留。

适用范围：

```text
适合：测试版、演示版、小范围试用、单人或少量人员录入验证
不适合：多人高并发、正式生产、复杂权限隔离、强审计要求
```

数据库升级、账号权限、角色管控、后台审计和更完整的管理后台放到下一阶段处理。本次部署先以 JSON 数据库作为测试先行版，重点保证网站能跑、计算模块可用、数据能保留、更新时不丢数据。

## 一、本地 Windows 运行

进入项目目录：

```powershell
cd G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone
```

安装依赖：

```powershell
npm.cmd install
```

启动服务：

```powershell
npm.cmd start
```

访问：

```text
http://localhost:3100/
```

全站验证需要服务已经在 `3100` 端口运行：

```powershell
npm.cmd run verify
```

第13/14期样本回归：

```powershell
npm.cmd run sample:regression
```

第12/13/14期非 PDF 测试数据回归：

```powershell
npm.cmd run test:payment-fixtures
```

回归报告生成在：

```text
tmp/sample-regression/latest-result.md
tmp/sample-regression/latest-result.json
tmp/payment-fixture-regression/latest-result.md
tmp/payment-fixture-regression/latest-result.json
```

## 二、部署前备份数据

`data/runtime-db.json` 是当前运行数据库，里面包含后台规则、工程数据、计量数据和业务操作后的状态。部署、更新、回归测试前建议备份。

Windows：

```powershell
Copy-Item .\data\runtime-db.json .\data\runtime-db.backup.json -Force
```

Linux：

```bash
cp data/runtime-db.json data/runtime-db.$(date +%F-%H%M%S).bak
```

服务器上建议使用单独备份目录：

```bash
mkdir -p /opt/zwkjy-clone/data/backups
cp /opt/zwkjy-clone/data/runtime-db.json /opt/zwkjy-clone/data/backups/runtime-db-$(date +%F-%H%M%S).json
```

注意：`scripts/sample-regression.js` 会临时替换运行数据库进行测试，脚本结束后会自动恢复原 `data/runtime-db.json`。

## 三、Linux 云服务器部署

以下命令以 Ubuntu/Debian 为例。建议部署目录为：

```text
/opt/zwkjy-clone
```

安装基础环境：

```bash
apt update
apt install -y git curl unzip nginx
```

安装 Node.js 20 LTS：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
npm -v
```

### 方式 A：从 GitHub 拉取

如果当前代码已经推送到 GitHub：

```bash
mkdir -p /opt/zwkjy-clone
cd /opt/zwkjy-clone
git clone -b 你的分支名 你的仓库地址 .
npm ci
```

如果要让云服务器使用本机当前的测试数据，在本机另开 PowerShell 上传当前 JSON 数据库：

```powershell
cd G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone
scp .\data\runtime-db.json root@服务器IP:/opt/zwkjy-clone/data/runtime-db.json
```

上传后在服务器执行一次保护标记，避免后续 `git pull` 把服务器运行数据覆盖回仓库里的基线数据：

```bash
cd /opt/zwkjy-clone
git update-index --skip-worktree data/runtime-db.json
```

如果已经克隆过：

```bash
cd /opt/zwkjy-clone
git pull
npm ci
```

### 方式 B：本机打包上传

在 Windows 本机执行：

```powershell
cd G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone
Compress-Archive -Path assets,common,css,data,img,js,scripts,constructionData.js,costEngine.js,index.html,login.html,package.json,package-lock.json,pageoffice.js,server.js,work_form_http.js,README.md,DEPLOYMENT.md -DestinationPath zwkjy-clone.zip -Force
scp .\zwkjy-clone.zip root@服务器IP:/opt/
```

在服务器执行：

```bash
mkdir -p /opt/zwkjy-clone
cd /opt/zwkjy-clone
unzip -o /opt/zwkjy-clone.zip
npm ci
```

## 四、systemd 常驻运行

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

启动：

```bash
systemctl daemon-reload
systemctl enable --now zwkjy-clone
systemctl status zwkjy-clone --no-pager
```

查看日志：

```bash
journalctl -u zwkjy-clone -f
```

本机验证服务：

```bash
curl -I http://127.0.0.1:3100/
curl http://127.0.0.1:3100/api/debug/runtime
```

确认 JSON 数据库位置：

```bash
ls -lh /opt/zwkjy-clone/data/runtime-db.json
```

## 五、Nginx 反向代理

如果希望通过 `http://服务器IP/` 访问，而不是 `http://服务器IP:3100/`，配置 Nginx。

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

## 六、服务器防火墙与安全组

如果直接访问 `3100` 端口，需要开放：

```text
TCP 3100
```

如果使用 Nginx 反向代理，需要开放：

```text
TCP 80
```

SSH 管理需要开放：

```text
TCP 22
```

在 Windows 测试端口：

```powershell
Test-NetConnection -ComputerName 服务器IP -Port 22
Test-NetConnection -ComputerName 服务器IP -Port 80
Test-NetConnection -ComputerName 服务器IP -Port 3100
```

## 七、部署后验收

确认 systemd 正常：

```bash
systemctl status zwkjy-clone --no-pager
```

确认后端运行：

```bash
curl http://127.0.0.1:3100/api/debug/runtime
```

确认全站功能：

```bash
cd /opt/zwkjy-clone
npm run verify
```

如需跑第13/14期样本回归，需要把样本 PDF 放到：

```text
tmp/sample-regression/p13
tmp/sample-regression/p14
```

然后执行：

```bash
npm run sample:regression
```

如果样本目录放在其他位置：

```bash
SAMPLE_REGRESSION_ROOT=/path/to/sample-regression npm run sample:regression
```

## 八、更新部署

更新前先备份运行数据库：

```bash
cd /opt/zwkjy-clone
mkdir -p data/backups
cp data/runtime-db.json data/backups/runtime-db-$(date +%F-%H%M%S).json
cp data/runtime-db.json /tmp/zwkjy-runtime-db.json
```

GitHub 更新：

```bash
git pull
npm ci
cp /tmp/zwkjy-runtime-db.json data/runtime-db.json
systemctl restart zwkjy-clone
npm run verify
```

Zip 更新：

```bash
unzip -o /opt/zwkjy-clone.zip
npm ci
cp /tmp/zwkjy-runtime-db.json data/runtime-db.json
systemctl restart zwkjy-clone
npm run verify
```

如果确认新版本需要使用新的初始化数据结构，先不要直接覆盖旧数据库。建议先保留备份，再单独对比或迁移 `data/runtime-db.json`，确认计算数据和业务数据没有丢失后再上线。

## 九、建议开启自动备份

测试版虽然可以直接用 JSON 数据库，但要养成备份习惯。可以在服务器创建每日备份脚本：

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

手动验证备份：

```bash
/usr/local/bin/zwkjy-backup-jsondb.sh
ls -lh /opt/zwkjy-clone/data/backups | tail
```

## 十、常见问题

### 页面打不开

先在服务器本机检查：

```bash
curl -I http://127.0.0.1:3100/
systemctl status zwkjy-clone --no-pager
```

如果本机能访问，公网不能访问，通常是安全组或防火墙没有开放 `80` 或 `3100`。

### 端口被占用

```bash
ss -lntp | grep 3100
```

可以改 systemd 里的端口：

```text
Environment=PORT=3101
```

改完后：

```bash
systemctl daemon-reload
systemctl restart zwkjy-clone
```

### 数据不对或想恢复

停止服务：

```bash
systemctl stop zwkjy-clone
```

恢复备份：

```bash
cp data/backups/你的备份文件.json data/runtime-db.json
```

启动服务：

```bash
systemctl start zwkjy-clone
```

### 更新后数据变回去了

通常是更新代码或解压 zip 时覆盖了 `data/runtime-db.json`。处理方法：

```bash
cd /opt/zwkjy-clone
systemctl stop zwkjy-clone
cp data/backups/你的备份文件.json data/runtime-db.json
systemctl start zwkjy-clone
```

之后更新前按“八、更新部署”的步骤先保存 `/tmp/zwkjy-runtime-db.json`，更新后再复制回来。
