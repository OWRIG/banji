# 班级工作台

给老师用的班级数据工作台：默写过关、待过关名单、加分积分、学生档案。网页、命令行、AI agent 三种方式都能用，数据在老师自己手里。

- **今天要追谁**：首页按班列出还欠着默写没过关的学生，补过了点一下销账。
- **课上记得快**：登记分数按回车自动跳下一位；可以从 Excel 整列粘贴；满分、请假一键填。
- **加分不重复**：默写满分、背书一次过自动 +1，改分、删场次、关规则都不会多加或漏扣。
- **点错能撤销**：每一次修改都有记录（谁、什么时候、做了什么），网页、命令行、agent 的操作都能撤销。
- **让 AI 帮忙**：内置 MCP 服务，Claude、Codex 等 agent 可以直接查待过关、登记成绩、写周报。
- **数据安全**：每天自动备份；只存学号、姓名、性别、小组，不存家长信息和身份证号。

> 成绩和积分排名只供老师本人参考，请不要公开学生的成绩和排名。

## 两种部署方式

| | 本地部署 | 云端部署 |
|---|---|---|
| 适合 | 先用起来、数据不出电脑 | 手机随时随地要用 |
| 跑在哪 | 自己的 Mac | 自己租的云服务器（Docker） |
| 手机访问 | 同一 Wi-Fi 或 Tailscale，电脑要开着 | 任何地方 |
| 怎么装 | 见下面「本地部署」 | 见 [deploy/DEPLOY.md](deploy/DEPLOY.md)，可以直接交给 agent 执行 |

两种方式的数据就是同一个数据库文件，可以随时迁移（`banji backup` → `banji restore`）。

### 本地部署（macOS）

需要 [Node.js](https://nodejs.org) 22.12 以上和 [pnpm](https://pnpm.io)。

```bash
pnpm install
bin/banji service install          # 开机自动启动；加 --lan 允许同一 Wi-Fi 的手机访问
```

然后浏览器打开 http://localhost:3000，创建账号。**第一个创建的账号就是主人，之后自动关闭注册。**

这条命令会生成 `.env`（登录密钥、备份目录），每日备份默认放在「文稿/班级工作台备份」。

### 云端部署

按 [deploy/DEPLOY.md](deploy/DEPLOY.md) 操作：准备一台装了 Docker 的服务器和一个域名（国内服务器需要 ICP 备案），`docker compose up -d --build`，Caddy 会自动配置 HTTPS。

## 导入名册

在「数据与设置 → 导入名册」粘贴 JSON（格式见 [examples/roster.example.json](examples/roster.example.json)），或者：

```bash
bin/banji import 名册.json          # 先预览
bin/banji import 名册.json --yes    # 确认导入
```

Excel 名单格式五花八门，最省事的办法是让 agent 读你的 Excel，整理成上面的格式再导入。

## 命令行

`bin/banji` 直接读写本机的数据库，网页服务没开也能用。常用命令：

```bash
banji brief                                  # 今日概览
banji pending 705                            # 705 班待过关名单
banji record 12 李明=95 王芳=请假 张三=100    # 登记第 12 场检查
banji deduct 未交作业 李明 王芳               # 扣分（加分由系统自动结算）
banji undo                                   # 撤销最近一次操作
banji history                                # 操作记录
banji ops                                    # 全部操作；banji call <操作> '<JSON>' 调用任意操作
```

## 让 agent 使用

**本机的 agent**（Claude Desktop、Claude Code、Codex、Cherry Studio 等）把下面这条命令配置成 MCP 服务：

```json
{ "mcpServers": { "banji": { "command": "/项目路径/bin/banji", "args": ["mcp", "--name", "claude"] } } }
```

**远程 agent**：在网页「数据与设置 → 远程 agent 访问」生成令牌，MCP 地址是 `https://你的域名/mcp`，请求头 `Authorization: Bearer <令牌>`。

agent 能做的事和网页一样（查询、登记、销账、加分、撤销……），会修改数据的操作都会记录是哪个 agent 做的，可以撤销。导入名册、删除场次这类危险操作，agent 只能先拿到预览，要老师确认后才会执行。

## 开发

本项目基于 [磐石 Panshi](https://github.com/OWRIG/panshi) 模板：React + Hono + SQLite + Drizzle + zod。给 AI 协作者的开发规则在 [AGENTS.md](AGENTS.md)。

```bash
pnpm dev       # 开发环境
pnpm check     # 类型、代码规范、测试，必须全部通过
```

设计思路见 [docs/design.md](docs/design.md)。
