import { createFileRoute, Link } from "@tanstack/react-router"
import { Empty, PageHeader, QueryState } from "@/web/components/common"
import { Button } from "@/web/components/ui/button"
import { useOp } from "@/web/lib/ops"
import { webModules } from "@/web/modules"

export const Route = createFileRoute("/")({ component: TodayPage })

const weekday = ["日", "一", "二", "三", "四", "五", "六"]

function TodayPage() {
  const brief = useOp("brief.today", {})
  return (
    <QueryState query={brief}>
      {(data) => {
        const lastBackup = data.sections.system?.lastBackup ?? null
        const days = lastBackup ? (Date.now() - new Date(lastBackup.createdAt).getTime()) / 86_400_000 : null
        return (
          <div className="space-y-6">
            <PageHeader
              title="今日"
              subtitle={`${data.date} 星期${weekday[new Date(`${data.date}T00:00`).getDay()]}`}
              actions={
                <>
                  {webModules.map((m) => m.HomeActions && <m.HomeActions key={m.id} />)}
                  <Button asChild variant="outline">
                    <Link to="/points">扣分</Link>
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

            {webModules.map((m) => m.HomeCard && <m.HomeCard key={m.id} brief={data} />)}

            <section
              className={`rounded-lg border p-4 text-sm ${days == null || days > 7 ? "border-destructive/40 bg-destructive/5" : "bg-card"}`}
            >
              <span className="font-medium">数据备份：</span>
              {lastBackup
                ? `最近一次 ${new Date(lastBackup.createdAt).toLocaleString("zh-CN", { hour12: false })}`
                : "还没有备份"}
              <span className="text-muted-foreground">（服务开着时每天自动备份一次）</span>
              <Link to="/settings" className="no-print ml-2 text-brand hover:underline">
                管理备份 →
              </Link>
            </section>
          </div>
        )
      }}
    </QueryState>
  )
}
