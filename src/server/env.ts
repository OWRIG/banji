import { existsSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"

// 项目根目录。CLI 可能在任何目录下运行，所以相对路径都以项目根目录为准，而不是当前目录
export const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// 可以在项目根目录放一个 .env 文件（参考 .env.example）；不放也能用下面的默认值跑起来
const envFile = resolve(ROOT, ".env")
if (existsSync(envFile)) process.loadEnvFile(envFile)

const fromRoot = (p: string) => (p === ":memory:" || isAbsolute(p) ? p : resolve(ROOT, p))

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    // 默认只允许本机访问；需要手机或局域网访问时设为 0.0.0.0（Docker 里固定是 0.0.0.0）
    HOST: z.string().min(1).default("127.0.0.1"),
    DATABASE_URL: z.string().min(1).default("data/app.db").transform(fromRoot),
    // 每日自动备份的目录和保留份数
    BACKUP_DIR: z.string().min(1).default("data/backups").transform(fromRoot),
    BACKUP_KEEP: z.coerce.number().int().positive().default(30),
    // 登录功能：上线运行时这两项必须设置（见 .env.example），开发时可以不设
    BETTER_AUTH_SECRET: z.string().min(32, "至少 32 个字符").optional(),
    BETTER_AUTH_URL: z.url().optional(),
    // 额外允许的访问地址（逗号分隔），例如本地部署时手机用的 http://192.168.1.20:3000
    TRUSTED_ORIGINS: z
      .string()
      .default("")
      .transform((s) =>
        s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
  })
  .refine((e) => e.NODE_ENV !== "production" || (e.BETTER_AUTH_SECRET && e.BETTER_AUTH_URL), {
    message: "上线运行时必须在 .env 里设置 BETTER_AUTH_SECRET 和 BETTER_AUTH_URL",
  })

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error(`环境变量配置有误：\n${z.prettifyError(parsed.error)}`)
  process.exit(1)
}

export const env = parsed.data
