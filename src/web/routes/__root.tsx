import { useQueryClient } from "@tanstack/react-query"
import { createRootRoute, Link, Navigate, Outlet, useLocation } from "@tanstack/react-router"
import { Toaster } from "@/web/components/ui/sonner"
import { authClient } from "@/web/lib/auth-client"
import { useOp } from "@/web/lib/ops"
import { webModules } from "@/web/modules"

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => <p className="text-muted-foreground">页面不存在</p>,
})

// 导航：今日 → 各功能模块的入口（在模块的 web.tsx 里声明，停用的模块不显示）→ 核心页面
const coreNav = [
  { to: "/points", label: "积分" },
  { to: "/students", label: "学生档案" },
  { to: "/settings", label: "数据与设置" },
] as const

// 整个应用的外框：没登录时只显示登录页；登录后电脑上是左侧导航，手机上是顶部横向导航。
function RootLayout() {
  const { data: session, isPending } = authClient.useSession()
  const pathname = useLocation({ select: (location) => location.pathname })
  const queryClient = useQueryClient()
  const moduleList = useOp("modules.list", {})
  const enabled = new Set((moduleList.data ?? []).filter((m) => m.enabled).map((m) => m.id as string))
  const nav = [
    { to: "/", label: "今日" },
    ...webModules.filter((m) => enabled.has(m.id)).flatMap((m) => m.nav ?? []),
    ...coreNav,
  ]

  if (isPending) return null
  if (!session)
    return pathname === "/login" ? (
      <>
        <Outlet />
        <Toaster position="top-center" />
      </>
    ) : (
      <Navigate to="/login" />
    )
  if (pathname === "/login") return <Navigate to="/" />

  async function signOut() {
    await authClient.signOut()
    queryClient.clear() // 清掉上一个用户的数据缓存
  }

  return (
    <div className="min-h-screen md:flex">
      <aside className="no-print border-b bg-sidebar md:fixed md:inset-y-0 md:flex md:w-44 md:flex-col md:border-r md:border-b-0">
        <div className="flex h-14 items-center gap-2 px-4 md:px-5">
          <span className="size-2 rotate-45 bg-brand" aria-hidden />
          <span className="text-sm font-semibold tracking-tight text-foreground">班级工作台</span>
          <button
            type="button"
            onClick={signOut}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground md:hidden"
          >
            退出
          </button>
        </div>
        <nav className="flex gap-0.5 overflow-x-auto px-2 pb-2 text-sm md:flex-col md:overflow-visible md:px-3 md:pt-2 md:pb-0">
          {nav.map((item) => (
            <Link
              key={String(item.to)}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="whitespace-nowrap rounded-md border border-transparent px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground [&.active]:border-border [&.active]:bg-card [&.active]:font-medium [&.active]:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden border-t px-5 py-4 text-xs text-muted-foreground md:block">
          <div className="truncate text-foreground">{session.user.name}</div>
          <button type="button" onClick={signOut} className="mt-1 hover:text-foreground">
            退出登录
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1 md:ml-44 print:ml-0">
        <main className="mx-auto min-h-screen w-full max-w-screen-2xl px-4 py-4 md:px-6 md:py-5 print:m-0 print:max-w-none print:border-0 print:p-0">
          <Outlet />
        </main>
      </div>
      <Toaster position="top-center" />
    </div>
  )
}
