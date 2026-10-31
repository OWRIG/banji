import { and, eq } from "drizzle-orm"
import { db } from "@/server/db"
import { checks, classes, students } from "@/server/db/schema"
import { cleanName } from "@/shared/checks"
import { OpError } from "./define"

// 把"人话"指代解析成数据库记录。agent 和 CLI 习惯用姓名、班级代号，网页用内部编号。
// 原则：对不上或有歧义时直接报错并列出候选，绝不猜。

export type ClassRow = typeof classes.$inferSelect
export type StudentRow = typeof students.$inferSelect

export async function resolveClass(ref: string | number): Promise<ClassRow> {
  const all = await db.select().from(classes)
  let found: ClassRow | undefined
  if (typeof ref === "number") found = all.find((c) => c.id === ref)
  else {
    const key = ref.trim()
    found = all.find((c) => c.code === key || c.name === key)
    const near = all.filter((c) => c.name.includes(key))
    if (!found && near.length === 1) found = near[0]
  }
  if (!found) {
    const list = all.map((c) => `${c.code}（${c.name}）`).join("、") || "还没有班级"
    throw new OpError(404, `找不到班级「${ref}」。现有班级：${list}`)
  }
  return found
}

export async function resolveOptionalClass(ref: string | number | undefined) {
  return ref == null ? undefined : resolveClass(ref)
}

/**
 * 解析一批学生。所有对不上的一次性报出来，方便 agent 一次改正。
 * 字符串先按学号精确匹配，再按姓名（去掉 * 号和空格）精确匹配；限定了班级就只在该班找。
 */
export async function resolveStudents(refs: (string | number)[], classId?: number): Promise<StudentRow[]> {
  const pool = await db
    .select()
    .from(students)
    .where(classId ? and(eq(students.classId, classId), eq(students.active, true)) : eq(students.active, true))
  const problems: string[] = []
  const out: StudentRow[] = []
  for (const ref of refs) {
    if (typeof ref === "number") {
      const s = pool.find((p) => p.id === ref)
      if (s) out.push(s)
      else problems.push(`找不到编号为 ${ref} 的学生`)
      continue
    }
    const key = cleanName(ref)
    const byNo = pool.filter((p) => p.studentNo === key)
    const matches = byNo.length ? byNo : pool.filter((p) => cleanName(p.name) === key)
    if (matches.length === 1) {
      out.push(matches[0])
    } else if (matches.length > 1) {
      problems.push(
        `「${ref}」有重名：${matches.map((m) => `${m.name}（学号 ${m.studentNo}）`).join("、")}，请改用学号`,
      )
    } else {
      const near = pool.filter((p) => cleanName(p.name).includes(key) || key.includes(cleanName(p.name)))
      problems.push(
        near.length
          ? `找不到「${ref}」，是不是：${near
              .slice(0, 5)
              .map((m) => `${m.name}（${m.studentNo}）`)
              .join("、")}？`
          : `找不到学生「${ref}」`,
      )
    }
  }
  if (problems.length) throw new OpError(409, problems.join("\n"), { problems })
  // 去重，保持顺序
  return out.filter((s, i) => out.findIndex((x) => x.id === s.id) === i)
}

export async function resolveStudent(ref: string | number, classId?: number) {
  const [s] = await resolveStudents([ref], classId)
  return s
}

export async function resolveCheck(ref: string | number, classId?: number) {
  const rows = await db
    .select()
    .from(checks)
    .where(
      typeof ref === "number"
        ? eq(checks.id, ref)
        : classId
          ? and(eq(checks.title, ref.trim()), eq(checks.classId, classId))
          : eq(checks.title, ref.trim()),
    )
  if (rows.length === 0) throw new OpError(404, `找不到检查「${ref}」，可以先用 checks.list 查看`)
  if (rows.length > 1) throw new OpError(409, `有多场名为「${ref}」的检查，请指定班级或改用编号`)
  return rows[0]
}
