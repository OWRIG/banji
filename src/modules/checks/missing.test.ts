import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { runOp } from "@/server/core/define"
import { initModules, ops, runScheduledOps } from "@/server/registry"
import { MISSING_TRIGGER } from "./missing"
import { checkDay } from "./shared"

const as = { actor: "test" }
beforeAll(async () => {
  await initModules()
  const input = {
    classes: [
      {
        code: "801",
        name: "测试班",
        students: [
          { studentNo: "01", name: "测试甲" },
          { studentNo: "02", name: "测试乙" },
          { studentNo: "03", name: "测试丙" },
          { studentNo: "04", name: "测试丁" },
        ],
      },
    ],
  }
  const preview = await runOp(ops["roster.import"], input, as)
  await runOp(ops["roster.import"], { ...input, confirm: preview.confirm }, as)
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-04T02:00:00Z"))
})
afterEach(() => vi.useRealTimers())

async function create(extra: Record<string, unknown> = {}) {
  return (await runOp(ops["checks.create"], { class: "801", title: "当天登记", ...extra }, as)).data
}
async function points(check: number) {
  return (await runOp(ops["checks.get"], { check }, as)).data.rows.map((r) => r.missingPoints)
}
const nextDay = () => vi.setSystemTime(new Date("2026-11-04T16:00:00Z"))

