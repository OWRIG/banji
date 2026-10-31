import { eq, inArray } from "drizzle-orm"
import { defineModule } from "@/server/core/module"
import { db } from "@/server/db"
import {
  clearPending,
  createCheck,
  deleteCheck,
  getCheck,
  listChecks,
  listPending,
  pendingItems,
  recordResults,
  SOURCE,
  unclearPending,
  updateCheck,
} from "./ops"
import { checkResults, checks } from "./schema"
import { checkStats, resultStatus } from "./shared"

// 「默写过关」模块：默写、背书、作业订正等检查，以及待过关名单。

export const checksModule = defineModule({
  id: "checks",
  title: "默写过关",
  description: "默写、背书、作业订正等检查的登记，未达标自动进入待过关名单，补过后销账。",
  ops: [
    listChecks,
    getCheck,
    createCheck,
    updateCheck,
    recordResults,
    deleteCheck,
    listPending,
    clearPending,
    unclearPending,
  ],
  tables: [checks, checkResults],

  pointSources: [
    {
      sourceType: SOURCE,
      triggers: {
        "checks.dictation_full": "默写满分（分数登记且达到满分）",
        "checks.recite_first_pass": "背书一次过（标记为“过”）",
      },
      awards: async (ctx, trigger, sourceIds) => {
        const rows = await ctx.db
          .select({ r: checkResults, c: checks })
          .from(checkResults)
          .innerJoin(checks, eq(checks.id, checkResults.checkId))
          .where(sourceIds ? inArray(checkResults.id, sourceIds) : undefined)
        return rows
          .filter(({ r, c }) => {
            if (trigger === "checks.dictation_full")
              return c.kind === "dictation" && r.score != null && r.score >= c.fullScore
            if (trigger === "checks.recite_first_pass") return c.kind === "recite" && r.mark === "pass"
            return false
          })
          .map(({ r }) => ({ sourceId: r.id, studentId: r.studentId }))
      },
    },
  ],
  autoRules: [
    { name: "默写满分", delta: 1, autoTrigger: "checks.dictation_full" },
    { name: "背书一次过关", delta: 1, autoTrigger: "checks.recite_first_pass" },
  ],

  studentFacts: [
    {
      label: "待过关",
      tone: "bad",
      compute: async ({ classId }) => {
        const counts = new Map<number, number>()
        for (const p of await pendingItems({ classId })) counts.set(p.student.id, (counts.get(p.student.id) ?? 0) + 1)
        return counts
      },
    },
  ],

  brief: async ({ date }) => {
    const pending = await pendingItems({})
    const todays = await db.select().from(checks).where(eq(checks.date, date))
    const results = todays.length
      ? await db
          .select()
          .from(checkResults)
          .where(
            inArray(
              checkResults.checkId,
              todays.map((c) => c.id),
            ),
          )
      : []
    return {
      pending,
      todayChecks: todays.map((c) => ({
        ...c,
        stats: checkStats(
          c,
          results.filter((r) => r.checkId === c.id),
        ),
      })),
    }
  },

  profile: async ({ studentId }) => {
    const rows = await db
      .select({ r: checkResults, c: checks })
      .from(checkResults)
      .innerJoin(checks, eq(checks.id, checkResults.checkId))
      .where(eq(checkResults.studentId, studentId))
    const history = rows
      .map(({ r, c }) => ({
        resultId: r.id,
        checkId: c.id,
        kind: c.kind,
        title: c.title,
        date: c.date,
        createdAt: c.createdAt,
        score: r.score,
        mark: r.mark,
        status: resultStatus(c, r),
        clearedAt: r.clearedAt,
      }))
      .sort((a, b) => (b.date ?? b.createdAt).localeCompare(a.date ?? a.createdAt) || b.checkId - a.checkId)
    const counted = history.filter((h) => h.status === "passed" || h.status === "failed")
    return {
      pending: history.filter((h) => h.status === "failed" && !h.clearedAt),
      passRate: counted.length ? counted.filter((h) => h.status === "passed").length / counted.length : null,
      recentChecks: history.slice(0, 15),
    }
  },
})
