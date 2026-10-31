# 班级工作台：网页端 + CLI + MCP 设计草案

> 状态：草案 v0.1（2026-10-31）
> 基座：磐石 Panshi 模板（React + Hono + SQLite + Drizzle + zod）
> 第一个用户：七年级 5 班班主任，同时教 5 班和 7 班英语。之后开源给更多老师。

---

## 1. 核心思路：一套业务操作，三个入口

```
            ┌──────────── 网页（老师点按钮）
            │
业务操作层 ──┼──────────── CLI（老师/开发者/脚本）
 (ops)      │
            └──────────── MCP（AI agent：Claude、Codex、Cherry Studio…）
              │
          SQLite 单文件（data/app.db）
```

- **所有业务规则只写一遍**，放在操作层：过关判定、待过关池、自动积分、撤销。
- 网页接口、CLI 命令、MCP 工具都只是很薄的一层，负责把参数转一下、调用操作层，自己不写业务逻辑。
- 这是对磐石的主要扩展。磐石原来把业务逻辑直接写在 Hono 路由里，只有网页一个入口时没问题；入口变成三个，就必须把逻辑抽出来，否则会写三份，口径一定会对不上。

### 1.1 操作的定义方式

每个操作是一个对象，带上 agent 需要的元信息：

```ts
// src/server/ops/checks.ts（示意）
export const recordCheckResults = defineOp({
  name: "checks.record",                 // CLI: banji checks record / MCP: checks_record
  title: "登记默写/背书结果",
  description: "给某一场检查登记若干学生的结果。学生可以用姓名或学号指定。",
  kind: "write",                         // read | write | danger
  input: recordCheckResultsSchema,       // zod，放在 src/shared/，网页表单也复用这一份
  run: async (ctx, input) => { ... },    // ctx: { db 事务, actor: "web" | "cli" | "mcp:claude" }
})
```

- `kind` 决定安全策略（见第 4 节）。
- `description` 和 zod 字段上的 `.describe()` 直接用作 MCP 工具说明和 CLI `--help`，不用另外维护文档。
- 网页接口仍然按磐石的链式写法注册，保证前端有 RPC 类型；路由里只做一件事：`return c.json(await runOp(op, input, { actor: "web" }))`。

### 1.2 CLI 和 MCP 怎么连数据

**直接在进程内调用操作层，读写同一个 SQLite 文件**，不经过 HTTP 服务。

- 好处：网页服务没开时，CLI 和 MCP 也能用，少一个出错的环节。
- SQLite 开 WAL 模式，再设一个 `busy_timeout`，单机上几个进程同时读写没有问题。
- 网页端靠 TanStack Query 在窗口重新获得焦点时自动刷新，所以 agent 改了数据，老师切回浏览器就能看到。

MCP 提供两种传输方式：

| 方式 | 用途 |
|---|---|
| stdio（`banji mcp`） | 老师本机的 agent（Claude Desktop / Claude Code / Codex / Cherry Studio）直接拉起这个进程 |
| Streamable HTTP（服务上的 `/mcp`，必须带 token） | 远程 agent、手机上的 agent、学校服务器部署 |

---

## 2. 数据模型

原则：
1. 只存教学必需的字段，不存家长信息、身份证号这类隐私数据。
2. 学期是顶层概念，升年级时数据能延续。
3. 积分只追加、不修改，撤销靠记录。
4. 每次写操作都留痕迹。

