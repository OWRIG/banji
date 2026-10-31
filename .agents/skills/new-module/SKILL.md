---
name: new-module
description: 新增一个功能模块，例如"座位表""值日表""抽签点名""谈话记录""考试成绩""作业收交"。也用于给已有模块加一个操作。模块写好后，网页、命令行、MCP、首页、学生档案、自动积分都会自动接上。
---

# 新增功能模块

参照现有的 `src/modules/checks/`（默写过关）写，它用到了模块的全部能力：

```
src/modules/checks/
├── schema.ts       checks、check_results 两张表
├── shared.ts       口径：过关判定、统计、结果解析（前后端共用）
├── ops.ts          业务操作：checks.create / checks.record / pending.clear …
├── index.ts        defineModule：ops、tables、pointSources、autoRules、studentFacts、brief、profile
├── web.tsx         导航、首页按钮和卡片、档案卡片
└── checks.test.ts  业务测试
src/web/routes/checks/、src/web/routes/pending.tsx   页面
```

## 第 0 步：用业务语言确认需求

- 要记录什么？和学生、班级是什么关系？哪些必填？
- 需要哪些操作？哪些会删除或覆盖数据（做成 danger）？
- 首页要不要显示什么（今天要处理的事）？学生档案里要不要显示？学生列表要不要加一列统计？
- 要不要自动加分（例如"值日认真 +1"）？触发条件是什么？
- 涉及隐私字段（家长信息、身份证号等）时，建议不存。

能合理推断的直接按推断做，做完告诉用户你是怎么理解的。

## 步骤

1. **建目录** `src/modules/<id>/`（id 用英文小写，例如 `seats`、`duty`、`notes`）。

2. **数据表** `schema.ts`：
   ```ts
   import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
   import { now } from "@/server/db/columns"
   import { students } from "@/server/db/schema"

   export const notes = sqliteTable("notes", {
     id: integer("id").primaryKey({ autoIncrement: true }),   // 必须有整数 id，才能撤销
     studentId: integer("student_id").notNull().references(() => students.id),
     date: text("date"),
     text: text("text").notNull(),
     createdAt: text("created_at").notNull().$defaultFn(now),
   })
   ```
   在 `src/server/db/schema.ts` 末尾加一行 `export * from "@/modules/<id>/schema"`，然后 `pnpm db:generate`、`pnpm db:migrate`。新表应该**只有 `CREATE TABLE`**；出现 `ALTER`/`DROP` 改读 db-change skill。

3. **业务操作** `ops.ts`：每个操作一个 `defineOp`，名字用 `<id>.<动作>`。写库必须用 `ctx.insert / ctx.update / ctx.remove`。
   ```ts
   export const addNote = defineOp({
     name: "notes.add",
     title: "记录谈话",
     description: "给学生记一条谈话/家访/观察记录。",   // 写给 agent 看，说清楚效果
     kind: "write",
     input: z.object({ student: studentRef, text: z.string().trim().min(1, "请填写内容").max(2000) }),
     run: async (ctx, input) => {
       const s = await resolveStudent(input.student)
       const note = await ctx.insert(notes, { studentId: s.id, text: input.text })
       ctx.summary = `给 ${s.name} 记录谈话`
       return note
     },
   })
   ```

4. **声明模块** `index.ts`：
   ```ts
   export const notesModule = defineModule({
     id: "notes",
     title: "谈话记录",
     description: "谈话、家访、观察记录",
     ops: [addNote, listNotes, deleteNote],
     tables: [notes],
     profile: async ({ studentId }) => ({ notes: await ... }),   // 学生档案里显示（可选）
     // brief / studentFacts / pointSources / autoRules 按需要加
   })
   ```
   需要自动加分时：`pointSources` 里实现 `awards(ctx, trigger, sourceIds)`，返回满足条件的 (sourceId, studentId)；`autoRules` 写默认规则；数据改动后调用 `syncAutoPoints(ctx, sourceType, 受影响的编号)`（包括刚删除的）。参考 checks。

5. **登记**：加到 `src/server/registry.ts` 的 `modules` 里。`bin/banji ops` 能看到新操作，MCP 也会自动出现。

6. **测试** `src/modules/<id>/<id>.test.ts`：用 `runOp(ops["notes.add"], {...}, { actor: "test" })`。覆盖正常流程、参数不合法、找不到、撤销（`runOp(ops.undo, ...)`），有自动积分的要测"不重复加分"。测试开头调用 `await initModules()`。

7. **网页**：
   - 页面放 `src/web/routes/<id>/`，用 `useOp` 读、`useOpMutation` 写、`useDangerOp` 做危险操作。
   - `src/modules/<id>/web.tsx` 导出 `WebModule`：`nav`（导航入口）、`HomeCard`、`ProfileCard`、`HomeActions`，按需要写。只能 import 前端代码和本模块的 `shared.ts`，服务端的东西只能 `import type`。
   - 加到 `src/web/modules.ts` 的 `webModules` 里。

8. **检查**：`pnpm check` 全部通过。

9. 告诉用户：网页上在哪里用；也可以让 agent 直接说（例如"给李明记一条谈话：最近上课走神"）；不需要时可以在「数据与设置 → 功能模块」停用。

## 不要做

- 不要为了这个功能去改平台代码（`src/server/core/`、`registry.ts` 的汇总逻辑、`app.ts`、`mcp.ts`）。平台缺能力时，先向用户说明。
- 功能模块之间不要互相 import。
