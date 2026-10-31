import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm"
import { z } from "zod"
import { classRef, defineOp, OpError, studentRef } from "@/server/core/define"
import { allTriggers, syncAllAutoPoints } from "@/server/core/points-engine"
import { resolveOptionalClass, resolveStudents } from "@/server/core/resolve"
import { db } from "@/server/db"
import { classes, groups, pointEvents, pointRules, students } from "@/server/db/schema"

// 加分、扣分、规则、排行榜

export const listRules = defineOp({
  name: "rules.list",
  title: "积分规则",
  description: "列出加分、扣分规则。带 autoTrigger 的是自动规则，由系统自动结算，不能手动按这条规则加分。",
  kind: "read",
  input: z.object({ includeDisabled: z.boolean().default(true) }),
  run: async (_ctx, input) => {
    const rows = await db.select().from(pointRules).orderBy(asc(pointRules.sort), asc(pointRules.id))
    return rows
      .filter((r) => input.includeDisabled || r.enabled)
      .map((r) => ({ ...r, autoLabel: r.autoTrigger ? (allTriggers()[r.autoTrigger] ?? "（来源模块已停用）") : null }))
  },
})

export const saveRule = defineOp({
  name: "rules.save",
  title: "新增或修改积分规则",
  description: "不传 id 时新增；传 id 时修改名称、分值、启用状态。停用或修改自动规则后，相关自动积分会立即重新结算。",
  kind: "write",
  input: z.object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(30).optional(),
    delta: z
      .number()
      .int()
      .min(-100)
      .max(100)
      .refine((n) => n !== 0, "分值不能为 0")
      .optional(),
    enabled: z.boolean().optional(),
  }),
  run: async (ctx, input) => {
    const { id, ...set } = input
    if (id == null) {
      if (!set.name || set.delta == null) throw new OpError(400, "新增规则需要名称和分值")
      const [maxSort] = await db
        .select({ sort: pointRules.sort })
        .from(pointRules)
        .orderBy(desc(pointRules.sort))
        .limit(1)
      const [dup] = await db.select().from(pointRules).where(eq(pointRules.name, set.name))
      if (dup) throw new OpError(409, `已经有一条叫「${set.name}」的规则`)
      const rule = await ctx.insert(pointRules, {
        name: set.name,
        delta: set.delta,
        enabled: set.enabled ?? true,
        sort: (maxSort?.sort ?? 0) + 1,
      })
      ctx.summary = `新增规则「${rule.name}」${rule.delta > 0 ? "+" : ""}${rule.delta}`
      return rule
    }
    const rule = await ctx.update(pointRules, id, set)
    if (!rule) throw new OpError(404, "规则不存在")
    if (rule.autoTrigger) await syncAllAutoPoints(ctx)
    ctx.summary = `修改规则「${rule.name}」`
    return rule
  },
})