| 表 | 关键字段 | 说明 |
|---|---|---|
| `terms` | name, start, end, current | 学期 |
| `classes` | term_id, name（"七5班"）, code（"705"）, my_roles（班主任/英语…） | 一位老师可以管多个班，在每个班的角色可以不同 |
| `students` | student_no, name, gender, active, tags | 学号在一个学校内唯一；"*"号这类标记放进 tags 或直接忽略 |
| `class_students` | class_id, student_id, seat_no | 跨学期延续时只需新增关联 |
| `groupings` / `group_members` | 一套分组可以有多个组 | 学习小组、值日组等可以同时存在多套 |
| `checks` | class_id, kind（默写/背书/作业订正/自定义）, title, date?, mode（分数/标记）, pass_line | 把她的"默写"和"背书"统一成一类 |
| `check_results` | check_id, student_id, score?, mark（过/未过/请假/免）, cleared_at?, cleared_note | **待过关池 = 未达标 且 未销账**，是查询出来的视图，不单独建表 |
| `assessments` | class_id, type（单元/阶段/月考/期中/期末/其他）, title, date?, paper_group | `paper_group` 用来标记"两班同卷"，做跨班对比 |
| `assessment_subjects` | assessment_id, key, full_score, in_total | 数学满 120 这类规则靠这张表 |
| `assessment_scores` | assessment_id, student_id, subject_key, score?, status（正常/请假/缺考/系统排除）, class_rank?, school_rank?, note | |
| `point_rules` | class_id?, name, delta, category, enabled, auto_trigger? | auto_trigger 例：`check.full_score`、`recite.first_pass`、`assessment.top_progress` |
| `point_events` | student_id, delta, rule_id?, note, source_type?, source_id?, actor, created_at, revoked_at? | 只追加；撤销时填 revoked_at |
| `notes` | student_id, date, kind（谈话/家访/观察）, text | |
| `seat_layouts` | class_id, name, grid（JSON）, is_current | grid 是通用网格：任意行列、讲台、单独位、过道 |
| `duty_rosters` | class_id, roles（JSON）, plan（JSON：时段 × 岗位 → 学生 id 数组） | 一格支持多人 |
| `changesets` | id, actor, op_name, input, before/after 快照, created_at, undone_at? | **统一撤销和审计**（见 2.2） |

### 2.1 自动积分：用投影实现幂等

她明确要求"默写满分只加一次，来源删了或改了要同步撤销，规则关了要清掉"。这类要求用**投影**最稳：

- 来源数据（检查结果、背书、考试）只要有变动，就在**同一个事务里**调用 `syncAutoPoints(source_type, source_id)`。
- 这个函数按当前规则和当前数据，算出"这份来源**应该**产生哪些积分事件"，和已有的自动事件比对，多的撤销，少的补上。
- 数据库再加一道唯一索引兜底：`(rule_id, source_type, source_id, student_id)`，只对未撤销的记录生效。
- 关闭一条规则，等于对所有相关来源重新跑一次同步。

这样即使改分、删场次、关规则的顺序再乱，结果都只由"当前数据 + 当前规则"决定。

### 2.2 统一撤销（changesets）

每次写操作都在同一个事务里记录一份 changeset：涉及哪些行，改之前和改之后各是什么样。

- 网页上的撤销提示、`banji undo`、agent 调用的 `undo` 工具，走的是同一套逻辑。
- 审计时能看到每一笔是谁改的：网页、CLI，还是哪个 agent。这在 agent 时代是刚需，否则老师不敢让 agent 动手。
- 撤销前先检查后面有没有依赖这次修改的改动，有冲突就拒绝撤销并说明原因，不硬回滚。

---

## 3. 操作清单（第一版）

agent 用起来顺手的关键是：**数量少、粒度粗、接受姓名、批量操作**。

| 领域 | 操作 | kind |
|---|---|---|
| 名册 | `students.resolve`（姓名/学号/模糊匹配 → 学生；同名时返回候选列表） | read |
| | `students.list` / `students.profile`（单人汇总：待过关、积分、成绩趋势、记录） | read |
| | `roster.import`（规整好的 JSON 名单，先 preview 再 apply） | danger |
| 检查 | `checks.create` / `checks.list` / `checks.get` | write / read |
| | `checks.record`（批量：`[{student:"李明", score:95}, {student:"王芳", mark:"请假"}]`） | write |
| | `pending.list`（待过关池，可按班、学生、天数筛选） | read |
| | `pending.clear`（销账，可批量） | write |
| 考试 | `assessments.create` / `assessments.record`（批量、整列） | write |
| | `assessments.analyze`（概览/进退步/临界生/跨班对比，用参数选） | read |
| 积分 | `points.add`（多名学生 + 规则名或分值 + 备注） / `points.leaderboard` / `points.log` | write / read |
| | `rules.list` / `rules.update` | read / write |
| 记录 | `notes.add` / `notes.list` | write / read |
| 班务 | `seats.get` / `seats.swap` / `seats.rebalance(preview)` / `duty.get` / `duty.set` | 混合 |
| 系统 | `undo` / `history`（最近操作） / `backup.create` / `export.csv` | 混合 |
| 汇总 | `brief.today`（今天要追的人、最近的异常） / `brief.week` | read |

CLI 示例：

```bash
banji pending list --class 705
banji checks record --check "U3 默写 1" 李明=95 王芳=请假 张三=100
banji points add 李明 王芳 --rule 课堂发言
banji undo
banji import roster ./705名单.json --preview
banji mcp            # 以 stdio 方式启动 MCP 服务
```

