# AGENTS.md

这份文件写给在这个项目里**写代码**的 AI。给人看的说明在 README.md；给**使用**工作台的 agent 的说明在 MCP 服务的 instructions 里（`src/server/mcp.ts`）。

## 这个项目是什么

「班级工作台」：给中小学老师用的班级数据工具（默写过关、待过关名单、积分、学生档案），按"平台 + 功能模块"组织。第一个用户是一位初中班主任兼英语老师，之后开源给更多老师。设计思路见 `docs/design.md`。

项目基于「磐石（Panshi）」模板，技术栈和大部分写法约定沿用磐石；**最大的不同是业务逻辑放在模块的操作层（ops），网页、命令行、MCP 三个入口共用**，见下文。

用户（老师）通常不懂技术：用业务语言沟通，不让用户做技术选择；需求不清楚时问业务问题；会删除或改坏数据的操作先讲清后果并确认。

## 涉及学生数据，注意

- 只存教学必需字段（学号、姓名、性别、小组、成绩、积分、记录）。**不要加家长信息、身份证号、住址等字段**，用户要求时说明原因并建议不存。
- 成绩、积分排名只给老师本人看。不做公开排名、对外分享排名的功能。
- 不把学生数据发到任何外部服务（统计、日志、AI 接口等）。

## 架构：平台 + 模块（插件）

老师的需求会不断以"小功能"的形式加进来（座位表、值日表、抽签点名、谈话记录、考试成绩……）。**每个功能是一个模块，放在 `src/modules/<id>/`，在 `index.ts` 里用 `defineModule` 声明它带来了什么；平台自动把它接到所有入口上。** 新功能不要改平台代码。

```
src/modules/<id>/
├── schema.ts      数据表（在 src/server/db/schema.ts 末尾 export * 出来）
├── shared.ts      口径：纯函数，前后端共用（过关判定、统计……）
├── ops.ts         业务操作（defineOp）
├── index.ts       defineModule：ops / tables / pointSources / autoRules / studentFacts / brief / profile
├── web.tsx        网页部分：nav / HomeActions / HomeCard / ProfileCard
└── *.test.ts      业务测试
src/web/routes/... 模块的页面（文件路由）
```

模块声明的东西会自动出现在：

| 声明 | 效果 |
|---|---|
| `ops` | 网页接口 `/api/ops/<名字>`、命令行 `banji call <名字>`、MCP 工具 `<名字 . 换成 _>` |
| `tables` | 变更记录与撤销（没登记的表不能用 ctx 写入，会直接报错） |
| `pointSources` + `autoRules` | 自动积分（积分引擎 `core/points-engine.ts`，幂等结算） |
| `studentFacts` | 学生列表的统计列（例如"待过关"） |
| `brief` | 首页概览 `brief.today` 的 `sections[id]`（agent 每天看的也是这个） |
| `profile` | 学生档案 `students.profile` 的 `sections[id]` |
| `web.tsx` | 导航入口、首页按钮和卡片、学生档案卡片 |

登记：服务端在 `src/server/registry.ts` 的 `modules`，网页端在 `src/web/modules.ts` 的 `webModules`。非核心模块老师可以在设置里停用：停用后操作被拒绝、MCP 不再提供、导航和首页隐藏，数据保留。

模块之间的规矩：
- 模块可以用平台（`@/server/core/*`、核心表 classes/students/groups/point_*）和核心模块（roster、points、system）。**功能模块之间不要互相 import**；需要联动时通过平台机制（例如积分来源），或者先和用户确认再把共用部分提到平台。
- 平台代码（`src/server/core/`、`registry.ts`）不能 import 任何功能模块的具体内容，只能通过 `defineModule` 声明的接口汇总。

### 业务操作（defineOp）

- 每个操作是 `defineOp({ name, title, description, kind, input, run })`。名字用 `<模块>.<动作>`。
- `kind`：
  - `read`：只读。
  - `write`：修改数据。必须通过 `ctx.insert / ctx.update / ctx.remove` 写库，这样才会记录变更、可以撤销。
  - `danger`：删除、批量覆盖类。input 里加 `confirm: confirmField`；框架先执行一遍再回滚，返回预览和确认码，带确认码再调用才生效。
- `description` 和 zod 字段的 `.describe()` 会原样给 agent 看：写清楚参数含义、取值、会产生什么效果。
- 学生、班级参数用 `studentRef` / `classRef`，用 `core/resolve.ts` 解析（支持姓名、学号、班级代号）。**对不上或有歧义时报错并列出候选，不要猜。**
- 出错时 `throw new OpError(状态码, "给老师看的中文说明")`：400 参数不对、404 找不到、409 冲突/需要确认。
- `ctx.summary` 写一句业务语言的摘要（"登记「U3 默写 1」：李明、王芳"），会显示在撤销提示和操作记录里。
- 会产生自动积分的数据改动后，调用 `syncAutoPoints(ctx, 来源类型, 受影响的记录编号)`（包括刚删除的），不要手写"加一次分"。

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
├── modules/             功能模块，一个功能一个文件夹（见上文）。核心模块：roster 名册、points 积分、system 系统
├── shared/format.ts     通用显示和日期小工具
├── server/
│   ├── core/            平台：define.ts（defineOp / runOp / Ctx）、module.ts（defineModule）、
│   │                    points-engine.ts（自动积分）、resolve.ts（姓名班级解析）、rules.ts（默认规则）
│   ├── registry.ts      模块登记表，以及跨模块汇总的操作（今日概览、学生列表、学生档案、模块开关）
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
    ├── lib/ops.ts       useOp / useOpMutation / callOp
    └── modules.ts       网页端模块登记表
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

- 业务规则的测试写在模块目录里（`src/modules/<id>/*.test.ts`），直接调用 `runOp`。每个新操作至少覆盖：正常流程、参数不合法、找不到、撤销。
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
- 不为了某个功能去改平台代码（core/、registry.ts 的汇总逻辑）；平台缺能力时，先向用户说明再扩展。
- 不修改技术栈和目录结构，不为了"更好的架构"做大规模重构。

## 技能（skills）

`.agents/skills/` 里有具体任务的步骤：

| skill | 什么时候用 |
|---|---|
| new-module | 新增一个功能模块（座位表、值日、谈话记录……），或给已有模块加操作 |
| db-change | 修改已经存在的数据表：加字段、改名、删字段、改类型、删表 |
| deploy-cloud | 把工作台部署到云服务器（Docker + HTTPS） |
