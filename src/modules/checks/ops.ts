import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm"
import { z } from "zod"
import { activeStudents } from "@/modules/roster/ops"
import { type Ctx, classRef, confirmField, defineOp, OpError, studentRef } from "@/server/core/define"
import { syncAutoPoints } from "@/server/core/points-engine"
import { resolveClass, resolveOptionalClass, resolveStudents } from "@/server/core/resolve"
import { db } from "@/server/db"
import { classes, students } from "@/server/db/schema"
import { today } from "@/shared/format"
import { checkResults, checks } from "./schema"
import {
  type CheckKind,
  checkKinds,
  checkModes,
  checkStats,
  marks,
  parseResultValue,
  resultStatus,
  resultText,
} from "./shared"

// 检查项（默写、背书、作业订正…）与待过关池

/** 自动积分的来源类型：每条登记结果是一条来源记录 */
export const SOURCE = "check_result"

/** 重新结算一场检查的自动积分；removed 是刚删除的结果编号（它们的自动积分要撤销） */
async function syncCheckPoints(ctx: Ctx, checkId: number, removed: number[] = []) {
  const rows = await db.select({ id: checkResults.id }).from(checkResults).where(eq(checkResults.checkId, checkId))
  await syncAutoPoints(ctx, SOURCE, [...rows.map((r) => r.id), ...removed])
}

export async function resolveCheck(ref: string | number, classId?: number) {
  const rows = await db
    .select()
    .from(checks)
    .where(
      typeof ref === "number"
        ? eq(checks.id, ref)
        : classId
          ? and(eq(checks.title, ref.trim()), eq(checks.classId, classId))
          : eq(checks.title, ref.trim()),
    )
  if (rows.length === 0) throw new OpError(404, `找不到检查「${ref}」，可以先用 checks.list 查看`)
  if (rows.length > 1) throw new OpError(409, `有多场名为「${ref}」的检查，请指定班级或改用编号`)
  return rows[0]
}

const kindEnum = z.enum(Object.keys(checkKinds) as [CheckKind, ...CheckKind[]])
const checkRef = z.union([z.number().int().positive(), z.string().trim().min(1)]).describe("检查：编号或标题")
const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式是 YYYY-MM-DD")
  .nullable()
  .optional()
  .describe("日期 YYYY-MM-DD，可以为空")

export const createCheck = defineOp({
  name: "checks.create",
  title: "新建检查",
  description: `新建一场检查（${Object.values(checkKinds).join("/")}）。mode=score 登记分数，mode=mark 快速标记（${Object.values(marks).join("/")}）。默认过关线 80、满分 100。`,
  kind: "write",
  input: z.object({
    class: classRef,
    kind: kindEnum.default("dictation"),
    title: z.string().trim().min(1, "请填写标题").max(100),
    date: dateField,
    mode: z
      .enum(["score", "mark"])
      .optional()
      .describe(`${JSON.stringify(checkModes)}；背书默认 mark，其余默认 score`),
    passLine: z.number().min(0).default(80),
    fullScore: z.number().positive().default(100),
  }),
  run: async (ctx, input) => {
    const cls = await resolveClass(input.class)
    const check = await ctx.insert(checks, {
      classId: cls.id,
      kind: input.kind,
      title: input.title,
      date: input.date ?? null,
      mode: input.mode ?? (input.kind === "recite" ? "mark" : "score"),
      passLine: input.passLine,
      fullScore: input.fullScore,
    })
    ctx.summary = `新建${checkKinds[input.kind]}「${check.title}」（${cls.name}）`
    return check
  },
})

export const updateCheck = defineOp({
  name: "checks.update",
  title: "修改检查",
  description: "修改一场检查的标题、日期、过关线、满分。改过关线后达标情况会自动重算。",
  kind: "write",
  input: z.object({
    check: checkRef,
    class: classRef.optional(),
    title: z.string().trim().min(1).max(100).optional(),
    date: dateField,
    passLine: z.number().min(0).optional(),
    fullScore: z.number().positive().optional(),
  }),
  run: async (ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const check = await resolveCheck(input.check, cls?.id)
    const { check: _c, class: _cl, ...set } = input
    const updated = await ctx.update(checks, check.id, set)
    await syncCheckPoints(ctx, check.id)
    ctx.summary = `修改检查「${updated?.title}」`
    return updated
  },
})

