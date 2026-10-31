import { describe, expect, it } from "vitest"
import { app } from "@/server/app"

describe("登录保护", () => {
  it("没登录时业务接口返回 401，健康检查不受影响", async () => {
    expect((await app.request("/api/todos")).status).toBe(401)
    expect((await app.request("/api/health")).status).toBe(200)
  })
})