export const addPoints = defineOp({
  name: "points.add",
  title: "加分/扣分",
  description:
    "给一个或多个学生加分或扣分（不常用：加分一般由自动规则结算，扣分用 points.deduct）。" +
    "rule 填老师自己建的规则名（见 rules.list），或者不填规则、直接给 delta 分值并在 note 写原因。自动规则不能手动使用。",
  kind: "write",
  input: z.object({
    students: z.array(studentRef).min(1),
    class: classRef.optional(),
    rule: z
      .union([z.number().int().positive(), z.string().trim().min(1)])
      .optional()
      .describe("规则名或规则编号"),
    delta: z.number().int().min(-100).max(100).optional().describe("分值；填了规则时可省略，默认用规则的分值"),
    note: z.string().trim().max(200).default(""),
  }),
  run: async (ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const ss = await resolveStudents(input.students, cls?.id)
    let rule: typeof pointRules.$inferSelect | undefined
    if (input.rule != null) {
      const all = await db.select().from(pointRules)
      rule = all.find((r) => r.id === input.rule || r.name === input.rule)
      if (!rule) {
        const names = all.filter((r) => r.enabled && !r.autoTrigger).map((r) => r.name)
        throw new OpError(404, `找不到规则「${input.rule}」。可用的规则：${names.join("、")}`)
      }
      if (rule.autoTrigger) throw new OpError(409, `「${rule.name}」是自动规则，由系统自动结算，不能手动加`)
      if (!rule.enabled) throw new OpError(409, `规则「${rule.name}」已停用`)
    }
    const delta = input.delta ?? rule?.delta
    if (delta == null || delta === 0) throw new OpError(400, "请选择规则，或填写分值")
    if (!rule && !input.note) throw new OpError(400, "不按规则加减分时，请在 note 里写原因")
    const ids: number[] = []
    for (const s of ss) {
      const e = await ctx.insert(pointEvents, {
        studentId: s.id,
        delta,
        ruleId: rule?.id ?? null,
        ruleName: rule?.name ?? (delta > 0 ? "加分" : "扣分"),
        note: input.note,
        actor: ctx.actor,
      })
      ids.push(e.id)
    }
    const names = ss.slice(0, 3).map((s) => s.name)
    ctx.summary = `${names.join("、")}${ss.length > 3 ? ` 等 ${ss.length} 人` : ""} ${delta > 0 ? "+" : ""}${delta}（${rule?.name ?? input.note ?? ""}）`
    return { eventIds: ids, delta, students: ss.map((s) => s.name) }
  },
})

export const deductPoints = defineOp({
  name: "points.deduct",
  title: "扣分",
  description:
    "给一个或多个学生扣分，必须写原因（例如「未交作业」「上课讲话」）。加分由系统按自动规则结算（默写满分、背书一次过、考试进步），一般不需要手动加。",
  kind: "write",
  input: z.object({
    students: z.array(studentRef).min(1),
    class: classRef.optional(),
    points: z.number().int().min(1).max(20).default(1).describe("扣几分（正数），默认 1"),
    reason: z.string().trim().min(1, "请写扣分原因").max(200).describe("扣分原因"),
  }),
  run: async (ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const ss = await resolveStudents(input.students, cls?.id)
    const ids: number[] = []
    for (const s of ss) {
      const e = await ctx.insert(pointEvents, {
        studentId: s.id,
        delta: -input.points,
        ruleId: null,
        ruleName: "扣分",
        note: input.reason,
        actor: ctx.actor,
      })
      ids.push(e.id)
    }
    const names = ss.slice(0, 3).map((s) => s.name)
    ctx.summary = `${names.join("、")}${ss.length > 3 ? ` 等 ${ss.length} 人` : ""} -${input.points}（${input.reason}）`
    return { eventIds: ids, delta: -input.points, students: ss.map((s) => s.name) }
  },
})

export const revokePoints = defineOp({
  name: "points.revoke",
  title: "删除积分记录",
  description: "撤销一条或多条积分流水（积分随之回滚）。自动积分不能这样删，要改它的来源记录。",
  kind: "write",
  input: z.object({ eventIds: z.array(z.number().int().positive()).min(1) }),
  run: async (ctx, input) => {
    const rows = await db.select().from(pointEvents).where(inArray(pointEvents.id, input.eventIds))
    if (rows.length !== input.eventIds.length) throw new OpError(404, "有积分记录不存在")
    const auto = rows.filter((r) => r.sourceType)
    if (auto.length) throw new OpError(409, "自动积分由来源记录决定（例如默写满分），请修改或删除那条登记")
    const revokedAt = new Date().toISOString()
    for (const r of rows) if (!r.revokedAt) await ctx.update(pointEvents, r.id, { revokedAt })
    ctx.summary = `删除积分记录 ${rows.length} 条`
    return { revoked: rows.length }
  },
})

