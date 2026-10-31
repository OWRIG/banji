---
name: new-op
description: 新增一个业务功能（例如"记录谈话"、"值日表"、"考试成绩"）：数据表 + 业务操作 + 页面。业务操作写好后，网页接口、命令行、MCP 工具会自动生效。也用于给已有功能加一个新操作（例如"批量调整分组"）。
---

# 新增业务功能

参照项目里已有的功能写，最完整的例子是「检查（默写）」：

```
src/shared/checks.ts            口径：过关判定、统计、结果解析（前后端共用的纯函数）
src/server/db/schema.ts         checks、check_results 两张表
src/server/ops/checks.ts        业务操作：checks.create / checks.record / pending.clear …
src/server/ops/ops.test.ts      业务测试
src/web/routes/checks/          页面：列表 + 新建弹窗、登记页
```

## 第 0 步：用业务语言确认需求

- 要记录哪些信息？哪些必填？和学生、班级是什么关系？
- 需要哪些操作？哪些操作删除或覆盖数据（要做成 danger）？
- 有没有需要自动计算的东西（统计、自动积分）？口径是什么？

能合理推断的直接按推断做，做完告诉用户你是怎么理解的。涉及隐私字段（家长信息、身份证号等）时，建议不存。

## 步骤

1. **数据表**：追加到 `src/server/db/schema.ts`，然后 `pnpm db:generate`、`pnpm db:migrate`。新表应该**只有 `CREATE TABLE`**；出现 `ALTER`/`DROP` 改读 db-change skill。
2. **登记可撤销的表**：把新表加到 `src/server/ops/define.ts` 的 `trackedTables`。
3. **口径**（可选）：纯计算逻辑放 `src/shared/<功能>.ts`，前端显示和后端计算共用。
4. **业务操作**：`src/server/ops/<功能>.ts`，每个操作一个 `defineOp`：
   ```ts
   export const addNote = defineOp({
     name: "notes.add",                       // 领域.动作；MCP 工具名会变成 notes_add
     title: "记录谈话",
     description: "给学生记一条谈话/家访/观察记录。",   // 写给 agent 看，说清楚效果
     kind: "write",                           // read | write | danger
     input: z.object({
       student: studentRef,
       text: z.string().trim().min(1, "请填写内容").max(2000),
     }),
     run: async (ctx, input) => {
       const s = await resolveStudent(input.student)
       const note = await ctx.insert(notes, { studentId: s.id, text: input.text })   // 写库必须走 ctx
       ctx.summary = `给 ${s.name} 记录谈话`
       return note
     },
   })
   ```
   - 读数据可以直接用 `db.select()`；**写数据必须用 `ctx.insert / ctx.update / ctx.remove`**。
   - 删除、批量覆盖用 `kind: "danger"`，input 里加 `confirm: confirmField`。
5. **登记**：在 `src/server/ops/index.ts` 的 `list` 里加上新操作。完成后 `bin/banji ops` 能看到它，MCP 也会自动出现。
6. **测试**：在 `src/server/ops/` 下写测试（可以新建 `<功能>.test.ts`），用 `runOp(ops["notes.add"], {...}, { actor: "test" })` 调用。覆盖正常流程、参数不合法、找不到、撤销（`runOp(ops.undo, ...)`）。
7. **页面**：在 `src/web/routes/` 新建页面，用 `useOp` 读、`useOpMutation` 写、`useDangerOp` 做危险操作；在 `__root.tsx` 的 `nav` 里加入口。
8. **检查**：`pnpm check` 全部通过。
9. 告诉用户：网页上在哪里看到；也可以让 agent 直接说"给李明记一条谈话"。
