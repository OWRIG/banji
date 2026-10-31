import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { type CheckKind, checkKinds } from "@/modules/checks/shared"
import { pct, today } from "@/shared/format"
import { ClassTabs, Empty, PageHeader, QueryState } from "@/web/components/common"
import { Button } from "@/web/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/web/components/ui/dialog"
import { Input } from "@/web/components/ui/input"
import { Label } from "@/web/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table"
import { useCurrentClass } from "@/web/lib/class"
import { downloadCsv } from "@/web/lib/csv"
import { callOp, useOp, useOpMutation } from "@/web/lib/ops"

export const Route = createFileRoute("/checks/")({
  component: ChecksPage,
  validateSearch: z.object({ new: z.boolean().optional() }),
})

function ChecksPage() {
  const { current } = useCurrentClass()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(!!search.new)
  const list = useOp("checks.list", { class: current?.code, limit: 200 }, { enabled: !!current })

  return (
    <div>
      <PageHeader
        title="默写过关"
        subtitle="默写、背书、作业订正都在这里登记。未达标的学生会自动进入待过关名单。"
        actions={
          <>
            {current && (
              <Button variant="outline" onClick={() => void exportSheet(current.code)}>
                导出总表
              </Button>
            )}
            <Button onClick={() => setCreating(true)}>新建</Button>
          </>
        }
      />
      <ClassTabs />
      <QueryState query={list}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>还没有检查记录，点右上角「新建」开始第一场默写。</Empty>
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead>标题</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead className="text-right">已录</TableHead>
                    <TableHead className="text-right">达标率</TableHead>
                    <TableHead className="text-right">待过关</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => navigate({ to: "/checks/$id", params: { id: String(c.id) } })}
                    >
                      <TableCell className="text-muted-foreground tabular-nums">{c.date ?? "—"}</TableCell>
                      <TableCell className="font-medium">
                        <Link to="/checks/$id" params={{ id: String(c.id) }}>
                          {c.title}
                        </Link>
                      </TableCell>
                      <TableCell>{checkKinds[c.kind as CheckKind]}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.stats.entered}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(c.stats.passRate)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${c.pending ? "text-destructive" : ""}`}>
                        {c.pending || ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }
      </QueryState>
      {current && (
        <NewCheckDialog
          open={creating}
          onOpenChange={setCreating}
          classCode={current.code}
          className={current.name}
          onCreated={(id) => navigate({ to: "/checks/$id", params: { id: String(id) } })}
        />
      )}
    </div>
  )
}

/** 默写总表：学生 × 场次，Excel 可以直接打开 */
async function exportSheet(classCode: string) {
  try {
    const { data } = await callOp("checks.sheet", { class: classCode })
    downloadCsv(`${data.className}-检查总表`, [
      ["学号", "姓名", ...data.checks.map((c) => (c.date ? `${c.title}（${c.date.slice(5)}）` : c.title))],
      ...data.rows.map((r) => [r.student.studentNo, r.student.name, ...r.values]),
    ])
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "导出失败")
  }
}

function NewCheckDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  classCode: string
  className: string
  onCreated: (id: number) => void
}) {
  const [kind, setKind] = useState<CheckKind>("dictation")
  const [title, setTitle] = useState("")
  const [date, setDate] = useState(today())
  const [passLine, setPassLine] = useState("80")
  const [fullScore, setFullScore] = useState("100")
  const [mode, setMode] = useState<"score" | "mark">("score")
  const create = useOpMutation("checks.create", { silent: true })

  async function submit(e: FormEvent) {
    e.preventDefault()
    const out = await create.mutateAsync({
      class: props.classCode,
      kind,
      title,
      date: date || null,
      mode,
      passLine: Number(passLine),
      fullScore: Number(fullScore),
    })
    props.onOpenChange(false)
    setTitle("")
    props.onCreated(out.data.id)
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建检查 · {props.className}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(checkKinds) as CheckKind[]).map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={kind === k ? "default" : "outline"}
                onClick={() => {
                  setKind(k)
                  setMode(k === "recite" ? "mark" : "score")
                }}
              >
                {checkKinds[k]}
              </Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="title">标题</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如 U3 单词默写 1"
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="date">日期（可空）</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pass">过关线</Label>
              <Input
                id="pass"
                inputMode="decimal"
                value={passLine}
                onChange={(e) => setPassLine(e.target.value)}
                disabled={mode === "mark"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="full">满分</Label>
              <Input
                id="full"
                inputMode="decimal"
                value={fullScore}
                onChange={(e) => setFullScore(e.target.value)}
                disabled={mode === "mark"}
              />
            </div>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "score"} onChange={() => setMode("score")} /> 分数登记
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "mark"} onChange={() => setMode("mark")} /> 快速标记（过 / 未过 /
              请假 / 免）
            </label>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              创建并开始登记
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
