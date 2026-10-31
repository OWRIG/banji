import { describe, expect, it } from "vitest"
import { app } from "@/server/app"
import { signedInRequest } from "@/server/test-utils"

describe("登录保护", () => {
  it("没登录时业务接口返回 401，健康检查不受影响", async () => {
    expect((await app.request("/api/ops/classes.list", { method: "POST" })).status).toBe(401)
    expect((await app.request("/api/health")).status).toBe(200)
  })

  it("第一个账号注册后关闭注册", async () => {
    expect(await (await app.request("/api/setup")).json()).toEqual({ hasUser: false })
    const request = await signedInRequest()
    expect(await (await app.request("/api/setup")).json()).toEqual({ hasUser: true })
    const second = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "别人", email: "other@example.com", password: "other-password-123" }),
    })
    expect(second.status).toBe(403)

    const res = await request("/api/ops/classes.list", { method: "POST", body: "{}" })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ applied: true, data: [] })
  })

  it("参数错误返回 400，未知操作返回 404", async () => {
    const request = await signedInRequest()
    const bad = await request("/api/ops/checks.create", { method: "POST", body: JSON.stringify({ title: "" }) })
    expect(bad.status).toBe(400)
    expect((await request("/api/ops/nope", { method: "POST" })).status).toBe(404)
  })
})
