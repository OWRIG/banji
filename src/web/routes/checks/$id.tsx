import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { cn } from "cn"
import { type ClipboardEvent, type KeyboardEvent, useRef, useState } from "react"
import { toast } from "sonner"
import {
  type CheckKind,
  type CheckMode,
  checkKinds,
  checkModes,
  isReciteDone,
  levels,
  marks,
  modeMarks,
  parseResultValue,
  reciteTickValue,
  resultText,
} from "@/modules/checks/shared"
import type { OpData } from "@/server/registry"
import { fmt, pct } from "@/shared/format"
import { Empty, PageHeader, QueryState, Stat } from "@/web/components/common"
import { useDangerOp } from "@/web/components/danger"
import { Button } from "@/web/components/ui/button"
import { Checkbox } from "@/web/components/ui/checkbox"
import { Input } from "@/web/components/ui/input"
import { Label } from "@/web/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table"
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

  const isMark = check.mode !== "score"
  const isReciteMark = check.kind === "recite" && isMark
  // 输入框里的草稿：key 是学生编号
  const [view, setView] = useState<"tick" | "entry" | "overview">(isReciteMark ? "tick" : "entry")
  const [draft, setDraft] = useState<Record<number, string>>({})
  const [busyIds, setBusyIds] = useState<Record<number, boolean>>({})
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  // 正在保存的值：回车后焦点移走还会触发一次失焦保存，用它避免重复提交
  const saving = useRef<Record<number, string>>({})

  const update = useOpMutation("checks.update")

  async function save(index: number, value: string) {
    const row = rows[index]
    const sid = row.student.id
    if (value === display(row.result) || saving.current[sid] !== undefined) return
    const parsed = parseResultValue(value)
    if (parsed === null) {
      toast.error(`${row.student.name}：看不懂「${value}」。可以填分数，或 过/未过/请假/免`)
      return
    }
    saving.current[sid] = value
    setBusyIds((b) => ({ ...b, [sid]: true }))
    try {
      await record.mutateAsync({ check: check.id, results: [{ student: sid, value }] })
      setDraft((d) => {
        const { [row.student.id]: _, ...rest } = d
        return rest
      })
    } catch {
      // useOpMutation.onError 已弹出提示，保持服务器端原值
    } finally {
      delete saving.current[sid]
      setBusyIds((b) => {
        const { [sid]: _, ...rest } = b
        return rest
      })
    }
  }

  function toggleReciteTick(index: number) {
    const row = rows[index]
    const done = isReciteDone(check.mode, row.result)
    const nextValue = done ? "" : reciteTickValue(check.mode)
    void save(index, nextValue)
  }

  function focusInput(targetIndex: number) {
    for (let j = targetIndex; j >= 0 && j < rows.length; j += targetIndex >= 0 ? 1 : -1) {
      const el = inputs.current[j]
      if (el && !el.disabled) {
        el.focus()
        el.select()
        return
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault()
      const val = e.currentTarget.value.trim()
      focusInput(index + 1)
      void save(index, val)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      const prev = inputs.current[index - 1]
      prev?.focus()
      prev?.select()
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
    try {
      await recordLoud.mutateAsync({ check: check.id, results: entries })
      setDraft({})
    } catch {
      // useOpMutation.onError 已提示，保留原草稿
    }
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

  const doneCount = isReciteMark ? rows.filter((r) => isReciteDone(check.mode, r.result)).length : 0
  const unrecordedCount = rows.length - stats.entered
  const specialCount = isReciteMark ? stats.entered - doneCount : 0

  return (
    <div>
      <PageHeader
        title={check.title}
        subtitle={
          <>
            {check.className} · {checkKinds[check.kind as CheckKind]} · {check.date ?? "无日期"}
            {` · ${checkModes[check.mode as CheckMode] ?? check.mode}`}
            {!isMark && ` · 满分 ${fmt(check.fullScore)}`}
            {check.requirePass ? (isMark ? " · 判定过关" : ` · 过关线 ${fmt(check.passLine)}`) : " · 不判定过关"}
            {detail.previousCheck && ` · 上回：${detail.previousCheck.title}`}
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => update.mutate({ check: check.id, requirePass: !check.requirePass })}
              title={check.requirePass ? "关闭后不再产生待过关" : "打开后未达标的学生进入待过关名单"}
            >
              {check.requirePass ? "关闭过关判定" : "开启过关判定"}
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv}>
              导出 CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              打印
            </Button>
            <Button size="sm" variant="ghost" onClick={() => del.start({ check: check.id })}>
              删除
            </Button>
          </>
        }
      />
      {del.dialog}

      <div className="mb-2.5 flex flex-wrap gap-2">
        {isReciteMark && view === "tick" ? (
          <>
            <Stat label="已背" value={`${doneCount}/${rows.length}`} tone="good" />
            <Stat label="未登记" value={unrecordedCount} />
            <Stat label="已录" value={`${stats.entered}/${rows.length}`} />
            {specialCount > 0 && <Stat label="特殊/分级" value={specialCount} />}
            {check.requirePass && (
              <>
                <Stat label="达标率" value={pct(stats.passRate)} tone="brand" />
                <Stat label="未达标" value={stats.failed} tone={stats.failed ? "bad" : undefined} />
              </>
            )}
            {stats.leave > 0 && <Stat label="请假" value={stats.leave} />}
          </>
        ) : (
          <>
            <Stat label="已录" value={`${stats.entered}/${rows.length}`} />
            {check.requirePass && (
              <>
                <Stat label="达标率" value={pct(stats.passRate)} tone="brand" />
                <Stat label="未达标" value={stats.failed} tone={stats.failed ? "bad" : undefined} />
              </>
            )}
            {!check.requirePass && !isMark && <Stat label="平均分" value={fmt(stats.avg) || "—"} tone="brand" />}
            {check.mode === "level" &&
              [...levels].reverse().map((l) => <Stat key={l} label={marks[l]} value={stats.levels[l] ?? 0} />)}
            <Stat label="请假" value={stats.leave} />
            {!isMark && <Stat label="满分" value={stats.full} tone="good" />}
          </>
        )}
      </div>

      <div className="no-print mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex gap-0.5 rounded-md border bg-card p-0.5">
          {isReciteMark ? (
            <>
              <Button
                size="sm"
                variant={view === "tick" ? "secondary" : "ghost"}
                aria-pressed={view === "tick"}
                className="md:h-7 md:px-2.5 md:text-xs"
                onClick={() => setView("tick")}
              >
                勾选背书
              </Button>
              <Button
                size="sm"
                variant={view === "entry" ? "secondary" : "ghost"}
                aria-pressed={view === "entry"}
                className="md:h-7 md:px-2.5 md:text-xs"
                onClick={() => setView("entry")}
              >
                详细登记
              </Button>
              <Button
                size="sm"
                variant={view === "overview" ? "secondary" : "ghost"}
                aria-pressed={view === "overview"}
                className="md:h-7 md:px-2.5 md:text-xs"
                onClick={() => setView("overview")}
              >
                整班总览
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant={view === "entry" ? "secondary" : "ghost"}
                aria-pressed={view === "entry"}
                className="md:h-7 md:px-2.5 md:text-xs"
                onClick={() => setView("entry")}
              >
                录入成绩
              </Button>
              <Button
                size="sm"
                variant={view === "overview" ? "secondary" : "ghost"}
                aria-pressed={view === "overview"}
                className="md:h-7 md:px-2.5 md:text-xs"
                onClick={() => setView("overview")}
              >
                整班总览
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {view === "overview"
            ? "按学号从上到下、从左到右排列，方便整班截图与打印。"
            : view === "tick"
              ? "点击学生行勾选完成，再点一次取消清除；其他情况点「详细登记」。"
              : isMark
                ? "点按钮直接保存，再点一次取消。"
                : "回车保存并跳到下一位；支持粘贴 Excel 整列，也可以填 请假 / 免。"}
        </p>
      </div>
      {rows.length === 0 && <Empty>班级里还没有学生，请先到学生档案添加学生。</Empty>}
      <div className={cn(view === "overview" ? "" : "hidden print:block")}>
        <CheckOverview rows={rows} requirePass={check.requirePass} />
      </div>
      {isReciteMark && view === "tick" && rows.length > 0 && (
        <div className="no-print">
          <ReciteChecklist
            rows={rows}
            mode={check.mode}
            requirePass={check.requirePass}
            busyIds={busyIds}
            onToggle={toggleReciteTick}
          />
        </div>
      )}
      <div className={cn("no-print", view !== "entry" && "hidden")}>
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">学号</TableHead>
                <TableHead className="w-28">姓名</TableHead>
                {detail.previousCheck && <TableHead className="w-24">上回</TableHead>}
                <TableHead>本次</TableHead>
                {check.requirePass && <TableHead className="w-32">状态</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const value = draft[r.student.id] ?? display(r.result)
                const busy = !!busyIds[r.student.id]
                return (
                  <TableRow key={r.student.id}>
                    <TableCell className="py-1 text-muted-foreground tabular-nums">{r.student.studentNo}</TableCell>
                    <TableCell className="py-1 font-medium">
                      <Link to="/students/$id" params={{ id: String(r.student.id) }} className="hover:underline">
                        {r.student.name}
                      </Link>
                    </TableCell>
                    {detail.previousCheck && (
                      <TableCell
                        className={cn("py-1 tabular-nums", r.previous?.status === "failed" && "text-destructive")}
                      >
                        {display(r.previous)}
                      </TableCell>
                    )}
                    <TableCell className="py-1">
                      {isMark ? (
                        <div className="no-print flex flex-wrap gap-1">
                          {(modeMarks[check.mode as CheckMode] ?? modeMarks.mark).map((m) => (
                            <Button
                              key={m}
                              size="xs"
                              disabled={busy}
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
                            disabled={busy}
                            inputMode="decimal"
                            aria-label={`${r.student.name}的本次成绩`}
                            className="h-9 w-20 tabular-nums md:h-7"
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
                              disabled={busy}
                              tabIndex={-1}
                              onClick={() => quick(i, String(check.fullScore))}
                            >
                              满分
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={busy}
                              tabIndex={-1}
                              onClick={() => quick(i, "请假")}
                            >
                              请假
                            </Button>
                          </span>
                        </div>
                      )}
                    </TableCell>
                    {check.requirePass && (
                      <TableCell className="py-1">
                        <StatusCell row={r} onClear={() => r.result && clear.mutate({ resultIds: [r.result.id] })} />
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

/** 背书简洁勾选名单：桌面按学号从上到下、从左到右分 2~3 栏，手机单栏整行可点。 */
function ReciteChecklist({
  rows,
  mode,
  requirePass,
  busyIds,
  onToggle,
}: {
  rows: Row[]
  mode: string
  requirePass: boolean
  busyIds: Record<number, boolean>
  onToggle: (index: number) => void
}) {
  return (
    <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
      {rows.map((row, index) => {
        const done = isReciteDone(mode, row.result)
        const rawText = display(row.result)
        const busy = !!busyIds[row.student.id]
        const hasOtherResult = !done && rawText !== ""
        return (
          <Label
            key={row.student.id}
            className={cn(
              "mb-0 flex min-h-10 break-inside-avoid items-center gap-2.5 border-x border-b bg-card px-2.5 py-1.5 text-sm font-normal transition-colors select-none first:border-t has-[:focus-visible]:bg-accent/50 md:min-h-8 md:py-1",
              done ? "bg-success/5" : "hover:bg-muted/50",
              busy ? "cursor-wait opacity-60" : "cursor-pointer",
            )}
          >
            <Checkbox
              checked={done}
              disabled={busy}
              aria-label={`${row.student.name} 已背`}
              onCheckedChange={() => {
                if (!busy) onToggle(index)
              }}
              className="after:hidden"
            />
            <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">{row.student.studentNo}</span>
            <span className="min-w-0 flex-1 leading-snug font-medium break-words">{row.student.name}</span>
            {done ? (
              <span className="shrink-0 text-xs font-medium text-success">
                ✓ 已背{row.result?.mark === "pass_retry" ? "（二次过）" : ""}
              </span>
            ) : hasOtherResult ? (
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
                  row.result?.mark === "leave" || row.result?.mark === "exempt"
                    ? "bg-muted text-muted-foreground"
                    : requirePass && row.status === "failed" && !row.result?.clearedAt
                      ? "bg-destructive/10 text-destructive"
                      : "bg-accent text-foreground",
                )}
              >
                {rawText}
                {row.status === "failed" && row.result?.clearedAt ? "·已补过" : ""}
              </span>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">未登记</span>
            )}
          </Label>
        )
      })}
    </div>
  )
}

/** 分栏使用 CSS 顺序流，屏幕和打印均按学号纵向阅读。 */
function CheckOverview({ rows, requirePass }: { rows: Row[]; requirePass: boolean }) {
  if (!rows.length) return null
  return (
    <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 print:columns-3">
      {rows.map((row) => (
        <div
          key={row.student.id}
          className="mb-0 flex break-inside-avoid items-center gap-2 border-x border-b bg-card px-2.5 py-1 text-sm leading-4 first:border-t [&:nth-child(odd)]:bg-muted/40"
        >
          <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">{row.student.studentNo}</span>
          <span className="min-w-0 flex-1 font-medium">{row.student.name}</span>
          <span className={cn("shrink-0 font-semibold tabular-nums", row.status === "failed" && "text-destructive")}>
            {display(row.result) || "未录"}
          </span>
          {requirePass && <span className="text-xs text-muted-foreground">{statusText(row)}</span>}
        </div>
      ))}
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
