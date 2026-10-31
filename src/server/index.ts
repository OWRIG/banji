import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { app, mcpApp } from "./app"
import { dailyBackupIfNeeded } from "./backup"
import { env } from "./env"
import { ensureDefaultRules } from "./ops/points"

await ensureDefaultRules()

const server = new Hono().route("/", app).route("/", mcpApp)
server.all("/api/*", (c) => c.json({ message: "接口不存在" }, 404))

// 上线运行（pnpm start）时，由这个进程同时提供前端页面；开发时前端由 Vite 提供
if (env.NODE_ENV === "production") {
  server.use("/*", serveStatic({ root: "./dist/web" }))
  server.get("*", serveStatic({ path: "./dist/web/index.html" }))
}

// 每日自动备份：启动时检查一次，之后每小时检查一次（当天已备份就跳过）
async function backupTick() {
  try {
    const file = await dailyBackupIfNeeded()
    if (file) console.log(`已自动备份：${file}`)
  } catch (err) {
    console.error("自动备份失败：", err)
  }
}
await backupTick()
setInterval(backupTick, 60 * 60 * 1000)

serve({ fetch: server.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  console.log(`服务已启动：http://${env.HOST === "0.0.0.0" ? "localhost" : env.HOST}:${info.port}`)
})
