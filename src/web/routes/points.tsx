import { createFileRoute, Link } from "@tanstack/react-router"
import { cn } from "cn"
import { useMemo, useState } from "react"
import { ClassTabs, Delta, Empty, PageHeader, QueryState } from "@/web/components/common"
import { Button } from "@/web/components/ui/button"
import { Input } from "@/web/components/ui/input"
import { useCurrentClass } from "@/web/lib/class"
import { downloadCsv } from "@/web/lib/csv"
import { useOp, useOpMutation } from "@/web/lib/ops"

export const Route = createFileRoute("/points")({ component: PointsPage })

type Period = "all" | "week" | "month"
const periods: Record<Period, string> = { week: "本周", month: "本月", all: "全部" }

function PointsPage() {
  const { current } = useCurrentClass()
  const code = current?.code
  const students = useOp("students.list", { class: code }, { enabled: !!code })
  const groups = useOp("groups.list", { class: code ?? "" }, { enabled: !!code })
  const deduct = useOpMutation("points.deduct")
  const revoke = useOpMutation("points.revoke")
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [q, setQ] = useState("")
  const [reason, setReason] = useState("")
  const [amount, setAmount] = useState(1)
  const [period, setPeriod] = useState<Period>("week")
  const board = useOp("points.leaderboard", { class: code, period }, { enabled: !!code })
  const log = useOp("points.log", { class: code, limit: 50 }, { enabled: !!code })

  const visible = useMemo(
    () => (students.data?.rows ?? []).filter((s) => !q || s.name.includes(q) || s.studentNo.includes(q)),
    [students.data, q],
  )

  function toggle(ids: number[], on?: boolean) {
    setSelected((s) => {
      const next = new Set(s)
      const allOn = ids.every((id) => next.has(id))
      for (const id of ids) {
        if (on ?? !allOn) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  async function submit() {
    if (selected.size === 0 || !reason.trim()) return
    await deduct.mutateAsync({ students: [...selected], class: code, points: amount, reason: reason.trim() })
    setSelected(new Set())
    setReason("")
    setAmount(1)
  }

  // 常用原因：最近用过的扣分原因，没有时给几个例子
  const reasons = useMemo(() => {
    const used = (log.data ?? []).filter((e) => e.delta < 0 && !e.auto && e.note).map((e) => e.note)
    const list = [...new Set(used)].slice(0, 6)
    return list.length ? list : ["未交作业", "上课讲话", "迟到"]
  }, [log.data])

  return (
    <div>
      <PageHeader
        title="积分"
        subtitle="加分由系统自动结算（默写满分、背书一次过、考试进步前列）。这里只需要扣分：选学生，写原因。"
      />
      <ClassTabs />

      <section className="mb-6 rounded-lg border bg-card p-4">
        <div className="no-print mb-3 flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索姓名/学号" className="h-8 w-36" />
          {(groups.data ?? []).map((g) => (
            <Button key={g.id} size="sm" variant="outline" onClick={() => toggle(g.members.map((m) => m.id))}>
              {g.name}组
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              toggle(
                visible.map((s) => s.id),
                true,
              )
            }
          >
            全选
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            清空
          </Button>
          <span className="ml-auto text-sm text-muted-foreground">已选 {selected.size} 人</span>
        </div>
        <QueryState query={students}>
          {() =>
            visible.length === 0 ? (
              <Empty>没有学生。先到「数据与设置」导入名册。</Empty>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-8">
                {visible.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => toggle([s.id])}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-left text-sm transition-colors",
                      selected.has(s.id) ? "border-gold bg-accent font-medium" : "bg-background hover:bg-muted",
                    )}
                  >
                    <div className="truncate">{s.name}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {s.groupName ? `${s.groupName}组 · ` : ""}
                      <Delta n={s.facts.积分 ?? 0} />
                    </div>
                  </button>
                ))}
              </div>
            )
          }
        </QueryState>

        <div className="no-print mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
          <div className="inline-flex rounded-md border p-0.5 text-sm">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAmount(n)}
                className={cn(
                  "rounded px-2.5 py-0.5 tabular-nums",
                  amount === n && "bg-primary text-primary-foreground",
                )}
              >
                -{n}
              </button>
            ))}
          </div>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="扣分原因（必填）"
            className="h-8 w-56"
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={!selected.size || !reason.trim() || deduct.isPending}
            onClick={() => void submit()}
          >
            扣 {amount} 分{selected.size ? `（${selected.size} 人）` : ""}
          </Button>
          <div className="flex flex-wrap gap-1">
            {reasons.map((r) => (
              <Button key={r} size="xs" variant="ghost" onClick={() => setReason(r)}>
                {r}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="font-semibold">积分榜</h2>
            <div className="no-print ml-auto inline-flex rounded-md border bg-card p-0.5 text-xs">
              {(Object.keys(periods) as Period[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={cn("rounded px-2 py-1", period === p && "bg-primary text-primary-foreground")}
                >
                  {periods[p]}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="no-print"
              onClick={() =>
                board.data &&
                downloadCsv(`积分-${current?.name}-${periods[period]}`, [
                  ["学号", "姓名", "小组", "加分", "扣分", "净分"],
                  ...board.data.rows.map((r) => [r.studentNo, r.name, r.groupName, r.bonus, r.minus, r.net]),
                ])
              }
            >
              导出
            </Button>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">仅供老师参考，不建议公开排名。</p>
          <QueryState query={board}>
            {(b) => (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-1.5 text-sm">
                  {b.groups
                    .filter((g) => g.name !== "未分组")
                    .map((g) => (
                      <div key={g.name} className="rounded-md border bg-card px-3 py-2">
                        <div className="text-xs text-muted-foreground">
                          {g.name}组 · {g.members} 人
                        </div>
                        <Delta n={g.net} className="text-lg font-semibold" />
                      </div>
                    ))}
                </div>
                <div className="rounded-lg border bg-card text-sm">
                  {b.rows.map((r, i) => (
                    <div key={r.studentId} className="flex items-center gap-3 border-t px-3 py-1.5 first:border-t-0">
                      <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      <Link to="/students/$id" params={{ id: String(r.studentId) }} className="flex-1 hover:underline">
                        {r.name}
                      </Link>
                      <span className="text-xs text-success tabular-nums">{r.bonus ? `+${r.bonus}` : ""}</span>
                      <span className="w-6 text-xs text-destructive tabular-nums">{r.minus || ""}</span>
                      <Delta n={r.net} className="w-8 text-right font-medium" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </QueryState>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">最近明细</h2>
          <QueryState query={log}>
            {(rows) =>
              rows.length === 0 ? (
                <Empty>还没有积分记录</Empty>
              ) : (
                <div className="rounded-lg border bg-card text-sm">
                  {rows.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 border-t px-3 py-1.5 first:border-t-0">
                      <span className="w-12 text-xs text-muted-foreground tabular-nums">
                        {new Date(e.createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                      </span>
                      <span className="w-14 font-medium">{e.studentName}</span>
                      <Delta n={e.delta} className="w-7" />
                      <span className="flex-1 truncate text-muted-foreground">
                        {e.ruleName}
                        {e.note && e.note !== "自动" ? ` · ${e.note}` : ""}
                        {e.auto ? " · 自动" : ""}
                      </span>
                      {!e.auto && (
                        <button
                          type="button"
                          className="no-print text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => revoke.mutate({ eventIds: [e.id] })}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )
            }
          </QueryState>
        </section>
      </div>
    </div>
  )
}
