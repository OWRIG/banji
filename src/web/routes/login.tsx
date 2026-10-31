import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { Button } from "@/web/components/ui/button"
import { Input } from "@/web/components/ui/input"
import { authClient } from "@/web/lib/auth-client"

export const Route = createFileRoute("/login")({ component: LoginPage })

// 还没有任何账号时显示"创建账号"（第一个注册的人就是主人，之后自动关闭注册）；否则只能登录
function LoginPage() {
  const setup = useQuery({
    queryKey: ["setup"],
    queryFn: async () => (await fetch("/api/setup").then((r) => r.json())) as { hasUser: boolean },
  })
  const signUp = setup.data?.hasUser === false
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(undefined)
    const { error } = signUp
      ? await authClient.signUp.email({ name, email, password })
      : await authClient.signIn.email({ email, password, rememberMe: true })
    setPending(false)
    // 登录成功后 useSession 会自动更新，__root.tsx 会跳转到首页
    if (error) setError(errorMessages[error.code ?? ""] ?? error.message ?? "操作失败，请重试")
  }

  if (setup.isLoading) return null

  return (
    <div className="mx-auto mt-24 max-w-sm space-y-6 px-4">
      <div>
        <p className="text-sm font-medium text-gold">班级工作台</p>
        <h1 className="mt-1 text-2xl font-semibold">{signUp ? "创建账号" : "登录"}</h1>
        {signUp && (
          <p className="mt-2 text-sm text-muted-foreground">
            第一次使用：创建的账号就是这个工作台的主人，之后不再开放注册。
          </p>
        )}
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        {signUp && (
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="称呼，例如 王老师" required />
        )}
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" required />
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码（至少 8 位）"
          required
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {signUp ? "创建并进入" : "登录"}
        </Button>
      </form>
      {!signUp && (
        <p className="text-xs text-muted-foreground">忘记密码：在电脑上运行 banji auth reset-password 邮箱 新密码</p>
      )}
    </div>
  )
}

const errorMessages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码错误",
  USER_ALREADY_EXISTS: "这个邮箱已经注册过了",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "这个邮箱已经注册过了",
  PASSWORD_TOO_SHORT: "密码至少 8 位",
  INVALID_EMAIL: "邮箱格式不正确",
}
