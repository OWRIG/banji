# AGENTS.md

这份文件写给在这个项目里**写代码**的 AI。给人看的说明在 README.md；给**使用**工作台的 agent 的说明在 MCP 服务的 instructions 里（`src/server/mcp.ts`）。

## 这个项目是什么

「班级工作台」：给中小学老师用的班级数据工具（默写过关、待过关名单、积分、学生档案）。第一个用户是一位初中班主任兼英语老师，之后开源给更多老师。设计思路见 `docs/design.md`。

项目基于「磐石（Panshi）」模板，技术栈和大部分写法约定沿用磐石；**最大的不同是业务逻辑放在操作层（ops），网页、命令行、MCP 三个入口共用**，见下文。

用户（老师）通常不懂技术：用业务语言沟通，不让用户做技术选择；需求不清楚时问业务问题；会删除或改坏数据的操作先讲清后果并确认。

## 涉及学生数据，注意

- 只存教学必需字段（学号、姓名、性别、小组、成绩、积分、记录）。**不要加家长信息、身份证号、住址等字段**，用户要求时说明原因并建议不存。
- 成绩、积分排名只给老师本人看。不做公开排名、对外分享排名的功能。
- 不把学生数据发到任何外部服务（统计、日志、AI 接口等）。

## 架构：一套业务操作，三个入口

```
src/server/ops/*.ts   业务操作（defineOp）  ← 业务规则只写在这里
        │
        ├── 网页：POST /api/ops/<操作名>（src/server/app.ts）→ 前端 src/web/lib/ops.ts
        ├── 命令行：bin/banji（src/cli/index.ts）
        └── MCP：src/server/mcp.ts（stdio：banji mcp；HTTP：/mcp + 访问令牌）
```

- 每个操作是 `defineOp({ name, title, description, kind, input, run })`，在 `src/server/ops/index.ts` 的 `list` 里登记后，**网页接口、CLI（`banji call`）、MCP 工具会自动出现**，不需要分别写。
- `kind`：
  - `read`：只读。
  - `write`：修改数据。必须通过 `ctx.insert / ctx.update / ctx.remove` 写库，这样才会记录变更、可以撤销。不要在 write 操作里直接 `db.insert/update/delete` 业务表。
  - `danger`：删除、批量覆盖类。input 里加 `confirm: confirmField`；框架会先执行一遍再回滚，返回预览和确认码，带确认码再调用才生效。
- `description` 和 zod 字段的 `.describe()` 会原样给 agent 看：写清楚参数含义、取值、会产生什么效果。
- 学生、班级参数用 `studentRef` / `classRef`，用 `resolve.ts` 里的函数解析（支持姓名、学号、班级代号）。**对不上或有歧义时报错并列出候选，不要猜。**
- 出错时 `throw new OpError(状态码, "给老师看的中文说明")`：400 参数不对、404 找不到、409 冲突/需要确认。
- `ctx.summary` 写一句业务语言的摘要（"登记「U3 默写 1」：李明、王芳"），会显示在撤销提示和操作记录里。
- 新增业务表时，把表加到 `define.ts` 的 `trackedTables`，否则无法记录变更和撤销。
- 自动积分用"投影"方式结算（`auto-points.ts`）：来源数据改动后调用 `syncAutoPointsForChecks`，不要手写"加一次分"的逻辑。

## 技术栈（已经定好，不要替换）

| 用途 | 选型 |
|---|---|
| 前端 | React + TypeScript，Vite 构建 |
| 页面路由 | TanStack Router（文件即路由） |
| 请求数据 | TanStack Query + `src/web/lib/ops.ts`（类型来自操作层） |
| 界面组件 | shadcn/ui + Tailwind CSS |
| 后端 | Hono（运行在 Node.js 上） |
| 数据库 | SQLite + Drizzle ORM |
| 数据校验 | zod |
| 登录 | Better Auth（邮箱 + 密码；第一个注册的账号是主人，之后关闭注册） |
| MCP | @modelcontextprotocol/sdk |
| 命令行 | commander |
| 检查 | TypeScript + Biome + Vitest |

- 不引入和上面同类的其他库。确实需要新依赖时，选下载量大、维护活跃的库，并告诉用户加了什么、为什么。
- 包管理器只用 pnpm。

