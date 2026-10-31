import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { classRef, confirmField, defineOp, OpError, studentRef } from "@/server/core/define"
import { cleanName, resolveClass, resolveOptionalClass, resolveStudents } from "@/server/core/resolve"
import { db } from "@/server/db"
import { classes, groups, students } from "@/server/db/schema"

// 班级、分组、学生名册

export const listClasses = defineOp({
  name: "classes.list",
  title: "列出班级",
  description: "列出所有班级，以及每个班的人数和分组。其他操作里的「班级」参数可以填这里的班级代号。",
  kind: "read",
  input: z.object({}),
  run: async () => {
    const cls = await db.select().from(classes).orderBy(asc(classes.sort), asc(classes.code))
    const counts = await db
      .select({ classId: students.classId, n: sql<number>`count(*)` })
      .from(students)
      .where(eq(students.active, true))
      .groupBy(students.classId)
    const gs = await db.select().from(groups).orderBy(asc(groups.sort))
    return cls.map((c) => ({
      ...c,
      studentCount: Number(counts.find((x) => x.classId === c.id)?.n ?? 0),
      groups: gs.filter((g) => g.classId === c.id).map((g) => ({ id: g.id, name: g.name })),
    }))
  },
})

export const resolveStudentsOp = defineOp({
  name: "students.resolve",
  title: "核对学生",
  description:
    "把一批姓名或学号解析成学生（含内部编号）。有重名、对不上时会报错并列出候选。批量写入前可以先用它核对名单。",
  kind: "read",
  input: z.object({ names: z.array(studentRef).min(1), class: classRef.optional() }),
  run: async (_ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    return resolveStudents(input.names, cls?.id)
  },
})

export const listGroups = defineOp({
  name: "groups.list",
  title: "分组列表",
  description: "某个班的分组和组员。",
  kind: "read",
  input: z.object({ class: classRef }),
  run: async (_ctx, input) => {
    const cls = await resolveClass(input.class)
    const gs = await db.select().from(groups).where(eq(groups.classId, cls.id)).orderBy(asc(groups.sort))
    const ss = await db
      .select()
      .from(students)
      .where(and(eq(students.classId, cls.id), eq(students.active, true)))
      .orderBy(asc(students.studentNo))
    return gs.map((g) => ({ ...g, members: ss.filter((s) => s.groupId === g.id) }))
  },
})

export const setStudentGroup = defineOp({
  name: "students.setGroup",
  title: "调整学生分组",
  description: "把若干学生调到某个组（组名或组编号）；group 为 null 表示移出分组。",
  kind: "write",
  input: z.object({
    class: classRef,
    students: z.array(studentRef).min(1),
    group: z.union([z.number().int(), z.string().trim().min(1), z.null()]).describe("组名、组编号，或 null"),
  }),
  run: async (ctx, input) => {
    const cls = await resolveClass(input.class)
    const ss = await resolveStudents(input.students, cls.id)
    let groupId: number | null = null
    if (input.group != null) {
      const gs = await db.select().from(groups).where(eq(groups.classId, cls.id))
      const g = gs.find((x) => x.id === input.group || x.name === input.group)
      if (!g) throw new OpError(404, `找不到分组「${input.group}」，现有：${gs.map((x) => x.name).join("、")}`)
      groupId = g.id
    }
    for (const s of ss) await ctx.update(students, s.id, { groupId })
    ctx.summary = `调整分组：${ss.map((s) => s.name).join("、")}`
    return { updated: ss.length }
  },
})

// ---- 名册导入 ----

const importStudent = z.object({
  studentNo: z.coerce.string().trim().min(1, "学号不能为空"),
  name: z.string().trim().min(1, "姓名不能为空"),
  gender: z.string().trim().optional(),
  group: z.coerce.string().trim().optional().describe("组名，例如 1 或 第1组"),
})

