import { beforeAll, describe, expect, it } from "vitest"
import { OpError, runOp } from "./define"
import { ops } from "./index"
import { ensureDefaultRules } from "./points"

// 业务操作测试：直接调用 runOp，和网页、CLI、MCP 走的是同一条路。
// 测试使用内存数据库（见 vite.config.ts），每个测试文件都是一个全新的空库。

const as = { actor: "test" }

async function importDemo() {
  const preview = await runOp(ops["roster.import"], roster, as)
  expect(preview.applied).toBe(false)
  const out = await runOp(ops["roster.import"], { ...roster, confirm: preview.confirm }, as)
  expect(out.applied).toBe(true)
  return out
}

const roster = {
  classes: [
    {
      code: "705",
      name: "七5班",
      students: [
        { studentNo: "70501", name: "李明", gender: "男", group: "1" },
        { studentNo: "70502", name: "王芳*", gender: "女", group: "1" },
        { studentNo: "70503", name: "张三", gender: "男", group: "2" },
        { studentNo: "70504", name: "赵四", gender: "男", group: "2" },
      ],
    },
    { code: "707", name: "七7班", students: [{ studentNo: "70701", name: "张三", gender: "男" }] },
  ],
}

async function totalPoints(student: string) {
  const p = await runOp(ops["students.profile"], { student, class: "705" }, as)
  return p.data.points.net
}

beforeAll(async () => {
  await ensureDefaultRules()
  await importDemo()
})

describe("名册", () => {
  it("预览不落库，确认码不对时拒绝", async () => {
    const list = await runOp(ops["classes.list"], {}, as)
    expect(list.data.map((c) => [c.code, c.studentCount])).toEqual([
      ["705", 4],
      ["707", 1],
    ])
    await expect(runOp(ops["roster.import"], { ...roster, confirm: "wrong" }, as)).rejects.toThrow(/确认码/)
  })

  it("姓名里的星号被去掉；跨班重名必须限定班级", async () => {
    const [s] = (await runOp(ops["students.resolve"], { names: ["王芳"] }, as)).data
    expect(s.name).toBe("王芳")
    await expect(runOp(ops["students.resolve"], { names: ["张三"] }, as)).rejects.toThrow(/重名/)
    const ok = await runOp(ops["students.resolve"], { names: ["张三"], class: "705" }, as)
    expect(ok.data[0].studentNo).toBe("70503")
  })

  it("对不上的名字给出候选", async () => {
    await expect(runOp(ops["students.resolve"], { names: ["李"], class: "705" }, as)).rejects.toThrow(/李明/)
  })

  it("重复导入不重复建人", async () => {
    const again = await importDemo()
    expect(again.data[0]).toMatchObject({ total: 4, created: [], updated: [] })
  })
})

describe("默写 → 待过关 → 销账", () => {
  let checkId: number

  it("登记后统计正确，请假不计入分母", async () => {
    const c = await runOp(ops["checks.create"], { class: "705", title: "U3 默写 1", date: "2026-11-02" }, as)
    checkId = c.data.id
    const r = await runOp(
      ops["checks.record"],
      {
        check: checkId,
        results: [
          { student: "李明", value: 100 },
          { student: "王芳", value: 60 },
          { student: "70503", value: "请假" },
          { student: "赵四", value: "85" },
        ],
      },
      as,
    )
    expect(r.data.stats).toMatchObject({ entered: 4, counted: 3, passed: 2, failed: 1, leave: 1, full: 1 })
    expect(r.changesetId).toBeTypeOf("number")
  })

  it("看不懂的值整体拒绝，不会只写一半", async () => {
    await expect(
      runOp(
        ops["checks.record"],
        {
          check: checkId,
          results: [
            { student: "李明", value: 90 },
            { student: "王芳", value: "优" },
          ],
        },
        as,
      ),
    ).rejects.toBeInstanceOf(OpError)
    const g = await runOp(ops["checks.get"], { check: checkId }, as)
    expect(g.data.rows.find((r) => r.student.name === "李明")?.result?.score).toBe(100)
  })

  it("未达标进入待过关池，销账后消失，撤销后回来", async () => {
    let pending = await runOp(ops["pending.list"], { class: "705" }, as)
    expect(pending.data.map((p) => p.student.name)).toEqual(["王芳"])

    const cleared = await runOp(ops["pending.clear"], { items: [{ student: "王芳", check: checkId }] }, as)
    pending = await runOp(ops["pending.list"], { class: "705" }, as)
    expect(pending.data).toEqual([])

    await runOp(ops.undo, { changesetId: cleared.changesetId ?? undefined }, as)
    pending = await runOp(ops["pending.list"], { class: "705" }, as)
    expect(pending.data.map((p) => p.student.name)).toEqual(["王芳"])
  })

  it("默写满分自动 +1，重复登记不重复加，改分后撤销", async () => {
    expect(await totalPoints("李明")).toBe(1)
    await runOp(ops["checks.record"], { check: checkId, results: [{ student: "李明", value: 100 }] }, as)
    expect(await totalPoints("李明")).toBe(1)
    await runOp(ops["checks.record"], { check: checkId, results: [{ student: "李明", value: 95 }] }, as)
    expect(await totalPoints("李明")).toBe(0)
    await runOp(ops["checks.record"], { check: checkId, results: [{ student: "李明", value: 100 }] }, as)
    expect(await totalPoints("李明")).toBe(1)
  })

  it("停用自动规则会清掉自动积分，重新启用会补回", async () => {
    const rules = (await runOp(ops["rules.list"], {}, as)).data
    const full = rules.find((r) => r.autoTrigger === "check_full_score")
    if (!full) throw new Error("缺少默认规则")
    await runOp(ops["rules.save"], { id: full.id, enabled: false }, as)
    expect(await totalPoints("李明")).toBe(0)
    await runOp(ops["rules.save"], { id: full.id, enabled: true }, as)
    expect(await totalPoints("李明")).toBe(1)
  })

  it("删除检查需要确认，删除后自动积分撤销、待过关消失", async () => {
    const preview = await runOp(ops["checks.delete"], { check: checkId }, as)
    expect(preview.applied).toBe(false)
    expect(await totalPoints("李明")).toBe(1)
    await runOp(ops["checks.delete"], { check: checkId, confirm: preview.confirm ?? "" }, as)
    expect(await totalPoints("李明")).toBe(0)
    expect((await runOp(ops["pending.list"], {}, as)).data).toEqual([])
  })

  it("撤销删除：检查、结果、自动积分全部回来", async () => {
    await runOp(ops.undo, {}, as)
    expect(await totalPoints("李明")).toBe(1)
    expect((await runOp(ops["pending.list"], {}, as)).data.length).toBe(1)
  })
})

