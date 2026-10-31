import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { now } from "@/server/db/columns"
import { classes, students } from "@/server/db/schema"
import type { Subject } from "./shared"

// 考试成绩模块的数据表

export const exams = sqliteTable(
  "exams",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id),
    // unit 单元检测 / stage 阶段测试 / monthly 月考 / midterm 期中 / final 期末 / other 其他
    type: text("type").notNull().default("unit"),
    title: text("title").notNull(),
    // 业务日期 YYYY-MM-DD，可以为空
    date: text("date"),
    // 科目、满分、是否计入总分，例如 [{"name":"数学","full":120,"inTotal":true}]
    subjects: text("subjects", { mode: "json" }).$type<Subject[]>().notNull(),
    // 同卷标记：几个班考同一张卷子时填同一个值，用来做班级对比
    paperGroup: text("paper_group"),
    createdAt: text("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("exams_class_idx").on(t.classId)],
)

export const examScores = sqliteTable(
  "exam_scores",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    examId: integer("exam_id")
      .notNull()
      .references(() => exams.id),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    // 科目名；「总分」这一行只用来存导入的总分名次，分数由各科相加得到
    subject: text("subject").notNull(),
    score: real("score"),
    // leave 请假 / absent 缺考（不计入统计）；有分数时为空
    status: text("status"),
    // 从学校成绩表导入的名次（可空）；班级名次没有导入时按分数现算
    classRank: integer("class_rank"),
    schoolRank: integer("school_rank"),
    note: text("note").notNull().default(""),
    updatedAt: text("updated_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("exam_scores_unique_idx").on(t.examId, t.studentId, t.subject)],
)

// 「考试进步」奖励名单：老师确认后写入，每一行给一名学生自动加分（积分来源）
export const examAwards = sqliteTable(
  "exam_awards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    examId: integer("exam_id")
      .notNull()
      .references(() => exams.id),
    compareExamId: integer("compare_exam_id")
      .notNull()
      .references(() => exams.id),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    subject: text("subject").notNull(),
    // 进步了多少（按名次或分数，见 by）
    gain: real("gain").notNull(),
    by: text("by").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("exam_awards_unique_idx").on(t.examId, t.studentId)],
)
