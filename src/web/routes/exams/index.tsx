import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { cn } from "cn"
import { type FormEvent, type ReactNode, useEffect, useState } from "react"
import { z } from "zod"
import { type ExamType, examTypes } from "@/modules/exams/shared"
import { fmt, pct, today } from "@/shared/format"
import { ClassTabs, Empty, PageHeader, QueryState } from "@/web/components/common"
import { Button } from "@/web/components/ui/button"
import { Checkbox } from "@/web/components/ui/checkbox"
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
  const { current, setCode } = useCurrentClass()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(!!search.new)
  const list = useOp("exams.list", { class: current?.code, limit: 200 }, { enabled: !!current })

  return (
    <div>
      <PageHeader
        title="考试成绩"
        subtitle="单元检测、月考、期中期末。录完成绩可以看统计、进退步、临界生和班级对比。"
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            新建考试
          </Button>
        }
      />
      <ClassTabs />
      <QueryState query={list}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>还没有考试记录，点右上角「新建考试」。</Empty>
          ) : (
            <div className="rounded-md border bg-card">
              <Table className="min-w-[38rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">日期</TableHead>
                    <TableHead className="min-w-48">考试</TableHead>
                    <TableHead className="w-24">类型</TableHead>
                    <TableHead className="min-w-36">科目</TableHead>
                    <TableHead className="w-20 text-right">已录</TableHead>
                    <TableHead className="w-28 text-right">均分</TableHead>
                    <TableHead className="w-24 text-right">及格率</TableHead>
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
                      <TableCell className="font-medium whitespace-normal">
                        <Link to="/exams/$id" params={{ id: String(e.id) }} className="hover:underline">
                          {e.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{examTypes[e.type as ExamType] ?? e.type}</TableCell>
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
          onCreated={(id, code) => {
            if (code && code !== current.code) setCode(code)
            navigate({ to: "/exams/$id", params: { id: String(id) } })
          }}
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
  onCreated: (id: number, classCode?: string) => void
}) {
  const { classes } = useCurrentClass()
  const [type, setType] = useState<ExamType>("unit")
  const [title, setTitle] = useState("")
  const [date, setDate] = useState(today())
  const [subjects, setSubjects] = useState<SubjectDraft[]>(() =>
    presets[0].subjects.map((x) => draftOf(x.name, x.full)),
  )
  const [picked, setPicked] = useState<string[]>([props.classCode])
  const create = useOpMutation("exams.create")

  useEffect(() => {
    if (props.open) {
      setPicked([props.classCode])
    }
  }, [props.open, props.classCode])

  const classList = picked

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
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
      const target = mine ?? out.data[0]
      const targetCode = classes.find((c) => c.id === target.classId)?.code
      props.onCreated(target.id, targetCode)
    } catch {
      // useOpMutation.onError 已提示
    }
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
          <Field label="类型">
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
          </Field>

          <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
            <Field label="名称" htmlFor="title">
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如 U3 单元检测"
                required
                autoFocus
              />
            </Field>
            <Field label="日期（可空）" htmlFor="date">
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          <Field label="班级" hint={`已选 ${classList.length} 个班（同一张卷子可多选，之后能做班级对比）`}>
            <div className="flex flex-wrap gap-4 text-sm">
              {classes.map((c) => (
                <Label key={c.code} className="font-normal">
                  <Checkbox
                    checked={classList.includes(c.code)}
                    onCheckedChange={(on) =>
                      setPicked((xs) => (on ? [...new Set([...xs, c.code])] : xs.filter((x) => x !== c.code)))
                    }
                  />
                  {c.name}
                </Label>
              ))}
            </div>
          </Field>

          <Field
            label="科目"
            extra={
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => setSubjects(p.subjects.map((x) => draftOf(x.name, x.full)))}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            }
          >
            <div className="space-y-2">
              {subjects.map((s, i) => (
                <div key={s.uid} className="flex items-center gap-2.5 text-sm">
                  <Input
                    value={s.name}
                    onChange={(e) => setSubject(i, { name: e.target.value })}
                    placeholder="科目"
                    className="flex-1"
                    aria-label="科目"
                  />
                  <span className="text-muted-foreground">满分</span>
                  <Input
                    value={s.full}
                    inputMode="decimal"
                    onChange={(e) => setSubject(i, { full: e.target.value })}
                    className="w-20 tabular-nums"
                    aria-label="满分"
                  />
                  <Label className="font-normal whitespace-nowrap">
                    <Checkbox checked={s.inTotal} onCheckedChange={(on) => setSubject(i, { inTotal: on === true })} />
                    计入总分
                  </Label>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className={cn("text-muted-foreground", subjects.length === 1 && "invisible")}
                    aria-label="删除这一科"
                    onClick={() => setSubjects((xs) => xs.filter((_, j) => j !== i))}
                  >
                    ✕
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSubjects((xs) => [...xs, draftOf("", "100")])}
              >
                + 加一科
              </Button>
            </div>
          </Field>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={create.isPending || classList.length === 0}>
              创建并开始录入
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** 表单里的一项：标题（可带说明、右侧附加内容）+ 内容 */
function Field({
  label,
  htmlFor,
  hint,
  extra,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        {extra && <div className="ml-auto">{extra}</div>}
      </div>
      {children}
    </div>
  )
}