export const deleteCheck = defineOp({
  name: "checks.delete",
  title: "删除检查",
  description: "删除一场检查和它的全部登记结果，由它产生的自动积分会一起撤销（危险操作，先预览再确认）。",
  kind: "danger",
  input: z.object({ check: checkRef, class: classRef.optional(), confirm: confirmField }),
  run: async (ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const check = await resolveCheck(input.check, cls?.id)
    const results = await db.select().from(checkResults).where(eq(checkResults.checkId, check.id))
    for (const r of results) await ctx.remove(checkResults, r.id)
    await syncAutoPoints(
      ctx,
      SOURCE,
      results.map((r) => r.id),
    )
    await ctx.remove(checks, check.id)
    ctx.summary = `删除检查「${check.title}」（含 ${results.length} 条登记）`
    return { title: check.title, removedResults: results.length }
  },
})

export const listChecks = defineOp({
  name: "checks.list",
  title: "检查列表",
  description: "列出检查场次（最新的在前），附带已录人数、达标率、未达标人数。",
  kind: "read",
  input: z.object({
    class: classRef.optional(),
    kind: kindEnum.optional(),
    limit: z.number().int().positive().max(500).default(100),
  }),
  run: async (_ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const rows = await db
      .select({ c: checks, classCode: classes.code, className: classes.name })
      .from(checks)
      .innerJoin(classes, eq(classes.id, checks.classId))
      .where(and(cls ? eq(checks.classId, cls.id) : undefined, input.kind ? eq(checks.kind, input.kind) : undefined))
      .orderBy(desc(checks.date), desc(checks.id))
      .limit(input.limit)
    const ids = rows.map((r) => r.c.id)
    const results = ids.length ? await db.select().from(checkResults).where(inArray(checkResults.checkId, ids)) : []
    return rows.map(({ c, classCode, className }) => {
      const rs = results.filter((r) => r.checkId === c.id)
      const stats = checkStats(c, rs)
      const pending = rs.filter((r) => resultStatus(c, r) === "failed" && !r.clearedAt).length
      return { ...c, classCode, className, stats, pending }
    })
  },
})

export const checkSheet = defineOp({
  name: "checks.sheet",
  title: "检查总表",
  description:
    "一个班的检查总表：每行一个学生，每列一场检查（按时间先后），格子里是分数或 过/未过/请假/免，" +
    "补过的未达标成绩后面带「(补)」。用来导出 Excel 或整体查看。",
  kind: "read",
  input: z.object({ class: classRef, kind: kindEnum.optional() }),
  run: async (_ctx, input) => {
    const cls = await resolveClass(input.class)
    const list = await db
      .select()
      .from(checks)
      .where(and(eq(checks.classId, cls.id), input.kind ? eq(checks.kind, input.kind) : undefined))
      .orderBy(asc(checks.date), asc(checks.id))
    const roster = await activeStudents(cls.id)
    const results = list.length
      ? await db
          .select()
          .from(checkResults)
          .where(
            inArray(
              checkResults.checkId,
              list.map((c) => c.id),
            ),
          )
      : []
    const byKey = new Map(results.map((r) => [`${r.checkId}:${r.studentId}`, r]))
    return {
      className: cls.name,
      checks: list.map((c) => ({ id: c.id, title: c.title, date: c.date, kind: c.kind })),
      rows: roster.map((s) => ({
        student: { id: s.id, name: s.name, studentNo: s.studentNo },
        values: list.map((c) => {
          const r = byKey.get(`${c.id}:${s.id}`)
          if (!r) return ""
          const text = resultText(r)
          return resultStatus(c, r) === "failed" && r.clearedAt ? `${text}(补)` : text
        }),
      })),
    }
  },
})

