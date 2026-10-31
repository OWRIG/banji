import { desc, eq } from "drizzle-orm"
import { defineModule } from "@/server/core/module"
import { db } from "@/server/db"
import { addNote, deleteNote, listNotes } from "./ops"
import { notes } from "./schema"

// 「谈话记录」模块：谈话、家访、观察记录，显示在学生档案里。

export const notesModule = defineModule({
  id: "notes",
  title: "谈话记录",
  description: "给学生记录谈话、家访、观察，显示在学生档案里。",
  ops: [addNote, listNotes, deleteNote],
  tables: [notes],
  profile: async ({ studentId }) => ({
    notes: await db
      .select()
      .from(notes)
      .where(eq(notes.studentId, studentId))
      .orderBy(desc(notes.date), desc(notes.id)),
  }),
})
