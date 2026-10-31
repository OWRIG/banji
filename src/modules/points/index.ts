import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { defineModule } from "@/server/core/module"
import { db } from "@/server/db"
import { pointEvents, pointRules } from "@/server/db/schema"
import { addPoints, leaderboard, listRules, pointsLog, revokePoints, saveRule } from "./ops"

// 「积分」核心模块：规则、流水、积分榜。其他模块通过积分引擎（core/points-engine.ts）自动加分。

export const pointsModule = defineModule({
  id: "points",
  title: "积分",
  description: "加分扣分、积分规则、积分榜",
  core: true,
  ops: [addPoints, revokePoints, pointsLog, leaderboard, listRules, saveRule],
  tables: [pointRules, pointEvents],

  studentFacts: [
    {
      label: "积分",
      compute: async () => {
        const rows = await db
          .select({ studentId: pointEvents.studentId, net: sql<number>`sum(${pointEvents.delta})` })
          .from(pointEvents)
          .where(isNull(pointEvents.revokedAt))
          .groupBy(pointEvents.studentId)
        return new Map(rows.map((r) => [r.studentId, Number(r.net)]))
      },
    },
  ],

  profile: async ({ studentId }) => {
    const events = await db
      .select()
      .from(pointEvents)
      .where(and(eq(pointEvents.studentId, studentId), isNull(pointEvents.revokedAt)))
      .orderBy(desc(pointEvents.id))
    return {
      net: events.reduce((a, e) => a + e.delta, 0),
      bonus: events.filter((e) => e.delta > 0).reduce((a, e) => a + e.delta, 0),
      minus: events.filter((e) => e.delta < 0).reduce((a, e) => a + e.delta, 0),
      recent: events.slice(0, 30),
    }
  },
})