export const getCheck = defineOp({
  name: "checks.get",
  title: "查看检查",
  description: "一场检查的详情：全班每个学生的结果、状态、上一场同类检查的成绩，以及统计。",
  kind: "read",
  input: z.object({ check: checkRef, class: classRef.optional() }),
  run: async (_ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const check = await resolveCheck(input.check, cls?.id)
    const [klass] = await db.select().from(classes).where(eq(classes.id, check.classId))
    const roster = await activeStudents(check.classId)
    const results = await db.select().from(checkResults).where(eq(checkResults.checkId, check.id))

    // 上一场同班同类检查：按日期（没有日期按创建顺序）排在这场之前的最近一场
    const [prev] = await db
      .select()
      .from(checks)
      .where(
        and(
          eq(checks.classId, check.classId),
          eq(checks.kind, check.kind),
          check.date
            ? or(lt(checks.date, check.date), and(eq(checks.date, check.date), lt(checks.id, check.id)))
            : lt(checks.id, check.id),
        ),
      )
      .orderBy(desc(checks.date), desc(checks.id))
      .limit(1)
    const prevResults = prev ? await db.select().from(checkResults).where(eq(checkResults.checkId, prev.id)) : []

    const rows = roster.map((s) => {
      const r = results.find((x) => x.studentId === s.id) ?? null
      const p = prevResults.find((x) => x.studentId === s.id)
      return {
        student: { id: s.id, name: s.name, studentNo: s.studentNo, groupId: s.groupId },
        result: r,
        status: resultStatus(check, r),
        previous: p && prev ? { score: p.score, mark: p.mark, status: resultStatus(prev, p) } : null,
      }
    })
    return {
      check: { ...check, classCode: klass.code, className: klass.name },
      previousCheck: prev ? { id: prev.id, title: prev.title } : null,
      rows,
      stats: checkStats(check, results),
    }
  },
})

export const recordResults = defineOp({
  name: "checks.record",
  title: "登记检查结果",
  description:
    "给一场检查批量登记结果。value 可以是分数（数字），也可以是 过/二次过/未过/请假/免；传 null 或空字符串表示清除这条登记。" +
    "达到满分的默写、一次过的背书会自动加分（只加一次）。未达标的学生会自动进入待过关池。",
  kind: "write",
  input: z.object({
    check: checkRef,
    class: classRef.optional(),
    results: z
      .array(
        z.object({
          student: studentRef,
          value: z.union([z.number(), z.string(), z.null()]).describe("分数，或 过/二次过/未过/请假/免，null 表示清除"),
        }),
      )
      .min(1),
  }),
  run: async (ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const check = await resolveCheck(input.check, cls?.id)
    const ss = await resolveStudents(
      input.results.map((r) => r.student),
      check.classId,
    )

    const bad = input.results.filter((r) => parseResultValue(r.value) === null).map((r) => `${r.student}=${r.value}`)
    if (bad.length) throw new OpError(400, `看不懂这些结果：${bad.join("、")}。可以填分数，或 过/二次过/未过/请假/免`)

    const existing = await db.select().from(checkResults).where(eq(checkResults.checkId, check.id))
    const now = new Date().toISOString()
    const removed: number[] = []
    let written = 0
    for (const item of input.results) {
      const [student] = await resolveStudents([item.student], check.classId)
      const parsed = parseResultValue(item.value)
      const old = existing.find((r) => r.studentId === student.id)
      if (parsed === "clear" || parsed === null) {
        if (old) removed.push(old.id)
        continue
      }
      if (check.mode === "mark" && parsed.score != null) {
        throw new OpError(400, `「${check.title}」是快速标记模式，${student.name} 请填 过/二次过/未过/请假/免`)
      }
      written++
      if (old) {
        if (old.score === parsed.score && old.mark === parsed.mark) continue
        // 结果改了，之前的销账就不再适用：达标了不需要销账，仍未达标则重新追踪
        await ctx.update(checkResults, old.id, { ...parsed, clearedAt: null, clearedNote: "", updatedAt: now })
      } else {
        await ctx.insert(checkResults, { checkId: check.id, studentId: student.id, ...parsed, updatedAt: now })
      }
    }
    for (const id of removed) await ctx.remove(checkResults, id)
    await syncCheckPoints(ctx, check.id, removed)

    const after = await db.select().from(checkResults).where(eq(checkResults.checkId, check.id))
    const names = ss.slice(0, 3).map((s) => s.name)
    ctx.summary = `登记「${check.title}」：${names.join("、")}${ss.length > 3 ? ` 等 ${ss.length} 人` : ""}`
    return { written, cleared: removed.length, stats: checkStats(check, after) }
  },
})

// ---- 待过关池 ----

