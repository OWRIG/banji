---
name: add-auth
description: 给项目加上登录功能（邮箱 + 密码注册登录、退出、未登录跳转到登录页、接口需要登录才能访问）。用户提到“登录”“账号”“只有自己人能看”“区分是谁提交的”时使用。
---

# 加上登录功能

使用 [Better Auth](https://www.better-auth.com)。加完之后：

- 所有页面都要先登录，没登录会跳到 `/login`（登录页可以注册新账号）；
- 所有业务接口都要登录才能访问，没登录返回 401；
- 接口里可以用 `c.get("user")` 拿到当前用户。

`references/` 里是验证过的完整代码，路径和项目一一对应。大部分文件可以直接复制，少数需要合并（下面标出）。

## 步骤

1. **安装**：`pnpm add better-auth`

2. **环境变量**：用 `references/src/server/env.ts` 替换 `src/server/env.ts`（如果项目里已经加过别的变量，合并进去）。并把下面这段追加到 `.env.example`：
   ```
   # 登录功能（上线运行时必填）
   # 密钥：运行 node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" 生成
   BETTER_AUTH_SECRET=
   # 大家在浏览器里访问这个系统的地址，必须完全一致，例如 http://10.0.0.8:3000
   BETTER_AUTH_URL=
   ```
   开发时不用设置；上线运行时没设置，服务会拒绝启动并提示。

3. **数据表**：把 `references/src/server/db/schema.ts` 里的四张表（user、session、account、verification）追加到 `src/server/db/schema.ts`，并按片段顶部的注释更新 import。然后：
   ```
   pnpm db:generate
   pnpm db:migrate
   ```
   这四张表是 Better Auth 官方命令生成的，不要改字段名。

4. **后端**：
   - 复制 `references/src/server/auth.ts` → `src/server/auth.ts`
   - 修改 `src/server/app.ts`，在 `/health` 后面加两行（`.use(requireAuth)` 以下的接口都需要登录）：
     ```ts
     import { auth, requireAuth } from "./auth"

     export const app = new Hono()
       .basePath("/api")
       .get("/health", (c) => c.json({ ok: true }))
       .on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw))
       // 这一行以下注册的接口都需要登录；不需要登录的接口放到这一行上面
       .use(requireAuth)
       .route("/todos", todosRoute)
     ```

5. **前端**：
   - 复制 `references/src/web/lib/auth-client.ts` → `src/web/lib/auth-client.ts`
   - 复制 `references/src/web/routes/login.tsx` → `src/web/routes/login.tsx`
   - `src/web/routes/__root.tsx`：参照 `references/src/web/routes/__root.tsx` 修改——加上登录判断、右上角用户名和“退出”按钮。**保留项目里已有的导航链接。**

6. **测试**：
   - 复制 `references/src/server/test-utils.ts` 和 `references/src/server/auth.test.ts` 到 `src/server/`
   - 现有的每个接口测试文件都改成“已登录”状态：把 `import { app } from "@/server/app"` 换成下面这段，再把文件里所有 `app.request(` 换成 `request(`：
     ```ts
     import { beforeAll, describe, expect, it } from "vitest"
     import { signedInRequest } from "@/server/test-utils"

     let request: Awaited<ReturnType<typeof signedInRequest>>
     beforeAll(async () => {
       request = await signedInRequest()
     })
     ```

7. `pnpm check` 全部通过后，启动 `pnpm dev`，让用户在浏览器里试一遍：注册 → 自动进入首页 → 退出 → 用错误密码登录（应提示“邮箱或密码错误”）→ 正确登录。

8. 更新 AGENTS.md 的「已启用的功能」一节，写上：已加登录（Better Auth），接口默认需要登录，当前用户用 `c.get("user")` 获取。

## 在接口里使用当前用户

```ts
import type { AuthEnv } from "@/server/auth"

export const expensesRoute = new Hono<AuthEnv>()
  .post("/", zValidator("json", createExpenseSchema), async (c) => {
    const user = c.get("user")
    const [expense] = await db.insert(expenses).values({ ...c.req.valid("json"), userId: user.id }).returning()
    return c.json(expense, 201)
  })
```

关联用户的字段写法：`userId: text("user_id").notNull().references(() => user.id)`（user 表的 id 是文字，不是数字）。

## 上线时

- `.env` 里必须设置 `BETTER_AUTH_SECRET` 和 `BETTER_AUTH_URL`。
- `BETTER_AUTH_URL` 必须和大家在浏览器地址栏里看到的地址完全一致（包括 http/https 和端口）。不一致会导致登录时报 “Invalid origin”。

## 以后

- 公司的统一登录（SSO）确定之后，可以用 Better Auth 的 Generic OAuth 插件接入，替换邮箱密码登录。先读官方文档，再和用户确认。
- 需要“管理员 / 普通用户”等权限区分时，先和用户确认有哪些角色、各能做什么，再动手。