## 目录结构

```
src/
├── shared/              前后端共用的纯函数和口径（例如 checks.ts：过关判定、统计、结果解析）
├── server/
│   ├── ops/             业务操作，一个领域一个文件；ops.test.ts 是业务测试
│   │   ├── define.ts    defineOp / runOp / Ctx（事务、变更记录、确认码）
│   │   ├── index.ts     操作登记表
│   │   └── resolve.ts   姓名、班级、检查的解析
│   ├── app.ts           HTTP 入口：/api/ops/:name、登录、备份下载、/mcp
│   ├── mcp.ts           把操作注册成 MCP 工具
│   ├── auth.ts          Better Auth 配置
│   ├── backup.ts        备份、恢复
│   ├── db/schema.ts     所有数据表
│   └── env.ts           环境变量
├── cli/                 banji 命令行
└── web/
    ├── routes/          页面（文件路径就是网址）；__root.tsx 里有导航
    ├── components/      common.tsx（页头、空状态、班级切换等）、danger.tsx（危险操作确认弹窗）、ui/（shadcn）
    └── lib/ops.ts       useOp / useOpMutation / callOp
deploy/                  云端部署（Dockerfile 在根目录），DEPLOY.md 是写给部署 agent 的步骤
drizzle/                 数据库迁移文件（命令生成）
data/                    本地数据库和备份（不提交到 git）
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动开发环境（前端 + 后端），访问地址以终端打印的为准 |
| `pnpm check` | 完整检查：类型、代码规范、测试 |
| `pnpm fix` | 自动修复格式问题 |
| `pnpm db:generate` | 改完 schema.ts 后生成迁移文件 |
| `pnpm db:migrate` | 立即把数据库升级到最新结构（有待执行的升级时会先自动备份） |
| `bin/banji ...` | 命令行，见 `bin/banji --help` |
| `pnpm build` / `pnpm start` | 打包 / 上线运行 |

## 写法约定

### 前端

- 读数据：`useOp("操作名", 参数)`；写数据：`useOpMutation("操作名")`（成功后自动刷新，并弹出带"撤销"的提示）；危险操作：`useDangerOp`。不要直接写 `fetch`。
- 列表要处理加载中、出错、没有数据三种状态（用 `QueryState`、`Empty`）。空状态写清楚下一步做什么。
- 界面文字用中文，不用 emoji（用 ✓ ✕ ↑ ↓ 等符号）。不需要打印的元素加 `no-print`。
- 手机上也要能用：布局用响应式 class，不要写死宽度。

### 数据库

- 改表流程：改 schema.ts → `pnpm db:generate` → `pnpm db:migrate`。不手写、不修改 `drizzle/` 里的迁移文件。
- **修改已有的表**前先读 db-change skill。
- 业务表的时间存 ISO 字符串，业务日期存 `YYYY-MM-DD`（可以为空）。

### 测试

- 业务规则的测试写在 `src/server/ops/*.test.ts`，直接调用 `runOp`。每个新操作至少覆盖：正常流程、参数不合法、找不到、撤销。
- 测试自动使用内存数据库。

## 完成标准

每次改完代码，**必须运行 `pnpm check` 并且全部通过**，才能告诉用户完成了。

- 格式问题先运行 `pnpm fix`。
- **不许**用 `any`、`@ts-ignore`、`@ts-expect-error`、`biome-ignore`、删除或跳过测试等方式让检查通过。
- 同一个问题修了三次还过不去，停下来，用业务语言向用户说明卡在哪里。

## 禁止事项

- 不把密码、密钥、token 写进代码。
- 不用字符串拼接 SQL。
- 不删除 `data/`、`deploy/data/` 目录或数据库文件。
- 不绕过操作层直接改业务数据（包括在路由、CLI、MCP 里直接写库）。
- 不修改技术栈和目录结构，不为了"更好的架构"做大规模重构。

## 技能（skills）

`.agents/skills/` 里有具体任务的步骤：

| skill | 什么时候用 |
|---|---|
| new-op | 新增一个业务功能：数据表 + 业务操作 + 页面（三个入口自动生效） |
| db-change | 修改已经存在的数据表：加字段、改名、删字段、改类型、删表 |
| deploy-cloud | 把工作台部署到云服务器（Docker + HTTPS） |