export const importRoster = defineOp({
  name: "roster.import",
  title: "导入名册",
  description:
    "导入或更新班级名册（危险操作，先预览再确认）。按班级代号匹配班级，按学号匹配学生：已有的更新姓名、性别、分组，没有的新建。" +
    "姓名里的 * 号和空格会被去掉。只导入学号、姓名、性别、分组，不要传家长信息、身份证号等隐私字段。" +
    "deactivateMissing=true 时，名单里没有的本班学生会被标记为离班（不删除历史记录）。",
  kind: "danger",
  input: z.object({
    classes: z
      .array(
        z.object({
          code: z.coerce.string().trim().min(1).describe("班级代号，例如 705"),
          name: z.string().trim().min(1).describe("班级名称，例如 七5班"),
          roles: z.string().trim().optional().describe("我在这个班的角色，例如 班主任,英语"),
          students: z.array(importStudent),
        }),
      )
      .min(1),
    deactivateMissing: z.boolean().default(false),
    confirm: confirmField,
  }),
  run: async (ctx, input) => {
    const report = []
    for (const [i, c] of input.classes.entries()) {
      const [existing] = await db.select().from(classes).where(eq(classes.code, c.code))
      const cls = existing
        ? ((await ctx.update(classes, existing.id, {
            name: c.name,
            ...(c.roles != null ? { roles: c.roles } : {}),
          })) ?? existing)
        : await ctx.insert(classes, { code: c.code, name: c.name, roles: c.roles ?? "", sort: i })

      // 分组
      const groupIds = new Map<string, number>()
      for (const g of await db.select().from(groups).where(eq(groups.classId, cls.id))) groupIds.set(g.name, g.id)
      const groupNames = [...new Set(c.students.map((s) => s.group).filter((g): g is string => !!g))]
      for (const name of groupNames) {
        if (!groupIds.has(name)) {
          const sortKey = Number.parseInt(name.replace(/\D/g, ""), 10)
          const g = await ctx.insert(groups, { classId: cls.id, name, sort: Number.isNaN(sortKey) ? 99 : sortKey })
          groupIds.set(name, g.id)
        }
      }

      const created: string[] = []
      const updated: string[] = []
      const warnings: string[] = []
      const seenNos = new Set<string>()
      for (const s of c.students) {
        const name = cleanName(s.name)
        if (seenNos.has(s.studentNo)) {
          warnings.push(`学号 ${s.studentNo} 在名单里出现了多次，只取第一条`)
          continue
        }
        seenNos.add(s.studentNo)
        const values = {
          classId: cls.id,
          name,
          gender: s.gender ?? "",
          groupId: s.group ? (groupIds.get(s.group) ?? null) : null,
          active: true,
        }
        const [old] = await db.select().from(students).where(eq(students.studentNo, s.studentNo))
        if (!old) {
          await ctx.insert(students, { studentNo: s.studentNo, ...values })
          created.push(name)
        } else if (
          old.classId !== values.classId ||
          old.name !== values.name ||
          old.gender !== values.gender ||
          old.groupId !== values.groupId ||
          !old.active
        ) {
          await ctx.update(students, old.id, values)
          updated.push(name)
        }
      }

      const names = c.students.map((s) => cleanName(s.name))
      const dupNames = names.filter((n, idx) => names.indexOf(n) !== idx)
      if (dupNames.length) warnings.push(`本班有重名：${[...new Set(dupNames)].join("、")}，录入时请用学号区分`)

      const deactivated: string[] = []
      const others = await db
        .select()
        .from(students)
        .where(and(eq(students.classId, cls.id), eq(students.active, true)))
      const missing = others.filter((o) => !seenNos.has(o.studentNo))
      if (input.deactivateMissing) {
        for (const o of missing) {
          await ctx.update(students, o.id, { active: false })
          deactivated.push(o.name)
        }
      } else if (missing.length) {
        warnings.push(`名单里没有、但系统里还在本班的学生：${missing.map((m) => m.name).join("、")}（未做改动）`)
      }

      const total = (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(students)
          .where(and(eq(students.classId, cls.id), eq(students.active, true)))
      )[0].n
      report.push({
        class: `${c.code} ${c.name}`,
        classCreated: !existing,
        total: Number(total),
        created,
        updated,
        deactivated,
        groups: groupNames,
        warnings,
      })
    }
    ctx.summary = `导入名册：${report.map((r) => `${r.class} 共 ${r.total} 人`).join("；")}`
    return report
  },
})

/** 某个班当前在册的学生（按学号排序） */
export async function activeStudents(classId: number) {
  return db
    .select()
    .from(students)
    .where(and(eq(students.classId, classId), eq(students.active, true)))
    .orderBy(asc(students.studentNo))
}

export async function studentsByIds(ids: number[]) {
  return ids.length ? db.select().from(students).where(inArray(students.id, ids)) : []
}