describe("背书", () => {
  it("一次过自动 +1，二次过不加", async () => {
    const c = await runOp(ops["checks.create"], { class: "705", kind: "recite", title: "U3 课文背诵" }, as)
    expect(c.data.mode).toBe("mark")
    const before = await totalPoints("赵四")
    await runOp(
      ops["checks.record"],
      {
        check: c.data.id,
        results: [
          { student: "赵四", value: "过" },
          { student: "王芳", value: "二次过" },
        ],
      },
      as,
    )
    expect(await totalPoints("赵四")).toBe(before + 1)
    await expect(
      runOp(ops["checks.record"], { check: c.data.id, results: [{ student: "赵四", value: 90 }] }, as),
    ).rejects.toThrow(/快速标记/)
  })
})

describe("积分", () => {
  it("按规则加分、按组汇总，删除后回滚", async () => {
    const before = await totalPoints("张三")
    const add = await runOp(ops["points.add"], { class: "705", students: ["张三", "赵四"], rule: "课堂发言/答对" }, as)
    expect(await totalPoints("张三")).toBe(before + 1)

    const board = await runOp(ops["points.leaderboard"], { class: "705" }, as)
    const g2 = board.data.groups.find((g) => g.name === "2")
    const members = board.data.rows.filter((r) => r.groupName === "2")
    expect(g2?.net).toBe(members.reduce((a, r) => a + r.net, 0))

    await runOp(ops["points.revoke"], { eventIds: add.data.eventIds }, as)
    expect(await totalPoints("张三")).toBe(before)
  })

  it("自动规则不能手动加，自动积分不能手动删", async () => {
    await expect(runOp(ops["points.add"], { students: ["李明"], rule: "默写满分" }, as)).rejects.toThrow(/自动规则/)
    const log = await runOp(ops["points.log"], { student: "李明" }, as)
    const auto = log.data.find((e) => e.auto)
    if (!auto) throw new Error("应该有自动积分")
    await expect(runOp(ops["points.revoke"], { eventIds: [auto.id] }, as)).rejects.toThrow(/来源/)
  })

  it("撤销冲突：之后又被改过的数据拒绝撤销", async () => {
    const c = await runOp(ops["checks.create"], { class: "705", title: "冲突测试" }, as)
    const first = await runOp(ops["checks.record"], { check: c.data.id, results: [{ student: "李明", value: 70 }] }, as)
    await runOp(ops["checks.record"], { check: c.data.id, results: [{ student: "李明", value: 75 }] }, as)
    await expect(runOp(ops.undo, { changesetId: first.changesetId ?? undefined }, as)).rejects.toThrow(/又被改过/)
  })
})

describe("操作记录", () => {
  it("记录操作人和摘要", async () => {
    const h = await runOp(ops.history, { limit: 5 }, as)
    expect(h.data[0]).toMatchObject({ actor: "test" })
    expect(h.data.some((x) => x.summary.includes("登记"))).toBe(true)
  })
})