### MCP 的额外内容

- **Resources**：`class://705/roster`、`class://705/rules`。agent 先读这些，就不会把名字猜错。
- **Prompts**：`周报`、`谈话准备(学生)`、`整理 Excel 导入`。把老师常用的工作流程固定下来。
- **Server instructions**：告诉 agent 这里的口径（及格 60%、优秀 85%、过关线默认 80）、哪些操作必须先预览，以及成绩排名不能对外。

---

## 4. 面向 agent 的安全设计

| 规则 | 做法 |
|---|---|
| 普通写操作（加分、登记、销账） | 直接执行，结果里带撤销 id；老师随时可以说"撤销刚才那步" |
| 危险操作（导入覆盖、删除场次、恢复备份、批量改分组） | 必须两步走：先调用 `preview` 拿到差异和一个确认码，再带着确认码调用 `apply`；确认码 5 分钟内有效，绑定这次的输入 |
| 学生指代不明确 | 遇到同名或模糊匹配，**直接报错并列出候选**，绝不猜 |
| 隐私 | MCP 默认只返回姓名和学号；可选"脱敏模式"，学生名字换成代号（S01），给云端模型用 |
| 远程访问 | 网页和 HTTP MCP 都需要登录，做法见 4.1 |
| 排名 | 排行榜和分层信息只在老师端显示；导出时提醒"不得公开学生成绩和排名" |

### 4.1 登录：用 better-auth，保持轻量

直接用磐石自带的 add-auth skill（Better Auth，邮箱 + 密码），只在上面加两处小改动，其余不扩展。

| 入口 | 怎么认证 |
|---|---|
| 网页（电脑、手机） | Better Auth 会话；会话有效期设长一些（例如 30 天），她基本只需要登录一次 |
| CLI、stdio MCP | **不需要登录**。它们直接读写本机的数据库文件，能访问这台电脑就等于有权限，和她自己打开 Excel 是一回事 |
| HTTP MCP（`/mcp`） | 在设置页生成一个访问令牌，agent 带着这个令牌访问；可以随时作废。优先用 Better Auth 的 API Key 插件，用不了就自己建一张令牌表 |

两处改动：
1. **第一个注册的人就是主人，之后自动关闭注册**（Better Auth 的 `disableSignUp`），省掉管理员后台。以后有其他老师加入，由主人在设置页里邀请。
2. changesets 的 `actor` 字段记录用户 id（agent 记录令牌名），留痕时直接复用。

刻意不做的：角色和权限体系、OAuth、短信或微信登录、找回密码邮件。忘了密码就用 CLI 重置：`banji auth reset-password`。多老师协作（P3）时，也只加一张"老师 ↔ 班级"关联表，按班级隔离数据，不引入通用的权限框架。

一个坑：Better Auth 要求 `BETTER_AUTH_URL` 和浏览器里的访问地址完全一致。手机通过局域网 IP 访问时，IP 一变就登不上。解决办法是给 Mac 固定一个局域网 IP，或者用 Tailscale 这类固定的主机名。

---

## 5. Excel 导入：交给 agent 和导入向导

老师手里的 Excel 千奇百怪：xls 和 xlsx 混着用，表头乱，合并单元格，名字里夹着"*"号。思路是把导入拆成两层：

1. **核心层只接收规整的 JSON**（`roster.import`、`assessments.import`、`checks.import`），用严格的 zod 校验，先 preview 再 apply。
2. **把乱七八糟的表格规整成 JSON**，有两条路：
   - **agent 路线**：agent 用自己的工具读 Excel、理解表头，转成 JSON 后调用 preview。她那 9 条导入口径，正是 agent 需要跟老师确认的问题。
   - **网页向导路线**：上传文件 → 选 sheet → 列映射 → 按姓名匹配 → 把对不上的逐条列出来 → 确认。读 xls 需要 SheetJS（npm 上的旧版已停止维护，要用官方 CDN 发布的 tarball），或者在服务端处理。

她的第一批数据由我们用 agent 路线一次性导入，网页向导放到开源阶段再做。

---

## 6. 目录结构（在磐石基础上扩展）

```
src/
├── shared/            zod 规则（不变）：表单、接口、CLI、MCP 共用
├── server/
│   ├── ops/           ★ 业务操作层：每个领域一个文件 + 测试
│   │   ├── define.ts      defineOp / runOp（事务、changeset、actor）
│   │   ├── checks.ts  points.ts  assessments.ts  roster.ts  ...
│   │   └── auto-points.ts 自动积分投影
│   ├── routes/        Hono 路由（薄壳，调用 ops）
│   ├── db/
│   └── mcp.ts         ★ 把 ops 注册成 MCP 工具（stdio 和 /mcp 共用）
├── cli/
│   └── index.ts       ★ 把 ops 生成 CLI 命令（commander）
└── web/
```

