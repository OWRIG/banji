import { useState } from "react"
import { Button } from "@/web/components/ui/button"
import { Textarea } from "@/web/components/ui/textarea"
import { useOpMutation } from "@/web/lib/ops"
import type { WebModule } from "@/web/modules"
import { type NoteKind, noteKinds } from "./shared"

// 「谈话记录」模块的网页部分：学生档案里的记录列表和输入框（Ctrl+Enter 保存）

export const notesWeb: WebModule = {
  id: "notes",
  ProfileCard: ({ profile }) => {
    const data = profile.sections.notes
    const add = useOpMutation("notes.add")
    const del = useOpMutation("notes.delete")
    const [text, setText] = useState("")
    const [kind, setKind] = useState<NoteKind>("talk")
    if (!data) return null

    async function save() {
      if (!text.trim()) return
      try {
        await add.mutateAsync({ student: profile.student.id, kind, text })
        setText("")
      } catch {
        // useOpMutation.onError 已提示
      }
    }

    return (
      <section>
        <h2 className="mb-2 font-semibold">谈话记录</h2>
        <div className="no-print mb-2.5 space-y-2">
          <div className="flex gap-1">
            {(Object.keys(noteKinds) as NoteKind[]).map((k) => (
              <Button key={k} size="xs" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>
                {noteKinds[k]}
              </Button>
            ))}
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save()
            }}
            placeholder="记录要点（Ctrl+Enter 保存）"
            className="h-20"
          />
          <Button size="sm" onClick={save} disabled={!text.trim() || add.isPending}>
            保存
          </Button>
        </div>
        {data.notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有记录</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.notes.map((n) => (
              <li key={n.id} className="rounded-md border bg-card px-3 py-2">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">{n.date}</span>
                  <span>{noteKinds[n.kind as NoteKind] ?? n.kind}</span>
                  <button
                    type="button"
                    className="no-print ml-auto hover:text-destructive"
                    onClick={() => del.mutate({ id: n.id })}
                  >
                    删除
                  </button>
                </div>
                <p className="whitespace-pre-wrap">{n.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  },
}
