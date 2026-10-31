import { zValidator } from "@hono/zod-validator"
import { desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { db } from "@/server/db"
import { todos } from "@/server/db/schema"
import { createTodoSchema, todoIdSchema, updateTodoSchema } from "@/shared/todos"

// 示例接口：新功能照这个文件的写法来。
// 注意：必须像下面这样一路用 .get().post()... 串起来写，前端才能拿到接口的类型。
export const todosRoute = new Hono()
  .get("/", async (c) => {
    const rows = await db.select().from(todos).orderBy(desc(todos.id))
    return c.json(rows)
  })
  .post("/", zValidator("json", createTodoSchema), async (c) => {
    const [todo] = await db.insert(todos).values(c.req.valid("json")).returning()
    return c.json(todo, 201)
  })
  .patch("/:id", zValidator("param", todoIdSchema), zValidator("json", updateTodoSchema), async (c) => {
    const { id } = c.req.valid("param")
    const [todo] = await db.update(todos).set(c.req.valid("json")).where(eq(todos.id, id)).returning()
    if (!todo) return c.json({ message: "记录不存在" }, 404)
    return c.json(todo)
  })
  .delete("/:id", zValidator("param", todoIdSchema), async (c) => {
    const { id } = c.req.valid("param")
    const [todo] = await db.delete(todos).where(eq(todos.id, id)).returning()
    if (!todo) return c.json({ message: "记录不存在" }, 404)
    return c.json(todo)
  })
