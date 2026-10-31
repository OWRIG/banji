import { z } from "zod"

export const customerIdSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export const customerQuerySchema = z.object({
  q: z.string().trim().optional(),
})

// 新增和编辑共用同一份规则。选填的文字字段用空字符串表示“没填”，不用 null。
export const customerFormSchema = z.object({
  name: z.string().trim().min(1, "请填写客户名称").max(100, "最多 100 个字"),
  contact: z.string().trim().max(50, "最多 50 个字"),
  phone: z
    .string()
    .trim()
    .regex(/^[\d\-+ ]*$/, "电话只能包含数字、空格、+ 和 -"),
  note: z.string().trim().max(500, "最多 500 个字"),
})

export type CustomerFormInput = z.infer<typeof customerFormSchema>
