import { zValidator } from "@hono/zod-validator"
import { desc, eq, like, or } from "drizzle-orm"
import { Hono } from "hono"
import { db } from "@/server/db"
import { customers } from "@/server/db/schema"
import { customerFormSchema, customerIdSchema, customerQuerySchema } from "@/shared/customers"

export const customersRoute = new Hono()
  .get("/", zValidator("query", customerQuerySchema), async (c) => {
    const { q } = c.req.valid("query")
    const rows = await db
      .select()
      .from(customers)
      .where(q ? or(like(customers.name, `%${q}%`), like(customers.contact, `%${q}%`)) : undefined)
      .orderBy(desc(customers.id))
    return c.json(rows)
  })
  .get("/:id", zValidator("param", customerIdSchema), async (c) => {
    const { id } = c.req.valid("param")
    const [customer] = await db.select().from(customers).where(eq(customers.id, id))
    if (!customer) return c.json({ message: "客户不存在" }, 404)
    return c.json(customer)
  })
  .post("/", zValidator("json", customerFormSchema), async (c) => {
    const [customer] = await db.insert(customers).values(c.req.valid("json")).returning()
    return c.json(customer, 201)
  })
  .put("/:id", zValidator("param", customerIdSchema), zValidator("json", customerFormSchema), async (c) => {
    const { id } = c.req.valid("param")
    const [customer] = await db.update(customers).set(c.req.valid("json")).where(eq(customers.id, id)).returning()
    if (!customer) return c.json({ message: "客户不存在" }, 404)
    return c.json(customer)
  })
  .delete("/:id", zValidator("param", customerIdSchema), async (c) => {
    const { id } = c.req.valid("param")
    const [customer] = await db.delete(customers).where(eq(customers.id, id)).returning()
    if (!customer) return c.json({ message: "客户不存在" }, 404)
    return c.json(customer)
  })
