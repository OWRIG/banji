// pnpm db:backup：把数据库完整复制一份到 data/backups/，服务运行中也可以安全执行。
// 注意：这里故意不导入 ./index，避免备份之前先执行了迁移。
import { existsSync, mkdirSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import Database from "better-sqlite3"
import { env } from "../env"

const source = env.DATABASE_URL
if (!existsSync(source)) {
  console.log(`还没有数据库文件（${source}），不需要备份`)
  process.exit(0)
}

const now = new Date()
const pad = (n: number) => String(n).padStart(2, "0")
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
const target = join(dirname(source), "backups", `${basename(source, extname(source))}-${stamp}.db`)

mkdirSync(dirname(target), { recursive: true })
const sqlite = new Database(source, { readonly: true })
await sqlite.backup(target)
sqlite.close()
console.log(`已备份到 ${target}`)
