import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { cn } from "cn"
import { type ClipboardEvent, type KeyboardEvent, useRef, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import {
  type ExamType,
  examTypes,
  fullOf,
  parseScoreValue,
  type ScoreStatus,
  scoreLevel,
  scoreStatuses,
  TOTAL,
} from "@/modules/exams/shared"
import type { OpData } from "@/server/registry"
import { fmt, pct } from "@/shared/format"
import { Empty, PageHeader, Picker, QueryState } from "@/web/components/common"
import { useDangerOp } from "@/web/components/danger"
import { Button } from "@/web/components/ui/button"
import { Input } from "@/web/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table"
import { downloadCsv } from "@/web/lib/csv"
import { useOp, useOpMutation } from "@/web/lib/ops"

export const Route = createFileRoute("/exams/$id")({
  component: ExamPage,
  validateSearch: z.object({ tab: z.enum(["scores", "analysis"]).optional() }),
})

type Detail = OpData<"exams.get">
type Cell = Detail["rows"][number]["cells"][string]

function ExamPage() {
  const { id } = Route.useParams()
  const { tab = "scores" } = Route.useSearch()
  const detail = useOp("exams.get", { exam: Number(id) })
  return (
    <QueryState query={detail}>
      {(d) => (
        <div>
          <Header detail={d} />
          <div className="no-print mb-3 inline-flex rounded-md border bg-card p-0.5 text-sm">
            {(["scores", "analysis"] as const).map((t) => (
              <Link
                key={t}
                to="/exams/$id"
                params={{ id }}
                search={{ tab: t }}
                className={cn(
                  "rounded px-3 py-1.5 text-muted-foreground md:px-2.5 md:py-0.5",
                  tab === t && "bg-muted font-medium text-foreground",
                )}
              >
                {t === "scores" ? "成绩录入" : "考后分析"}
              </Link>
            ))}
          </div>
          {tab === "scores" ? <ScoreEditor key={d.exam.id} detail={d} /> : <Analysis detail={d} />}
        </div>
      )}
    </QueryState>
  )
}

function Header({ detail }: { detail: Detail }) {
  const { exam } = detail
  const navigate = useNavigate()
  const del = useDangerOp("exams.delete", {
    title: "删除这场考试？",
    describe: (p) => (
      <p>
        将删除「{p.title}」和 {p.students} 名学生的成绩
        {p.awards > 0 && `，以及 ${p.awards} 条进步奖励加分`}。
      </p>
    ),
    onDone: () => navigate({ to: "/exams" }),
  })

  function exportCsv() {
    const subjects = detail.subjects
    downloadCsv(`${exam.className}-${exam.title}`, [
      ["学号", "姓名", ...subjects, `${TOTAL}班排`, `${TOTAL}校排`, "备注"],
      ...detail.rows.map((r) => [
        r.student.studentNo,
        r.student.name,
        ...subjects.map((s) => cellText(r.cells[s])),
        r.cells[TOTAL]?.classRank ?? "",
        r.cells[TOTAL]?.schoolRank ?? "",
        r.note,
      ]),
    ])
  }

  return (
    <>
      <PageHeader
        title={exam.title}
        subtitle={
          <>
            {exam.className} · {examTypes[exam.type as ExamType] ?? exam.type} · {exam.date ?? "无日期"} ·{" "}
            {exam.subjects.map((s) => `${s.name} ${fmt(s.full)}${s.inTotal ? "" : "（不计总分）"}`).join("、")}
            {detail.peers.length > 0 && ` · 同卷：${detail.peers.map((p) => p.className).join("、")}`}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="outline" onClick={exportCsv}>
              导出 CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              打印
            </Button>
            <Button size="sm" variant="ghost" onClick={() => del.start({ exam: exam.id })}>
              删除
            </Button>
          </>
        }
      />
      {del.dialog}
    </>
  )
}

function cellText(c: Cell | undefined) {
  if (!c) return ""
  if (c.status) return scoreStatuses[c.status as ScoreStatus] ?? c.status
  return fmt(c.score)
}

/** 分数着色：低于满分 60% 红色，达到 85% 绿色 */
function levelClass(score: number | null | undefined, full: number) {
  const level = scoreLevel(score, full)
  return level === "low" ? "text-destructive" : level === "high" ? "text-success" : ""
}

// ---- 成绩录入：回车往下走、整列粘贴，和默写登记一样 ----

function ScoreEditor({ detail }: { detail: Detail }) {
  const { exam, rows } = detail
  const subjects = exam.subjects.map((s) => s.name)
  const hasTotal = detail.subjects.includes(TOTAL)
  const record = useOpMutation("exams.record", { silent: true })
  const recordLoud = useOpMutation("exams.record")
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busyKeys, setBusyKeys] = useState<Record<string, boolean>>({})
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const saving = useRef<Record<string, string>>({})
  const key = (i: number, subject: string) => `${i}:${subject}`

  async function save(i: number, subject: string, value: string) {
    const row = rows[i]
    const k = key(i, subject)
    if (value === cellText(row.cells[subject]) || saving.current[k] !== undefined) return
    if (parseScoreValue(value) === null) {
      toast.error(`${row.student.name} ${subject}：看不懂「${value}」。可以填分数，或 请假/缺考`)
      return
    }
    saving.current[k] = value
    setBusyKeys((b) => ({ ...b, [k]: true }))
    try {
      await record.mutateAsync({ exam: exam.id, results: [{ student: row.student.id, subject, value }] })
      setDraft(({ [k]: _, ...rest }) => rest)
    } catch {
      // useOpMutation.onError 已提示，保留原草稿
    } finally {
      delete saving.current[k]
      setBusyKeys((b) => {
        const { [k]: _, ...rest } = b
        return rest
      })
    }
  }

  function focus(i: number, subject: string) {
    const el = inputs.current[key(i, subject)]
    el?.focus()
    el?.select()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, i: number, subject: string) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault()
      const val = e.currentTarget.value.trim()
      focus(i + 1, subject)
      void save(i, subject, val)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      focus(i - 1, subject)
    }
  }

  // 从 Excel 复制一列（或相邻几列）分数，从这一格开始往下、往右填
  async function onPaste(e: ClipboardEvent<HTMLInputElement>, i: number, subject: string) {
    const lines = e.clipboardData.getData("text").split(/\r?\n/)
    if (lines.at(-1) === "") lines.pop()
    const grid = lines.map((l) => l.split("\t").map((x) => x.trim()))
    if (grid.length < 2 && (grid[0]?.length ?? 0) < 2) return
    e.preventDefault()
    const start = subjects.indexOf(subject)
    const entries = grid
      .slice(0, rows.length - i)
      .flatMap((cols, r) =>
        cols
          .slice(0, subjects.length - start)
          .flatMap((value, c) =>
            value === "" ? [] : [{ student: rows[i + r].student.id, subject: subjects[start + c], value }],
          ),
      )
    const bad = entries.filter((x) => parseScoreValue(x.value) === null)
    if (bad.length) {
      toast.error(`有 ${bad.length} 个格子看不懂（例如「${bad[0].value}」），没有保存`)
      return
    }
    if (entries.length === 0) return
    try {
      await recordLoud.mutateAsync({ exam: exam.id, results: entries })
      setDraft({})
    } catch {
      // useOpMutation.onError 已提示
    }
  }

  return (
    <div>
      <p className="no-print mb-2.5 text-xs text-muted-foreground">
        输入后按回车跳到下一位并自动保存；可以从 Excel
        复制一列或几列分数，粘贴到起始格。没来考的填「请假」或「缺考」，不计入统计。
        {hasTotal && " 总分自动相加，名次按本班总分计算（有导入的班排时用导入的）。"}
      </p>
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">学号</TableHead>
              <TableHead className="w-28">姓名</TableHead>
              {exam.subjects.map((s) => (
                <TableHead key={s.name} className="w-28">
                  {s.name}
                  <span className="font-normal">（{fmt(s.full)}）</span>
                </TableHead>
              ))}
              {hasTotal && (
                <>
                  <TableHead className="w-20 text-right">{TOTAL}</TableHead>
                  <TableHead className="w-16 text-right">班排</TableHead>
                </>
              )}
              <TableHead>备注</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.student.id}>
                <TableCell className="py-1 text-muted-foreground tabular-nums">{r.student.studentNo}</TableCell>
                <TableCell className="py-1 font-medium whitespace-nowrap">
                  <Link to="/students/$id" params={{ id: String(r.student.id) }} className="hover:underline">
                    {r.student.name}
                  </Link>
                </TableCell>
                {exam.subjects.map((s) => {
                  const k = key(i, s.name)
                  const cell = r.cells[s.name]
                  const busy = !!busyKeys[k]
                  return (
                    <TableCell key={s.name} className="py-1">
                      <Input
                        ref={(el) => {
                          inputs.current[k] = el
                        }}
                        value={draft[k] ?? cellText(cell)}
                        disabled={busy}
                        inputMode="decimal"
                        aria-label={`${r.student.name} ${s.name}`}
                        className={cn(
                          "no-print h-9 w-20 tabular-nums md:h-7",
                          !(k in draft) && levelClass(cell?.score, s.full),
                        )}
                        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                        onKeyDown={(e) => onKeyDown(e, i, s.name)}
                        onBlur={(e) => void save(i, s.name, e.currentTarget.value.trim())}
                        onPaste={(e) => void onPaste(e, i, s.name)}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <span className={cn("hidden tabular-nums print:inline", levelClass(cell?.score, s.full))}>
                        {cellText(cell)}
                      </span>
                    </TableCell>
                  )
                })}
                {hasTotal && (
                  <>
                    <TableCell
                      className={cn(
                        "py-1 text-right font-medium tabular-nums",
                        levelClass(r.cells[TOTAL]?.score, fullOf(exam.subjects, TOTAL)),
                      )}
                    >
                      {fmt(r.cells[TOTAL]?.score)}
                    </TableCell>
                    <TableCell className="py-1 text-right text-muted-foreground tabular-nums">
                      {r.cells[TOTAL]?.classRank ?? ""}
                    </TableCell>
                  </>
                )}
                <TableCell className="py-1 text-xs text-muted-foreground whitespace-normal">{r.note}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <StatsTable stats={detail.stats} />
    </div>
  )
}

