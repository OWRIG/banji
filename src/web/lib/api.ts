import { hc } from "hono/client"
import type { AppType } from "@/server/app"

// 调用后端接口统一用这个 api 对象，参数和返回值都有类型提示。
// 配合 hono/client 的 parseResponse 使用：请求失败时会直接抛出错误，交给 TanStack Query 处理。
export const api = hc<AppType>("/").api
