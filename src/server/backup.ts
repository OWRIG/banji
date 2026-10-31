import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import Database from "better-sqlite3"
import { env } from "./env"

// 备份相关的工具函数。故意不导入 ./db，这样备份、恢复都可以在数据库升级之前执行。

const pad = (n: number) => String(n).padStart(2, "0")
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export type BackupInfo = { file: string; name: string; size: number; createdAt: string }

/** 把数据库完整复制一份到备份目录。服务运行中也可以安全执行。返回备份文件路径；还没有数据库时返回 null */
export async function createBackup(reason = "manual", source = env.DATABASE_URL): Promise<string | null> {
  if (source === ":memory:" || !existsSync(source)) return null
  mkdirSync(env.BACKUP_DIR, { recursive: true })
  const target = join(env.BACKUP_DIR, `app-${stamp()}-${reason}.db`)
  const sqlite = new Database(source, { readonly: true })
  await sqlite.backup(target)
  sqlite.close()
  pruneBackups()
  return target
}

export function listBackups(): BackupInfo[] {
  if (!existsSync(env.BACKUP_DIR)) return []
  return readdirSync(env.BACKUP_DIR)
    .filter((f) => f.endsWith(".db"))
    .map((name) => {
      const file = join(env.BACKUP_DIR, name)
      const st = statSync(file)
      return { file, name, size: st.size, createdAt: st.mtime.toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 只保留最近 BACKUP_KEEP 份 */
export function pruneBackups() {
  for (const b of listBackups().slice(env.BACKUP_KEEP)) rmSync(b.file, { force: true })
}

/** 今天还没有自动备份时，备份一次。服务启动时和每小时调用 */
export async function dailyBackupIfNeeded() {
  const today = stamp().slice(0, 8)
  const done = listBackups().some((b) => b.name.startsWith(`app-${today}`) && b.name.includes("-daily"))
  if (!done) return createBackup("daily")
  return null
}

/**
 * 用备份文件替换当前数据库。必须在网页服务停止时执行（CLI：banji restore）。
 * 替换前会先把当前数据库备份一次；替换后下次连接时会自动升级表结构。
 */
export async function restoreBackup(file: string) {
  if (!existsSync(file)) throw new Error(`找不到备份文件：${file}`)
  const check = new Database(file, { readonly: true })
  const ok = check.pragma("integrity_check", { simple: true })
  const hasTables = check.prepare("select count(*) as n from sqlite_master where name = 'students'").get() as {
    n: number
  }
  check.close()
  if (ok !== "ok" || hasTables.n === 0) throw new Error("这个文件不是有效的班级工作台备份")

  const before = await createBackup("before-restore")
  for (const suffix of ["-wal", "-shm"]) rmSync(env.DATABASE_URL + suffix, { force: true })
  copyFileSync(file, env.DATABASE_URL)
  return { restoredFrom: basename(file), previousBackup: before }
}
