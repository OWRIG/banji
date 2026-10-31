---
name: new-feature
description: 新增一个业务功能（数据表 + 后端接口 + 前端页面），例如“做一个客户台账”“加一个报销申请”“记录设备借用”。也用于在页面里做表单、表格、详情/编辑页。
---

# 新增业务功能

`references/` 里有一个完整、验证过的参考实现——「客户」功能：列表 + 搜索、新增、编辑、删除。目录结构和项目完全对应，照着改名、改字段即可：

```
references/src/
├── shared/customers.ts                        校验规则（前后端共用）
├── server/db/schema.ts                        数据表（片段，追加到项目的 schema.ts）
├── server/routes/customers.ts                 接口
├── server/routes/customers.test.ts            接口测试
├── web/components/customers/customer-form.tsx 表单（新增、编辑共用）
└── web/routes/customers/
    ├── index.tsx                              列表 + 搜索  → /customers
    ├── new.tsx                                新增        → /customers/new
    └── $id.tsx                                编辑 + 删除  → /customers/1
```

功能很简单时（一两个字段、不需要单独的编辑页），照项目里的 todos 示例写一个页面文件就够了。

## 第 0 步：用业务语言确认需求

动手前确认这几件事，**只问业务问题，不问技术问题**：

- 要记录哪些信息？哪些必填？（“客户名称必填，电话选填，对吗？”）
- 需要哪些操作？新增、编辑、删除、搜索、导出……
- 和已有的数据有没有关系？（“一个客户可以有多个联系人吗？”）

能合理推断的直接按推断做，做完告诉用户你是怎么理解的。

## 步骤

1. **校验规则** `src/shared/<功能>.ts`：新增和编辑共用一份规则；错误提示写成用户看得懂的中文。
2. **数据表** 追加到 `src/server/db/schema.ts`，然后：
   ```
   pnpm db:generate
   pnpm db:migrate
   ```
   打开 `drizzle/` 里最新生成的 `.sql` 文件看一眼：新增功能应该**只有 `CREATE TABLE`**。如果出现了 `ALTER`、`DROP` 或对已有表的改动，停下来，改读 db-change skill。
3. **接口** `src/server/routes/<功能>.ts` + 测试 `<功能>.test.ts`。
4. **注册接口**：在 `src/server/app.ts` 的链上加 `.route("/<功能>", <功能>Route)`。
5. **页面**：在 `src/web/routes/` 下新建页面文件，并在 `src/web/routes/__root.tsx` 的导航里加链接。
6. **检查**：`pnpm check` 全部通过。

命名：文件名、接口路径、表名用英文复数小写（`customers`、`expense_claims`）；页面上的文字用中文。

## 数据表字段怎么写

| 业务含义 | schema.ts | shared 校验规则 |
|---|---|---|
| 必填文字 | `text("name").notNull()` | `z.string().trim().min(1, "请填写…")` |
| 选填文字 | `text("note").notNull().default("")` | `z.string().trim().max(500)` |
| 整数 | `integer("quantity").notNull()` | `z.number().int()` |
| 金额 | `integer("amount_cents").notNull()`（按“分”存整数，显示时除以 100） | `z.number().int()` |
| 是 / 否 | `integer("paid", { mode: "boolean" }).notNull().default(false)` | `z.boolean()` |
| 日期时间 | `integer("due_at", { mode: "timestamp" })` | `z.coerce.date()` |
| 固定几个选项 | `text("status", { enum: ["draft", "approved"] }).notNull()` | `z.enum(["draft", "approved"])` |
| 关联另一张表 | `integer("customer_id").notNull().references(() => customers.id)` | `z.number().int()` |

- 选填的文字字段用 `notNull().default("")`，不要用 null，页面上就不用处理空值。
- 金额不要用小数存。
- 每张表都带 `createdAt`，需要记录修改时间的加 `updatedAt`（写法见参考实现）。

## 页面怎么组织

- 只有一个页面：`src/web/routes/<功能>.tsx`（如 todos.tsx）。
- 有列表、新增、编辑多个页面：用目录 `src/web/routes/<功能>/index.tsx`、`new.tsx`、`$id.tsx`。
- ⚠️ **不要同时存在 `customers.tsx` 和 `customers/` 目录**：TanStack Router 会把 `customers.tsx` 当成外框，子页面显示不出来。
- `src/web/routeTree.gen.ts` 是自动生成的（`pnpm dev` / `pnpm check` 时更新），不要手改。

## 表单

- **一两个字段**：`useState` + 提交时用 shared 规则 `safeParse`，照 `src/web/routes/todos.tsx`。
- **三个字段以上，或需要在每个输入框下面提示错误**：react-hook-form + shadcn 的 Field 组件，照 `references/.../customer-form.tsx`。第一次用时安装：
  ```
  pnpm add react-hook-form @hookform/resolvers
  pnpm dlx shadcn@latest add field textarea
  ```
- 新增和编辑共用同一个表单组件，编辑时把已有数据传给 `defaultValues`。
- 下拉选择、日期选择、单选等控件：先 `pnpm dlx shadcn@latest docs <组件名>` 看官方用法，再 `pnpm dlx shadcn@latest add <组件名>`。

## 列表和表格

- 用 shadcn 的 table 组件：`pnpm dlx shadcn@latest add table`。
- **搜索、筛选在后端做**：接口接收查询参数（参考实现里的 `?q=`），不要把全部数据拉到前端再过滤。
- 数据可能超过几百条时加分页：接口接收页码，用 `.limit()` / `.offset()` 查询，同时返回总条数。
- 删除前用 `window.confirm("确定删除「xx」吗？删除后无法恢复。")` 让用户确认。

## 容易出错的地方

- **接口必须链式写**：`new Hono().get(...).post(...)`，在 app.ts 里也是接在链上 `.route(...)`。分开写的话前端 `api.xxx` 会没有类型、提示“不存在”。
- **路由参数要传字符串**：`api.customers[":id"].$get({ param: { id: String(id) } })`。
- **改完数据要刷新**：`useMutation` 的 `onSuccess` 里调用 `queryClient.invalidateQueries({ queryKey: ["<功能>"] })`。
- **queryKey 以功能名开头**：`["customers", "list", q]`、`["customers", "detail", id]`。这样一次 invalidate `["customers"]` 就能刷新列表和详情。
- **列表处理三种状态**：加载中、出错、没有数据（搜索没结果时的提示和“还没有数据”要区分）。
- **测试至少覆盖**：正常新增和查询、参数不合法返回 400、记录不存在返回 404。
- 如果项目已经加了登录（有 `src/server/test-utils.ts`），测试里用 `signedInRequest()` 代替 `app.request`，写法见现有的测试文件。
