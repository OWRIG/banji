import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { cn } from "cn"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { type CheckKind, type CheckMode, checkKinds, checkModes, defaultMode } from "@/modules/checks/shared"
import { pct, today } from "@/shared/format"
import { ClassTabs, Empty, PageHeader, QueryState } from "@/web/components/common"
import { Button } from "@/web/components/ui/button"
import { Checkbox } from "@/web/components/ui/checkbox"
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

const modeHints: Record<CheckMode, string> = {
  score: "逐个填分数，可以从 Excel 整列粘贴。",
  level: "抄书 / 读书 / 背部分 / 全背，适合背书。全背自动 +1 分。",
  mark: "过 / 二次过 / 未过 / 请假 / 免。",
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
  const [mode, setMode] = useState<CheckMode>("score")
  const [requirePass, setRequirePass] = useState(false)
  const create = useOpMutation("checks.create", { silent: true })

  async function submit(e: FormEvent) {
    e.preventDefault()
    const out = await create.mutateAsync({
      class: props.classCode,
      kind,
      title,
      date: date || null,
      mode,
      requirePass,
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
        <form onSubmit={submit} className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(checkKinds) as CheckKind[]).map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={kind === k ? "default" : "outline"}
                onClick={() => {
                  setKind(k)
                  setMode(defaultMode(k))
                }}
              >
                {checkKinds[k]}
              </Button>
            ))}
          </div>
          <div className="space-y-2.5">
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2.5">
              <Label htmlFor="date">日期（可空）</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {mode === "score" && (
              <div className="space-y-2.5">
                <Label htmlFor="full">满分</Label>
                <Input id="full" inputMode="decimal" value={fullScore} onChange={(e) => setFullScore(e.target.value)} />
              </div>
            )}
          </div>

          <div className="space-y-2.5">
            <Label>登记方式</Label>
            <div className="inline-flex rounded-md border bg-card p-0.5 text-sm">
              {(Object.keys(checkModes) as CheckMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded px-3 py-1 text-muted-foreground transition-colors hover:text-foreground",
                    mode === m && "bg-muted font-medium text-foreground",
                  )}
                >
                  {checkModes[m]}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{modeHints[mode]}</p>
          </div>

          <div className="space-y-2.5">
            <Label className="font-normal">
              <Checkbox checked={requirePass} onCheckedChange={(on) => setRequirePass(on === true)} />
              判定过关
            </Label>
            <p className="text-xs text-muted-foreground">
              {requirePass
                ? mode === "score"
                  ? "低于过关线的学生进入待过关名单，补过后销账。"
                  : mode === "level"
                    ? "没到「全背」的学生进入待过关名单，补过后销账。"
                    : "标记为「未过」的学生进入待过关名单，补过后销账。"
                : "只记录结果，不产生待过关名单。之后也可以在这场检查里打开。"}
            </p>
            {requirePass && mode === "score" && (
              <div className="flex items-center gap-2 text-sm">
                <Label htmlFor="pass" className="font-normal text-muted-foreground">
                  过关线
                </Label>
                <Input
                  id="pass"
                  inputMode="decimal"
                  value={passLine}
                  onChange={(e) => setPassLine(e.target.value)}
                  className="w-24"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={create.isPending}>
              创建并开始登记
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
