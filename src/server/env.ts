import { existsSync } from "node:fs"
import { z } from "zod"

// 可以在项目根目录放一个 .env 文件（参考 .env.example）；不放也能用下面的默认值跑起来
if (existsSync(".env")) process.loadEnvFile(".env")

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default("data/app.db"),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error(`环境变量配置有误：\n${z.prettifyError(parsed.error)}`)
  process.exit(1)
}

export const env = parsed.data
