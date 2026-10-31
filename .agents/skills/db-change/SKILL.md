---
name: db-change
description: 修改已经存在的数据表结构，例如给表加字段、字段改名、删字段、改字段类型、删表。这类改动可能导致已有数据丢失，动手前必须读。新建表不需要这个 skill。
---

# 修改已有数据表

## 1. 先判断风险

| 改动 | 风险 | 做法 |
|---|---|---|
| 加一个选填字段（`.notNull().default(...)` 或允许为空） | 安全 | 直接做 |
| 加一个必填字段，但**没有默认值** | 已有数据没法填，迁移会失败 | 加上 `.default(...)` |
| 字段改名、表改名 | 迁移工具会停下来提问（AI 无法回答） | 按下面「改名」的三步做 |
| 删字段、删表 | **数据永久丢失** | 先向用户确认 |
| 改字段类型 | 可能转换失败或丢数据 | 先向用户确认；按「改名」的方式新建字段、搬数据 |

**有风险的改动，先向用户确认，再动手。** 用业务语言讲后果，不讲 SQL：

> 删掉“备注”这一栏之后，已经填写的备注会永久删除，无法恢复。确定要删吗？

能查到受影响的条数就一起告诉用户，例如：

```
node -e "const D=require('better-sqlite3');console.log(new D('data/app.db',{readonly:true}).prepare(\"select count(*) as n from customers where note != ''\").get())"
```

## 2. 步骤

1. 修改 `src/server/db/schema.ts`。
2. `pnpm db:generate`
3. 打开 `drizzle/` 里最新生成的 `.sql` 文件，核对和预期一致：
   - SQLite 的很多改动会生成“建新表 → 复制数据 → 删旧表 → 改名”一组语句，这是正常的；确认其中有 `INSERT INTO ... SELECT` 把旧数据复制过去。
   - 出现了预期之外的 `DROP`，停下来重新检查 schema.ts。
4. `pnpm db:backup`（备份到 `data/backups/`）
5. `pnpm db:migrate`
6. 同步修改受影响的校验规则、接口、页面和测试，然后 `pnpm check`。

注意：`pnpm dev` 运行时，改动后端代码会让服务重启，重启时会自动执行迁移。所以第 3 步核对完、第 4 步备份之前，不要去改其他后端代码。

## 3. 改名：三步走

直接改名时，`pnpm db:generate` 分不清是“改名”还是“删一个、加一个”，会停下来要求在终端里回答，然后报错 `Interactive prompts require a TTY terminal`。改用下面三步（以 `todos.title` 改名为 `name` 为例）：

1. **加新字段**：schema.ts 里保留 `title`，新增 `name: text("name").notNull().default("")`，然后 `pnpm db:generate`。
2. **搬数据**：`pnpm db:generate --custom --name copy_title_to_name`，会生成一个只有一行注释的 `.sql` 文件。在注释**下面另起一行**写：
   ```sql
   UPDATE `todos` SET `name` = `title`;
   ```
   （不要写在注释同一行，否则整句会被当成注释。这个文件也不能留空：只有注释的迁移文件会导致迁移报错 `contains no statements`，服务启动不了。）
3. **删旧字段**：从 schema.ts 删掉 `title`，然后 `pnpm db:generate`。

然后照上面第 2 节的第 4–6 步：备份 → `pnpm db:migrate` → 把代码里的 `title` 全部改成 `name` → `pnpm check`。

改字段类型也用同样的思路：新建一个正确类型的字段 → 用 `UPDATE` 转换并搬数据 → 删掉旧字段。

## 4. 出了问题怎么办

- **迁移执行失败**：整次迁移会自动回滚，数据库保持原样。看报错修改后重新生成。
- **生成的迁移不对、还没执行过**（没运行过 `pnpm db:migrate`，`pnpm dev` 也没有重启过）：删除这次生成的 `drizzle/<编号>_<名字>.sql` 和 `drizzle/meta/<编号>_snapshot.json`，再从 `drizzle/meta/_journal.json` 的 `entries` 里删掉最后一项，把 schema.ts 改回去。这是唯一允许删除迁移文件的情况。
- **迁移已经执行、数据出了问题**：先停止 `pnpm dev`，把 `data/backups/` 里最近的备份复制成 `data/app.db`（同时删掉 `data/app.db-wal` 和 `data/app.db-shm`），并告诉用户发生了什么。

## 禁止事项

- 不用 `drizzle-kit push`。
- 不修改已经执行过的迁移文件，不删除 `drizzle/` 目录。
- 不删除 `data/` 目录或数据库文件。
