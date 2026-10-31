import { and, desc, eq, lt, ne, or } from "drizzle-orm"
import { z } from "zod"
import { activeStudents } from "@/modules/roster/ops"
import { classRef, confirmField, defineOp, OpError, studentRef } from "@/server/core/define"
import { syncAutoPoints } from "@/server/core/points-engine"
import { resolveClass, resolveOptionalClass, resolveStudents } from "@/server/core/resolve"
import { db } from "@/server/db"
import { classes } from "@/server/db/schema"
import { examAwards, examScores, exams } from "./schema"
import {
  BORDER_RATE,
  EXCELLENT_RATE,
  type ExamType,
  examTypes,
  fullOf,
  hasTotal,
  mainSubject,
  PASS_RATE,
  parseScoreValue,
  rankOf,
  type Subject,
  scoreStats,
  type scoreStatuses,
  sumTotal,
  TOTAL,
} from "./shared"

// 考试成绩：录入、统计、进退步、临界生、同卷班级对比、进步奖励

/** 自动积分的来源类型：每条进步奖励是一条来源记录 */
export const AWARD_SOURCE = "exam_award"

type Exam = typeof exams.$inferSelect
type ScoreRow = typeof examScores.$inferSelect

const typeEnum = z.enum(Object.keys(examTypes) as [ExamType, ...ExamType[]])
const examRef = z.union([z.number().int().positive(), z.string().trim().min(1)]).describe("考试：编号或标题")
const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式是 YYYY-MM-DD")
  .nullable()
  .optional()
  .describe("日期 YYYY-MM-DD，可以为空")
const subjectsField = z
  .array(
    z.object({
      name: z
        .string()
        .trim()
        .min(1)
        .max(20)
        .refine((n) => n !== TOTAL, `「${TOTAL}」会自动计算，不用作为科目`),
      full: z.number().positive().default(100).describe("满分"),
      inTotal: z.boolean().default(true).describe("是否计入总分"),
    }),
  )
  .min(1)
  .refine((xs) => new Set(xs.map((x) => x.name)).size === xs.length, "科目名称重复")
  .describe("科目列表，例如 [{name:'语文',full:100},{name:'数学',full:120},{name:'英语',full:100}]")
const subjectField = z.string().trim().min(1).optional().describe(`科目名，或「${TOTAL}」。只有一个科目时可以不填`)

export async function resolveExam(ref: string | number, classId?: number) {
  const rows = await db
    .select()
    .from(exams)
    .where(
      typeof ref === "number"
        ? eq(exams.id, ref)
        : classId
          ? and(eq(exams.title, ref.trim()), eq(exams.classId, classId))
          : eq(exams.title, ref.trim()),
    )
  if (rows.length === 0) throw new OpError(404, `找不到考试「${ref}」，可以先用 exams.list 查看`)
  if (rows.length > 1) throw new OpError(409, `有多场名为「${ref}」的考试（多个班同名），请指定班级或改用编号`)
  return rows[0]
}

/** 科目参数：不填时有总分用总分，否则用第一科 */
function pickSubject(exam: Exam, subject: string | undefined) {
  if (!subject) return mainSubject(exam.subjects)
  if ((subject === TOTAL && hasTotal(exam.subjects)) || exam.subjects.some((s) => s.name === subject)) return subject
  const options = [...exam.subjects.map((s) => s.name), ...(hasTotal(exam.subjects) ? [TOTAL] : [])]
  throw new OpError(400, `「${exam.title}」没有科目「${subject}」，可选：${options.join("、")}`)
}