export async function pendingItems(filter: { classId?: number; studentId?: number }) {
  const rows = await db
    .select({ r: checkResults, c: checks, s: students, classCode: classes.code, className: classes.name })
    .from(checkResults)
    .innerJoin(checks, eq(checks.id, checkResults.checkId))
    .innerJoin(students, eq(students.id, checkResults.studentId))
    .innerJoin(classes, eq(classes.id, checks.classId))
    .where(
      and(
        isNull(checkResults.clearedAt),
        eq(students.active, true),
        filter.classId ? eq(checks.classId, filter.classId) : undefined,
        filter.studentId ? eq(checkResults.studentId, filter.studentId) : undefined,
      ),
    )
    .orderBy(asc(classes.code), asc(students.studentNo), asc(checks.date), asc(checks.id))
  return rows
    .filter(({ r, c }) => resultStatus(c, r) === "failed")
    .map(({ r, c, s, classCode, className }) => ({
      resultId: r.id,
      classCode,
      className,
      student: { id: s.id, name: s.name, studentNo: s.studentNo },
      check: { id: c.id, title: c.title, date: c.date, kind: c.kind, passLine: c.passLine },
      score: r.score,
      mark: r.mark,
      since: c.date ?? c.createdAt.slice(0, 10),
    }))
}

export const listPending = defineOp({
  name: "pending.list",
  title: "待过关名单",
  description: "未达标且还没销账的记录（谁还欠着哪场没过）。可以按班级、学生筛选。",
  kind: "read",
  input: z.object({ class: classRef.optional(), student: studentRef.optional() }),
  run: async (_ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const student = input.student != null ? (await resolveStudents([input.student], cls?.id))[0] : undefined
    return pendingItems({ classId: cls?.id, studentId: student?.id })
  },
})

export const clearPending = defineOp({
  name: "pending.clear",
  title: "销账（已补过）",
  description:
    "把待过关记录标记为已补过。可以传 resultIds（来自 pending.list），也可以传 student + check。不会改动原始成绩。",
  kind: "write",
  input: z.object({
    resultIds: z.array(z.number().int().positive()).optional(),
    items: z.array(z.object({ student: studentRef, check: checkRef })).optional(),
    class: classRef.optional(),
    date: dateField.describe("补过日期，默认今天"),
    note: z.string().trim().max(200).default(""),
  }),
  run: async (ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const ids = new Set(input.resultIds ?? [])
    for (const item of input.items ?? []) {
      const check = await resolveCheck(item.check, cls?.id)
      const [s] = await resolveStudents([item.student], check.classId)
      const [r] = await db
        .select()
        .from(checkResults)
        .where(and(eq(checkResults.checkId, check.id), eq(checkResults.studentId, s.id)))
      if (!r) throw new OpError(404, `${s.name} 在「${check.title}」没有登记记录`)
      ids.add(r.id)
    }
    if (ids.size === 0) throw new OpError(400, "请指定要销账的记录")
    const rows = await db
      .select({ r: checkResults, c: checks, s: students })
      .from(checkResults)
      .innerJoin(checks, eq(checks.id, checkResults.checkId))
      .innerJoin(students, eq(students.id, checkResults.studentId))
      .where(inArray(checkResults.id, [...ids]))
    if (rows.length !== ids.size) throw new OpError(404, "有记录不存在，请重新查询待过关名单")
    const cleared: string[] = []
    const skipped: string[] = []
    for (const { r, c, s } of rows) {
      if (resultStatus(c, r) !== "failed" || r.clearedAt) {
        skipped.push(`${s.name}「${c.title}」`)
        continue
      }
      await ctx.update(checkResults, r.id, { clearedAt: input.date ?? today(), clearedNote: input.note })
      cleared.push(`${s.name}「${c.title}」`)
    }
    ctx.summary = `销账：${cleared.slice(0, 3).join("、")}${cleared.length > 3 ? ` 等 ${cleared.length} 条` : ""}`
    return { cleared, skipped }
  },
})

export const unclearPending = defineOp({
  name: "pending.unclear",
  title: "取消销账",
  description: "把已经销账的记录放回待过关池。",
  kind: "write",
  input: z.object({ resultIds: z.array(z.number().int().positive()).min(1) }),
  run: async (ctx, input) => {
    let n = 0
    for (const id of input.resultIds) {
      const row = await ctx.update(checkResults, id, { clearedAt: null, clearedNote: "" })
      if (!row) throw new OpError(404, `记录 ${id} 不存在`)
      n++
    }
    ctx.summary = `取消销账 ${n} 条`
    return { restored: n }
  },
})
