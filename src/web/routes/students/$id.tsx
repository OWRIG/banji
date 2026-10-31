import { createFileRoute } from "@tanstack/react-router"
import { PageHeader, QueryState } from "@/web/components/common"
import { Button } from "@/web/components/ui/button"
import { useOp } from "@/web/lib/ops"
import { webModules } from "@/web/modules"

export const Route = createFileRoute("/students/$id")({ component: StudentPage })

// 学生档案：基本信息 + 各功能模块的卡片（在模块的 web.tsx 里声明 ProfileCard）
function StudentPage() {
  const { id } = Route.useParams()
  const profile = useOp("students.profile", { student: Number(id) })

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
          {webModules.map((m) => m.ProfileCard && <m.ProfileCard key={m.id} profile={p} />)}
        </div>
      )}
    </QueryState>
  )
}
