import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { app } from "./app"
import { env } from "./env"

const server = new Hono().route("/", app)
server.all("/api/*", (c) => c.json({ message: "接口不存在" }, 404))

// 上线运行（pnpm start）时，由这个进程同时提供前端页面；开发时前端由 Vite 提供
if (env.NODE_ENV === "production") {
  server.use("/*", serveStatic({ root: "./dist/web" }))
  server.get("*", serveStatic({ path: "./dist/web/index.html" }))
}

serve({ fetch: server.fetch, port: env.PORT }, (info) => {
  console.log(`服务已启动：http://localhost:${info.port}`)
})
