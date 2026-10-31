import { createFileRoute, Link } from "@tanstack/react-router"
import { type CheckKind, checkKinds, pct } from "@/shared/checks"
import { Empty, PageHeader, QueryState } from "@/web/components/common"
import { Badge } from "@/web/components/ui/badge"
import { Button } from "@/web/components/ui/button"
import { useOp } from "@/web/lib/ops"

export const Route = createFileRoute("/")({ component: TodayPage })

const weekday = ["日", "一", "二", "三", "四", "五", "六"]

function TodayPage() {
  const brief = useOp("brief.today", {})
  return (
    <QueryState query={brief}>
      {(data) => {
        const days = data.lastBackup ? (Date.now() - new Date(data.lastBackup.createdAt).getTime()) / 86_400_000 : null
        return (
          <div className="space-y-6">
            <PageHeader
              title="今日"
              subtitle={`${data.date} 星期${weekday[new Date(`${data.date}T00:00`).getDay()]}`}
              actions={
                <>
                  <Button asChild>
                    <Link to="/checks" search={{ new: true }}>
                      记默写
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/points">记加分</Link>
                  </Button>
                </>
              }
            />

            {data.classes.length === 0 && (
              <Empty>
                还没有班级名册。到「数据与设置」导入名册，或者让 agent 帮你把 Excel 名单整理后导入。
                <div className="mt-3">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/settings">去导入</Link>
                  </Button>
                </div>
              </Empty>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              {data.classes.map((c) => {
                const byStudent = new Map<number, { name: string; items: typeof c.pending }>()
                for (const p of c.pending) {
                  const e = byStudent.get(p.student.id) ?? { name: p.student.name, items: [] }
                  e.items.push(p)
                  byStudent.set(p.student.id, e)
                }
                return (
                  <section key={c.code} className="rounded-lg border bg-card p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <h2 className="font-semibold">{c.name} 待过关</h2>
                      <Badge variant={c.pending.length ? "destructive" : "secondary"}>{c.pending.length}</Badge>
                      <Link
                        to="/pending"
                        search={{ class: c.code }}
                        className="no-print ml-auto text-sm text-gold hover:underline"
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
                              {s.items
                                .map((p) => `${p.check.title}${p.score != null ? `（${p.score}）` : ""}`)
                                .join("；")}
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

            <section
              className={`rounded-lg border p-4 text-sm ${days == null || days > 7 ? "border-destructive/40 bg-destructive/5" : "bg-card"}`}
            >
              <span className="font-medium">数据备份：</span>
              {data.lastBackup
                ? `最近一次 ${new Date(data.lastBackup.createdAt).toLocaleString("zh-CN", { hour12: false })}`
                : "还没有备份"}
              <span className="text-muted-foreground">（服务开着时每天自动备份一次）</span>
              <Link to="/settings" className="no-print ml-2 text-gold hover:underline">
                管理备份 →
              </Link>
            </section>
          </div>
        )
      }}
    </QueryState>
  )
}