/** 一场考试的成绩表：每个学生每科的成绩、总分、名次 */
export async function examMatrix(exam: Exam) {
  const roster = await activeStudents(exam.classId)
  const rows = await db.select().from(examScores).where(eq(examScores.examId, exam.id))
  const cells = new Map<number, Record<string, ScoreRow>>()
  for (const r of rows) cells.set(r.studentId, { ...cells.get(r.studentId), [r.subject]: r })

  const value = (studentId: number, subject: string) => {
    const c = cells.get(studentId) ?? {}
    if (subject === TOTAL) {
      return sumTotal(exam.subjects, Object.fromEntries(exam.subjects.map((s) => [s.name, c[s.name]?.score])))
    }
    return c[subject]?.score ?? null
  }
  const subjects = [...exam.subjects.map((s) => s.name), ...(hasTotal(exam.subjects) ? [TOTAL] : [])]
  // 名次：导入的班级名次优先，没有时按本班分数现算
  const ranks = new Map<string, Map<number, number>>()
  for (const subject of subjects) {
    const computed = rankOf(new Map(roster.map((s) => [s.id, value(s.id, subject)])))
    for (const s of roster) {
      const imported = cells.get(s.id)?.[subject]?.classRank
      if (imported != null) computed.set(s.id, imported)
    }
    ranks.set(subject, computed)
  }
  return { roster, cells, value, subjects, ranks }
}

type Matrix = Awaited<ReturnType<typeof examMatrix>>

function statsOf(exam: Exam, m: Matrix) {
  return m.subjects.map((subject) => ({
    subject,
    full: fullOf(exam.subjects, subject),
    ...scoreStats(
      fullOf(exam.subjects, subject),
      m.roster.map((s) => m.value(s.id, subject)),
    ),
  }))
}

/** 同班、在这场之前的最近一场考试 */
async function previousExam(exam: Exam) {
  const [prev] = await db
    .select()
    .from(exams)
    .where(
      and(
        eq(exams.classId, exam.classId),
        ne(exams.id, exam.id),
        exam.date
          ? or(lt(exams.date, exam.date), and(eq(exams.date, exam.date), lt(exams.id, exam.id)))
          : lt(exams.id, exam.id),
      ),
    )
    .orderBy(desc(exams.date), desc(exams.id))
    .limit(1)
  return prev
}

const progressInput = {
  exam: examRef,
  class: classRef.optional(),
  subject: subjectField,
  compareTo: examRef.optional().describe("和哪一场比，默认同班上一场考试"),
  by: z
    .enum(["rank", "score"])
    .default("rank")
    .describe("rank 按班级名次变化（不同卷子之间也可比）；score 按分数变化（满分不同时按本次满分折算）"),
}

/** 进退步：两场考试都有成绩的学生，按名次或分数的变化排序（进步大的在前） */
async function progressOf(
  exam: Exam,
  m: Matrix,
  input: { subject?: string; compareTo?: string | number; by: "rank" | "score" },
) {
  const subject = pickSubject(exam, input.subject)
  const other = input.compareTo != null ? await resolveExam(input.compareTo, exam.classId) : await previousExam(exam)
  if (!other) return null
  if (other.id === exam.id) throw new OpError(400, "不能和自己比较")
  // 对比的那场考试也要有这一科；总分对总分
  const otherSubject =
    subject === TOTAL
      ? hasTotal(other.subjects)
        ? TOTAL
        : null
      : other.subjects.some((s) => s.name === subject)
        ? subject
        : null
  if (!otherSubject) throw new OpError(400, `「${other.title}」没有科目「${subject}」，换一场对比或指定科目`)
  const om = await examMatrix(other)
  const scale = fullOf(exam.subjects, subject) / fullOf(other.subjects, otherSubject)
  const rows = m.roster.flatMap((s) => {
    const after = m.value(s.id, subject)
    const before = om.value(s.id, otherSubject)
    const rankAfter = m.ranks.get(subject)?.get(s.id) ?? null
    const rankBefore = om.ranks.get(otherSubject)?.get(s.id) ?? null
    if (after == null || before == null) return []
    const gain = input.by === "rank" ? (rankBefore ?? 0) - (rankAfter ?? 0) : after - before * scale
    return [{ student: { id: s.id, name: s.name, studentNo: s.studentNo }, before, after, rankBefore, rankAfter, gain }]
  })
  rows.sort((a, b) => b.gain - a.gain || a.student.studentNo.localeCompare(b.student.studentNo))
  return { subject, by: input.by, compareExam: { id: other.id, title: other.title, date: other.date }, rows }
}

