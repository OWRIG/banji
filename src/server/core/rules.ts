import { db } from "@/server/db"
import { pointRules } from "@/server/db/schema"

// 积分规则的初始数据：通用的手动规则只在第一次启动时写入；
// 模块带来的自动规则按 auto_trigger 补齐（以后新增模块，老用户也会自动得到它的默认规则）。

export type AutoRuleSeed = { name: string; delta: number; autoTrigger: string }

export const defaultManualRules = [
  { name: "课堂发言/答对", delta: 1 },
  { name: "作业优秀/按时", delta: 1 },
  { name: "考试进步", delta: 2 },
  { name: "好人好事/热心班级", delta: 2 },
  { name: "值日认真", delta: 1 },
  { name: "活动参与", delta: 2 },
  { name: "获奖/受表扬", delta: 5 },
  { name: "未交作业", delta: -1 },
  { name: "纪律提醒", delta: -1 },
]

export async function seedRules(autoRules: AutoRuleSeed[]) {
  const existing = await db.select().from(pointRules)
  let sort = existing.reduce((m, r) => Math.max(m, r.sort), 0)
  const toInsert: (typeof pointRules.$inferInsert)[] = []
  for (const r of autoRules) {
    if (existing.some((e) => e.autoTrigger === r.autoTrigger)) continue
    const name = existing.some((e) => e.name === r.name) ? `${r.name}（自动）` : r.name
    toInsert.push({ ...r, name, sort: ++sort })
  }
  if (existing.length === 0) for (const r of defaultManualRules) toInsert.push({ ...r, sort: ++sort })
  if (toInsert.length) await db.insert(pointRules).values(toInsert)
}
