import { createHash, randomBytes } from "node:crypto"
import { and, desc, eq, getTableName, inArray, isNull, ne } from "drizzle-orm"
import { z } from "zod"
import { createBackup, listBackups } from "@/server/backup"
import { db } from "@/server/db"
import { apiTokens, changesets, checkResults, checks, classes } from "@/server/db/schema"
import { checkStats, today } from "@/shared/checks"
import { pendingItems } from "./checks"
import { type Change, defineOp, OpError, trackedTables } from "./define"

// 撤销、操作记录、今日概览、备份、访问令牌

type IdTable = (typeof trackedTables)[keyof typeof trackedTables]
const tableByName = new Map<string, IdTable>(Object.values(trackedTables).map((t) => [getTableName(t), t]))

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export const undo = defineOp({
  name: "undo",
  title: "撤销",
  description:
    "撤销一次操作。不传 changesetId 时撤销最近一次（不论来自网页、CLI 还是 agent）。如果那次之后相关数据又被改过，会拒绝撤销并说明原因。",
  kind: "write",
  input: z.object({ changesetId: z.number().int().positive().optional() }),
  run: async (ctx, input) => {
    const [cs] = input.changesetId
      ? await db.select().from(changesets).where(eq(changesets.id, input.changesetId))
      : await db
          .select()
          .from(changesets)
          .where(and(isNull(changesets.undoneAt), ne(changesets.opName, "undo")))
          .orderBy(desc(changesets.id))
          .limit(1)
    if (!cs) throw new OpError(404, "没有可以撤销的操作")
    if (cs.undoneAt) throw new OpError(409, `「${cs.summary}」已经撤销过了`)
    if (cs.opName === "undo") throw new OpError(409, "撤销操作本身不能再撤销")

    const changes = JSON.parse(cs.changes) as Change[]
    for (const ch of [...changes].reverse()) {
      const table = tableByName.get(ch.table)
      if (!table) throw new OpError(409, `无法撤销：未知的数据表 ${ch.table}`)
      const [current] = await ctx.db.select().from(table).where(eq(table.id, ch.id))
      const expected = ch.after
      if (!same(current ?? null, expected)) {
        throw new OpError(
          409,
          `「${cs.summary}」之后相关数据又被改过，不能直接撤销。可以先撤销后面的操作，或者手动修改。`,
        )
      }
      if (ch.before === null) await ctx.remove(table, ch.id)
      else if (ch.after === null) await ctx.insert(table, ch.before as never)
      else await ctx.update(table, ch.id, ch.before as never)
    }
    await ctx.db.update(changesets).set({ undoneAt: new Date().toISOString() }).where(eq(changesets.id, cs.id))
    ctx.summary = `撤销：${cs.summary}`
    return { undone: cs.summary, changesetId: cs.id }
  },
})

export const history = defineOp({
  name: "history",
  title: "操作记录",
  description: "最近的修改记录：谁（网页/CLI/哪个 agent）、什么时候、做了什么、是否已撤销。",
  kind: "read",
  input: z.object({ limit: z.number().int().positive().max(200).default(30) }),
  run: async (_ctx, input) => {
    const rows = await db.select().from(changesets).orderBy(desc(changesets.id)).limit(input.limit)
    return rows.map(({ changes, ...r }) => ({ ...r, changeCount: (JSON.parse(changes) as unknown[]).length }))
  },
})

export const briefToday = defineOp({
  name: "brief.today",
  title: "今日概览",
  description: "首页数据：各班待过关名单、今天的检查登记情况、最近一次备份。适合每天开始工作时先看。",
  kind: "read",
  input: z.object({}),
  run: async () => {
    const date = today()
    const cls = await db.select().from(classes).orderBy(classes.sort, classes.code)
    const pending = await pendingItems({})
    const todays = await db.select().from(checks).where(eq(checks.date, date))
    const results = todays.length
      ? await db
          .select()
          .from(checkResults)
          .where(
            inArray(
              checkResults.checkId,
              todays.map((c) => c.id),
            ),
          )
      : []
    const lastBackup = listBackups()[0] ?? null
    return {
      date,
      classes: cls.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        pending: pending.filter((p) => p.classCode === c.code),
      })),
      todayChecks: todays.map((c) => ({
        ...c,
        stats: checkStats(
          c,
          results.filter((r) => r.checkId === c.id),
        ),
      })),
      lastBackup: lastBackup ? { name: lastBackup.name, createdAt: lastBackup.createdAt } : null,
    }
  },
})

export const backupNow = defineOp({
  name: "backup.create",
  title: "立即备份",
  description: "把整个数据库备份一份到备份目录（不修改任何数据）。",
  kind: "read",
  input: z.object({}),
  run: async () => {
    const file = await createBackup("manual")
    if (!file) throw new OpError(409, "当前是内存数据库，不需要备份")
    return { file }
  },
})

export const backupList = defineOp({
  name: "backup.list",
  title: "备份列表",
  description: "列出已有的备份文件（最新在前）。",
  kind: "read",
  input: z.object({}),
  run: async () => listBackups().map(({ name, size, createdAt }) => ({ name, size, createdAt })),
})

// ---- 访问令牌（远程 agent 用），不在 MCP 中暴露 ----

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export const createToken = defineOp({
  name: "tokens.create",
  title: "生成访问令牌",
  description: "给远程 agent 生成一个访问令牌。令牌只显示这一次，请马上复制保存。",
  kind: "write",
  hideFromMcp: true,
  input: z.object({ name: z.string().trim().min(1, "请给令牌起个名字，例如 我的 Claude").max(50) }),
  run: async (ctx, input) => {
    const token = `bj_${randomBytes(24).toString("base64url")}`
    const row = await ctx.insert(apiTokens, { name: input.name, tokenHash: hashToken(token) })
    ctx.summary = `生成访问令牌「${input.name}」`
    return { id: row.id, name: row.name, token }
  },
})

export const listTokens = defineOp({
  name: "tokens.list",
  title: "访问令牌列表",
  description: "列出访问令牌（不显示令牌本身）。",
  kind: "read",
  hideFromMcp: true,
  input: z.object({}),
  run: async () => {
    const rows = await db.select().from(apiTokens).orderBy(desc(apiTokens.id))
    return rows.map(({ tokenHash: _h, ...r }) => r)
  },
})

export const revokeToken = defineOp({
  name: "tokens.revoke",
  title: "作废访问令牌",
  description: "作废一个访问令牌，使用它的 agent 将无法再访问。",
  kind: "write",
  hideFromMcp: true,
  input: z.object({ id: z.number().int().positive() }),
  run: async (ctx, input) => {
    const row = await ctx.update(apiTokens, input.id, { revokedAt: new Date().toISOString() })
    if (!row) throw new OpError(404, "令牌不存在")
    ctx.summary = `作废访问令牌「${row.name}」`
    return { id: row.id }
  },
})

/** 校验令牌，返回令牌名；无效时返回 null */
export async function verifyToken(token: string) {
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt)))
  if (!row) return null
  await db.update(apiTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiTokens.id, row.id))
  return row.name
}
