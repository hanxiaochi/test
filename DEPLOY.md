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

安装依赖并验证：

```bash
npm ci
npm run verify
```

## 方式二：本地打包上传部署

在 Windows 本机项目目录执行：

```powershell
cd G:\学习\chrome-plugin-chrome-openai-bundled-http\outputs\zwkjy-clone
Compress-Archive -Path assets,common,css,data,img,js,scripts,constructionData.js,costEngine.js,index.html,login.html,package.json,package-lock.json,pageoffice.js,server.js,work_form_http.js,README.md,DEPLOY.md -DestinationPath zwkjy-clone.zip -Force
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
git pull
npm ci
npm run verify
systemctl restart zwkjy-clone
```

如果使用 zip 上传部署，重新上传 zip 后执行：

```bash
cd /opt/zwkjy-clone
unzip -o /opt/zwkjy-clone.zip
npm ci
npm run verify
systemctl restart zwkjy-clone
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
