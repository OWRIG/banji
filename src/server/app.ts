import { createReadStream, existsSync } from "node:fs"
import { Readable } from "node:stream"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { type AuthEnv, auth, hasAnyUser, requireAuth } from "./auth"
import { createBackup } from "./backup"
import { createMcpServer } from "./mcp"
import { OpError, runOp } from "./ops/define"
import { findOp } from "./ops/index"
import { verifyToken } from "./ops/system"

// 业务接口只有一个入口：POST /api/ops/<操作名>，请求体就是操作的参数。
// 业务规则全部在 ops/ 里；前端用 src/web/lib/ops.ts 调用，参数和返回值都有类型。

const opsRoute = new Hono<AuthEnv>().post("/:name", async (c) => {
  const op = findOp(c.req.param("name"))
  if (!op) return c.json({ message: "接口不存在" }, 404)
  const body = await c.req.json().catch(() => ({}))
  const out = await runOp(op, body, { actor: `web:${c.get("user").name}` })
  return c.json(out)
})

const systemRoute = new Hono<AuthEnv>().get("/backup/download", async (c) => {
  const file = await createBackup("download")
  if (!file || !existsSync(file)) return c.json({ message: "当前没有可下载的数据库" }, 404)
  const name = file.split("/").pop() ?? "backup.db"
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  })
})

export const app = new Hono()
  .basePath("/api")
  .get("/health", (c) => c.json({ ok: true }))
  // 登录页用：还没有任何账号时显示"创建账号"
  .get("/setup", async (c) => c.json({ hasUser: await hasAnyUser() }))
  .on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw))
  // 这一行以下注册的接口都需要登录；不需要登录的接口放到这一行上面
  .use(requireAuth)
  .route("/ops", opsRoute)
  .route("/system", systemRoute)

app.onError((err, c) => {
  if (err instanceof OpError) return c.json({ message: err.message, details: err.details }, err.status)
  if (err instanceof HTTPException) return err.getResponse()
  console.error(err)
  return c.json({ message: "服务器出错了" }, 500)
})

// 远程 agent 用的 MCP 入口：Authorization: Bearer <访问令牌>（在网页「设置」里生成）
// 无状态模式：每个请求新建一个 MCP 服务实例，不需要保存会话
export const mcpApp = new Hono().all("/mcp", async (c) => {
  const header = c.req.header("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
  const name = token ? await verifyToken(token) : null
  if (!name) return c.json({ message: "访问令牌无效或已作废" }, 401)
  const server = createMcpServer(`mcp:${name}`)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return transport.handleRequest(c.req.raw)
})

export type AppType = typeof app
