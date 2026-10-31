import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"
import { checksModule } from "@/modules/checks"
import { examsModule } from "@/modules/exams"
import { notesModule } from "@/modules/notes"
import { pointsModule } from "@/modules/points"
import { rosterModule } from "@/modules/roster"
import { systemModule } from "@/modules/system"
import { classRef, defineOp, type OpDef, OpError, registerTable, studentRef } from "@/server/core/define"
import { registerPointSource } from "@/server/core/points-engine"
import { cleanName, resolveOptionalClass, resolveStudent } from "@/server/core/resolve"
import { seedRules } from "@/server/core/rules"
import { db } from "@/server/db"
import { classes, groups, settings, students } from "@/server/db/schema"
import { today } from "@/shared/format"

// 模块登记表。新增一个模块：在 src/modules/<id>/ 里写好，然后加到下面的 modules 里——
// 它的操作会出现在网页接口、命令行、MCP 里；它的表可以撤销；它的积分来源、首页和档案内容会自动汇总。

export const modules = [rosterModule, pointsModule, systemModule, checksModule, examsModule, notesModule] as const

type Mods = (typeof modules)[number]
export type ModuleId = Mods["id"]

for (const m of modules) {
  for (const t of m.tables ?? []) registerTable(t)
  for (const s of m.pointSources ?? []) registerPointSource(s)
}

/** 启动时调用：补齐各模块的默认积分规则 */
export async function initModules() {
  await seedRules(modules.flatMap((m) => m.autoRules ?? []))
}

// ---- 模块开关：核心模块不能停用；功能模块停用后，它的操作、页面、首页内容都会隐藏（数据保留） ----

const DISABLED_KEY = "modules.disabled"

export async function disabledModules(): Promise<Set<string>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, DISABLED_KEY))
  return new Set(row ? (JSON.parse(row.value) as string[]) : [])
}

async function enabledModules() {
  const off = await disabledModules()
  return modules.filter((m) => m.core || !off.has(m.id))
}

// ---- 跨模块汇总的操作 ----

type BriefOf<M> = M extends { brief?: (input: never) => Promise<infer R> } ? R : never
type ProfileOf<M> = M extends { profile?: (input: never) => Promise<infer R> } ? R : never
/** 首页概览里各模块的部分，key 是模块 id（模块停用时没有） */
export type BriefSections = { [M in Mods as [BriefOf<M>] extends [never] ? never : M["id"]]?: BriefOf<M> }
/** 学生档案里各模块的部分 */
export type ProfileSections = { [M in Mods as [ProfileOf<M>] extends [never] ? never : M["id"]]?: ProfileOf<M> }

export const briefToday = defineOp({
  name: "brief.today",
  title: "今日概览",
  description:
    "首页数据：各班概况、各功能模块今天需要关注的内容（例如待过关名单、今天的检查）、最近一次备份。每天开始工作时先看这个。",
  kind: "read",
  input: z.object({}),
  run: async () => {
    const date = today()
    const sections: Record<string, unknown> = {}
    for (const m of await enabledModules()) if (m.brief) sections[m.id] = await m.brief({ date })
    return {
      date,
      classes: await db.select().from(classes).orderBy(asc(classes.sort), asc(classes.code)),
      sections: sections as BriefSections,
    }
  },
})

export const listStudents = defineOp({
  name: "students.list",
  title: "学生列表",
  description: "按班级、分组、关键字（姓名或学号）列出学生，附带各功能模块的统计（例如待过关数、积分）。",
  kind: "read",
  input: z.object({
    class: classRef.optional(),
    groupId: z.number().int().optional().describe("分组编号"),
    q: z.string().trim().optional().describe("姓名或学号关键字"),
  }),
  run: async (_ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const rows = await db
      .select({ s: students, groupName: groups.name, classCode: classes.code, className: classes.name })
      .from(students)
      .innerJoin(classes, eq(classes.id, students.classId))
      .leftJoin(groups, eq(groups.id, students.groupId))
      .where(and(eq(students.active, true), cls ? eq(students.classId, cls.id) : undefined))
      .orderBy(asc(students.studentNo))
    const factDefs = (await enabledModules()).flatMap((m) => m.studentFacts ?? [])
    const factValues = await Promise.all(factDefs.map((f) => f.compute({ classId: cls?.id })))
    const q = input.q ? cleanName(input.q) : ""
    return {
      facts: factDefs.map((f) => ({ label: f.label, tone: f.tone ?? null })),
      rows: rows
        .filter((r) => (input.groupId ? r.s.groupId === input.groupId : true))
        .filter((r) => (q ? r.s.name.includes(q) || r.s.studentNo.includes(q) : true))
        .map((r) => ({
          ...r.s,
          groupName: r.groupName,
          classCode: r.classCode,
          className: r.className,
          facts: Object.fromEntries(factDefs.map((f, i) => [f.label, factValues[i].get(r.s.id) ?? 0])) as Record<
            string,
            number
          >,
        })),
    }
  },
})