- 新增依赖：`@modelcontextprotocol/sdk`（MCP 官方 SDK，直接支持 zod）、`commander`（CLI）。都是各自领域最主流的库。
- 要同步更新 AGENTS.md：**业务逻辑只写在 ops 里；新增一个操作 = 写 ops + 测试，再在路由里挂一行；CLI 和 MCP 会自动出现。** 再加一个 skill：`new-op`。
- 测试主要写在 ops 层。她的验收清单可以直接改写成测试，例如"新建默写 → 录入 → 进入待过关池 → 销账 → 从池中消失，满分 +1 且不重复"。

---

## 7. 部署：本地和云端两种模式

**一套代码、一个数据库文件、两种跑法。** 两种模式的区别只在于"跑在哪台机器上、怎么从外面访问"，业务代码完全一样，数据可以在两边来回迁移。

### 7.1 两种模式对比

| | 模式一：本地部署 | 模式二：云端部署 |
|---|---|---|
| 跑在哪 | 老师自己的 Mac 或 Windows 电脑 | 云服务器（Docker） |
| 电脑上访问 | `http://localhost:3000` | `https://自己的域名` |
| 手机访问 | 手机和电脑在同一个网络，或者两边都装 Tailscale；**电脑必须开着** | 随时随地都能访问 |
| 本机 agent | CLI 和 stdio MCP，直接读写数据库文件 | 通过 HTTP MCP 加访问令牌连接 |
| 备份 | 每天自动复制到"文稿/班级工作台备份"（随 iCloud 同步） | 容器内每天自动备份到数据卷；可以选择再推送到对象存储；网页上可以随时下载备份 |
| 费用和门槛 | 零费用；需要装 Node（以后做免安装版） | 每月几十元的服务器费用；国内服务器绑定域名需要 ICP 备案 |
| 隐私 | 数据不出这台电脑 | 数据在老师自己租的服务器上；不经过任何第三方平台 |

**对她的判断**：她的诉求是"手机上也要用"。学校 WiFi 常常隔离设备，手机可能连不到电脑；她在教室用手机流量时，电脑也不一定开着。所以她最终大概率要用云端模式。建议的节奏是：

- 下周先用本地模式加 Tailscale 跑起来，不耽误她正式使用。
- 等她的域名和服务器准备好，把数据库文件迁上云端。

### 7.2 本地模式

- `pnpm start` 启动一个进程，同时提供网页、接口和 `/mcp`。
- macOS 用 launchd 开机自动启动；提供一个 `banji service install` 命令自动完成配置，不让老师自己写配置文件。
- 默认只监听 127.0.0.1；在设置里打开"允许手机访问"后，才监听局域网。
- 以后做免安装版（Node SEA 或 bun compile 打成单个可执行文件），双击启动后自动打开浏览器。

### 7.3 云端模式

仓库里提供 `deploy/` 目录。**这个目录是写给 agent 看的**：老师对自己的 AI 说"帮我部署到我的服务器"，agent 照着做就能完成。

```
deploy/
├── Dockerfile          多阶段构建：node:22-slim（glibc，better-sqlite3 可直接用预编译包）
├── compose.yaml        app + Caddy（自动申请 HTTPS 证书）
├── Caddyfile           域名 → app:3000
├── .env.example        BETTER_AUTH_SECRET、BETTER_AUTH_URL、DOMAIN、备份相关配置
└── DEPLOY.md           给 agent 的部署步骤和验收清单
```

要点：
- **只能跑一个实例**。数据在 SQLite 里，不能横向扩容，也不需要：一个老师甚至一个年级组都远远用不到这个量级。compose 里写死 `replicas: 1`。
- **数据放在数据卷里**：`/app/data`（含 app.db 和 backups/）。升级时只换镜像，启动时自动迁移表结构（磐石已有这个机制）；迁移前先自动备份一次。
- **强制 HTTPS**。Caddy 自动申请证书；Better Auth 会话 cookie 走 HTTPS；生产环境没设置密钥就拒绝启动（磐石已有这个检查）。
- **健康检查**：`/api/health` 用作 Docker healthcheck，也作为 agent 判断部署是否成功的依据。
- **云端使用 CLI**：`docker compose exec app banji ...`，主要用于忘记密码时重置、手动备份、导入数据。
- **备份**：容器里每天自动备份，保留最近 30 份；可选配置 S3 兼容的对象存储（阿里云 OSS、腾讯云 COS、Cloudflare R2）做异地备份；网页设置页可以一键下载 `.db` 文件。
- **一键部署平台**（Zeabur、Railway 这类支持 Dockerfile 和持久化数据卷的平台）放到 P3 再做，用的还是同一个 Dockerfile。

