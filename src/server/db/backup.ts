// pnpm db:backup：把数据库完整复制一份到备份目录，服务运行中也可以安全执行。
// 注意：这里故意不导入 ./index，避免备份之前先执行了迁移。
import { createBackup } from "../backup"
import { env } from "../env"

const target = await createBackup("manual")
console.log(target ? `已备份到 ${target}` : `还没有数据库文件（${env.DATABASE_URL}），不需要备份`)
