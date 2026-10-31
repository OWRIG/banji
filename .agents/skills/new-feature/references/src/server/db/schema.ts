// 片段：把下面的表定义追加到项目的 src/server/db/schema.ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // 选填字段：notNull + default("")，避免页面上处理 null
  contact: text("contact").notNull().default(""),
  phone: text("phone").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
})