`DEPLOY.md` 按 agent 能逐步执行、逐步验证的方式来写：
1. 前置检查：服务器能用 Docker；域名已经解析到服务器 IP；80 和 443 端口开着。
2. 生成密钥，填写 `.env`。
3. `docker compose up -d`。
4. 验证：`curl https://域名/api/health` 返回 ok；打开网页能看到注册页。
5. 让老师注册主人账号，确认注册已经自动关闭。
6. 在设置页生成 MCP 令牌，写进老师本机 agent 的配置。
7. 确认每日备份生效：手动触发一次备份，确认文件生成。

另外给开发用的 agent 加一个 skill `deploy-cloud`，内容和 DEPLOY.md 对应。

### 7.4 本地和云端之间迁移

两边的数据就是同一个 `app.db` 文件：
- **本地迁到云端**：本地执行 `banji backup` → 把文件上传到服务器 → `docker compose exec app banji restore <文件>`。也可以在云端网页的设置页直接上传备份。
- **云端迁回本地**：反过来操作。
- 恢复之前会自动备份当前数据，并检查两边的表结构版本：旧备份自动升级，比当前程序还新的备份拒绝恢复。

### 7.5 国内部署的现实问题

- **ICP 备案**：在中国大陆服务器上用域名对外提供网站服务，需要先备案，大约 1～3 周。备案期间可以先用本地模式加 Tailscale。
- **境外服务器**（香港等地）不用备案，但学生数据会出境。《个人信息保护法》对数据出境有专门规定，**不推荐**。
- **数据合规**：云端模式下，数据保存在老师自己租的服务器上，老师就是数据处理者。项目文档里要写清楚建议：只存教学必需字段、开 HTTPS、定期备份、不要把服务器地址和账号外传。不满 14 周岁未成年人的个人信息在《个人信息保护法》里属于敏感个人信息，这一点要单独说明。

磐石自己的定位说明也写了，"涉及敏感数据、给外部人员用"超出了模板的设计范围。所以云端模式在开源发布之前，要专门做一次安全评审，包括登录限流、依赖漏洞检查、备份加密。

---

## 8. 路线图

| 阶段 | 目标 | 内容 |
|---|---|---|
| **P0：她下周能用** | 替代默写表和积分表 | 名册和分组导入（agent 路线）、检查项和待过关池、积分（含自动积分）、撤销、首页"今天要追的人"、每日自动备份；登录（better-auth，第一个注册的人是主人）；CLI 基础命令 |
| **P1：成绩与档案** | 考后分析 | 考试录入和分析、学生档案、谈话记录、CSV 导出、打印样式；**MCP 上线**，加周报、谈话准备两个 prompt |
| **P1.5：上云** | 手机随时可用 | `deploy/`（Dockerfile + compose + Caddy）、DEPLOY.md 和 deploy-cloud skill、HTTP MCP 访问令牌、备份上传和恢复、本地迁移到云端 |
| **P2：班务与移动** | 班主任工作 | 座位编辑器（通用网格、多方案、强弱搭配）、值日轮换；手机端布局优化；拍照录入（agent 识别后先给预览） |
| **P3：开源** | 别的老师也能用 | 学期管理和归档、网页导入向导、可配置模板（学段/学科）、免安装版、一键部署平台、多老师协作、安全评审、文档 |

## 9. 待确认的问题

1. 她的电脑能装 Node 吗？如果不能，P0 就得先做单文件可执行版。
2. 她平时用哪个 AI 工具？这决定先对接哪个 MCP 客户端。
3. 在教室手机上，她只看数据，还是也要记分？这决定 P0 的手机页面做到什么程度。
4. 搭班老师（比如数学老师）会不会来记分？如果会，多用户要提前到 P2。
5. 项目叫什么名字？CLI 命令暂时叫 `banji`。
6. 她有没有云服务器或域名？域名有没有备案？这决定云端模式什么时候能上线；在那之前先用本地模式加 Tailscale。
