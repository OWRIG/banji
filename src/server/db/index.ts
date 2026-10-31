import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
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

// 连接时自动把数据库升级到最新结构（执行 drizzle/ 里还没执行过的迁移文件）
migrate(db, { migrationsFolder: resolve(ROOT, "drizzle") })
