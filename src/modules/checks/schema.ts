import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { now } from "@/server/db/columns"
import { classes, students } from "@/server/db/schema"

// 检查模块的数据表：默写、背书、作业订正……统一建模

export const checks = sqliteTable(
  "checks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id),
    // dictation 默写 / recite 背书 / homework 作业订正 / other 其他
    kind: text("kind").notNull().default("dictation"),
    title: text("title").notNull(),
    // 业务日期 YYYY-MM-DD，可以为空（历史数据没有日期）
    date: text("date"),
    // score 分数登记 / mark 快速标记
    mode: text("mode").notNull().default("score"),
    passLine: real("pass_line").notNull().default(80),
    fullScore: real("full_score").notNull().default(100),
    createdAt: text("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("checks_class_idx").on(t.classId)],
)

export const checkResults = sqliteTable(
  "check_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    checkId: integer("check_id")
      .notNull()
      .references(() => checks.id),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    score: real("score"),
    // pass 过 / pass_retry 二次过 / fail 未过 / leave 请假 / exempt 免
    mark: text("mark"),
    // 销账：未达标的学生补过之后记下日期
    clearedAt: text("cleared_at"),
    clearedNote: text("cleared_note").notNull().default(""),
    updatedAt: text("updated_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("check_results_unique_idx").on(t.checkId, t.studentId)],
)
