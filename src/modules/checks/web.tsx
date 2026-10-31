import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import { fmt, pct } from "@/shared/format"
import { Badge } from "@/web/components/ui/badge"
import { Button } from "@/web/components/ui/button"
import { useOp, useOpMutation } from "@/web/lib/ops"
import type { WebModule } from "@/web/modules"
import { type CheckKind, checkKinds, type Mark, marks } from "./shared"

// 「默写过关」模块的网页部分：导航、首页卡片、学生档案卡片。页面在 src/web/routes/checks/ 和 pending.tsx。

export const checksWeb: WebModule = {
  id: "checks",
  nav: [
    { to: "/checks", label: "默写过关" },
    { to: "/pending", label: "待过关" },
  ],

  HomeActions: () => {
    const modules = useOp("modules.list", {})
    if (!modules.data?.find((m) => m.id === "checks")?.enabled) return null
    return (
      <Button asChild>
        <Link to="/checks" search={{ new: true }}>
          记默写
        </Link>
      </Button>
    )
  },

  HomeCard: ({ brief }) => {
    const data = brief.sections.checks
    if (!data) return null
    return (
      <>
        <div className="grid gap-4 lg:grid-cols-2">
          {brief.classes.map((c) => {
            const pending = data.pending.filter((p) => p.classCode === c.code)
            const byStudent = new Map<number, { name: string; items: typeof pending }>()
            for (const p of pending) {
              const e = byStudent.get(p.student.id) ?? { name: p.student.name, items: [] }
              e.items.push(p)
              byStudent.set(p.student.id, e)
            }
            return (
              <section key={c.code} className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="font-semibold">{c.name} 待过关</h2>
                  <Badge variant={pending.length ? "destructive" : "secondary"}>{pending.length}</Badge>
                  <Link
                    to="/pending"
                    search={{ class: c.code }}
                    className="no-print ml-auto text-sm text-brand hover:underline"
                  >
                    去处理 →
                  </Link>
                </div>
                {byStudent.size === 0 ? (
                  <p className="text-sm text-muted-foreground">✓ 没有欠账</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {[...byStudent.entries()].map(([id, s]) => (
                      <li key={id} className="flex gap-2">
                        <Link
                          to="/students/$id"
                          params={{ id: String(id) }}
                          className="w-16 shrink-0 font-medium hover:underline"
                        >
                          {s.name}
                        </Link>
                        <span className="text-muted-foreground">
                          {s.items.map((p) => `${p.check.title}${p.score != null ? `（${p.score}）` : ""}`).join("；")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>

        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 font-semibold">今天的检查</h2>
          {data.todayChecks.length === 0 ? (
            <p className="text-sm text-muted-foreground">今天还没有登记检查。</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.todayChecks.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-x-3">
                  <Link to="/checks/$id" params={{ id: String(c.id) }} className="font-medium hover:underline">
                    {c.title}
                  </Link>
                  <span className="text-muted-foreground">
                    {checkKinds[c.kind as CheckKind]} · 已录 {c.stats.entered} 人 · 达标率 {pct(c.stats.passRate)} ·
                    未达标 {c.stats.failed}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    )
  },

  ProfileCard: ({ profile }) => {
    const data = profile.sections.checks
    const clear = useOpMutation("pending.clear")
    if (!data) return null
    return (
      <>
        <p className="text-sm text-muted-foreground">
          检查达标率 <span className="font-medium text-brand">{pct(data.passRate)}</span> · 待过关{" "}
          <span className={cn("font-medium", data.pending.length > 0 && "text-destructive")}>
            {data.pending.length}
          </span>
        </p>

        {data.pending.length > 0 && (
          <section className="rounded-lg border border-destructive/30 bg-card p-4">
            <h2 className="mb-2 font-semibold">待过关</h2>
            <ul className="space-y-1.5 text-sm">
              {data.pending.map((h) => (
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
          {data.recentChecks.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有记录</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.recentChecks.map((h) => (
                <Link
                  key={h.resultId}
                  to="/checks/$id"
                  params={{ id: String(h.checkId) }}
                  title={`${checkKinds[h.kind as CheckKind]} ${h.date ?? ""}`}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs",
                    h.status === "passed" && "border-success/40 bg-success/10",
                    h.status === "failed" && !h.clearedAt && "border-destructive/40 bg-destructive/10",
                    h.status === "failed" && h.clearedAt && "border-brand/40 bg-accent",
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
      </>
    )
  },
}
