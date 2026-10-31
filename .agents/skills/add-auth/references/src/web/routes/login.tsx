import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { Button } from "@/web/components/ui/button"
import { Input } from "@/web/components/ui/input"
import { authClient } from "@/web/lib/auth-client"

export const Route = createFileRoute("/login")({ component: LoginPage })

function LoginPage() {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(undefined)
    const { error } =
      mode === "signIn"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ name, email, password })
    setPending(false)
    // 登录成功后 useSession 会自动更新，__root.tsx 会跳转到首页
    if (error) setError(errorMessages[error.code ?? ""] ?? error.message ?? "操作失败，请重试")
  }

  return (
    <div className="mx-auto mt-24 max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">{mode === "signIn" ? "登录" : "注册"}</h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === "signUp" && (
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名" required />
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
          {mode === "signIn" ? "登录" : "注册"}
        </Button>
      </form>
      <button
        type="button"
        className="text-sm text-muted-foreground underline"
        onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}
      >
        {mode === "signIn" ? "没有账号？注册一个" : "已有账号？去登录"}
      </button>
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
