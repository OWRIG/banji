import { and, eq, inArray, isNull, lt } from "drizzle-orm"
import type { Ctx } from "@/server/core/define"
import { type PointSource, syncAutoPoints } from "@/server/core/points-engine"
import { students } from "@/server/db/schema"
import { checkExpectations, checkResults, checks } from "./schema"
import { checkDay } from "./shared"

export const MISSING_SOURCE = "check_missing"
export const MISSING_TRIGGER = "checks.missing_after_day"

export const missingPointSource: PointSource = {
  sourceType: MISSING_SOURCE,
  triggers: { [MISSING_TRIGGER]: "建表当天结束后仍未登记（补填退回，请假/免测不扣）" },
  awards: async (ctx, trigger, sourceIds) => {
    if (trigger !== MISSING_TRIGGER) return []
    return ctx.db
      .select({ sourceId: checkExpectations.id, studentId: checkExpectations.studentId })
      .from(checkExpectations)
      .innerJoin(checks, eq(checks.id, checkExpectations.checkId))
      .innerJoin(students, eq(students.id, checkExpectations.studentId))
      .leftJoin(
        checkResults,
        and(eq(checkResults.checkId, checks.id), eq(checkResults.studentId, checkExpectations.studentId)),
      )
      .where(
        and(
          lt(checks.missingDeadline, checkDay()),
          eq(students.active, true),
          eq(students.classId, checks.classId),
          isNull(checkResults.score),
          isNull(checkResults.mark),
          sourceIds ? inArray(checkExpectations.id, sourceIds) : undefined,
        ),
      )
  },
}

export async function syncMissingPoints(ctx: Ctx, checkId?: number) {
  const sources =
    checkId === undefined
      ? undefined
      : await ctx.db
          .select({ id: checkExpectations.id })
          .from(checkExpectations)
          .where(eq(checkExpectations.checkId, checkId))
  await syncAutoPoints(
    ctx,
    MISSING_SOURCE,
    sources?.map((s) => s.id),
  )
}
