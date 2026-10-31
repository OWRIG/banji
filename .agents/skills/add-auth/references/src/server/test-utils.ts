import { app } from "./app"
import { auth } from "./auth"

// 测试用：注册一个新用户，返回一个“已登录”的请求函数，用法和 app.request 一样
export async function signedInRequest() {
  const res = await auth.api.signUpEmail({
    body: { name: "测试用户", email: `test-${crypto.randomUUID()}@example.com`, password: "test-password-123" },
    asResponse: true,
  })
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ")
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), cookie } })
}
