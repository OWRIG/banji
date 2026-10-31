import { beforeAll, describe, expect, it } from "vitest"
import { runOp } from "@/server/core/define"
import { initModules, ops } from "@/server/registry"

const as = { actor: "test" }

beforeAll(async () => {
  await initModules()
  const roster = { classes: [{ code: "705", name: "七5班", students: [{ studentNo: "70501", name: "李明" }] }] }
  const p = await runOp(ops["roster.import"], roster, as)
  await runOp(ops["roster.import"], { ...roster, confirm: p.confirm ?? "" }, as)
})

describe("谈话记录", () => {
  it("记录后出现在学生档案里，删除可以撤销", async () => {
    const added = await runOp(ops["notes.add"], { student: "李明", text: "最近上课走神，约了周五再聊" }, as)
    let profile = await runOp(ops["students.profile"], { student: "李明" }, as)
    expect(profile.data.sections.notes?.notes.map((n) => n.text)).toEqual(["最近上课走神，约了周五再聊"])

    await runOp(ops["notes.delete"], { id: added.data.id }, as)
    profile = await runOp(ops["students.profile"], { student: "李明" }, as)
    expect(profile.data.sections.notes?.notes).toEqual([])

    await runOp(ops.undo, {}, as)
    const list = await runOp(ops["notes.list"], { class: "705" }, as)
    expect(list.data.map((r) => r.studentName)).toEqual(["李明"])
  })

  it("内容为空时拒绝，找不到学生时给出提示", async () => {
    await expect(runOp(ops["notes.add"], { student: "李明", text: "  " }, as)).rejects.toThrow(/请填写内容/)
    await expect(runOp(ops["notes.add"], { student: "王五", text: "x" }, as)).rejects.toThrow(/找不到/)
  })
})
