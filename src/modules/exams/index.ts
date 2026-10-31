import { asc, eq, inArray } from "drizzle-orm"
import { defineModule } from "@/server/core/module"
import { db } from "@/server/db"
import { students } from "@/server/db/schema"
import {
  AWARD_SOURCE,
  analyzeExam,
  awardProgress,
  createExam,
  deleteExam,
  examMatrix,
  getExam,
  listExams,
  recordScores,
  updateExam,
} from "./ops"
import { examAwards, examScores, exams } from "./schema"
import { fullOf, mainSubject } from "./shared"

// 「考试成绩」模块：单元检测、月考、期中期末的成绩录入和考后分析。

export const examsModule = defineModule({
  id: "exams",
  title: "考试成绩",
  description: "考试成绩录入（多科、不同满分）、考后分析（统计、进退步、临界生、同卷对比）、进步奖励加分。",
  ops: [listExams, getExam, createExam, updateExam, recordScores, deleteExam, analyzeExam, awardProgress],
  tables: [exams, examScores, examAwards],

  pointSources: [
    {
      sourceType: AWARD_SOURCE,
      triggers: { "exams.top_progress": "考试进步前列（在考试分析里点「进步奖励」后入账）" },
      awards: async (ctx, trigger, sourceIds) => {
        if (trigger !== "exams.top_progress") return []
        const rows = await ctx.db
          .select()
          .from(examAwards)
          .where(sourceIds ? inArray(examAwards.id, sourceIds) : undefined)
        return rows.map((r) => ({ sourceId: r.id, studentId: r.studentId }))
      },
    },
  ],
  autoRules: [{ name: "考试进步前列", delta: 2, autoTrigger: "exams.top_progress" }],

  // 学生档案：每场考试的总分（或单科）、得分率、班级名次，按时间先后，用来画趋势
  profile: async ({ studentId }) => {
    const [s] = await db.select().from(students).where(eq(students.id, studentId))
    const taken = await db
      .selectDistinct({ examId: examScores.examId })
      .from(examScores)
      .where(eq(examScores.studentId, studentId))
    if (!s || taken.length === 0) return { history: [] }
    const list = await db
      .select()
      .from(exams)
      .where(
        inArray(
          exams.id,
          taken.map((t) => t.examId),
        ),
      )
      .orderBy(asc(exams.date), asc(exams.id))
    const history = []
    for (const e of list) {
      const m = await examMatrix(e)
      const main = mainSubject(e.subjects)
      const score = m.value(studentId, main)
      const full = fullOf(e.subjects, main)
      history.push({
        examId: e.id,
        title: e.title,
        date: e.date,
        type: e.type,
        subject: main,
        score,
        full,
        rate: score == null ? null : score / full,
        rank: m.ranks.get(main)?.get(studentId) ?? null,
        classSize: m.roster.length,
        subjects: e.subjects.map((sub) => ({
          name: sub.name,
          full: sub.full,
          score: m.value(studentId, sub.name),
          status: m.cells.get(studentId)?.[sub.name]?.status ?? null,
        })),
      })
    }
    return { history }
  },
})
