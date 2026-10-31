import type { z } from "zod"
import * as checks from "./checks"
import type { OpDef } from "./define"
import * as points from "./points"
import * as roster from "./roster"
import * as system from "./system"

// 所有业务操作的登记表。网页（/api/ops/:name）、CLI、MCP 都从这里取操作。
// 新增操作：在对应的 ops 文件里 defineOp，然后加到下面的列表里。

const list = [
  system.briefToday,
  roster.listClasses,
  roster.listStudents,
  roster.resolveStudentsOp,
  roster.studentProfile,
  roster.listGroups,
  roster.setStudentGroup,
  roster.importRoster,
  checks.listChecks,
  checks.getCheck,
  checks.createCheck,
  checks.updateCheck,
  checks.recordResults,
  checks.deleteCheck,
  checks.listPending,
  checks.clearPending,
  checks.unclearPending,
  points.addPoints,
  points.revokePoints,
  points.pointsLog,
  points.leaderboard,
  points.listRules,
  points.saveRule,
  system.undo,
  system.history,
  system.backupNow,
  system.backupList,
  system.createToken,
  system.listTokens,
  system.revokeToken,
] as const

type AnyOp = (typeof list)[number]
type OpMap = { [O in AnyOp as O["name"]]: O }
export type OpName = keyof OpMap
export type OpInput<N extends OpName> = z.input<OpMap[N]["input"]>
export type OpData<N extends OpName> = Awaited<ReturnType<OpMap[N]["run"]>>

export const opList: readonly OpDef<string, z.ZodObject, unknown>[] = list
export const ops = Object.fromEntries(list.map((op) => [op.name, op])) as OpMap

export function findOp(name: string): OpDef<string, z.ZodObject, unknown> | undefined {
  return opList.find((op) => op.name === name)
}
