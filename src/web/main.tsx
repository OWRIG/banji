import "./index.css"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { OpCallError } from "./lib/ops"
import { routeTree } from "./routeTree.gen"

// 参数不对、找不到、没登录这类错误重试也没用，只有网络或服务器错误才重试
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, err) => !(err instanceof OpCallError && err.status < 500) && count < 2 },
  },
})
const router = createRouter({ routeTree, defaultPreload: "intent" })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById("root")
if (!rootElement) throw new Error("找不到 #root 元素")

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
