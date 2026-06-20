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

回归报告生成在：

```text
tmp/sample-regression/latest-result.md
tmp/sample-regression/latest-result.json
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
Compress-Archive -Path assets,common,css,data,img,js,scripts,constructionData.js,costEngine.js,index.html,login.html,package.json,package-lock.json,pageoffice.js,server.js,work_form_http.js,README.md,DEPLOYMENT.md,CALCULATION_USAGE.md -DestinationPath zwkjy-clone.zip -Force
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
cp data/runtime-db.json data/runtime-db.$(date +%F-%H%M%S).bak
```

GitHub 更新：

```bash
git pull
npm ci
systemctl restart zwkjy-clone
npm run verify
```

Zip 更新：

```bash
unzip -o /opt/zwkjy-clone.zip
npm ci
systemctl restart zwkjy-clone
npm run verify
```

## 九、常见问题

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
cp data/runtime-db.backup.json data/runtime-db.json
```

启动服务：

```bash
systemctl start zwkjy-clone
```
