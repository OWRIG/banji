import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { now } from "@/server/db/columns"
import { students } from "@/server/db/schema"

// 谈话记录模块的数据表

export const notes = sqliteTable(
  "notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    // talk 谈话 / visit 家访 / observe 观察
    kind: text("kind").notNull().default("talk"),
    date: text("date").notNull(),
    text: text("text").notNull(),
    actor: text("actor").notNull().default(""),
    createdAt: text("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("notes_student_idx").on(t.studentId)],
)