// ---- 操作 ----

export const createExam = defineOp({
  name: "exams.create",
  title: "新建考试",
  description:
    `新建一场考试（${Object.values(examTypes).join("/")}）。可以一次给几个班建同一场考试（同一张卷子），之后能做班级对比。` +
    "科目不填时默认只有英语（满分 100）。",
  kind: "write",
  input: z.object({
    class: z.union([classRef, z.array(classRef).min(1)]).describe("班级，或几个班级（同一张卷子）"),
    type: typeEnum.default("unit"),
    title: z.string().trim().min(1, "请填写考试名称").max(100),
    date: dateField,
    subjects: subjectsField.optional(),
    paperGroup: z.string().trim().max(100).optional().describe("同卷标记；一次建多个班时默认用考试名称"),
  }),
  run: async (ctx, input) => {
    const refs = Array.isArray(input.class) ? input.class : [input.class]
    const list = []
    for (const ref of refs) list.push(await resolveClass(ref))
    const subjects: Subject[] = input.subjects ?? [{ name: "英语", full: 100, inTotal: true }]
    const paperGroup = input.paperGroup || (list.length > 1 ? input.title : null)
    const created = []
    for (const cls of list) {
      const dup = await db
        .select({ id: exams.id })
        .from(exams)
        .where(and(eq(exams.classId, cls.id), eq(exams.title, input.title)))
      if (dup.length) throw new OpError(409, `${cls.name} 已经有一场「${input.title}」，换个名称`)
      created.push(
        await ctx.insert(exams, {
          classId: cls.id,
          type: input.type,
          title: input.title,
          date: input.date ?? null,
          subjects,
          paperGroup,
        }),
      )
    }
    ctx.summary = `新建考试「${input.title}」（${list.map((c) => c.name).join("、")}）`
    return created
  },
})

export const updateExam = defineOp({
  name: "exams.update",
  title: "修改考试",
  description: "修改考试名称、日期、类型、科目（满分、是否计入总分、增加科目）、同卷标记。已经有成绩的科目不能删除。",
  kind: "write",
  input: z.object({
    exam: examRef,
    class: classRef.optional(),
    title: z.string().trim().min(1).max(100).optional(),
    date: dateField,
    type: typeEnum.optional(),
    subjects: subjectsField.optional(),
    paperGroup: z.string().trim().max(100).nullable().optional(),
  }),
  run: async (ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const exam = await resolveExam(input.exam, cls?.id)
    if (input.subjects) {
      const keep = new Set(input.subjects.map((s) => s.name))
      const used = await db.select().from(examScores).where(eq(examScores.examId, exam.id))
      const lost = [...new Set(used.filter((r) => r.subject !== TOTAL && !keep.has(r.subject)).map((r) => r.subject))]
      if (lost.length) throw new OpError(409, `科目 ${lost.join("、")} 已经有成绩，不能删除；先清除这些成绩`)
    }
    const { exam: _e, class: _c, ...set } = input
    const updated = await ctx.update(exams, exam.id, set)
    ctx.summary = `修改考试「${updated?.title}」`
    return updated
  },
})

export const deleteExam = defineOp({
  name: "exams.delete",
  title: "删除考试",
  description: "删除一场考试和它的全部成绩；由它产生的进步加分会一起撤销（危险操作，先预览再确认）。",
  kind: "danger",
  input: z.object({ exam: examRef, class: classRef.optional(), confirm: confirmField }),
  run: async (ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const exam = await resolveExam(input.exam, cls?.id)
    const scores = await db.select().from(examScores).where(eq(examScores.examId, exam.id))
    for (const r of scores) await ctx.remove(examScores, r.id)
    // 这场考试自己的奖励，以及别的考试拿它做对比产生的奖励
    const awards = await db
      .select()
      .from(examAwards)
      .where(or(eq(examAwards.examId, exam.id), eq(examAwards.compareExamId, exam.id)))
    for (const a of awards) await ctx.remove(examAwards, a.id)
    await syncAutoPoints(
      ctx,
      AWARD_SOURCE,
      awards.map((a) => a.id),
    )
    await ctx.remove(exams, exam.id)
    const students = new Set(scores.map((r) => r.studentId)).size
    ctx.summary = `删除考试「${exam.title}」（含 ${students} 名学生的成绩）`
    return { title: exam.title, students, awards: awards.length }
  },
})

