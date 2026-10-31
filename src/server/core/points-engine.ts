import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { pointEvents, pointRules } from "@/server/db/schema"
import type { Ctx } from "./define"

// 自动积分引擎。任何模块都可以成为积分来源（默写满分、背书一次过、考试进步、值日认真……）。
//
// 用"投影"的方式保证幂等：来源数据变动后，按"当前数据 + 当前规则"算出应该有哪些自动积分，
// 和已有的比对，多的撤销、少的补上。所以无论改分、删记录、关规则的顺序多乱，都不会重复加分或漏扣。
//
// 模块只需要回答一个问题："这些来源记录里，哪些学生满足触发条件？"

export type PointSource = {
  /** 来源类型，例如 check_result。写进积分流水的 source_type */
  sourceType: string
  /** 这个来源提供的触发条件：key 写进规则的 auto_trigger（建议带模块前缀，如 checks.dictation_full），value 是给老师看的说明 */
  triggers: Record<string, string>
  /**
   * 给定触发条件，返回满足条件的 (来源记录, 学生)。
   * sourceIds 有值时只看这些来源记录（已删除的记录自然查不到，它们的积分会被撤销）；为空表示全部。
   */
  awards: (ctx: Ctx, trigger: string, sourceIds?: number[]) => Promise<{ sourceId: number; studentId: number }[]>
}

const sources = new Map<string, PointSource>()

export function registerPointSource(source: PointSource) {
  sources.set(source.sourceType, source)
}

/** 所有触发条件（规则设置页用） */
export function allTriggers() {
  return Object.assign({}, ...[...sources.values()].map((s) => s.triggers)) as Record<string, string>
}

/**
 * 重新结算某个来源的自动积分。
 * 来源记录新增、修改、删除之后都调用它，传入受影响的记录编号（包括被删除的）。
 */
export async function syncAutoPoints(ctx: Ctx, sourceType: string, sourceIds?: number[]) {
  const source = sources.get(sourceType)
  if (!source) throw new Error(`没有登记的积分来源：${sourceType}`)
  if (sourceIds && sourceIds.length === 0) return

  const rules = await ctx.db
    .select()
    .from(pointRules)
    .where(and(isNotNull(pointRules.autoTrigger), eq(pointRules.enabled, true)))

  // 应该存在的：key = 规则:来源记录
  const want = new Map<string, { rule: (typeof rules)[number]; sourceId: number; studentId: number }>()
  for (const rule of rules) {
    if (!rule.autoTrigger || !(rule.autoTrigger in source.triggers)) continue
    for (const a of await source.awards(ctx, rule.autoTrigger, sourceIds)) {
      want.set(`${rule.id}:${a.sourceId}`, { rule, ...a })
    }
  }

  const existing = await ctx.db
    .select()
    .from(pointEvents)
    .where(
      and(
        eq(pointEvents.sourceType, sourceType),
        isNull(pointEvents.revokedAt),
        sourceIds ? inArray(pointEvents.sourceId, sourceIds) : undefined,
      ),
    )

  const revokedAt = new Date().toISOString()
  for (const e of existing) {
    const key = `${e.ruleId}:${e.sourceId}`
    const w = want.get(key)
    // 学生或分值变了，按"撤销后重加"处理；停用规则的积分不在 want 里，会被撤销
    if (w && w.studentId === e.studentId && w.rule.delta === e.delta) want.delete(key)
    else await ctx.update(pointEvents, e.id, { revokedAt })
  }
  for (const w of want.values()) {
    await ctx.insert(pointEvents, {
      studentId: w.studentId,
      delta: w.rule.delta,
      ruleId: w.rule.id,
      ruleName: w.rule.name,
      note: "自动",
      sourceType,
      sourceId: w.sourceId,
      actor: ctx.actor,
    })
  }
}

/** 规则开关、改分值之后：所有来源全部重新结算一遍 */
export async function syncAllAutoPoints(ctx: Ctx) {
  for (const s of sources.values()) await syncAutoPoints(ctx, s.sourceType)
}
