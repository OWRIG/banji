import { createFileRoute, Link } from "@tanstack/react-router"
import { cn } from "cn"
import { useMemo, useState } from "react"
import { ClassTabs, Delta, Empty, PageHeader, QueryState } from "@/web/components/common"
import { Button } from "@/web/components/ui/button"
import { Input } from "@/web/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table"
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
  const [prevCode, setPrevCode] = useState(code)
  if (prevCode !== code) {
    setPrevCode(code)
    setSelected(new Set())
    setQ("")
    setReason("")
  }
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
    try {
      await deduct.mutateAsync({ students: [...selected], class: code, points: amount, reason: reason.trim() })
      setSelected(new Set())
      setReason("")
      setAmount(1)
    } catch {
      // useOpMutation.onError 已提示
    }
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

      <section className="mb-6 rounded-md border bg-card p-4">
        <div className="no-print mb-3 flex flex-wrap items-center gap-1.5">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索姓名/学号" className="h-8 w-40" />
          {(groups.data ?? []).map((g) => (
            <Button key={g.id} size="xs" variant="outline" onClick={() => toggle(g.members.map((m) => m.id))}>
              {g.name}组
            </Button>
          ))}
          <Button
            size="xs"
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
          <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
            清空
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">已选 {selected.size} 人</span>
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
                      "rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                      selected.has(s.id) ? "border-brand bg-accent font-medium" : "bg-background hover:bg-muted",
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

        <div className="no-print mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <div className="inline-flex rounded-md border p-0.5 text-sm">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAmount(n)}
                className={cn(
                  "rounded px-2.5 py-0.5 text-muted-foreground tabular-nums",
                  amount === n && "bg-muted font-medium text-foreground",
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
            className="h-8 w-52"
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
                  className={cn(
                    "rounded px-2 py-0.5 text-muted-foreground",
                    period === p && "bg-muted font-medium text-foreground",
                  )}
                >
                  {periods[p]}
                </button>
              ))}
            </div>
            <Button
              size="xs"
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
              <div className="space-y-2.5">
                <div className="flex flex-wrap gap-1.5 text-sm">
                  {b.groups
                    .filter((g) => g.name !== "未分组")
                    .map((g) => (
                      <div
                        key={g.name}
                        className="inline-flex items-baseline gap-2 rounded-md border bg-card px-2.5 py-1"
                      >
                        <span className="text-xs text-muted-foreground">
                          {g.name}组（{g.members}人）
                        </span>
                        <Delta n={g.net} className="font-semibold" />
                      </div>
                    ))}
                </div>
                <div className="rounded-md border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12 text-right">#</TableHead>
                        <TableHead>姓名</TableHead>
                        <TableHead className="w-20">小组</TableHead>
                        <TableHead className="w-16 text-right">加分</TableHead>
                        <TableHead className="w-16 text-right">扣分</TableHead>
                        <TableHead className="w-20 text-right">净分</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {b.rows.map((r, i) => (
                        <TableRow key={r.studentId}>
                          <TableCell className="py-1 text-right text-xs text-muted-foreground tabular-nums">
                            {i + 1}
                          </TableCell>
                          <TableCell className="py-1 font-medium">
                            <Link to="/students/$id" params={{ id: String(r.studentId) }} className="hover:underline">
                              {r.name}
                            </Link>
                          </TableCell>
                          <TableCell className="py-1 text-xs text-muted-foreground">
                            {r.groupName && r.groupName !== "未分组" ? `${r.groupName}组` : ""}
                          </TableCell>
                          <TableCell className="py-1 text-right text-xs text-success tabular-nums">
                            {r.bonus ? `+${r.bonus}` : ""}
                          </TableCell>
                          <TableCell className="py-1 text-right text-xs text-destructive tabular-nums">
                            {r.minus || ""}
                          </TableCell>
                          <TableCell className="py-1 text-right font-medium">
                            <Delta n={r.net} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
                <div className="rounded-md border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">日期</TableHead>
                        <TableHead className="w-20">姓名</TableHead>
                        <TableHead className="w-14 text-right">分值</TableHead>
                        <TableHead>原因</TableHead>
                        <TableHead className="no-print w-14 text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="py-1 text-xs text-muted-foreground tabular-nums">
                            {new Date(e.createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                          </TableCell>
                          <TableCell className="py-1 font-medium">{e.studentName}</TableCell>
                          <TableCell className="py-1 text-right">
                            <Delta n={e.delta} />
                          </TableCell>
                          <TableCell className="py-1 text-muted-foreground whitespace-normal">
                            {e.ruleName}
                            {e.note && e.note !== "自动" ? ` · ${e.note}` : ""}
                            {e.auto ? " · 自动" : ""}
                          </TableCell>
                          <TableCell className="no-print py-1 text-right">
                            {!e.auto && (
                              <button
                                type="button"
                                className="text-xs text-muted-foreground hover:text-destructive"
                                onClick={() => revoke.mutate({ eventIds: [e.id] })}
                              >
                                删除
                              </button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            }
          </QueryState>
        </section>
      </div>
    </div>
  )
}
