import { describe, expect, it } from "vitest"
import { app } from "@/server/app"

// 接口测试：直接用 app.request() 调接口，不需要启动服务器。
// 测试使用内存数据库（见 vite.config.ts），每个测试文件都是一个全新的空库。

describe("todos 接口", () => {
  it("新增后能在列表里查到", async () => {
    const created = await app.request("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "写周报" }),
    })
    expect(created.status).toBe(201)

    const list = await app.request("/api/todos")
    const todos = await list.json()
    expect(todos).toContainEqual(expect.objectContaining({ title: "写周报", done: false }))
  })

  it("标题为空时拒绝保存", async () => {
    const res = await app.request("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    })
    expect(res.status).toBe(400)
  })

  it("修改不存在的记录返回 404", async () => {
    const res = await app.request("/api/todos/99999", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    })
    expect(res.status).toBe(404)
  })
})
