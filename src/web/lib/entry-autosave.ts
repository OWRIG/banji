/** 登记表的保存队列：先保留草稿，再串行提交；旧请求只确认它实际提交的版本。 */
type Draft = { value: string; base: string; version: number }
export type EntryCell = {
  value: string
  validate: (value: string) => string | null
  normalize?: (value: string) => string
}
export type EntrySnapshot = {
  drafts: Record<string, Draft>
  errors: Record<string, string>
  saving: boolean
  storageError: boolean
}
type Options = {
  read: () => string | null
  write: (value: string | null) => void
  cells: Record<string, EntryCell>
  save: (entries: { key: string; value: string }[]) => Promise<unknown>
}

export class EntryAutosave {
  private state: EntrySnapshot = { drafts: {}, errors: {}, saving: false, storageError: false }
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private version = 0
  private running: Promise<void> | undefined
  // 请求成功可能早于 React 显示新查询结果；这段时间以实际已提交的值为准。
  private confirmed = new Map<string, { value: string; stale: Set<string> }>()
  private options: Options

  constructor(options: Options) {
    this.options = options
    try {
      const raw: unknown = JSON.parse(options.read() ?? "{}")
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [key, item] of Object.entries(raw)) {
          if (item && typeof item === "object" && "value" in item && "base" in item) {
            if (typeof item.value === "string" && typeof item.base === "string") {
              this.state.drafts[key] = { value: item.value, base: item.base, version: ++this.version }
            }
          }
        }
      }
    } catch {
      this.state.storageError = true
    }
  }

  configure(options: Pick<Options, "cells" | "save">) {
    this.options = { ...this.options, ...options }
  }

  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private serverValue(key: string) {
    const current = this.options.cells[key]?.value ?? ""
    const confirmed = this.confirmed.get(key)
    if (confirmed && current !== confirmed.value && confirmed.stale.has(current)) return confirmed.value
    this.confirmed.delete(key)
    return current
  }

  private normalized(key: string, value: string) {
    return this.options.cells[key]?.normalize?.(value) ?? value.trim()
  }

  private publish() {
    try {
      this.options.write(Object.keys(this.state.drafts).length ? JSON.stringify(this.state.drafts) : null)
      this.state = { ...this.state, storageError: false }
    } catch {
      this.state = { ...this.state, storageError: true }
    }
    for (const listener of this.listeners) listener()
  }

  edit(entries: { key: string; value: string }[], immediate = false) {
    const drafts = { ...this.state.drafts }
    const errors = { ...this.state.errors }
    for (const { key, value } of entries) {
      const cell = this.options.cells[key]
      if (!cell) continue
      drafts[key] = { value, base: drafts[key]?.base ?? this.serverValue(key), version: ++this.version }
      delete errors[key]
    }
    this.state = { ...this.state, drafts, errors }
    this.publish()
    this.schedule(immediate ? 0 : 600)
  }

  private schedule(delay = 600) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), delay)
  }

  /** 启动/恢复网络时只重试可安全提交的草稿；冲突需要老师明确选择。 */
  start = () => this.schedule(0)

  flush = async (): Promise<void> => {
    clearTimeout(this.timer)
    if (this.running) return this.running
    this.running = this.submit()
    try {
      await this.running
    } finally {
      this.running = undefined
    }
  }

  private async submit() {
    const pending: Record<string, Draft> = {}
    const drafts = { ...this.state.drafts }
    const errors: Record<string, string> = {}
    for (const [key, draft] of Object.entries(drafts)) {
      const cell = this.options.cells[key]
      const current = this.serverValue(key)
      if (!cell) {
        errors[key] = "这名学生或科目已不在表中，请核对后处理草稿"
      } else if (this.normalized(key, draft.value) === current) {
        delete drafts[key]
      } else {
        const error = cell.validate(draft.value)
        if (error) errors[key] = error
        else if (current !== draft.base) errors[key] = "服务器上的成绩已改变，请核对后选择保留哪一份"
        else pending[key] = { ...draft, value: draft.value.trim() }
      }
    }
    this.state = { ...this.state, drafts, errors, saving: Object.keys(pending).length > 0 }
    this.publish()
    if (!this.state.saving) return
    try {
      await this.options.save(Object.entries(pending).map(([key, d]) => ({ key, value: d.value })))
      const next = { ...this.state.drafts }
      for (const [key, sent] of Object.entries(pending)) {
        const value = this.normalized(key, sent.value)
        const stale = this.confirmed.get(key)?.stale ?? new Set<string>()
        stale.add(sent.base)
        stale.add(this.options.cells[key]?.value ?? "")
        this.confirmed.set(key, { value, stale })
        if (next[key]?.version === sent.version) delete next[key]
        // 保存期间继续输入的新版本要接着保存，不能被旧请求清掉。
        else if (next[key]) next[key] = { ...next[key], base: value }
      }
      this.state = { ...this.state, drafts: next, saving: false }
      this.publish()
      if (Object.keys(next).some((key) => !this.state.errors[key])) this.schedule(0)
    } catch (error) {
      const nextErrors = { ...this.state.errors }
      for (const key of Object.keys(pending)) {
        nextErrors[key] = error instanceof Error ? error.message : "保存失败，请重试"
      }
      this.state = { ...this.state, errors: nextErrors, saving: false }
      this.publish()
    }
  }

  /** 核对冲突后明确选择本页输入；普通失败重试也走这里。 */
  retry = () => {
    const drafts = Object.fromEntries(
      Object.entries(this.state.drafts).map(([key, d]) => [
        key,
        { ...d, base: this.options.cells[key] ? this.serverValue(key) : d.base },
      ]),
    )
    this.state = { ...this.state, drafts, errors: {} }
    this.publish()
    this.start()
  }

  discard = () => {
    if (this.state.saving) return
    clearTimeout(this.timer)
    this.state = { ...this.state, drafts: {}, errors: {} }
    this.publish()
  }
}
