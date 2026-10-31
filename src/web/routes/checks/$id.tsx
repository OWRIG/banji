import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { cn } from "cn"
import { type ClipboardEvent, type KeyboardEvent, useRef, useState } from "react"
import { toast } from "sonner"
import { type CheckKind, checkKinds, type Mark, marks, parseResultValue, resultText } from "@/modules/checks/shared"
import type { OpData } from "@/server/registry"
import { fmt, pct } from "@/shared/format"
import { PageHeader, QueryState, Stat } from "@/web/components/common"
import { useDangerOp } from "@/web/components/danger"
import { Button } from "@/web/components/ui/button"
import { Input } from "@/web/components/ui/input"
import { downloadCsv } from "@/web/lib/csv"
import { useOp, useOpMutation } from "@/web/lib/ops"

export const Route = createFileRoute("/checks/$id")({ component: CheckPage })

type Detail = OpData<"checks.get">
type Row = Detail["rows"][number]

function CheckPage() {
  const { id } = Route.useParams()
  const detail = useOp("checks.get", { check: Number(id) })
  // key：切换到另一场检查时重新挂载，清空输入草稿
  return <QueryState query={detail}>{(d) => <CheckEditor key={d.check.id} detail={d} />}</QueryState>
}

const display = resultText

function CheckEditor({ detail }: { detail: Detail }) {
  const { check, rows, stats } = detail
  const navigate = useNavigate()
  const record = useOpMutation("checks.record", { silent: true })
  const recordLoud = useOpMutation("checks.record")
  const clear = useOpMutation("pending.clear")
  const del = useDangerOp("checks.delete", {
    title: "删除这场检查？",
    describe: (p) => (
      <p>
        将删除「{p.title}」以及 {p.removedResults} 条登记结果，由它产生的自动积分会一起撤销。
      </p>
    ),
    onDone: () => navigate({ to: "/checks" }),
  })

  // 输入框里的草稿：key 是学生编号
  const [draft, setDraft] = useState<Record<number, string>>({})
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  // 正在保存的值：回车后焦点移走还会触发一次失焦保存，用它避免重复提交
  const saving = useRef<Record<number, string>>({})

  const isMark = check.mode === "mark"

  async function save(index: number, value: string) {
    const row = rows[index]
    const sid = row.student.id
    if (value === display(row.result) || saving.current[sid] === value) return
    const parsed = parseResultValue(value)
    if (parsed === null) {
      toast.error(`${row.student.name}：看不懂「${value}」。可以填分数，或 过/未过/请假/免`)
      return
    }
    saving.current[sid] = value
    try {
      await record.mutateAsync({ check: check.id, results: [{ student: sid, value }] })
    } finally {
      delete saving.current[sid]
    }
    setDraft((d) => {
      const { [row.student.id]: _, ...rest } = d
      return rest
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault()
      void save(index, e.currentTarget.value.trim())
      inputs.current[index + 1]?.focus()
      inputs.current[index + 1]?.select()
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      inputs.current[index - 1]?.focus()
      inputs.current[index - 1]?.select()
    }
  }

  // 从 Excel 复制一整列分数，粘贴到某一行：从这一行开始往下填
  async function onPaste(e: ClipboardEvent<HTMLInputElement>, index: number) {
    const text = e.clipboardData.getData("text")
    const lines = text.split(/\r?\n/).map((l) => l.split("\t")[0].trim())
    if (lines.at(-1) === "") lines.pop()
    if (lines.length < 2) return
    e.preventDefault()
    const entries = lines
      .slice(0, rows.length - index)
      .map((value, i) => ({ student: rows[index + i].student.id, value }))
      .filter((x) => x.value !== "")
    const bad = entries.filter((x) => parseResultValue(x.value) === null)
    if (bad.length) {
      toast.error(`有 ${bad.length} 个格子看不懂（例如「${bad[0].value}」），没有保存`)
      return
    }
    await recordLoud.mutateAsync({ check: check.id, results: entries })
    setDraft({})
  }

  function quick(index: number, value: string) {
    void save(index, value)
  }

  function exportCsv() {
    downloadCsv(`${check.className}-${check.title}`, [
      ["学号", "姓名", "结果", "状态", "上回"],
      ...rows.map((r) => [r.student.studentNo, r.student.name, display(r.result), statusText(r), display(r.previous)]),
    ])
  }

  return (
    <div>
      <PageHeader
        title={check.title}
        subtitle={
          <>
            {check.className} · {checkKinds[check.kind as CheckKind]} · {check.date ?? "无日期"}
            {!isMark && ` · 过关线 ${fmt(check.passLine)} / 满分 ${fmt(check.fullScore)}`}
            {detail.previousCheck && ` · 上回：${detail.previousCheck.title}`}
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={exportCsv}>
              导出 CSV
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              打印
            </Button>
            <Button variant="ghost" onClick={() => del.start({ check: check.id })}>
              删除
            </Button>
          </>
        }
      />
      {del.dialog}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="已录" value={`${stats.entered}/${rows.length}`} />
        <Stat label="达标率" value={pct(stats.passRate)} tone="brand" />
        <Stat label="未达标" value={stats.failed} tone={stats.failed ? "bad" : undefined} />
        <Stat label="请假" value={stats.leave} />
        {!isMark && <Stat label="满分" value={stats.full} tone="good" />}
      </div>

      <p className="no-print mb-3 text-xs text-muted-foreground">
        {isMark
          ? "点按钮直接保存。"
          : "输入后按回车跳到下一位并自动保存；可以从 Excel 复制一整列分数粘贴到任意一行。也可以填 请假 / 免 / 过 / 未过。"}
      </p>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-20 px-3 py-2 font-medium">学号</th>
              <th className="px-3 py-2 font-medium">姓名</th>
              <th className="px-3 py-2 font-medium">上回</th>
              <th className="px-3 py-2 font-medium">本次</th>
              <th className="px-3 py-2 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const value = draft[r.student.id] ?? display(r.result)
              return (
                <tr key={r.student.id} className="border-t">
                  <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{r.student.studentNo}</td>
                  <td className="px-3 py-1.5 font-medium">
                    <Link to="/students/$id" params={{ id: String(r.student.id) }} className="hover:underline">
                      {r.student.name}
                    </Link>
                  </td>
                  <td className={cn("px-3 py-1.5 tabular-nums", r.previous?.status === "failed" && "text-destructive")}>
                    {display(r.previous)}
                  </td>
                  <td className="px-3 py-1">
                    {isMark ? (
                      <div className="no-print flex flex-wrap gap-1">
                        {(Object.keys(marks) as Mark[]).map((m) => (
                          <Button
                            key={m}
                            size="xs"
                            variant={r.result?.mark === m ? "default" : "outline"}
                            onClick={() => quick(i, r.result?.mark === m ? "" : marks[m])}
                          >
                            {marks[m]}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Input
                          ref={(el) => {
                            inputs.current[i] = el
                          }}
                          value={value}
                          inputMode="decimal"
                          className="h-7 w-20 tabular-nums"
                          onChange={(e) => setDraft((d) => ({ ...d, [r.student.id]: e.target.value }))}
                          onKeyDown={(e) => onKeyDown(e, i)}
                          onBlur={(e) => void save(i, e.currentTarget.value.trim())}
                          onPaste={(e) => void onPaste(e, i)}
                          onFocus={(e) => e.currentTarget.select()}
                        />
                        <span className="no-print flex gap-0.5">
                          <Button
                            size="xs"
                            variant="ghost"
                            tabIndex={-1}
                            onClick={() => quick(i, String(check.fullScore))}
                          >
                            满分
                          </Button>
                          <Button size="xs" variant="ghost" tabIndex={-1} onClick={() => quick(i, "请假")}>
                            请假
                          </Button>
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusCell row={r} onClear={() => r.result && clear.mutate({ resultIds: [r.result.id] })} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function statusText(r: Row) {
  if (r.status === "passed") return "达标"
  if (r.status === "leave") return "请假"
  if (r.status === "failed") return r.result?.clearedAt ? `已补过 ${r.result.clearedAt}` : "待过关"
  return ""
}

function StatusCell({ row, onClear }: { row: Row; onClear: () => void }) {
  if (row.status === "passed") return <span className="text-success">✓ 达标</span>
  if (row.status === "leave") return <span className="text-muted-foreground">请假</span>
  if (row.status === "failed") {
    if (row.result?.clearedAt)
      return <span className="text-muted-foreground">✓ 已补过 {row.result.clearedAt.slice(5)}</span>
    return (
      <span className="flex items-center gap-2">
        <span className="text-destructive">✕ 待过关</span>
        <Button size="xs" variant="outline" className="no-print" onClick={onClear}>
          已过关
        </Button>
      </span>
    )
  }
  return null
}
