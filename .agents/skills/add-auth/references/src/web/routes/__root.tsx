import { useQueryClient } from "@tanstack/react-query"
import { createRootRoute, Link, Navigate, Outlet, useLocation } from "@tanstack/react-router"
import { Button } from "@/web/components/ui/button"
import { authClient } from "@/web/lib/auth-client"

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => <p className="text-muted-foreground">页面不存在</p>,
})

// 整个应用的外框：没登录时只显示登录页；登录后显示顶部导航 + 页面内容。
function RootLayout() {
  const { data: session, isPending } = authClient.useSession()
  const pathname = useLocation({ select: (location) => location.pathname })
  const queryClient = useQueryClient()

  if (isPending) return null
  if (!session) return pathname === "/login" ? <Outlet /> : <Navigate to="/login" />
  if (pathname === "/login") return <Navigate to="/" />

  async function signOut() {
    await authClient.signOut()
    queryClient.clear() // 清掉上一个用户的数据缓存
  }

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
          <span className="ml-auto text-muted-foreground">{session.user.name}</span>
          <Button variant="ghost" size="sm" onClick={signOut}>
            退出
          </Button>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
