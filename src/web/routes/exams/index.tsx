import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { z } from "zod"
import { type ExamType, examTypes } from "@/modules/exams/shared"
import { fmt, pct, today } from "@/shared/format"
import { ClassTabs, Empty, PageHeader, QueryState } from "@/web/components/common"
import { Button } from "@/web/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/web/components/ui/dialog"
import { Input } from "@/web/components/ui/input"
import { Label } from "@/web/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table"
import { useCurrentClass } from "@/web/lib/class"
import { useOp, useOpMutation } from "@/web/lib/ops"

export const Route = createFileRoute("/exams/")({
  component: ExamsPage,
  validateSearch: z.object({ new: z.boolean().optional() }),
})

function ExamsPage() {
  const { current } = useCurrentClass()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(!!search.new)
  const list = useOp("exams.list", { class: current?.code, limit: 200 }, { enabled: !!current })

  return (
    <div>
      <PageHeader
        title="考试成绩"
        subtitle="单元检测、月考、期中期末。录完成绩可以看统计、进退步、临界生和班级对比。"
        actions={<Button onClick={() => setCreating(true)}>新建考试</Button>}
      />
      <ClassTabs />
      <QueryState query={list}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>还没有考试记录，点右上角「新建考试」。</Empty>
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead>考试</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>科目</TableHead>
                    <TableHead className="text-right">已录</TableHead>
                    <TableHead className="text-right">均分</TableHead>
                    <TableHead className="text-right">及格率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((e) => (
                    <TableRow
                      key={e.id}
                      className="cursor-pointer"
                      onClick={() => navigate({ to: "/exams/$id", params: { id: String(e.id) } })}
                    >
                      <TableCell className="text-muted-foreground tabular-nums">{e.date ?? "—"}</TableCell>
                      <TableCell className="font-medium">
                        <Link to="/exams/$id" params={{ id: String(e.id) }}>
                          {e.title}
                        </Link>
                      </TableCell>
                      <TableCell>{examTypes[e.type as ExamType] ?? e.type}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.subjects.map((s) => s.name).join("、")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{e.entered}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(e.mainStats.avg)}
                        {e.mainStats.avg != null && e.mainSubject === "总分" && (
                          <span className="text-xs text-muted-foreground">（总分）</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{pct(e.mainStats.passRate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }
      </QueryState>
      {current && (
        <NewExamDialog
          open={creating}
          onOpenChange={setCreating}
          classCode={current.code}
          onCreated={(id) => navigate({ to: "/exams/$id", params: { id: String(id) } })}
        />
      )}
    </div>
  )
}

type SubjectDraft = { uid: number; name: string; full: string; inTotal: boolean }

// 科目行的临时编号（只用作 React key）
let nextUid = 1
const draftOf = (name: string, full: string): SubjectDraft => ({ uid: nextUid++, name, full, inTotal: true })

const presets: { label: string; subjects: SubjectDraft[] }[] = [
  { label: "英语", subjects: [draftOf("英语", "100")] },
  {
    label: "英语（卷面 + 听说）",
    subjects: [draftOf("卷面", "75"), draftOf("听说", "25")],
  },
  {
    label: "语数英",
    subjects: [draftOf("语文", "100"), draftOf("数学", "120"), draftOf("英语", "100")],
  },
]

function NewExamDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  classCode: string
  onCreated: (id: number) => void
}) {
  const { classes } = useCurrentClass()
  const [type, setType] = useState<ExamType>("unit")
  const [title, setTitle] = useState("")
  const [date, setDate] = useState(today())
  const [subjects, setSubjects] = useState<SubjectDraft[]>(() =>
    presets[0].subjects.map((x) => draftOf(x.name, x.full)),
  )
  const [picked, setPicked] = useState<string[]>([props.classCode])
  const create = useOpMutation("exams.create", { silent: true })

  const classList = picked

  async function submit(e: FormEvent) {
    e.preventDefault()
    const out = await create.mutateAsync({
      class: classList,
      type,
      title,
      date: date || null,
      subjects: subjects
        .filter((s) => s.name.trim())
        .map((s) => ({ name: s.name.trim(), full: Number(s.full) || 100, inTotal: s.inTotal })),
    })
    props.onOpenChange(false)
    setTitle("")
    const mine = out.data.find((x) => classes.find((c) => c.code === props.classCode)?.id === x.classId)
    props.onCreated((mine ?? out.data[0]).id)
  }

  const setSubject = (i: number, patch: Partial<SubjectDraft>) =>
    setSubjects((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建考试</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(examTypes) as ExamType[]).map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={type === k ? "default" : "outline"}
                onClick={() => setType(k)}
              >
                {examTypes[k]}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="title">名称</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如 U3 单元检测"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">日期（可空）</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          {classes.length > 1 && (
            <div className="space-y-1.5">
              <div className="text-sm font-medium">班级（同一张卷子可以多选，之后能做班级对比）</div>
              <div className="flex flex-wrap gap-3 text-sm">
                {classes.map((c) => (
                  <label key={c.code} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={classList.includes(c.code)}
                      onChange={(e) =>
                        setPicked((xs) =>
                          e.target.checked ? [...new Set([...xs, c.code])] : xs.filter((x) => x !== c.code),
                        )
                      }
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-sm font-medium">科目</span>
              {presets.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => setSubjects(p.subjects.map((x) => draftOf(x.name, x.full)))}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="space-y-1.5">
              {subjects.map((s, i) => (
                <div key={s.uid} className="flex items-center gap-2 text-sm">
                  <Input
                    value={s.name}
                    onChange={(e) => setSubject(i, { name: e.target.value })}
                    placeholder="科目"
                    className="h-8 w-28"
                    aria-label="科目"
                  />
                  <span className="text-muted-foreground">满分</span>
                  <Input
                    value={s.full}
                    inputMode="decimal"
                    onChange={(e) => setSubject(i, { full: e.target.value })}
                    className="h-8 w-16"
                    aria-label="满分"
                  />
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={s.inTotal}
                      onChange={(e) => setSubject(i, { inTotal: e.target.checked })}
                    />
                    计入总分
                  </label>
                  {subjects.length > 1 && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => setSubjects((xs) => xs.filter((_, j) => j !== i))}
                    >
                      ✕
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setSubjects((xs) => [...xs, draftOf("", "100")])}
              >
                + 加一科
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={create.isPending || classList.length === 0}>
              创建并开始录入
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