function periodStart(period: "all" | "week" | "month") {
  if (period === "all") return undefined
  const d = new Date()
  if (period === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  else d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export const pointsLog = defineOp({
  name: "points.log",
  title: "积分明细",
  description: "积分流水（最新在前），可以按班级、学生筛选。",
  kind: "read",
  input: z.object({
    class: classRef.optional(),
    student: studentRef.optional(),
    limit: z.number().int().positive().max(1000).default(100),
  }),
  run: async (_ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const student = input.student != null ? (await resolveStudents([input.student], cls?.id))[0] : undefined
    return db
      .select({
        id: pointEvents.id,
        delta: pointEvents.delta,
        ruleName: pointEvents.ruleName,
        note: pointEvents.note,
        auto: pointEvents.sourceType,
        actor: pointEvents.actor,
        createdAt: pointEvents.createdAt,
        studentId: students.id,
        studentName: students.name,
        classCode: classes.code,
      })
      .from(pointEvents)
      .innerJoin(students, eq(students.id, pointEvents.studentId))
      .innerJoin(classes, eq(classes.id, students.classId))
      .where(
        and(
          isNull(pointEvents.revokedAt),
          cls ? eq(students.classId, cls.id) : undefined,
          student ? eq(students.id, student.id) : undefined,
        ),
      )
      .orderBy(desc(pointEvents.id))
      .limit(input.limit)
  },
})

export const leaderboard = defineOp({
  name: "points.leaderboard",
  title: "积分榜",
  description:
    "按学生和按小组汇总积分（加分、扣分、净分），小组积分 = 组员净分之和。period：all 全部 / week 本周 / month 本月。仅供老师查看，不要对外公布。",
  kind: "read",
  input: z.object({
    class: classRef.optional(),
    period: z.enum(["all", "week", "month"]).default("all"),
  }),
  run: async (_ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const since = periodStart(input.period)
    const ss = await db
      .select({ s: students, classCode: classes.code, groupName: groups.name })
      .from(students)
      .innerJoin(classes, eq(classes.id, students.classId))
      .leftJoin(groups, eq(groups.id, students.groupId))
      .where(and(eq(students.active, true), cls ? eq(students.classId, cls.id) : undefined))
    const events = await db
      .select({ studentId: pointEvents.studentId, delta: pointEvents.delta })
      .from(pointEvents)
      .where(and(isNull(pointEvents.revokedAt), since ? gte(pointEvents.createdAt, since) : undefined))
    const per = new Map<number, { bonus: number; minus: number }>()
    for (const e of events) {
      const p = per.get(e.studentId) ?? { bonus: 0, minus: 0 }
      if (e.delta > 0) p.bonus += e.delta
      else p.minus += e.delta
      per.set(e.studentId, p)
    }
    const rows = ss.map(({ s, classCode, groupName }) => {
      const p = per.get(s.id) ?? { bonus: 0, minus: 0 }
      return {
        studentId: s.id,
        name: s.name,
        studentNo: s.studentNo,
        classCode,
        groupId: s.groupId,
        groupName,
        ...p,
        net: p.bonus + p.minus,
      }
    })
    const byGroup = new Map<
      string,
      { name: string; classCode: string; members: number; bonus: number; minus: number; net: number }
    >()
    for (const r of rows) {
      const key = `${r.classCode}:${r.groupId ?? "none"}`
      const g = byGroup.get(key) ?? {
        name: r.groupName ?? "未分组",
        classCode: r.classCode,
        members: 0,
        bonus: 0,
        minus: 0,
        net: 0,
      }
      g.members++
      g.bonus += r.bonus
      g.minus += r.minus
      g.net += r.net
      byGroup.set(key, g)
    }
    return {
      period: input.period,
      since: since ?? null,
      rows: rows.sort((a, b) => b.net - a.net || a.studentNo.localeCompare(b.studentNo)),
      groups: [...byGroup.values()].sort((a, b) => b.net - a.net),
    }
  },
})
