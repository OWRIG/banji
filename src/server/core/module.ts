import type { z } from "zod"
import type { IdTable, OpDef } from "./define"
import type { PointSource } from "./points-engine"
import type { AutoRuleSeed } from "./rules"

// 模块（插件）：一个功能一个文件夹（src/modules/<id>/），在 index.ts 里用 defineModule 声明自己带来了什么。
// 平台（src/server/registry.ts）把所有模块汇总起来：
//   ops          → 网页接口、命令行、MCP 工具（自动出现）
//   tables       → 变更记录和撤销
//   pointSources → 自动积分
//   autoRules    → 默认的自动积分规则（第一次启用时写入）
//   studentFacts → 学生列表上的统计列（例如"待过关"）
//   brief        → 首页"今日概览"的一块（agent 调用 brief_today 也能看到）
//   profile      → 学生档案的一块（agent 调用 students_profile 也能看到）
// 网页端的对应部分（导航、首页卡片、档案卡片）在模块的 web.tsx 里，由 src/web/modules.ts 汇总。

/** 任意操作。run 的参数写成 never[]：只用来约束形状，不影响推断出每个操作的具体类型 */
type AnyOp = Omit<OpDef<string, z.ZodObject, unknown>, "run"> & { run: (...args: never[]) => Promise<unknown> }

export type StudentFact = {
  label: string
  /** bad：数字大于 0 时标红（例如待过关）；good：标绿 */
  tone?: "bad" | "good"
  compute: (input: { classId?: number }) => Promise<Map<number, number>>
}

export type ServerModule<
  Id extends string = string,
  Ops extends readonly AnyOp[] = readonly AnyOp[],
  B = unknown,
  P = unknown,
> = {
  id: Id
  title: string
  description: string
  /** 核心模块（名册、积分、系统）不能停用；功能模块老师可以在设置里开关 */
  core?: boolean
  ops: Ops
  tables?: IdTable[]
  pointSources?: PointSource[]
  autoRules?: AutoRuleSeed[]
  /** 学生列表里显示的统计列，例如"待过关 2"（agent 调用 students_list 也能看到） */
  studentFacts?: StudentFact[]
  /** 首页概览里这个模块的部分 */
  brief?: (input: { date: string }) => Promise<B>
  /** 学生档案里这个模块的部分 */
  profile?: (input: { studentId: number }) => Promise<P>
}

export function defineModule<const Id extends string, const Ops extends readonly AnyOp[], B = never, P = never>(
  m: ServerModule<Id, Ops, B, P>,
) {
  return m
}