function StatsTable({ stats }: { stats: Detail["stats"] }) {
  return (
    <div className="mt-4 rounded-md border bg-card">
      <Table className="tabular-nums">
        <TableHeader>
          <TableRow>
            {["科目", "人数", "均分", "中位数", "最高", "最低", "及格率", "优秀率"].map((h, i) => (
              <TableHead key={h} className={cn(i > 0 && "text-right")}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map((s) => (
            <TableRow key={s.subject}>
              <TableCell className="font-medium">
                {s.subject}
                <span className="text-xs font-normal text-muted-foreground">（{fmt(s.full)}）</span>
              </TableCell>
              <TableCell className="text-right">{s.count}</TableCell>
              <TableCell className="text-right">{fmt(s.avg)}</TableCell>
              <TableCell className="text-right">{fmt(s.median)}</TableCell>
              <TableCell className="text-right">{fmt(s.max)}</TableCell>
              <TableCell className="text-right">{fmt(s.min)}</TableCell>
              <TableCell className="text-right">{pct(s.passRate)}</TableCell>
              <TableCell className="text-right">{pct(s.excellentRate)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ---- 考后分析 ----

function Analysis({ detail }: { detail: Detail }) {
  const { exam } = detail
  const [subject, setSubject] = useState(detail.subjects.includes(TOTAL) ? TOTAL : detail.subjects[0])
  const [by, setBy] = useState<"rank" | "score">("rank")
  const [compareTo, setCompareTo] = useState<number | undefined>()
  const others = useOp("exams.list", { class: exam.classCode, limit: 200 })
  const analysis = useOp("exams.analyze", { exam: exam.id, subject, by, compareTo })
  const award = useOpMutation("exams.awardProgress")

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">科目</span>
        <Picker
          label="科目"
          value={subject}
          onChange={setSubject}
          options={detail.subjects.map((s) => ({ value: s, label: s }))}
        />
        <span className="ml-2 text-muted-foreground">对比</span>
        <Picker
          label="对比的考试"
          value={compareTo ? String(compareTo) : ""}
          onChange={(v) => setCompareTo(v ? Number(v) : undefined)}
          options={[
            { value: "", label: "上一场考试" },
            ...(others.data ?? [])
              .filter((e) => e.id !== exam.id)
              .map((e) => ({ value: String(e.id), label: e.title })),
          ]}
        />
        <span className="ml-2 text-muted-foreground">按</span>
        <Picker
          label="比较方式"
          value={by}
          onChange={(v) => setBy(v as "rank" | "score")}
          options={[
            { value: "rank", label: "名次变化" },
            { value: "score", label: "分数变化" },
          ]}
        />
      </div>

      <QueryState query={analysis}>
        {(a) => (
          <>
            <StatsTable stats={a.stats} />

            <section>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">进步与退步</h2>
                {a.progress && (
                  <span className="text-sm text-muted-foreground">
                    {a.progress.subject} · 对比「{a.progress.compareExam.title}」 ·{" "}
                    {a.progress.by === "rank" ? "按班级名次" : "按分数（满分不同时折算）"}
                  </span>
                )}
                {a.progress && a.progress.improved.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="no-print ml-auto"
                    disabled={award.isPending}
                    onClick={() =>
                      award.mutate({
                        exam: exam.id,
                        subject,
                        by,
                        compareTo: a.progress?.compareExam.id,
                        top: 5,
                      })
                    }
                  >
                    进步前 5 名加分
                  </Button>
                )}
              </div>
              {!a.progress ? (
                <Empty>这个班在这场之前没有别的考试，暂时没法比较进退步。</Empty>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <ProgressList title="进步" rows={a.progress.improved} by={a.progress.by} tone="good" />
                  <ProgressList title="退步" rows={a.progress.declined} by={a.progress.by} tone="bad" />
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 font-semibold">临界生</h2>
              <p className="mb-2 text-xs text-muted-foreground">
                离及格线（{fmt(a.borderline.passLine)}）、优秀线（{fmt(a.borderline.excellentLine)}）差满分 10%
                以内的学生。
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <BorderList title="接近及格" rows={a.borderline.pass} />
                <BorderList title="接近优秀" rows={a.borderline.excellent} />
              </div>
            </section>

            {a.peers.length > 0 && (
              <section>
                <h2 className="mb-2 font-semibold">同卷班级对比</h2>
                <div className="rounded-md border bg-card">
                  <Table className="tabular-nums">
                    <TableHeader>
                      <TableRow>
                        <TableHead>科目</TableHead>
                        <TableHead>班级</TableHead>
                        <TableHead className="text-right">均分</TableHead>
                        <TableHead className="text-right">及格率</TableHead>
                        <TableHead className="text-right">优秀率</TableHead>
                        <TableHead className="text-right">本班均分差</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {a.peers.flatMap((p) =>
                        p.subjects.flatMap((s) => [
                          <TableRow key={`${p.exam.id}-${s.subject}-mine`}>
                            <TableCell className="font-medium">{s.subject}</TableCell>
                            <TableCell>{exam.className}</TableCell>
                            <TableCell className="text-right">{fmt(s.mine.avg)}</TableCell>
                            <TableCell className="text-right">{pct(s.mine.passRate)}</TableCell>
                            <TableCell className="text-right">{pct(s.mine.excellentRate)}</TableCell>
                            <TableCell
                              rowSpan={2}
                              className={cn(
                                "text-right font-medium",
                                (s.avgDiff ?? 0) > 0 && "text-success",
                                (s.avgDiff ?? 0) < 0 && "text-destructive",
                              )}
                            >
                              {s.avgDiff == null ? "—" : `${s.avgDiff > 0 ? "+" : ""}${fmt(s.avgDiff)}`}
                            </TableCell>
                          </TableRow>,
                          <TableRow key={`${p.exam.id}-${s.subject}-theirs`} className="text-muted-foreground">
                            <TableCell />
                            <TableCell>
                              <Link to="/exams/$id" params={{ id: String(p.exam.id) }} className="hover:underline">
                                {p.className}
                              </Link>
                            </TableCell>
                            <TableCell className="text-right">{fmt(s.theirs.avg)}</TableCell>
                            <TableCell className="text-right">{pct(s.theirs.passRate)}</TableCell>
                            <TableCell className="text-right">{pct(s.theirs.excellentRate)}</TableCell>
                          </TableRow>,
                        ]),
                      )}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}
          </>
        )}
      </QueryState>
    </div>
  )
}

type Progress = NonNullable<OpData<"exams.analyze">["progress"]>

function ProgressList({
  title,
  rows,
  by,
  tone,
}: {
  title: string
  rows: Progress["improved"]
  by: "rank" | "score"
  tone: "good" | "bad"
}) {
  return (
    <div className="rounded-md border bg-card p-3.5">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有</p>
      ) : (
        <ul className="space-y-1 text-sm tabular-nums">
          {rows.map((r) => (
            <li key={r.student.id} className="flex gap-3">
              <Link
                to="/students/$id"
                params={{ id: String(r.student.id) }}
                className="w-16 font-medium hover:underline"
              >
                {r.student.name}
              </Link>
              <span className="text-muted-foreground">
                {by === "rank"
                  ? `第 ${r.rankBefore ?? "—"} → ${r.rankAfter ?? "—"} 名`
                  : `${fmt(r.before)} → ${fmt(r.after)}`}
              </span>
              <span className={cn("ml-auto font-medium", tone === "good" ? "text-success" : "text-destructive")}>
                {tone === "good" ? "↑" : "↓"} {fmt(Math.abs(r.gain))}
                {by === "rank" ? " 名" : " 分"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BorderList({ title, rows }: { title: string; rows: OpData<"exams.analyze">["borderline"]["pass"] }) {
  return (
    <div className="rounded-md border bg-card p-3.5">
      <h3 className="mb-2 text-sm font-medium">
        {title}（{rows.length}）
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有</p>
      ) : (
        <ul className="space-y-1 text-sm tabular-nums">
          {rows.map((r) => (
            <li key={r.student.id} className="flex gap-3">
              <Link
                to="/students/$id"
                params={{ id: String(r.student.id) }}
                className="w-16 font-medium hover:underline"
              >
                {r.student.name}
              </Link>
              <span>{fmt(r.score)}</span>
              <span className="ml-auto text-muted-foreground">差 {fmt(r.gap)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
