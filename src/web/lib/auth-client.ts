import { createAuthClient } from "better-auth/react"

// 登录、注册、退出、获取当前用户都通过它（接口地址默认是当前网站的 /api/auth）
export const authClient = createAuthClient()
