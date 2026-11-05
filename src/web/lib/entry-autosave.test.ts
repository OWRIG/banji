import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EntryAutosave, type EntryCell } from "./entry-autosave"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup() {
  let stored: string | null = null
  const cells: Record<string, EntryCell> = Object.fromEntries(
    ["1", "2", "3"].map((key) => [
      key,
      {
        value: "",
        validate: (value: string) => (value === "bad" ? "请填有效分数" : null),
      },
    ]),
  )
  const save = vi.fn(async (entries: { key: string; value: string }[]) => {
    for (const entry of entries) cells[entry.key].value = entry.value
  })
  const options = {
    cells,
    save,
    read: () => stored,
    write: (value: string | null) => {
      stored = value
    },
  }
  return { queue: new EntryAutosave(options), options, cells, save, stored: () => stored }
}

describe("录入自动保存与刷新恢复", () => {
  it("尚未回车的输入立即备份，刷新后恢复并自动保存，包括 0 分", async () => {
    const h = setup()
    h.queue.edit([{ key: "1", value: "0" }])
    expect(h.save).not.toHaveBeenCalled()
    expect(h.stored()).toContain('"value":"0"')
    const restored = new EntryAutosave(h.options)
    expect(restored.snapshot().drafts["1"].value).toBe("0")
    await restored.flush()
    expect(h.cells["1"].value).toBe("0")
    expect(h.stored()).toBeNull()
  })

  it("输入停顿后自动保存，不需要失焦或回车", async () => {
    const h = setup()
    h.queue.edit([{ key: "1", value: "8" }])
    await vi.advanceTimersByTimeAsync(300)
    h.queue.edit([{ key: "1", value: "85" }])
    await vi.advanceTimersByTimeAsync(600)
    expect(h.save).toHaveBeenCalledExactlyOnceWith([{ key: "1", value: "85" }])
    expect(h.queue.snapshot().drafts).toEqual({})
  })

  it("慢网下连续改同一格、粘贴其他格，旧请求不会清掉新输入", async () => {
    const h = setup()
    let finish: () => void = () => undefined
    h.save.mockImplementationOnce(async (entries) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      for (const entry of entries) h.cells[entry.key].value = entry.value
    })
    h.queue.edit([{ key: "1", value: "80" }])
    const first = h.queue.flush()
    h.queue.edit([
      { key: "1", value: "90" },
      { key: "2", value: "70" },
    ])
    // 在保存另一格期间粘贴，仍应保留其他所有尚未保存的格子。
    h.queue.edit([{ key: "3", value: "60" }], true)
    finish()
    await first
    expect(h.queue.snapshot().drafts["1"].value).toBe("90")
    await h.queue.flush()
    expect(Object.values(h.cells).map((c) => c.value)).toEqual(["90", "70", "60"])
    expect(h.queue.snapshot().drafts).toEqual({})
  })

  it("在第一次保存途中把输入改回原值，也必须把改回的值存到服务器", async () => {
    const h = setup()
    h.cells["1"].value = "50"
    let finish: () => void = () => undefined
    h.save.mockImplementationOnce(async (entries) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      for (const entry of entries) h.cells[entry.key].value = entry.value
    })
    h.queue.edit([{ key: "1", value: "80" }])
    const first = h.queue.flush()
    h.queue.edit([{ key: "1", value: "50" }])
    finish()
    await first
    await h.queue.flush()
    expect(h.cells["1"].value).toBe("50")
  })

  it("断网不清草稿，重试后才显示已保存；清空格子也能保存", async () => {
    const h = setup()
    h.cells["1"].value = "80"
    h.save.mockRejectedValueOnce(new Error("网络断开"))
    h.queue.edit([{ key: "1", value: "" }])
    await h.queue.flush()
    expect(h.queue.snapshot().errors["1"]).toBe("网络断开")
    expect(h.queue.snapshot().drafts["1"].value).toBe("")
    expect(h.stored()).not.toBeNull()
    await h.queue.flush()
    expect(h.cells["1"].value).toBe("")
    expect(h.stored()).toBeNull()
  })

  it("一格非法不会挡住其他格保存，非法内容留在草稿中", async () => {
    const h = setup()
    h.queue.edit([
      { key: "1", value: "bad" },
      { key: "2", value: "75" },
    ])
    await h.queue.flush()
    expect(h.cells["2"].value).toBe("75")
    expect(h.queue.snapshot().errors["1"]).toBe("请填有效分数")
    expect(h.queue.snapshot().drafts["1"].value).toBe("bad")
  })

  it("恢复草稿时遇到服务器新成绩，先提示冲突，明确选择后才覆盖", async () => {
    const h = setup()
    h.queue.edit([{ key: "1", value: "80" }])
    h.cells["1"].value = "90"
    const restored = new EntryAutosave(h.options)
    await restored.flush()
    expect(h.save).not.toHaveBeenCalled()
    expect(restored.snapshot().errors["1"]).toContain("已改变")
    restored.retry()
    await restored.flush()
    expect(h.cells["1"].value).toBe("80")
  })

  it("浏览器禁止草稿存储时明确报告，但仍能保存到服务器", async () => {
    const h = setup()
    const queue = new EntryAutosave({
      ...h.options,
      write: () => {
        throw new Error("存储不可用")
      },
    })
    queue.edit([{ key: "1", value: "80" }])
    expect(queue.snapshot().storageError).toBe(true)
    await queue.flush()
    expect(h.cells["1"].value).toBe("80")
    expect(queue.snapshot().drafts).toEqual({})
  })

  it("保存成功早于页面刷新时，继续输入不会被误判为服务器冲突", async () => {
    const h = setup()
    h.cells["1"].value = "85"
    let finish: () => void = () => undefined
    h.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    h.queue.edit([{ key: "1", value: "80" }])
    const first = h.queue.flush()
    h.queue.edit([{ key: "1", value: "90" }])
    finish()
    await first
    // 页面此时还显示 85，保存接口实际已接受 80。
    await h.queue.flush()
    expect(h.save).toHaveBeenLastCalledWith([{ key: "1", value: "90" }])
    expect(h.queue.snapshot().errors).toEqual({})
    expect(h.cells["1"].value).toBe("90")
  })

  it("已保存的别名或小数格式在刷新恢复时不会被误判为冲突", async () => {
    const h = setup()
    h.cells["1"].normalize = (value) => String(Number(value))
    h.queue.edit([{ key: "1", value: "80.0" }])
    h.cells["1"].value = "80"
    const restored = new EntryAutosave(h.options)
    await restored.flush()
    expect(restored.snapshot().drafts).toEqual({})
    expect(h.save).not.toHaveBeenCalled()
  })
})
