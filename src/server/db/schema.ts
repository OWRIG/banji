import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

// 所有数据表都定义在这个文件里。改完后运行 pnpm db:generate 生成迁移文件。

// 示例表：开始做真实需求后可以删除（步骤见 AGENTS.md「示例模块」）
export const todos = sqliteTable("todos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
})
