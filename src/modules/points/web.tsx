import { Delta } from "@/web/components/common"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table"
import type { WebModule } from "@/web/modules"

// 「积分」模块的网页部分：学生档案里的积分明细。积分页面在 src/web/routes/points.tsx（核心导航）。

export const pointsWeb: WebModule = {
  id: "points",

  ProfileCard: ({ profile }) => {
    const data = profile.sections.points
    if (!data) return null
    return (
      <section>
        <h2 className="mb-2 font-semibold">
          积分 <Delta n={data.net} className="ml-1" />
          <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
            加 +{data.bonus} · 扣 {data.minus}
          </span>
        </h2>
        {data.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有积分记录</p>
        ) : (
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">日期</TableHead>
                  <TableHead className="w-16 text-right">分值</TableHead>
                  <TableHead>原因</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="py-1 text-xs text-muted-foreground tabular-nums">
                      {new Date(e.createdAt).toLocaleDateString("zh-CN")}
                    </TableCell>
                    <TableCell className="py-1 text-right">
                      <Delta n={e.delta} />
                    </TableCell>
                    <TableCell className="py-1 text-muted-foreground whitespace-normal">
                      {e.ruleName}
                      {e.note && e.note !== "自动" ? ` · ${e.note}` : ""}
                      {e.sourceType ? " · 自动" : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    )
  },
}
