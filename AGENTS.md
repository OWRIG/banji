# AGENTS.md

这份文件写给在这个项目里写代码的 AI。给人看的说明在 README.md。

## 这个项目是什么

这个项目基于「磐石（Panshi）」模板创建。磐石面向**没有工程背景的业务人员**：他们借助 AI 开发 demo 和内部系统，但没法判断技术方案的好坏。所以模板把技术选型、目录结构、写法约定、检查方式都提前定好了。

**你的任务是在这些已经定好的规则里实现业务需求，而不是重新做工程决策。**

## 和用户协作

- 用户通常不懂技术。用业务语言沟通：说“现在可以记录客户电话了”，不说“新增了 phone 字段和 PATCH 接口”。
- 不要让用户做技术选择（用哪个库、表怎么设计、接口怎么命名）。本文件有规定的照做；没有规定的，选最简单、最主流的做法，做完用一句话说明。
- 需求不清楚时问**业务问题**（“一个客户可以有多个联系人吗？”），不问技术问题。
- 会删除或改坏已有数据的操作，先用业务语言讲清后果，得到用户确认再做。
- 做完后告诉用户怎么在页面上看到效果。

## 适用范围

适合：demo、原型、内部系统（用户不多，部署在一台机器上）。

发现下面这些情况时，**主动提醒用户**：项目可能超出了这个模板的适用范围，建议找研发团队评审架构（例如把 SQLite 换成 PostgreSQL）：

- 需要部署多份，或者要求服务不能中断
- 同时写数据的人很多，或者数据量明显变大（例如单表几十万行以上且还在增长）
- 要给公司外部的人使用，或者涉及敏感数据（个人隐私、薪资、财务、账号密码等）
- 已经成为关键业务，需要多人长期维护

提醒一次并说明原因即可。用户决定继续的话，照常开发。

## 技术栈（已经定好，不要替换）

| 用途 | 选型 |
|---|---|
| 前端 | React + TypeScript，Vite 构建 |
| 页面路由 | TanStack Router（文件即路由） |
| 请求数据 | TanStack Query + Hono RPC 客户端 |
| 界面组件 | shadcn/ui + Tailwind CSS |
| 后端 | Hono（运行在 Node.js 上） |
| 数据库 | SQLite + Drizzle ORM |
| 数据校验 | zod（前后端共用） |
| 检查 | TypeScript + Biome + Vitest |

- 不引入和上面同类的其他库（例如 axios、Redux、Prisma、Express、ESLint、Prettier、其他 UI 组件库）。
- 确实需要新依赖时（例如图表、Excel 导入导出），选下载量大、维护活跃的库，并告诉用户加了什么、为什么。
- 包管理器只用 pnpm。

## 已启用的功能

- 登录：未启用。用户需要登录功能时，按 add-auth skill 添加。

（用 skill 加上新能力后，更新这一节。）

## 目录结构

```
src/
├── shared/              前后端共用的 zod 校验规则，一个业务一个文件
├── server/
│   ├── app.ts           所有接口在这里注册
│   ├── routes/          接口，一个业务一个文件，测试放在旁边（todos.ts / todos.test.ts）
│   ├── db/schema.ts     所有数据表的定义
│   ├── db/index.ts      数据库连接（连接时自动执行迁移）
│   └── env.ts           环境变量（用 zod 校验）
└── web/
    ├── routes/          页面，文件路径就是网址（todos.tsx → /todos）
    ├── routes/__root.tsx 整体外框和顶部导航
    ├── components/ui/   shadcn 组件（用命令添加，一般不手改）
    ├── components/      自己写的组件，按业务分目录
    └── lib/api.ts       调用后端接口的 api 对象
drizzle/                 数据库迁移文件（命令生成）
data/                    SQLite 数据文件和备份（不提交到 git）
```

`@/` 指向 `src/`，例如 `import { db } from "@/server/db"`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动开发环境（前端 + 后端），访问地址以终端打印的为准 |
| `pnpm check` | 完整检查：类型、代码规范、测试 |
| `pnpm fix` | 自动修复格式问题 |
| `pnpm db:generate` | 改完 schema.ts 后生成迁移文件 |
| `pnpm db:migrate` | 立即把数据库升级到最新结构 |
| `pnpm db:backup` | 备份数据库到 data/backups/ |
| `pnpm db:studio` | 在浏览器里查看、编辑数据 |
| `pnpm build` / `pnpm start` | 打包 / 上线运行（一个进程同时提供页面和接口） |
| `pnpm dlx shadcn@latest add <组件>` | 添加界面组件 |

## 写法约定