export const listExams = defineOp({
  name: "exams.list",
  title: "考试列表",
  description: "列出考试（最新的在前），附带科目、已录人数、总分均分。",
  kind: "read",
  input: z.object({ class: classRef.optional(), limit: z.number().int().positive().max(500).default(100) }),
  run: async (_ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const rows = await db
      .select({ e: exams, classCode: classes.code, className: classes.name })
      .from(exams)
      .innerJoin(classes, eq(classes.id, exams.classId))
      .where(cls ? eq(exams.classId, cls.id) : undefined)
      .orderBy(desc(exams.date), desc(exams.id))
      .limit(input.limit)
    const out = []
    for (const { e, classCode, className } of rows) {
      const m = await examMatrix(e)
      const main = pickSubject(e, undefined)
      const entered = m.roster.filter((s) => Object.keys(m.cells.get(s.id) ?? {}).length > 0).length
      out.push({
        ...e,
        classCode,
        className,
        entered,
        mainSubject: main,
        mainStats: scoreStats(
          fullOf(e.subjects, main),
          m.roster.map((s) => m.value(s.id, main)),
        ),
      })
    }
    return out
  },
})

export const getExam = defineOp({
  name: "exams.get",
  title: "查看考试成绩",
  description: "一场考试的成绩表：每个学生各科分数（或请假/缺考）、总分、班级名次、校排名，以及各科统计。",
  kind: "read",
  input: z.object({ exam: examRef, class: classRef.optional() }),
  run: async (_ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const exam = await resolveExam(input.exam, cls?.id)
    const [klass] = await db.select().from(classes).where(eq(classes.id, exam.classId))
    const m = await examMatrix(exam)
    const rows = m.roster.map((s) => {
      const c = m.cells.get(s.id) ?? {}
      return {
        student: { id: s.id, name: s.name, studentNo: s.studentNo, groupId: s.groupId },
        cells: Object.fromEntries(
          m.subjects.map((subject) => {
            const r = c[subject]
            return [
              subject,
              {
                score: m.value(s.id, subject),
                status: (r?.status ?? null) as keyof typeof scoreStatuses | null,
                classRank: m.ranks.get(subject)?.get(s.id) ?? null,
                schoolRank: r?.schoolRank ?? null,
              },
            ]
          }),
        ),
        note: Object.values(c)
          .map((r) => r.note)
          .filter(Boolean)
          .join("；"),
      }
    })
    const peers = exam.paperGroup
      ? await db
          .select({ id: exams.id, classCode: classes.code, className: classes.name })
          .from(exams)
          .innerJoin(classes, eq(classes.id, exams.classId))
          .where(and(eq(exams.paperGroup, exam.paperGroup), ne(exams.id, exam.id)))
      : []
    return {
      exam: { ...exam, classCode: klass.code, className: klass.name },
      subjects: m.subjects,
      rows,
      stats: statsOf(exam, m),
      peers,
    }
  },
})

