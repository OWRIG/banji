import { db } from "@/server/db"
import { pointRules } from "@/server/db/schema"

// 积分规则的初始数据：只有模块带来的自动规则，按 auto_trigger 补齐（以后新增模块，老用户也会自动得到它的默认规则）。
// 加分尽量由系统自动结算；老师手动只做扣分（写原因），见 points.deduct。

export type AutoRuleSeed = { name: string; delta: number; autoTrigger: string }

export async function seedRules(autoRules: AutoRuleSeed[]) {
  const existing = await db.select().from(pointRules)
  let sort = existing.reduce((m, r) => Math.max(m, r.sort), 0)
  const toInsert: (typeof pointRules.$inferInsert)[] = []
  for (const r of autoRules) {
    if (existing.some((e) => e.autoTrigger === r.autoTrigger)) continue
    const name = existing.some((e) => e.name === r.name) ? `${r.name}（自动）` : r.name
    toInsert.push({ ...r, name, sort: ++sort })
  }
  if (toInsert.length) await db.insert(pointRules).values(toInsert)
}