export const studentProfile = defineOp({
  name: "students.profile",
  title: "学生档案",
  description:
    "一个学生的汇总：基本信息，以及各功能模块的记录（待过关、检查记录、积分明细等）。准备谈话、家访前先看这个。",
  kind: "read",
  input: z.object({ student: studentRef, class: classRef.optional() }),
  run: async (_ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const s = await resolveStudent(input.student, cls?.id)
    const [info] = await db
      .select({ classCode: classes.code, className: classes.name, groupName: groups.name })
      .from(students)
      .innerJoin(classes, eq(classes.id, students.classId))
      .leftJoin(groups, eq(groups.id, students.groupId))
      .where(eq(students.id, s.id))
    const sections: Record<string, unknown> = {}
    for (const m of await enabledModules()) if (m.profile) sections[m.id] = await m.profile({ studentId: s.id })
    return { student: { ...s, ...info }, sections: sections as ProfileSections }
  },
})

export const listModules = defineOp({
  name: "modules.list",
  title: "功能模块",
  description: "列出所有功能模块和启用状态。",
  kind: "read",
  input: z.object({}),
  run: async () => {
    const off = await disabledModules()
    return modules.map((m) => ({
      id: m.id as ModuleId,
      title: m.title,
      description: m.description,
      core: !!m.core,
      enabled: !!m.core || !off.has(m.id),
    }))
  },
})

export const setModuleEnabled = defineOp({
  name: "modules.setEnabled",
  title: "启用/停用功能模块",
  description: "停用后，这个功能的页面、操作、首页内容都会隐藏，数据会保留，随时可以重新启用。核心模块不能停用。",
  kind: "write",
  hideFromMcp: true,
  input: z.object({ id: z.string(), enabled: z.boolean() }),
  run: async (ctx, input) => {
    const m = modules.find((x) => x.id === input.id)
    if (!m) throw new OpError(404, `没有这个模块：${input.id}`)
    if (m.core) throw new OpError(409, `「${m.title}」是核心模块，不能停用`)
    const off = await disabledModules()
    if (input.enabled) off.delete(m.id)
    else off.add(m.id)
    await db
      .insert(settings)
      .values({ key: DISABLED_KEY, value: JSON.stringify([...off]) })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify([...off]) } })
    ctx.summary = `${input.enabled ? "启用" : "停用"}「${m.title}」`
    return { id: m.id, enabled: input.enabled }
  },
})

// ---- 操作登记表 ----

const platformOps = [briefToday, listStudents, studentProfile, listModules, setModuleEnabled] as const

type AnyOp = (typeof platformOps)[number] | Mods["ops"][number]
type OpMap = { [O in AnyOp as O["name"]]: O }
export type OpName = keyof OpMap
export type OpInput<N extends OpName> = z.input<OpMap[N]["input"]>
export type OpData<N extends OpName> = Awaited<ReturnType<OpMap[N]["run"]>>

type LooseOp = OpDef<string, z.ZodObject, unknown>
const owner = new Map<string, Mods | null>()
for (const op of platformOps) owner.set(op.name, null)
for (const m of modules) {
  for (const op of m.ops) {
    if (owner.has(op.name)) throw new Error(`操作名重复：${op.name}`)
    owner.set(op.name, m)
  }
}

// 运行时的统一列表：参数由 runOp 用各操作自己的 zod 规则校验，所以这里可以把具体类型放宽
const all: unknown[] = [...platformOps]
for (const m of modules) all.push(...m.ops)
export const opList = all as readonly LooseOp[]
export const ops = Object.fromEntries(opList.map((op) => [op.name, op])) as unknown as OpMap

/** 按名字找操作。所属模块被停用时报错 */
export async function findOp(name: string): Promise<LooseOp | undefined> {
  const op = opList.find((o) => o.name === name)
  if (!op) return undefined
  const m = owner.get(name)
  if (m && !m.core && (await disabledModules()).has(m.id)) {
    throw new OpError(403, `「${m.title}」功能没有启用，可以在「数据与设置 → 功能模块」里打开`)
  }
  return op
}

/** 当前可用的操作（MCP 用） */
export async function availableOps() {
  const off = await disabledModules()
  return opList.filter((op) => {
    const m = owner.get(op.name)
    return !m || m.core || !off.has(m.id)
  })
}