export const recordScores = defineOp({
  name: "exams.record",
  title: "登记考试成绩",
  description:
    "批量登记成绩。每一项：student 学生、subject 科目（单科考试可省略）、value 分数或 请假/缺考（null 或空字符串表示清除）。" +
    `也可以只登记导入的名次 classRank / schoolRank，或备注 note；总分的名次用 subject:"${TOTAL}"，总分本身自动相加。`,
  kind: "write",
  input: z.object({
    exam: examRef,
    class: classRef.optional(),
    results: z
      .array(
        z.object({
          student: studentRef,
          subject: subjectField,
          value: z
            .union([z.number(), z.string(), z.null()])
            .optional()
            .describe("分数，或 请假/缺考；null 表示清除；不传表示不改分数"),
          classRank: z.number().int().positive().nullable().optional().describe("成绩单上的班级名次"),
          schoolRank: z.number().int().positive().nullable().optional().describe("成绩单上的年级/校名次"),
          note: z.string().trim().max(200).optional().describe("备注，例如「系统排除，按 0 分计」"),
        }),
      )
      .min(1),
  }),
  run: async (ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const exam = await resolveExam(input.exam, cls?.id)
    const ss = await resolveStudents(
      input.results.map((r) => r.student),
      exam.classId,
    )
    const bad = input.results
      .filter((r) => r.value !== undefined && parseScoreValue(r.value) === null)
      .map((r) => `${r.student}=${r.value}`)
    if (bad.length) throw new OpError(400, `看不懂这些成绩：${bad.join("、")}。可以填分数，或 请假/缺考`)

    const existing = await db.select().from(examScores).where(eq(examScores.examId, exam.id))
    const now = new Date().toISOString()
    let written = 0
    let cleared = 0
    for (const item of input.results) {
      const [student] = await resolveStudents([item.student], exam.classId)
      const subject = pickSubject(exam, item.subject)
      const full = fullOf(exam.subjects, subject)
      const old = existing.find((r) => r.studentId === student.id && r.subject === subject)
      const parsed = item.value === undefined ? undefined : parseScoreValue(item.value)
      if (subject === TOTAL && parsed !== undefined) {
        throw new OpError(400, `总分由各科相加，不能直接登记；${student.name} 请登记各科分数`)
      }
      if (parsed && parsed !== "clear" && parsed.score != null && parsed.score > full) {
        throw new OpError(400, `${student.name} 的${subject} ${parsed.score} 分超过了满分 ${full}`)
      }
      if (parsed === "clear") {
        if (old) {
          await ctx.remove(examScores, old.id)
          cleared++
        }
        continue
      }
      const set = {
        ...(parsed ? { score: parsed.score, status: parsed.status } : {}),
        ...(item.classRank !== undefined ? { classRank: item.classRank } : {}),
        ...(item.schoolRank !== undefined ? { schoolRank: item.schoolRank } : {}),
        ...(item.note !== undefined ? { note: item.note } : {}),
      }
      if (Object.keys(set).length === 0) continue
      written++
      if (old) {
        const same = (Object.keys(set) as (keyof typeof set)[]).every((k) => old[k] === set[k])
        if (!same) await ctx.update(examScores, old.id, { ...set, updatedAt: now })
      } else {
        await ctx.insert(examScores, { examId: exam.id, studentId: student.id, subject, ...set, updatedAt: now })
      }
    }
    const names = [...new Set(ss.map((s) => s.name))]
    ctx.summary = `登记「${exam.title}」成绩：${names.slice(0, 3).join("、")}${names.length > 3 ? ` 等 ${names.length} 人` : ""}`
    const m = await examMatrix(exam)
    return { written, cleared, stats: statsOf(exam, m) }
  },
})

