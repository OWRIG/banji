import { app } from "./app"
import { auth } from "./auth"

// 测试用：返回一个"已登录"的请求函数，用法和 app.request 一样。
// 只有第一个账号能注册（之后关闭注册），所以固定用同一个测试账号：没有就注册，有就登录。
const credentials = { email: "test@example.com", password: "test-password-123" }

export async function signedInRequest() {
  const signUp = await auth.api.signUpEmail({ body: { name: "测试老师", ...credentials }, asResponse: true })
  const res = signUp.ok ? signUp : await auth.api.signInEmail({ body: credentials, asResponse: true })
  if (!res.ok) throw new Error(`测试账号登录失败：${res.status}`)
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ")
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), cookie } })
}
