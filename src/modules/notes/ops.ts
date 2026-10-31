import { and, desc, eq, gte } from "drizzle-orm"
import { z } from "zod"
import { classRef, defineOp, OpError, studentRef } from "@/server/core/define"
import { resolveOptionalClass, resolveStudent } from "@/server/core/resolve"
import { db } from "@/server/db"
import { classes, students } from "@/server/db/schema"
import { today } from "@/shared/format"
import { notes } from "./schema"
import { type NoteKind, noteKinds } from "./shared"

const kindEnum = z.enum(Object.keys(noteKinds) as [NoteKind, ...NoteKind[]])

export const addNote = defineOp({
  name: "notes.add",
  title: "记录谈话",
  description: `给学生记一条记录（${Object.values(noteKinds).join("/")}）。只记和教育教学有关的事实，不要记录家庭隐私细节。`,
  kind: "write",
  input: z.object({
    student: studentRef,
    class: classRef.optional(),
    kind: kindEnum.default("talk"),
    text: z.string().trim().min(1, "请填写内容").max(2000),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("日期 YYYY-MM-DD，默认今天"),
  }),
  run: async (ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const s = await resolveStudent(input.student, cls?.id)
    const note = await ctx.insert(notes, {
      studentId: s.id,
      kind: input.kind,
      date: input.date ?? today(),
      text: input.text,
      actor: ctx.actor,
    })
    ctx.summary = `给 ${s.name} 记录${noteKinds[input.kind]}`
    return note
  },
})

export const listNotes = defineOp({
  name: "notes.list",
  title: "谈话记录列表",
  description: "查看谈话/家访/观察记录（最新在前），可以按学生、班级、最近天数筛选。",
  kind: "read",
  input: z.object({
    student: studentRef.optional(),
    class: classRef.optional(),
    days: z.number().int().positive().optional().describe("只看最近多少天"),
  }),
  run: async (_ctx, input) => {
    const cls = await resolveOptionalClass(input.class)
    const s = input.student != null ? await resolveStudent(input.student, cls?.id) : undefined
    let since: string | undefined
    if (input.days) {
      const d = new Date()
      d.setDate(d.getDate() - input.days)
      since = today(d)
    }
    return db
      .select({ note: notes, studentName: students.name, classCode: classes.code })
      .from(notes)
      .innerJoin(students, eq(students.id, notes.studentId))
      .innerJoin(classes, eq(classes.id, students.classId))
      .where(
        and(
          s ? eq(notes.studentId, s.id) : undefined,
          cls ? eq(students.classId, cls.id) : undefined,
          since ? gte(notes.date, since) : undefined,
        ),
      )
      .orderBy(desc(notes.date), desc(notes.id))
  },
})

export const deleteNote = defineOp({
  name: "notes.delete",
  title: "删除谈话记录",
  description: "删除一条记录（可以撤销）。",
  kind: "write",
  input: z.object({ id: z.number().int().positive() }),
  run: async (ctx, input) => {
    const row = await ctx.remove(notes, input.id)
    if (!row) throw new OpError(404, "记录不存在")
    ctx.summary = `删除一条${noteKinds[row.kind as NoteKind] ?? ""}记录`
    return { id: row.id }
  },
})
