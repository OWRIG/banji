import { Delta } from "@/web/components/common"
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
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            加 +{data.bonus} · 扣 {data.minus}
          </span>
        </h2>
        {data.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有积分记录</p>
        ) : (
          <div className="rounded-lg border bg-card text-sm">
            {data.recent.map((e) => (
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
    )
  },
}