项目自带的 todos 示例演示了下面所有约定，写新功能前先读一遍：
`src/shared/todos.ts` → `src/server/db/schema.ts` → `src/server/routes/todos.ts`（和 `todos.test.ts`）→ `src/server/app.ts` → `src/web/routes/todos.tsx`

### 后端接口

- 一个业务一个文件，放在 `src/server/routes/`，在 `app.ts` 里用 `.route()` 注册。
- **必须链式写**：`new Hono().get(...).post(...)`。分开写（`const r = new Hono(); r.get(...)`）会让前端拿不到接口类型。
- 请求参数一律用 `zValidator` 加上 `src/shared/` 里的规则校验，不要手动解析 `c.req.json()`。
- 查询统一用 `await db.select()...` 的写法，不用 `.all()` / `.get()` / `.run()`（以后换 PostgreSQL 时这部分代码不用改）。
- 记录不存在时返回 `c.json({ message: "记录不存在" }, 404)`。给用户看的提示都用中文。

### 数据库

- 所有表定义在 `src/server/db/schema.ts`。改表流程：改 schema.ts → `pnpm db:generate` → `pnpm db:migrate`。
- 不用 `drizzle-kit push`。不手写、不修改、不删除 `drizzle/` 里的迁移文件。
- **修改已有的表**（加字段、改名、删字段、改类型）前，先读 db-change skill。

### 前端

- 新页面：在 `src/web/routes/` 下新建文件，然后在 `__root.tsx` 的导航里加链接。
- 调接口用 `useQuery` / `useMutation` + `parseResponse(api.xxx.$get())`，不要直接用 `fetch`，也不要在 `useEffect` 里取数据。
- 修改数据成功后，用 `queryClient.invalidateQueries` 刷新相关数据。
- 列表要处理三种状态：加载中、出错、没有数据。
- 界面优先用 shadcn 组件：先看 `components/ui/` 里有没有，没有就用命令添加。样式用 Tailwind class，不写单独的 CSS 文件。
- 界面文字用中文。

### 校验

- 同一份 zod 规则放在 `src/shared/`，前端提交前和后端接收时都用它。
- 新的环境变量加在 `src/server/env.ts` 里并校验，同时写进 `.env.example`；代码里不要直接读 `process.env`。

### 测试

- 每个接口文件都要有测试，至少覆盖：正常流程、参数不合法（400）、记录不存在（404）。
- 用 `app.request()` 调接口，不需要启动服务器；测试自动使用内存数据库，不会影响开发数据。

## 完成标准

每次改完代码，**必须运行 `pnpm check` 并且全部通过**，才能告诉用户完成了。

- 格式问题先运行 `pnpm fix`。
- 其他报错要修真正的原因。**不许**用 `any`、`@ts-ignore`、`@ts-expect-error`、`biome-ignore`、删除或跳过测试等方式让检查通过。
- 同一个问题修了三次还过不去，停下来，用业务语言向用户说明卡在哪里。

## 禁止事项

- 不把密码、密钥、token 写进代码。放在 `.env`，并在 `.env.example` 里写上变量名（不写真实值）。
- 不用字符串拼接 SQL，用 Drizzle 的查询写法。
- 不删除 `data/` 目录或数据库文件。
- 不修改技术栈和目录结构，不为了“更好的架构”做大规模重构。
- 前端代码不 import `src/server/` 下的实现代码（类型除外，用 `import type`）。

## 技能（skills）

`.agents/skills/` 里有具体任务的详细步骤和验证过的参考代码。遇到对应任务时，先读 skill 再动手：

| skill | 什么时候用 |
|---|---|
| new-feature | 新增一个业务功能（数据表 + 接口 + 页面），包括表单、表格、编辑页 |
| db-change | 修改已经存在的数据表：加字段、改名、删字段、改类型、删表 |
| add-auth | 给项目加上登录功能 |

## 示例模块

todos 只是示例。第一个真实功能做完、`pnpm check` 通过之后，可以询问用户是否删除它：

1. 删除 `src/shared/todos.ts`、`src/server/routes/todos.ts`、`src/server/routes/todos.test.ts`、`src/web/routes/todos.tsx`
2. 从 `app.ts` 去掉 `.route("/todos", ...)`，从 `__root.tsx` 的导航去掉链接，改写首页 `src/web/routes/index.tsx`
3. 从 `schema.ts` 删掉 todos 表，运行 `pnpm db:generate` 和 `pnpm db:migrate`
4. `pnpm check`

删掉之后，写新功能时参照 new-feature skill 的参考代码和项目里已有的业务模块。
