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
  { to: "/points", label: "加分积分" },
  { to: "/students", label: "学生档案" },
  { to: "/settings", label: "数据与设置" },
] as const

// 整个应用的外框：没登录时只显示登录页；登录后电脑上是左侧深色导航，手机上是顶部横向导航。
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
      <aside className="no-print bg-sidebar text-sidebar-foreground md:fixed md:inset-y-0 md:flex md:w-48 md:flex-col">
        <div className="flex items-center gap-2 px-4 py-3 md:py-5">
          <span className="font-semibold tracking-wide text-sidebar-primary">班级工作台</span>
          <button type="button" onClick={signOut} className="ml-auto text-xs opacity-60 hover:opacity-100 md:hidden">
            退出
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 text-sm md:flex-col md:overflow-visible md:pb-0">
          {nav.map((item) => (
            <Link
              key={String(item.to)}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="whitespace-nowrap rounded-md px-3 py-2 opacity-75 hover:bg-sidebar-accent hover:opacity-100 [&.active]:bg-sidebar-accent [&.active]:text-sidebar-primary [&.active]:opacity-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden px-4 py-4 text-xs opacity-70 md:block">
          <div className="truncate">{session.user.name}</div>
          <button type="button" onClick={signOut} className="mt-1 underline-offset-2 hover:underline">
            退出登录
          </button>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:ml-48 md:px-8 md:py-8 print:m-0 print:max-w-none print:p-0">
        <Outlet />
      </main>
      <Toaster position="top-center" />
    </div>
  )
}
