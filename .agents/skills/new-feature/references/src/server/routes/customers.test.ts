import { describe, expect, it } from "vitest"
import { app } from "@/server/app"

const json = (body: unknown) => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

const validCustomer = { name: "华东物流", contact: "王经理", phone: "021-1234 5678", note: "" }

describe("customers 接口", () => {
  it("新增后可以按名称或联系人搜索到", async () => {
    const created = await app.request("/api/customers", { method: "POST", ...json(validCustomer) })
    expect(created.status).toBe(201)

    const byName = await (await app.request("/api/customers?q=物流")).json()
    expect(byName).toContainEqual(expect.objectContaining({ name: "华东物流" }))
    const byContact = await (await app.request("/api/customers?q=王")).json()
    expect(byContact).toContainEqual(expect.objectContaining({ name: "华东物流" }))
    const none = await (await app.request("/api/customers?q=不存在的关键词")).json()
    expect(none).toEqual([])
  })

  it("名称为空或电话格式错误时拒绝保存", async () => {
    const noName = await app.request("/api/customers", { method: "POST", ...json({ ...validCustomer, name: " " }) })
    expect(noName.status).toBe(400)
    const badPhone = await app.request("/api/customers", {
      method: "POST",
      ...json({ ...validCustomer, phone: "abc" }),
    })
    expect(badPhone.status).toBe(400)
  })

  it("可以修改和删除，操作不存在的记录返回 404", async () => {
    const created = await (await app.request("/api/customers", { method: "POST", ...json(validCustomer) })).json()

    const updated = await app.request(`/api/customers/${created.id}`, {
      method: "PUT",
      ...json({ ...validCustomer, note: "重点客户" }),
    })
    expect(await updated.json()).toMatchObject({ note: "重点客户" })

    expect((await app.request(`/api/customers/${created.id}`, { method: "DELETE" })).status).toBe(200)
    expect((await app.request(`/api/customers/${created.id}`)).status).toBe(404)
    expect((await app.request("/api/customers/99999", { method: "PUT", ...json(validCustomer) })).status).toBe(404)
  })
})