describe("当天未登记扣分", () => {
  it("按北京时间跨日结算，一人一表只扣一次；0 分、请假、免测都算已登记", async () => {
    const check = await create({ date: "2020-01-01" })
    expect(check.missingDeadline).toBe("2026-11-04")
    await runOp(
      ops["checks.record"],
      {
        check: check.id,
        results: [
          { student: "01", value: 0 },
          { student: "02", value: "请假" },
          { student: "03", value: "免" },
        ],
      },
      as,
    )
    vi.setSystemTime(new Date("2026-11-04T15:59:59Z"))
    expect(checkDay()).toBe("2026-11-04")
    await runOp(ops["checks.settleMissing"], { check: check.id }, as)
    expect(await points(check.id)).toEqual([0, 0, 0, 0])
    nextDay()
    await runScheduledOps()
    expect(await points(check.id)).toEqual([0, 0, 0, -1])
    const again = await runOp(ops["checks.settleMissing"], { check: check.id }, as)
    expect(again.changesetId).toBeNull()
    expect(await points(check.id)).toEqual([0, 0, 0, -1])
  })

  it("补填立即退回扣分；撤销补填恢复扣分；再次清空不重复扣", async () => {
    const check = await create()
    nextDay()
    await runOp(ops["checks.settleMissing"], { check: check.id }, as)
    const filled = await runOp(ops["checks.record"], { check: check.id, results: [{ student: "01", value: 85 }] }, as)
    expect(await points(check.id)).toEqual([0, -1, -1, -1])
    await runOp(ops.undo, { changesetId: filled.changesetId }, as)
    expect(await points(check.id)).toEqual([-1, -1, -1, -1])
    await runOp(ops["checks.record"], { check: check.id, results: [{ student: "01", value: "请假" }] }, as)
    expect((await points(check.id))[0]).toBe(0)
    await runOp(ops["checks.record"], { check: check.id, results: [{ student: "01", value: "" }] }, as)
    await runOp(ops["checks.settleMissing"], { check: check.id }, as)
    expect((await points(check.id))[0]).toBe(-1)
  })

  it("背书的过、未过和全背都是已登记", async () => {
    const check = await create({ kind: "recite" })
    nextDay()
    await runOp(ops["checks.settleMissing"], { check: check.id }, as)
    await runOp(
      ops["checks.record"],
      {
        check: check.id,
        results: [
          { student: "01", value: "过" },
          { student: "02", value: "未过" },
        ],
      },
      as,
    )
    expect(await points(check.id)).toEqual([0, 0, -1, -1])
    const level = await create({ kind: "recite", mode: "level" })
    vi.setSystemTime(new Date("2026-11-05T16:00:00Z"))
    await runOp(ops["checks.record"], { check: level.id, results: [{ student: "01", value: "全背" }] }, as)
    expect(await points(level.id)).toEqual([0, -1, -1, -1])
  })

  it("未开启的表不扣，批量新建的表有独立截止日，删除和撤销能恢复来源及扣分", async () => {
    const off = await create({ deductIfMissing: false })
    const other = await create({ kind: "homework" })
    const batch = await runOp(ops["checks.createBatch"], { classes: ["801"], title: "批量表" }, as)
    const check = batch.data[0]
    expect(off.missingDeadline).toBeNull()
    expect(other.missingDeadline).toBeNull()
    expect(check.missingDeadline).toBe("2026-11-04")
    nextDay()
    await runScheduledOps()
    expect(await points(off.id)).toEqual([0, 0, 0, 0])
    expect(await points(other.id)).toEqual([0, 0, 0, 0])
    const preview = await runOp(ops["checks.delete"], { check: check.id }, as)
    expect(await points(check.id)).toEqual([-1, -1, -1, -1])
    const removed = await runOp(ops["checks.delete"], { check: check.id, confirm: preview.confirm }, as)
    await expect(points(check.id)).rejects.toThrow(/找不到/)
    await runOp(ops.undo, { changesetId: removed.changesetId }, as)
    expect(await points(check.id)).toEqual([-1, -1, -1, -1])
  })

  it("规则停用会退回、启用补回；模块停用时调度不会新增扣分", async () => {
    const check = await create()
    nextDay()
    await runOp(ops["modules.setEnabled"], { id: "checks", enabled: false }, as)
    await runScheduledOps()
    expect(await points(check.id)).toEqual([0, 0, 0, 0])
    await runOp(ops["modules.setEnabled"], { id: "checks", enabled: true }, as)
    await runScheduledOps()
    expect(await points(check.id)).toEqual([-1, -1, -1, -1])
    const rule = (await runOp(ops["rules.list"], {}, as)).data.find((r) => r.autoTrigger === MISSING_TRIGGER)
    if (!rule) throw new Error("缺少未登记规则")
    await runOp(ops["rules.save"], { id: rule.id, enabled: false }, as)
    expect(await points(check.id)).toEqual([0, 0, 0, 0])
    await runOp(ops["rules.save"], { id: rule.id, enabled: true }, as)
    expect(await points(check.id)).toEqual([-1, -1, -1, -1])
  })

  it("结算校验参数、报告找不到，并支持撤销本次结算", async () => {
    await expect(runOp(ops["checks.settleMissing"], { check: -1 }, as)).rejects.toThrow(/参数/)
    await expect(runOp(ops["checks.settleMissing"], { check: 999999 }, as)).rejects.toThrow(/找不到/)
    const check = await create()
    nextDay()
    const settled = await runOp(ops["checks.settleMissing"], { check: check.id }, as)
    expect(await points(check.id)).toEqual([-1, -1, -1, -1])
    await runOp(ops.undo, { changesetId: settled.changesetId }, as)
    expect(await points(check.id)).toEqual([0, 0, 0, 0])
  })

  it("建表后转入的学生不扣旧表，离班学生停止扣分", async () => {
    const check = await create()
    nextDay()
    const input = {
      deactivateMissing: true,
      classes: [
        {
          code: "801",
          name: "测试班",
          students: [
            { studentNo: "01", name: "测试甲" },
            { studentNo: "02", name: "测试乙" },
            { studentNo: "03", name: "测试丙" },
            { studentNo: "05", name: "新同学" },
          ],
        },
      ],
    }
    const preview = await runOp(ops["roster.import"], input, as)
    const imported = await runOp(ops["roster.import"], { ...input, confirm: preview.confirm }, as)
    await runScheduledOps()
    expect(await points(check.id)).toEqual([-1, -1, -1, 0])
    const log = (await runOp(ops["points.log"], { class: "801", limit: 1000 }, as)).data
    expect(log.filter((e) => e.studentName === "测试丁" && e.auto === "check_missing")).toHaveLength(0)
    await runOp(ops.undo, { changesetId: imported.changesetId }, as)
  })

  it("补填满分时同时退回缺登扣分并只加一次满分奖励", async () => {
    const check = await create()
    nextDay()
    await runOp(ops["checks.settleMissing"], { check: check.id }, as)
    const before =
      (await runOp(ops["students.profile"], { student: "01", class: "801" }, as)).data.sections.points?.net ?? 0
    const input = { check: check.id, results: [{ student: "01", value: 100 }] }
    await runOp(ops["checks.record"], input, as)
    await runOp(ops["checks.record"], input, as)
    const after =
      (await runOp(ops["students.profile"], { student: "01", class: "801" }, as)).data.sections.points?.net ?? 0
    expect(after - before).toBe(2)
    expect((await points(check.id))[0]).toBe(0)
  })
})
