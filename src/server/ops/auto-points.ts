import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { checkResults, checks, pointEvents, pointRules } from "@/server/db/schema"
import type { Ctx } from "./define"

// 自动积分用"投影"的方式保证幂等：
// 每次来源数据变动后，按"当前数据 + 当前规则"算出应该有哪些自动积分，和已有的比对，多的撤销、少的补上。
// 所以无论改分、删场次、关规则的顺序多乱，结果都只由当前状态决定，不会重复加分。

export const autoTriggers = {
  check_full_score: "默写满分（分数登记且达到满分）",
  recite_first_pass: "背书一次过（标记为“过”）",
} as const
export type AutoTrigger = keyof typeof autoTriggers

const SOURCE = "check_result"

type CheckRow = typeof checks.$inferSelect
type ResultRow = typeof checkResults.$inferSelect

function triggered(trigger: string, check: CheckRow, r: ResultRow) {
  if (trigger === "check_full_score") return check.kind === "dictation" && r.score != null && r.score >= check.fullScore
  if (trigger === "recite_first_pass") return check.kind === "recite" && r.mark === "pass"
  return false
}

/** 重新结算若干场检查的自动积分 */
export async function syncAutoPointsForChecks(ctx: Ctx, checkIds: number[]) {
  if (checkIds.length === 0) return
  const rules = await ctx.db
    .select()
    .from(pointRules)
    .where(and(isNotNull(pointRules.autoTrigger), eq(pointRules.enabled, true)))
  const checkRows = await ctx.db.select().from(checks).where(inArray(checks.id, checkIds))
  const results = await ctx.db.select().from(checkResults).where(inArray(checkResults.checkId, checkIds))
  const resultIds = results.map((r) => r.id)

  // 应该存在的：key = ruleId:resultId
  const want = new Map<string, { rule: (typeof rules)[number]; r: ResultRow }>()
  for (const r of results) {
    const check = checkRows.find((c) => c.id === r.checkId)
    if (!check) continue
    for (const rule of rules) {
      if (rule.autoTrigger && triggered(rule.autoTrigger, check, r)) want.set(`${rule.id}:${r.id}`, { rule, r })
    }
  }

  const existing = resultIds.length
    ? await ctx.db
        .select()
        .from(pointEvents)
        .where(
          and(
            eq(pointEvents.sourceType, SOURCE),
            inArray(pointEvents.sourceId, resultIds),
            isNull(pointEvents.revokedAt),
          ),
        )
    : []

  const revokedAt = new Date().toISOString()
  for (const e of existing) {
    const key = `${e.ruleId}:${e.sourceId}`
    const w = want.get(key)
    // 学生变了（理论上不会）或分值规则变了，都按"撤销后重加"处理
    if (w && w.r.studentId === e.studentId && w.rule.delta === e.delta) want.delete(key)
    else await ctx.update(pointEvents, e.id, { revokedAt })
  }
  for (const { rule, r } of want.values()) {
    await ctx.insert(pointEvents, {
      studentId: r.studentId,
      delta: rule.delta,
      ruleId: rule.id,
      ruleName: rule.name,
      note: "自动",
      sourceType: SOURCE,
      sourceId: r.id,
      actor: ctx.actor,
    })
  }
}

/** 来源结果要被删除之前，先撤销它们产生的自动积分 */
export async function revokeAutoPointsForResults(ctx: Ctx, resultIds: number[]) {
  if (resultIds.length === 0) return
  const rows = await ctx.db
    .select()
    .from(pointEvents)
    .where(
      and(eq(pointEvents.sourceType, SOURCE), inArray(pointEvents.sourceId, resultIds), isNull(pointEvents.revokedAt)),
    )
  const revokedAt = new Date().toISOString()
  for (const e of rows) await ctx.update(pointEvents, e.id, { revokedAt })
}

/** 规则开关或改分值后：全部重新结算一遍（数据量是几百场 × 几十人，完全够快） */
export async function syncAllAutoPoints(ctx: Ctx) {
  const all = await ctx.db.select({ id: checks.id }).from(checks)
  await syncAutoPointsForChecks(
    ctx,
    all.map((c) => c.id),
  )
  // 已停用规则遗留的自动积分也要撤销（上面只看启用的规则，已停用规则的事件会被当成"多余"撤销）
}
