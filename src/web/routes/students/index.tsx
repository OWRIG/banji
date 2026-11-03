import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { ClassTabs, Delta, Empty, PageHeader, Picker, QueryState } from "@/web/components/common"
import { Badge } from "@/web/components/ui/badge"
import { Input } from "@/web/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table"
import { useCurrentClass } from "@/web/lib/class"
import { useOp } from "@/web/lib/ops"

export const Route = createFileRoute("/students/")({ component: StudentsPage })

function StudentsPage() {
  const { current } = useCurrentClass()
  const code = current?.code
  const [q, setQ] = useState("")
  const [groupId, setGroupId] = useState<number | undefined>()
  const [prevCode, setPrevCode] = useState(code)
  if (prevCode !== code) {
    setPrevCode(code)
    setGroupId(undefined)
  }
  const navigate = useNavigate()
  const list = useOp("students.list", { class: code, q: q || undefined, groupId }, { enabled: !!current })
  const groups = useOp("groups.list", { class: code ?? "" }, { enabled: !!current })

  return (
    <div>
      <PageHeader title="学生档案" subtitle="点学生查看待过关、默写记录、积分明细。" />
      <ClassTabs />
      <div className="no-print mb-2.5 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索姓名/学号" className="h-8 w-48" />
        <Picker
          label="小组"
          value={groupId ? String(groupId) : ""}
          onChange={(v) => setGroupId(v ? Number(v) : undefined)}
          options={[
            { value: "", label: "全部小组" },
            ...(groups.data ?? []).map((g) => ({ value: String(g.id), label: `${g.name}组` })),
          ]}
        />
      </div>
      <QueryState query={list}>
        {({ rows, facts }) =>
          rows.length === 0 ? (
            <Empty>没有找到学生</Empty>
          ) : (
            <div className="rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">学号</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead className="w-16">性别</TableHead>
                    <TableHead className="w-24">小组</TableHead>
                    {facts.map((f) => (
                      <TableHead key={f.label} className="w-24 text-right">
                        {f.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((s) => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer"
                      onClick={() => navigate({ to: "/students/$id", params: { id: String(s.id) } })}
                    >
                      <TableCell className="text-muted-foreground tabular-nums">{s.studentNo}</TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-muted-foreground">{s.gender}</TableCell>
                      <TableCell className="text-muted-foreground">{s.groupName ?? ""}</TableCell>
                      {facts.map((f) => (
                        <TableCell key={f.label} className="text-right tabular-nums">
                          <FactValue n={s.facts[f.label] ?? 0} tone={f.tone} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }
      </QueryState>
    </div>
  )
}

/** 模块提供的统计数字：tone=bad 时大于 0 标红（例如待过关），没有 tone 时按正负着色（例如积分） */
function FactValue({ n, tone }: { n: number; tone: "bad" | "good" | null }) {
  if (tone === "bad") return n > 0 ? <Badge variant="destructive">{n}</Badge> : null
  if (tone === "good") return n > 0 ? <span className="text-success">{n}</span> : null
  return <Delta n={n} />
}
