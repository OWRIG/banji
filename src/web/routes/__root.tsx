import { createRootRoute, Link, Outlet } from "@tanstack/react-router"

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => <p className="text-muted-foreground">页面不存在</p>,
})

// 整个应用的外框：顶部导航 + 页面内容。新增页面后在 nav 里加一个 Link。
function RootLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3 text-sm">
          <Link to="/" className="font-semibold">
            磐石
          </Link>
          <Link to="/todos" className="text-muted-foreground [&.active]:text-foreground">
            示例：待办
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
