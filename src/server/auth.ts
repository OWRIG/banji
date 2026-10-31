import { APIError, betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { sql } from "drizzle-orm"
import { createMiddleware } from "hono/factory"
import { db } from "./db"
import * as schema from "./db/schema"
import { env } from "./env"

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  emailAndPassword: { enabled: true },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`,
  // 老师基本只需要登录一次：会话 30 天有效，每天用一次就自动续期
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  trustedOrigins: [
    // 开发时页面由 Vite 提供，端口不固定（5173、5174…），所以信任本机的任意端口
    ...(env.NODE_ENV === "development" ? ["http://127.0.0.1:*", "http://localhost:*"] : []),
    // 本地部署时手机用局域网地址或 Tailscale 地址访问，在这里补充（逗号分隔）
    ...env.TRUSTED_ORIGINS,
  ],
  databaseHooks: {
    user: {
      create: {
        // 第一个注册的人就是主人；之后关闭注册。以后多位老师协作时，由主人邀请
        before: async (user) => {
          const [row] = await db.select({ n: sql<number>`count(*)` }).from(schema.user)
          if (Number(row.n) > 0) throw new APIError("FORBIDDEN", { message: "注册已关闭，请用已有账号登录" })
          return { data: user }
        },
      },
    },
  },
})

export async function hasAnyUser() {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(schema.user)
  return Number(row.n) > 0
}

export type SessionUser = typeof auth.$Infer.Session.user
export type AuthEnv = { Variables: { user: SessionUser } }

// 没登录的请求直接返回 401；登录了的，接口里可以用 c.get("user") 拿到当前用户
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ message: "请先登录" }, 401)
  c.set("user", session.user)
  await next()
})

/** 忘记密码时用 CLI 重置：banji auth reset-password */
export async function resetPassword(email: string, password: string) {
  const ctx = await auth.$context
  const found = await ctx.internalAdapter.findUserByEmail(email)
  if (!found) throw new Error(`没有这个账号：${email}`)
  if (password.length < 8) throw new Error("密码至少 8 位")
  await ctx.internalAdapter.updatePassword(found.user.id, await ctx.password.hash(password))
  // 让已登录的设备全部重新登录
  await ctx.internalAdapter.deleteUserSessions(found.user.id)
}
