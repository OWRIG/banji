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
    // score 分数登记 / mark 快速标记 / level 分等级（背书：抄书、读书、背部分、全背）
    mode: text("mode").notNull().default("score"),
    // 是否判定过关：不判定时只记录成绩，不产生待过关
    requirePass: integer("require_pass", { mode: "boolean" }).notNull().default(true),
    passLine: real("pass_line").notNull().default(80),
    fullScore: real("full_score").notNull().default(100),
    // 未登记扣分的截止日（北京时间），为空表示不开启；旧表保持关闭。
    missingDeadline: text("missing_deadline"),
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
    // pass 过 / pass_retry 二次过 / fail 未过 / leave 请假 / exempt 免；分等级时 copy 抄书 / read 读书 / partial 背部分 / full 全背
    mark: text("mark"),
    // 销账：未达标的学生补过之后记下日期
    clearedAt: text("cleared_at"),
    clearedNote: text("cleared_note").notNull().default(""),
    updatedAt: text("updated_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("check_results_unique_idx").on(t.checkId, t.studentId)],
)

// 建表时应登记的学生名单：每人每表一个积分来源，之后转入的学生不追扣旧表。
export const checkExpectations = sqliteTable(
  "check_expectations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    checkId: integer("check_id")
      .notNull()
      .references(() => checks.id),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
  },
  (t) => [uniqueIndex("check_expectations_unique_idx").on(t.checkId, t.studentId)],
)
