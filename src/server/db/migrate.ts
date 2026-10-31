// pnpm db:migrate：立即把数据库升级到最新结构。
// 导入 ./index 时就会执行迁移，这里只负责关闭连接并提示结果。
import { sqlite } from "./index"

sqlite.close()
console.log("数据库已是最新结构")
