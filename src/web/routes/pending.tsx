import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { z } from "zod"
import { type Mark, marks } from "@/modules/checks/shared"
import { fmt } from "@/shared/format"
import { ClassTabs, Empty, PageHeader, QueryState } from "@/web/components/common"
import { Badge } from "@/web/components/ui/badge"
import { Button } from "@/web/components/ui/button"
import { Checkbox } from "@/web/components/ui/checkbox"
import { downloadCsv } from "@/web/lib/csv"
import { useOp, useOpMutation } from "@/web/lib/ops"

export const Route = createFileRoute("/pending")({
  component: PendingPage,
  validateSearch: z.object({ class: z.string().optional() }),
})

function PendingPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: "/pending" })
  const list = useOp("pending.list", { class: search.class })
  const clear = useOpMutation("pending.clear")
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [prevClass, setPrevClass] = useState(search.class)
  if (prevClass !== search.class) {
    setPrevClass(search.class)
    setSelected(new Set())
  }

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function clearIds(ids: number[]) {
    try {
      await clear.mutateAsync({ resultIds: ids })
      setSelected(new Set())
    } catch {
      // useOpMutation.onError 已提示
    }
  }

  return (
    <div>
      <PageHeader
        title="待过关"
        subtitle="未达标、还没补过的记录。学生补过之后点「已过关」销账，原始成绩不会被改动。"
        actions={
          <>
            {selected.size > 0 && (
              <Button size="sm" onClick={() => clearIds([...selected])}>
                选中的 {selected.size} 条已过关
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                list.data &&
                downloadCsv("待过关名单", [
                  ["班级", "学号", "姓名", "检查", "日期", "成绩"],
                  ...list.data.map((p) => [
                    p.className,
                    p.student.studentNo,
                    p.student.name,
                    p.check.title,
                    p.check.date,
                    p.score != null ? fmt(p.score) : marks[p.mark as Mark],
                  ]),
                ])
              }
            >
              导出 CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              打印
            </Button>
          </>
        }
      />
      <ClassTabs
        allowAll
        value={search.class ?? null}
        onChange={(code) => navigate({ search: { class: code ?? undefined } })}
      />
      <QueryState query={list}>
        {(items) => {
          if (items.length === 0) return <Empty>✓ 没有待过关的记录</Empty>
          const groups = new Map<number, { name: string; studentNo: string; className: string; items: typeof items }>()
          for (const p of items) {
            const g = groups.get(p.student.id) ?? {
              name: p.student.name,
              studentNo: p.student.studentNo,
              className: p.className,
              items: [],
            }
            g.items.push(p)
            groups.set(p.student.id, g)
          }
          return (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                共 {groups.size} 人、{items.length} 条
              </p>
              {[...groups.entries()].map(([sid, g]) => (
                <div key={sid} className="flex flex-wrap items-center gap-2.5 rounded-md border bg-card px-3 py-2">
                  <div className="w-28 shrink-0">
                    <Link
                      to="/students/$id"
                      params={{ id: String(sid) }}
                      className="text-sm font-medium hover:underline"
                    >
                      {g.name}
                    </Link>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {search.class ? g.studentNo : `${g.className} · ${g.studentNo}`}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-wrap gap-1.5">
                    {g.items.map((p) => (
                      <div
                        key={p.resultId}
                        className="flex items-center gap-1.5 rounded border bg-background px-2 py-0.5 text-sm"
                      >
                        <Checkbox
                          aria-label={`选择 ${p.check.title}`}
                          className="no-print"
                          checked={selected.has(p.resultId)}
                          onCheckedChange={() => toggle(p.resultId)}
                        />
                        <Link to="/checks/$id" params={{ id: String(p.check.id) }} className="hover:underline">
                          {p.check.title}
                        </Link>
                        <Badge variant="destructive" className="tabular-nums">
                          {p.score != null ? fmt(p.score) : marks[p.mark as Mark]}
                        </Badge>
                        {p.check.date && (
                          <span className="text-xs text-muted-foreground tabular-nums">{p.check.date.slice(5)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="no-print"
                    onClick={() => clearIds(g.items.map((p) => p.resultId))}
                  >
                    全部已过关
                  </Button>
                </div>
              ))}
            </div>
          )
        }}
      </QueryState>
    </div>
  )
}
