# 云端部署（写给执行部署的 agent）

老师会对你说"帮我把班级工作台部署到我的服务器"。按下面的步骤做，**每一步都要验证通过再进行下一步**。遇到失败，用业务语言告诉老师卡在哪里，不要跳过验证。

部署结果：`https://<域名>` 可以打开工作台网页；`https://<域名>/mcp` 是给 agent 用的 MCP 入口。数据在服务器的 `deploy/data/` 目录里，每天自动备份。

## 0. 先向老师确认

- 服务器的登录方式（SSH 地址、用户名），以及有没有 sudo 权限。
- 域名。如果是中国大陆的服务器，域名**必须已经完成 ICP 备案**，否则 80/443 端口会被拦截。还没备案时，告诉老师先用本地部署（见项目 README），备案完成后再迁移上来。
- 是否已有数据需要迁移：本地正在用的话，先让老师在本地运行 `banji backup`，拿到 `.db` 备份文件。

## 1. 前置检查

在服务器上逐项检查：

```bash
docker --version && docker compose version   # 没有就按 Docker 官方文档安装
curl -s https://ipinfo.io/ip                 # 服务器公网 IP
dig +short <域名>                            # 必须等于上面的公网 IP
```

- 云厂商的安全组/防火墙要放行 TCP 80 和 443。
- 80、443 端口没有被其他程序（例如已有的 nginx）占用：`sudo ss -ltnp | grep -E ':80|:443'`。如果被占用，先问老师怎么处理，不要擅自停掉别的服务。

## 2. 获取代码

```bash
git clone <仓库地址> banji && cd banji/deploy
```

## 3. 填写配置

```bash
cp .env.example .env
openssl rand -base64 32    # 把输出填到 BETTER_AUTH_SECRET
```

编辑 `.env`：`DOMAIN` 填域名（不带 https://），`BETTER_AUTH_SECRET` 填上面生成的密钥。确认 `.env` 不会被提交到 git，也不要把密钥发到聊天里。

## 4. 启动

```bash
docker compose up -d --build
docker compose ps          # app 状态应为 healthy，caddy 为 running
```

第一次构建大约需要几分钟。

## 5. 验证

```bash
curl -fsS https://<域名>/api/health      # 返回 {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' https://<域名>/api/ops/classes.list -X POST   # 返回 401（未登录被拒绝）
```

HTTPS 证书申请失败时，看 `docker compose logs caddy`：通常是域名没有解析到这台服务器，或者 80 端口不通。

## 6. 迁移已有数据（可选）

把本地的备份文件上传到服务器的 `deploy/data/` 里，然后：

```bash
docker compose stop app
docker compose run --rm app banji restore /app/data/<备份文件名>.db
docker compose start app
```

恢复前会自动把服务器上的当前数据备份一次。

## 7. 让老师创建账号

请老师用浏览器打开 `https://<域名>`，创建账号。**第一个注册的账号就是主人，之后自动关闭注册。** 所以要在部署完成后尽快完成这一步，不要把地址提前发给别人。

验证：老师登录后，退出，再打开页面，应该只显示"登录"，不再出现"创建账号"。

## 8. 连接老师的 agent（可选）

请老师在网页「数据与设置 → 远程 agent 访问」里生成一个令牌（只显示一次）。agent 的 MCP 配置：

- 地址：`https://<域名>/mcp`
- 请求头：`Authorization: Bearer <令牌>`

验证：让 agent 调用 `brief_today`，能返回今天的概览。

## 9. 确认备份

```bash
docker compose exec app banji backup     # 手动备份一次
docker compose exec app banji backups    # 能看到备份文件
```

服务每天会自动备份一次，保留最近 30 份（`BACKUP_KEEP`）。备份文件在服务器的 `deploy/data/backups/`。建议老师每周在网页「数据与设置 → 下载备份文件」下载一份到自己的电脑，做异地备份。

## 日常维护

| 事情 | 命令（在 deploy/ 目录下） |
|---|---|
| 升级到新版本 | `git pull && docker compose up -d --build`（启动时会先自动备份，再升级数据库结构） |
| 查看日志 | `docker compose logs -f app` |
| 忘记密码 | `docker compose exec app banji auth reset-password <邮箱> <新密码>` |
| 查看操作记录 | `docker compose exec app banji history` |

## 注意

- 只能运行**一个** app 实例（数据在 SQLite 文件里），不要扩容成多副本。
- `deploy/data/` 里是学生数据，属于未成年人个人信息：不要放进公开的网盘，不要发给别人。
- 不要把服务器部署在境外再给学生数据用，除非老师明确了解并接受数据出境的要求。