export const analyzeExam = defineOp({
  name: "exams.analyze",
  title: "考试分析",
  description:
    "考后分析：各科统计（均分、中位数、最高、最低、及格率、优秀率；及格 = 满分 60%，优秀 = 85%）、" +
    "和上一场（或指定一场）比的进步/退步名单、临界生（离及格线、优秀线差 10% 满分以内）、同卷其他班的对比。" +
    "这些名单只给老师本人参考，不要对学生公开排名。",
  kind: "read",
  input: z.object({
    ...progressInput,
    top: z.number().int().positive().max(50).default(8).describe("进步、退步名单各显示几人"),
  }),
  run: async (_ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const exam = await resolveExam(input.exam, cls?.id)
    const [klass] = await db.select().from(classes).where(eq(classes.id, exam.classId))
    const m = await examMatrix(exam)
    const subject = pickSubject(exam, input.subject)
    const full = fullOf(exam.subjects, subject)

    const progress = await progressOf(exam, m, input)

    const border = (line: number) =>
      m.roster.flatMap((s) => {
        const v = m.value(s.id, subject)
        if (v == null || v >= line || v < line - full * BORDER_RATE) return []
        return [{ student: { id: s.id, name: s.name, studentNo: s.studentNo }, score: v, gap: line - v }]
      })

    // 同卷的其他班：共同科目的对比
    const peerExams = exam.paperGroup
      ? await db
          .select({ e: exams, className: classes.name })
          .from(exams)
          .innerJoin(classes, eq(classes.id, exams.classId))
          .where(and(eq(exams.paperGroup, exam.paperGroup), ne(exams.id, exam.id)))
      : []
    const mine = statsOf(exam, m)
    const peers = []
    for (const { e, className } of peerExams) {
      const pm = await examMatrix(e)
      const theirs = statsOf(e, pm)
      peers.push({
        exam: { id: e.id, title: e.title },
        className,
        subjects: mine.flatMap((a) => {
          const b = theirs.find((t) => t.subject === a.subject)
          if (!b) return []
          return [
            {
              subject: a.subject,
              mine: a,
              theirs: b,
              avgDiff: a.avg != null && b.avg != null ? a.avg - b.avg : null,
            },
          ]
        }),
      })
    }

    return {
      exam: { ...exam, classCode: klass.code, className: klass.name },
      subject,
      full,
      stats: mine,
      progress: progress && {
        subject: progress.subject,
        by: progress.by,
        compareExam: progress.compareExam,
        improved: progress.rows.filter((r) => r.gain > 0).slice(0, input.top),
        declined: progress.rows
          .filter((r) => r.gain < 0)
          .reverse()
          .slice(0, input.top),
      },
      borderline: {
        passLine: full * PASS_RATE,
        excellentLine: full * EXCELLENT_RATE,
        pass: border(full * PASS_RATE),
        excellent: border(full * EXCELLENT_RATE),
      },
      peers,
    }
  },
})

export const awardProgress = defineOp({
  name: "exams.awardProgress",
  title: "进步奖励加分",
  description:
    "给这场考试进步最大的前几名学生加分（按「考试进步前列」规则，默认 +2），可以撤销。" +
    "对同一场考试重新执行会替换之前的奖励名单，不会重复加分；top 填 0 表示取消这场考试的奖励。",
  kind: "write",
  input: z.object({
    ...progressInput,
    top: z.number().int().min(0).max(20).default(5).describe("奖励前几名（并列的一起奖励）"),
  }),
  run: async (ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const exam = await resolveExam(input.exam, cls?.id)
    const m = await examMatrix(exam)
    const progress = await progressOf(exam, m, input)
    if (!progress) throw new OpError(400, "这个班在这场考试之前没有别的考试，没法比较进步")

    const improved = progress.rows.filter((r) => r.gain > 0)
    // 第 top 名并列的一起奖励
    const cut = improved[input.top - 1]?.gain
    const winners = input.top === 0 ? [] : improved.filter((r) => cut == null || r.gain >= cut)

    const old = await db.select().from(examAwards).where(eq(examAwards.examId, exam.id))
    for (const a of old) await ctx.remove(examAwards, a.id)
    const created = []
    for (const w of winners) {
      created.push(
        await ctx.insert(examAwards, {
          examId: exam.id,
          compareExamId: progress.compareExam.id,
          studentId: w.student.id,
          subject: progress.subject,
          gain: w.gain,
          by: progress.by,
        }),
      )
    }
    await syncAutoPoints(ctx, AWARD_SOURCE, [...old.map((a) => a.id), ...created.map((a) => a.id)])
    ctx.summary = winners.length
      ? `「${exam.title}」进步奖励：${winners.map((w) => w.student.name).join("、")}`
      : `取消「${exam.title}」的进步奖励`
    return { compareExam: progress.compareExam, by: progress.by, subject: progress.subject, winners }
  },
})
