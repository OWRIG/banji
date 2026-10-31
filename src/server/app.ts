import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { todosRoute } from "./routes/todos"

// 所有接口都挂在 /api 下。新增的接口文件在这里用 .route() 串上去。
export const app = new Hono()
  .basePath("/api")
  .get("/health", (c) => c.json({ ok: true }))
  .route("/todos", todosRoute)

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  console.error(err)
  return c.json({ message: "服务器出错了" }, 500)
})

// 前端通过这个类型获得所有接口的类型提示（见 src/web/lib/api.ts）
export type AppType = typeof app
