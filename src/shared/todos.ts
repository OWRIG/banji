import { z } from "zod"

// 前后端共用的校验规则：前端提交前用它检查，后端收到请求时也用它检查

export const todoIdSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export const createTodoSchema = z.object({
  title: z.string().trim().min(1, "请填写内容").max(200, "最多 200 个字"),
})

export const updateTodoSchema = z
  .object({
    title: createTodoSchema.shape.title,
    done: z.boolean(),
  })
  .partial()

export type CreateTodoInput = z.infer<typeof createTodoSchema>
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>
