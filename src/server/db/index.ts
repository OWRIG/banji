import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { createBackup } from "../backup"
import { env, ROOT } from "../env"
import * as schema from "./schema"

if (env.DATABASE_URL !== ":memory:") {
  mkdirSync(dirname(env.DATABASE_URL), { recursive: true })
}

export const sqlite = new Database(env.DATABASE_URL)
sqlite.pragma("journal_mode = WAL")
sqlite.pragma("foreign_keys = ON")
// 网页服务、CLI、MCP 可能同时读写同一个文件：遇到锁时最多等 5 秒，而不是立刻报错
sqlite.pragma("busy_timeout = 5000")

export const db = drizzle(sqlite, { schema })
export type DB = typeof db

// 连接时自动把数据库升级到最新结构（执行 drizzle/ 里还没执行过的迁移文件）。
// 有需要执行的升级时，先把现有数据备份一次
const migrationsFolder = resolve(ROOT, "drizzle")
if (await hasPendingMigrations()) await createBackup("before-upgrade")
migrate(db, { migrationsFolder })

async function hasPendingMigrations() {
  if (env.DATABASE_URL === ":memory:" || !existsSync(env.DATABASE_URL)) return false
  const journal = JSON.parse(readFileSync(resolve(migrationsFolder, "meta/_journal.json"), "utf8")) as {
    entries: unknown[]
  }
  const table = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
    .get()
  if (!table) {
    // 有业务数据但还没有迁移记录：也算需要升级
    return !!sqlite.prepare("select name from sqlite_master where type = 'table' and name = 'students'").get()
  }
  const { n } = sqlite.prepare("select count(*) as n from __drizzle_migrations").get() as { n: number }
  return n < journal.entries.length
}
