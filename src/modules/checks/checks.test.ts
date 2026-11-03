import { beforeAll, describe, expect, it } from "vitest"
import { defaultMode, isReciteDone, reciteTickValue } from "@/modules/checks/shared"
import { OpError, runOp } from "@/server/core/define"
import { initModules, ops } from "@/server/registry"

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
  return p.data.sections.points?.net ?? 0
}

beforeAll(async () => {
  await initModules()
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
    const c = await runOp(
      ops["checks.create"],
      { class: "705", title: "U3 默写 1", date: "2026-11-02", requirePass: true },
      as,
    )
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
    const full = rules.find((r) => r.autoTrigger === "checks.dictation_full")
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
  it("共享口径：defaultMode / reciteTickValue / isReciteDone 覆盖 mark 与历史 level", () => {
    expect(defaultMode("recite")).toBe("mark")
    expect(defaultMode("dictation")).toBe("score")
    expect(reciteTickValue("mark")).toBe("过")
    expect(reciteTickValue("level")).toBe("全背")

    // mark 模式下：过 / 二次过 为已完成，未过 / 请假 / 免 / 空 为未完成
    expect(isReciteDone("mark", { score: null, mark: "pass" })).toBe(true)
    expect(isReciteDone("mark", { score: null, mark: "pass_retry" })).toBe(true)
    expect(isReciteDone("mark", { score: null, mark: "fail" })).toBe(false)
    expect(isReciteDone("mark", { score: null, mark: "leave" })).toBe(false)
    expect(isReciteDone("mark", { score: null, mark: "exempt" })).toBe(false)
    expect(isReciteDone("mark", null)).toBe(false)

    // 历史 level 模式下：仅全背为已完成，抄书 / 读书 / 背部分 / 请假 / 免 为未完成
    expect(isReciteDone("level", { score: null, mark: "full" })).toBe(true)
    expect(isReciteDone("level", { score: null, mark: "partial" })).toBe(false)
    expect(isReciteDone("level", { score: null, mark: "read" })).toBe(false)
    expect(isReciteDone("level", { score: null, mark: "copy" })).toBe(false)
    expect(isReciteDone("level", { score: null, mark: "leave" })).toBe(false)
    expect(isReciteDone("level", { score: null, mark: "exempt" })).toBe(false)
  })

  it("新建背书默认快速标记（mark）：勾选写入「过」自动 +1，取消清除后可撤销恢复结果与积分", async () => {
    const c = await runOp(ops["checks.create"], { class: "705", kind: "recite", title: "U3 课文背诵" }, as)
    expect(c.data.mode).toBe("mark")
    expect(c.data.requirePass).toBe(false)
    const before = await totalPoints("赵四")

    // 勾选「过」加分，重复登记幂等不重复加分
    await runOp(ops["checks.record"], { check: c.data.id, results: [{ student: "赵四", value: "过" }] }, as)
    expect(await totalPoints("赵四")).toBe(before + 1)
    await runOp(ops["checks.record"], { check: c.data.id, results: [{ student: "赵四", value: "过" }] }, as)
    expect(await totalPoints("赵四")).toBe(before + 1)

    // 取消勾选清除记录并回收自动积分
    const cleared = await runOp(
      ops["checks.record"],
      { check: c.data.id, results: [{ student: "赵四", value: "" }] },
      as,
    )
    expect(await totalPoints("赵四")).toBe(before)
    const detail = await runOp(ops["checks.get"], { check: c.data.id }, as)
    expect(detail.data.rows.find((r) => r.student.name === "赵四")?.result).toBeNull()

    // 撤销取消操作：恢复「过」和自动积分
    await runOp(ops.undo, { changesetId: cleared.changesetId ?? undefined }, as)
    expect(await totalPoints("赵四")).toBe(before + 1)
    const restored = await runOp(ops["checks.get"], { check: c.data.id }, as)
    expect(restored.data.rows.find((r) => r.student.name === "赵四")?.result?.mark).toBe("pass")
  })

  it("显式选择分等级（level）：全背自动 +1，其他等级不加分，取消勾选回收加分", async () => {
    const c = await runOp(
      ops["checks.create"],
      { class: "705", kind: "recite", title: "U3 分级背诵", mode: "level" },
      as,
    )
    expect(c.data.mode).toBe("level")
    expect(c.data.requirePass).toBe(false)
    const before = await totalPoints("赵四")
    const wang = await totalPoints("王芳")
    const out = await runOp(
      ops["checks.record"],
      {
        check: c.data.id,
        results: [
          { student: "赵四", value: "全背" },
          { student: "王芳", value: "背部分" },
          { student: "李明", value: "抄书" },
        ],
      },
      as,
    )
    expect(out.data.stats.levels).toEqual({ full: 1, partial: 1, copy: 1 })
    expect(out.data.stats.passRate).toBeNull()
    expect(await totalPoints("赵四")).toBe(before + 1)
    expect(await totalPoints("王芳")).toBe(wang)
    const pending = await runOp(ops["pending.list"], { class: "705" }, as)
    expect(pending.data.filter((p) => p.check.id === c.data.id)).toHaveLength(0)

    // 重复登记全背幂等，清除后回收积分
    await runOp(ops["checks.record"], { check: c.data.id, results: [{ student: "赵四", value: "全背" }] }, as)
    expect(await totalPoints("赵四")).toBe(before + 1)
    await runOp(ops["checks.record"], { check: c.data.id, results: [{ student: "赵四", value: null }] }, as)
    expect(await totalPoints("赵四")).toBe(before)

    // 分等级不能填分数，也不能填「过」
    await expect(
      runOp(ops["checks.record"], { check: c.data.id, results: [{ student: "赵四", value: 90 }] }, as),
    ).rejects.toThrow(/分等级/)
    await expect(
      runOp(ops["checks.record"], { check: c.data.id, results: [{ student: "赵四", value: "过" }] }, as),
    ).rejects.toThrow(/抄书/)
  })

  it("判定过关时，分等级没到全背的进待过关", async () => {
    const c = await runOp(
      ops["checks.create"],
      { class: "705", kind: "recite", title: "U4 课文背诵", mode: "level", requirePass: true },
      as,
    )
    await runOp(
      ops["checks.record"],
      {
        check: c.data.id,
        results: [
          { student: "赵四", value: "全背" },
          { student: "王芳", value: "读书" },
        ],
      },
      as,
    )
    const pending = await runOp(ops["pending.list"], { class: "705" }, as)
    expect(pending.data.filter((p) => p.check.id === c.data.id).map((p) => p.student.name)).toEqual(["王芳"])
    // 改成不判定：待过关清空
    await runOp(ops["checks.update"], { check: c.data.id, requirePass: false }, as)
    const after = await runOp(ops["pending.list"], { class: "705" }, as)
    expect(after.data.filter((p) => p.check.id === c.data.id)).toHaveLength(0)
  })

  it("快速标记：一次过 +1，二次过不加", async () => {
    const c = await runOp(
      ops["checks.create"],
      { class: "705", kind: "recite", title: "U5 背诵", mode: "mark", requirePass: true },
      as,
    )
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

describe("批量新建检查（checks.createBatch）", () => {
  it("一次给多个班创建同标题检查，重复引用去重，一次撤销全部消失", async () => {
    const clsList = (await runOp(ops["classes.list"], {}, as)).data
    const c705 = clsList.find((c) => c.code === "705")
    if (!c705) throw new Error("缺少 705 班")

    const batch = await runOp(
      ops["checks.createBatch"],
      {
        classes: ["705", "七5班", c705.id, "707"],
        kind: "recite",
        title: "U6 多班背诵",
        date: "2026-11-10",
        requirePass: true,
      },
      as,
    )
    expect(batch.data).toHaveLength(2)
    expect(batch.data.map((c) => [c.classCode, c.className, c.mode, c.requirePass])).toEqual([
      ["705", "七5班", "mark", true],
      ["707", "七7班", "mark", true],
    ])
    expect(batch.summary).toContain("七5班、七7班")

    // 两个班列表里都能查到
    const list705 = (await runOp(ops["checks.list"], { class: "705" }, as)).data
    const list707 = (await runOp(ops["checks.list"], { class: "707" }, as)).data
    expect(list705.some((c) => c.title === "U6 多班背诵")).toBe(true)
    expect(list707.some((c) => c.title === "U6 多班背诵")).toBe(true)

    // 一次撤销，两班的这场检查全部移除
    await runOp(ops.undo, { changesetId: batch.changesetId ?? undefined }, as)
    const after705 = (await runOp(ops["checks.list"], { class: "705" }, as)).data
    const after707 = (await runOp(ops["checks.list"], { class: "707" }, as)).data
    expect(after705.some((c) => c.title === "U6 多班背诵")).toBe(false)
    expect(after707.some((c) => c.title === "U6 多班背诵")).toBe(false)
  })

  it("空数组、非法参数或任一班级找不到时整体拒绝，不落库", async () => {
    const beforeCount = (await runOp(ops["checks.list"], {}, as)).data.length
    await expect(runOp(ops["checks.createBatch"], { classes: [], title: "空班级测试" }, as)).rejects.toThrow()
    await expect(runOp(ops["checks.createBatch"], { classes: ["705"], title: "   " }, as)).rejects.toThrow()
    await expect(
      runOp(ops["checks.createBatch"], { classes: ["705"], title: "非法日期", date: "2026/11/10" }, as),
    ).rejects.toThrow()

    await expect(
      runOp(ops["checks.createBatch"], { classes: ["705", "不存在的班"], title: "原子性测试" }, as),
    ).rejects.toThrow(/找不到/)

    const afterList = (await runOp(ops["checks.list"], {}, as)).data
    expect(afterList.length).toBe(beforeCount)
    expect(afterList.some((c) => c.title === "原子性测试")).toBe(false)
  })
})

describe("积分", () => {
  it("扣分要写原因、按组汇总，删除后回滚", async () => {
    await expect(runOp(ops["points.deduct"], { class: "705", students: ["张三"], reason: "" }, as)).rejects.toThrow(
      /原因/,
    )
    const before = await totalPoints("张三")
    const add = await runOp(
      ops["points.deduct"],
      { class: "705", students: ["张三", "赵四"], points: 2, reason: "未交作业" },
      as,
    )
    expect(await totalPoints("张三")).toBe(before - 2)

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

describe("检查总表", () => {
  it("学生 × 场次，补过的带标记", async () => {
    const c = await runOp(
      ops["checks.create"],
      { class: "705", title: "总表测试", date: "2099-01-01", requirePass: true },
      as,
    )
    await runOp(
      ops["checks.record"],
      {
        check: c.data.id,
        results: [
          { student: "李明", value: 60 },
          { student: "王芳", value: "请假" },
        ],
      },
      as,
    )
    await runOp(ops["pending.clear"], { items: [{ student: "李明", check: c.data.id }] }, as)
    const sheet = (await runOp(ops["checks.sheet"], { class: "705" }, as)).data
    const col = sheet.checks.findIndex((x) => x.id === c.data.id)
    expect(col).toBe(sheet.checks.length - 1)
    const value = (name: string) => sheet.rows.find((r) => r.student.name === name)?.values[col]
    expect(value("李明")).toBe("60(补)")
    expect(value("王芳")).toBe("请假")
    expect(value("张三")).toBe("")
    await expect(runOp(ops["checks.sheet"], { class: "999" }, as)).rejects.toThrow()
  })
})

describe("不判定过关的默写", () => {
  it("默认只记录分数：没有达标率，不进待过关，满分照样加分", async () => {
    const c = await runOp(ops["checks.create"], { class: "705", title: "只记分的默写" }, as)
    expect(c.data.requirePass).toBe(false)
    const before = await totalPoints("李明")
    const out = await runOp(
      ops["checks.record"],
      {
        check: c.data.id,
        results: [
          { student: "李明", value: 100 },
          { student: "王芳", value: 40 },
        ],
      },
      as,
    )
    expect(out.data.stats).toMatchObject({ entered: 2, passRate: null, failed: 0, avg: 70, full: 1 })
    expect(await totalPoints("李明")).toBe(before + 1)
    const pending = await runOp(ops["pending.list"], { class: "705" }, as)
    expect(pending.data.filter((p) => p.check.id === c.data.id)).toHaveLength(0)
  })
})
