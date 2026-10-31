import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { createMiddleware } from "hono/factory"
import { db } from "./db"
import * as schema from "./db/schema"
import { env } from "./env"

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  emailAndPassword: { enabled: true },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`,
  // 开发时页面由 Vite 提供，端口不固定（5173、5174…），所以信任本机的任意端口
  trustedOrigins: env.NODE_ENV === "development" ? ["http://127.0.0.1:*", "http://localhost:*"] : [],
})

export type SessionUser = typeof auth.$Infer.Session.user
export type AuthEnv = { Variables: { user: SessionUser } }

// 没登录的请求直接返回 401；登录了的，接口里可以用 c.get("user") 拿到当前用户
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ message: "请先登录" }, 401)
  c.set("user", session.user)
  await next()
})
