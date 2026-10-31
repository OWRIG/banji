import { createFileRoute, Link } from "@tanstack/react-router"
import { cn } from "cn"
import { type CheckKind, checkKinds, fmt, type Mark, marks, pct } from "@/shared/checks"
import { Delta, PageHeader, QueryState, Stat } from "@/web/components/common"
import { Button } from "@/web/components/ui/button"
import { useOp, useOpMutation } from "@/web/lib/ops"

export const Route = createFileRoute("/students/$id")({ component: StudentPage })

function StudentPage() {
  const { id } = Route.useParams()
  const profile = useOp("students.profile", { student: Number(id) })
  const clear = useOpMutation("pending.clear")

  return (
    <QueryState query={profile}>
      {(p) => (
        <div className="space-y-6">
          <PageHeader
            title={p.student.name}
            subtitle={`${p.student.className} · 学号 ${p.student.studentNo}${p.student.groupName ? ` · ${p.student.groupName}组` : ""}${p.student.gender ? ` · ${p.student.gender}` : ""}`}
            actions={
              <Button variant="outline" onClick={() => window.print()}>
                打印档案
              </Button>
            }
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="待过关" value={p.pending.length} tone={p.pending.length ? "bad" : "good"} />
            <Stat label="检查达标率" value={pct(p.passRate)} tone="gold" />
            <Stat label="积分" value={<Delta n={p.points.net} />} />
            <Stat label="加分 / 扣分" value={`+${p.points.bonus} / ${p.points.minus}`} />
          </div>

          {p.pending.length > 0 && (
            <section className="rounded-lg border border-destructive/30 bg-card p-4">
              <h2 className="mb-2 font-semibold">待过关</h2>
              <ul className="space-y-1.5 text-sm">
                {p.pending.map((h) => (
                  <li key={h.resultId} className="flex items-center gap-3">
                    <Link to="/checks/$id" params={{ id: String(h.checkId) }} className="hover:underline">
                      {h.title}
                    </Link>
                    <span className="text-destructive tabular-nums">
                      {h.score != null ? fmt(h.score) : marks[h.mark as Mark]}
                    </span>
                    <span className="text-xs text-muted-foreground">{h.date ?? ""}</span>
                    <Button
                      size="xs"
                      variant="outline"
                      className="no-print ml-auto"
                      onClick={() => clear.mutate({ resultIds: [h.resultId] })}
                    >
                      已过关
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-2 font-semibold">最近的检查</h2>
            {p.recentChecks.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有记录</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {p.recentChecks.map((h) => (
                  <Link
                    key={h.resultId}
                    to="/checks/$id"
                    params={{ id: String(h.checkId) }}
                    title={`${checkKinds[h.kind as CheckKind]} ${h.date ?? ""}`}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs",
                      h.status === "passed" && "border-success/40 bg-success/10",
                      h.status === "failed" && !h.clearedAt && "border-destructive/40 bg-destructive/10",
                      h.status === "failed" && h.clearedAt && "border-gold/40 bg-accent",
                    )}
                  >
                    <div className="font-medium">{h.title}</div>
                    <div className="tabular-nums text-muted-foreground">
                      {h.score != null ? fmt(h.score) : marks[h.mark as Mark]}
                      {h.status === "failed" && (h.clearedAt ? " · 已补过" : " · 未过")}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 font-semibold">积分明细</h2>
            {p.points.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有积分记录</p>
            ) : (
              <div className="rounded-lg border bg-card text-sm">
                {p.points.recent.map((e) => (
                  <div key={e.id} className="flex gap-3 border-t px-3 py-1.5 first:border-t-0">
                    <span className="w-20 text-xs text-muted-foreground tabular-nums">
                      {new Date(e.createdAt).toLocaleDateString("zh-CN")}
                    </span>
                    <Delta n={e.delta} className="w-8" />
                    <span className="text-muted-foreground">
                      {e.ruleName}
                      {e.note && e.note !== "自动" ? ` · ${e.note}` : ""}
                      {e.sourceType ? " · 自动" : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </QueryState>
  )
}
