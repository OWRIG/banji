import { integer, sqliteTable } from "drizzle-orm/sqlite-core"
import { describe, expect, it } from "vitest"
import { Ctx, runOp } from "@/server/core/define"
import { availableOps, findOp, initModules, modules, ops } from "@/server/registry"

// 模块机制本身的测试：登记、开关、汇总

const as = { actor: "test" }

describe("模块登记", () => {
  it("每个操作名唯一，并且都以模块或平台前缀命名", () => {
    const names = modules.flatMap((m) => m.ops.map((o) => o.name))
    expect(new Set(names).size).toBe(names.length)
  })

  it("没有登记的表不能通过 ctx 写入（否则无法撤销）", async () => {
    const stray = sqliteTable("stray", { id: integer("id").primaryKey() })
    await expect(new Ctx("test").insert(stray, { id: 1 })).rejects.toThrow(/没有登记/)
  })

  it("各模块的自动积分规则在初始化时补齐", async () => {
    await initModules()
    const rules = (await runOp(ops["rules.list"], {}, as)).data
    expect(rules.map((r) => r.autoTrigger).filter(Boolean)).toEqual(
      expect.arrayContaining(["checks.dictation_full", "checks.recite_first_pass"]),
    )
    await initModules()
    const again = (await runOp(ops["rules.list"], {}, as)).data
    expect(again.length).toBe(rules.length)
  })
})

describe("模块开关", () => {
  it("停用后：操作被拒绝、MCP 不再提供、首页没有它的内容；启用后恢复", async () => {
    await runOp(ops["modules.setEnabled"], { id: "checks", enabled: false }, as)
    await expect(findOp("checks.list")).rejects.toThrow(/没有启用/)
    expect((await availableOps()).some((o) => o.name === "checks.list")).toBe(false)
    const brief = await runOp(ops["brief.today"], {}, as)
    expect(brief.data.sections.checks).toBeUndefined()
    const list = await runOp(ops["students.list"], {}, as)
    expect(list.data.facts.map((f) => f.label)).not.toContain("待过关")

    await runOp(ops["modules.setEnabled"], { id: "checks", enabled: true }, as)
    expect(await findOp("checks.list")).toBeDefined()
    expect((await runOp(ops["brief.today"], {}, as)).data.sections.checks).toBeDefined()
  })

  it("核心模块不能停用", async () => {
    await expect(runOp(ops["modules.setEnabled"], { id: "points", enabled: false }, as)).rejects.toThrow(/核心/)
  })
})
