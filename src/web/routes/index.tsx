import { createFileRoute, Link } from "@tanstack/react-router"

export const Route = createFileRoute("/")({ component: HomePage })

function HomePage() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">项目已经跑起来了</h1>
      <p className="text-muted-foreground">
        告诉 AI 你想做什么。可以先看看
        <Link to="/todos" className="mx-1 underline">
          示例：待办
        </Link>
        ，它演示了从数据表到页面的完整写法。
      </p>
    </div>
  )
}
