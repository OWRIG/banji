import { createHmac, randomBytes } from "node:crypto"
import { eq, getTableName } from "drizzle-orm"
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core"
import { z } from "zod"
import { db, sqlite } from "@/server/db"
import {
  apiTokens,
  changesets,
  checkResults,
  checks,
  classes,
  groups,
  pointEvents,
  pointRules,
  settings,
  students,
} from "@/server/db/schema"

// 业务操作层的骨架。网页接口、CLI、MCP 都通过 runOp 调用业务操作，业务规则只写在 ops/ 里。
//
// - read：只读
// - write：修改数据，自动记录变更，可以撤销
// - danger：危险操作。不带 confirm 调用时只预览（真实执行一遍再回滚），返回 confirm 码；带上 confirm 再调用才生效

export type OpKind = "read" | "write" | "danger"

export class OpError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

// 会被记录变更、可以撤销的表。新增业务表时加到这里
export const trackedTables = {
  classes,
  groups,
  students,
  checks,
  check_results: checkResults,
  point_rules: pointRules,
  point_events: pointEvents,
  api_tokens: apiTokens,
}
type TrackedTable = (typeof trackedTables)[keyof typeof trackedTables]
type IdTable = SQLiteTable & { id: SQLiteColumn }

export type Change = { table: string; id: number; before: unknown; after: unknown }

export class Ctx {
  readonly changes: Change[] = []
  summary = ""
  readonly db = db
  constructor(readonly actor: string) {}

  /** 新增一行并记录变更 */
  async insert<T extends TrackedTable>(table: T, values: T["$inferInsert"]): Promise<T["$inferSelect"]> {
    const rows = (await this.db
      .insert(table as IdTable)
      .values(values)
      .returning()) as T["$inferSelect"][]
    const row = rows[0] as T["$inferSelect"] & { id: number }
    this.changes.push({ table: getTableName(table), id: row.id, before: null, after: row })
    return row
  }

  /** 修改一行并记录变更；记录不存在时返回 undefined */
  async update<T extends TrackedTable>(
    table: T,
    id: number,
    set: Partial<T["$inferInsert"]>,
  ): Promise<T["$inferSelect"] | undefined> {
    const t = table as IdTable
    const [before] = await this.db.select().from(t).where(eq(t.id, id))
    if (!before) return undefined
    const [after] = await this.db.update(t).set(set).where(eq(t.id, id)).returning()
    this.changes.push({ table: getTableName(table), id, before, after })
    return after as T["$inferSelect"]
  }

  /** 删除一行并记录变更；记录不存在时返回 undefined */
  async remove<T extends TrackedTable>(table: T, id: number): Promise<T["$inferSelect"] | undefined> {
    const t = table as IdTable
    const [before] = await this.db.delete(t).where(eq(t.id, id)).returning()
    if (!before) return undefined
    this.changes.push({ table: getTableName(table), id, before, after: null })
    return before as T["$inferSelect"]
  }
}

export type OpDef<N extends string, S extends z.ZodObject, R> = {
  name: N
  title: string
  description: string
  kind: OpKind
  input: S
  /** 不在 MCP 里暴露（例如管理访问令牌，不能让 agent 给自己发令牌） */
  hideFromMcp?: boolean
  run: (ctx: Ctx, input: z.output<S>) => Promise<R>
}

export function defineOp<const N extends string, S extends z.ZodObject, R>(op: OpDef<N, S, R>) {
  return op
}

export type OpOutcome<R> = {
  /** false 表示这是危险操作的预览，数据没有改动 */
  applied: boolean
  data: R
  /** 本次变更的编号，用于撤销 */
  changesetId: number | null
  /** 危险操作预览时返回：确认后带上它再调用一次 */
  confirm: string | null
  summary: string
}

// 同一个进程里的操作排队执行。better-sqlite3 是单连接，交错执行的异步事务会互相串进去。
// 不同进程之间（网页服务和 CLI）由 SQLite 自己的锁协调。
let queue: Promise<unknown> = Promise.resolve()
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

export async function runOp<S extends z.ZodObject, R>(
  op: OpDef<string, S, R>,
  rawInput: unknown,
  opts: { actor: string },
): Promise<OpOutcome<R>> {
  const parsed = op.input.safeParse(rawInput ?? {})
  if (!parsed.success) throw new OpError(400, `参数不正确：\n${z.prettifyError(parsed.error)}`)
  const input = parsed.data

  return serialized(async () => {
    const ctx = new Ctx(opts.actor)
    if (op.kind === "read") {
      const data = await op.run(ctx, input)
      return { applied: true, data, changesetId: null, confirm: null, summary: ctx.summary }
    }

    let confirm: string | null = null
    let preview = false
    if (op.kind === "danger") {
      const { confirm: given, ...rest } = input as { confirm?: string }
      const tokens = await confirmTokens(op.name, rest)
      if (!given) {
        preview = true
        confirm = tokens[0]
      } else if (!tokens.includes(given)) {
        throw new OpError(409, "确认码不对或已过期（有效期约 5 分钟），请重新预览后再确认")
      }
    }

    sqlite.exec("BEGIN IMMEDIATE")
    try {
      const data = await op.run(ctx, input)
      if (preview) {
        sqlite.exec("ROLLBACK")
        return { applied: false, data, changesetId: null, confirm, summary: ctx.summary }
      }
      let changesetId: number | null = null
      if (ctx.changes.length > 0) {
        const [cs] = await db
          .insert(changesets)
          .values({ actor: opts.actor, opName: op.name, summary: ctx.summary, changes: JSON.stringify(ctx.changes) })
          .returning({ id: changesets.id })
        changesetId = cs.id
      }
      sqlite.exec("COMMIT")
      return { applied: true, data, changesetId, confirm: null, summary: ctx.summary }
    } catch (err) {
      if (sqlite.inTransaction) sqlite.exec("ROLLBACK")
      throw err
    }
  })
}

// ---- 危险操作的确认码：绑定操作名和参数，5 分钟一个时间窗，当前和上一个窗口都有效 ----

async function secret() {
  const [row] = await db.select().from(settings).where(eq(settings.key, "confirm_secret"))
  if (row) return row.value
  await db
    .insert(settings)
    .values({ key: "confirm_secret", value: randomBytes(32).toString("hex") })
    .onConflictDoNothing()
  const [created] = await db.select().from(settings).where(eq(settings.key, "confirm_secret"))
  return created.value
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(",")}}`
  }
  return JSON.stringify(v)
}

async function confirmTokens(name: string, input: unknown) {
  const window = Math.floor(Date.now() / 300_000)
  const key = await secret()
  return [window, window - 1].map((w) =>
    createHmac("sha256", key)
      .update(`${name}|${w}|${stableStringify(input)}`)
      .digest("hex")
      .slice(0, 12),
  )
}

// ---- 常用的 zod 片段 ----

/** 学生：可以是内部编号（数字）、学号或姓名（字符串） */
export const studentRef = z
  .union([z.number().int().positive(), z.string().trim().min(1)])
  .describe("学生：姓名、学号，或内部编号（数字）")
/** 班级：班级代号（如 705）、班级名称，或内部编号 */
export const classRef = z
  .union([z.number().int().positive(), z.string().trim().min(1)])
  .describe("班级：班级代号（如 705）、班级名称，或内部编号（数字）")
export const confirmField = z
  .string()
  .optional()
  .describe("危险操作的确认码。第一次不填，会返回预览和确认码；确认无误后带上确认码再调用一次才会生效")
