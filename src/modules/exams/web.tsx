import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import type { OpData } from "@/server/registry"
import { fmt, pct } from "@/shared/format"
import { Button } from "@/web/components/ui/button"
import { useOp } from "@/web/lib/ops"
import type { WebModule } from "@/web/modules"
import { type ScoreStatus, scoreLevel, scoreStatuses } from "./shared"

// 「考试成绩」模块的网页部分：导航、首页按钮、学生档案里的成绩趋势。页面在 src/web/routes/exams/。

type History = NonNullable<OpData<"students.profile">["sections"]["exams"]>["history"]

export const examsWeb: WebModule = {
  id: "exams",
  nav: [{ to: "/exams", label: "考试成绩" }],

  HomeActions: () => {
    const modules = useOp("modules.list", {})
    if (!modules.data?.find((m) => m.id === "exams")?.enabled) return null
    return (
      <Button asChild variant="outline">
        <Link to="/exams" search={{ new: true }}>
          登记成绩
        </Link>
      </Button>
    )
  },

  ProfileCard: ({ profile }) => {
    const history = profile.sections.exams?.history
    if (!history) return null
    const taken = history.filter((h) => h.score != null)
    return (
      <section>
        <h2 className="mb-2 font-semibold">考试成绩</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有考试成绩</p>
        ) : (
          <>
            {taken.length >= 2 && (
              <div className="mb-3 grid gap-3 sm:grid-cols-2">
                <TrendChart
                  title="得分率"
                  points={taken.map((h) => ({
                    id: h.examId,
                    label: h.title,
                    value: (h.rate ?? 0) * 100,
                    text: pct(h.rate),
                  }))}
                  min={0}
                  max={100}
                />
                <TrendChart
                  title="班级名次（越靠上越好）"
                  points={taken
                    .filter((h) => h.rank != null)
                    .map((h) => ({ id: h.examId, label: h.title, value: h.rank ?? 0, text: `第 ${h.rank} 名` }))}
                  min={1}
                  max={Math.max(...taken.map((h) => h.classSize), 2)}
                  inverted
                />
              </div>
            )}
            <HistoryTable history={history} />
          </>
        )}
      </section>
    )
  },
}

function HistoryTable({ history }: { history: History }) {
  const rows = [...history].reverse()
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm tabular-nums">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">考试</th>
            <th className="px-3 py-2 font-medium">各科</th>
            <th className="px-3 py-2 text-right font-medium">成绩</th>
            <th className="px-3 py-2 text-right font-medium" title="得分率和上一场相比变化了多少个百分点">
              得分率变化
            </th>
            <th className="px-3 py-2 text-right font-medium">班排</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h, i) => {
            // 和上一场比得分率变化（不同满分也可比）
            const prev = rows.slice(i + 1).find((x) => x.rate != null)
            const delta = h.rate != null && prev?.rate != null ? (h.rate - prev.rate) * 100 : null
            return (
              <tr key={h.examId} className="border-t">
                <td className="px-3 py-1.5">
                  <Link to="/exams/$id" params={{ id: String(h.examId) }} className="font-medium hover:underline">
                    {h.title}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">{h.date ?? ""}</span>
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {h.subjects.length > 1 &&
                    h.subjects
                      .map(
                        (s) =>
                          `${s.name} ${s.status ? (scoreStatuses[s.status as ScoreStatus] ?? s.status) : fmt(s.score)}`,
                      )
                      .join(" · ")}
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right font-medium",
                    scoreLevel(h.score, h.full) === "low" && "text-destructive",
                    scoreLevel(h.score, h.full) === "high" && "text-success",
                  )}
                >
                  {h.score == null ? "—" : `${fmt(h.score)} / ${fmt(h.full)}`}
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right",
                    delta != null && delta > 0 && "text-success",
                    delta != null && delta < 0 && "text-destructive",
                  )}
                >
                  {delta == null ? "" : `${delta > 0 ? "↑" : delta < 0 ? "↓" : ""}${fmt(Math.abs(delta))}`}
                </td>
                <td className="px-3 py-1.5 text-right">{h.rank ?? ""}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 单条折线的小图（得分率、名次各一张，不用双坐标轴）。
 * 只标首尾两点的数值；鼠标停在点上显示考试名称和数值；精确数字看下面的表格。
 */
function TrendChart({
  title,
  points,
  min,
  max,
  inverted,
}: {
  title: string
  points: { id: number; label: string; value: number; text: string }[]
  min: number
  max: number
  inverted?: boolean
}) {
  const w = 480
  const h = 110
  const pad = { l: 8, r: 8, t: 18, b: 18 }
  if (points.length < 2) return null
  const x = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / (points.length - 1)
  const y = (v: number) => {
    const t = (v - min) / (max - min || 1)
    return pad.t + (inverted ? t : 1 - t) * (h - pad.t - pad.b)
  }
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ")
  const last = points.length - 1
  return (
    <figure className="rounded-lg border bg-card p-3">
      <figcaption className="mb-1 text-xs text-muted-foreground">{title}</figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={title}>
        <line x1={pad.l} x2={w - pad.r} y1={h - pad.b} y2={h - pad.b} className="stroke-border" strokeWidth={1} />
        <path d={path} fill="none" className="stroke-brand" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={p.id}>
            <circle cx={x(i)} cy={y(p.value)} r={4} className="fill-brand stroke-card" strokeWidth={2} />
            {/* 比点大的透明热区，方便鼠标和手指点到 */}
            <circle cx={x(i)} cy={y(p.value)} r={12} fill="transparent">
              <title>{`${p.label}：${p.text}`}</title>
            </circle>
            {(i === 0 || i === last) && (
              <text
                x={x(i)}
                y={y(p.value) - 8}
                textAnchor={i === 0 ? "start" : "end"}
                className="fill-foreground text-[10px]"
              >
                {p.text}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  )
}
