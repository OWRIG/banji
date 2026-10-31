import { listBackups } from "@/server/backup"
import { defineModule } from "@/server/core/module"
import { apiTokens } from "@/server/db/schema"
import { backupList, backupNow, createToken, history, listTokens, revokeToken, undo } from "./ops"

// 「系统」核心模块：撤销、操作记录、备份、访问令牌。

export const systemModule = defineModule({
  id: "system",
  title: "系统",
  description: "撤销、操作记录、备份、访问令牌",
  core: true,
  ops: [undo, history, backupNow, backupList, createToken, listTokens, revokeToken],
  tables: [apiTokens],
  brief: async () => {
    const last = listBackups()[0]
    return { lastBackup: last ? { name: last.name, createdAt: last.createdAt } : null }
  },
})
