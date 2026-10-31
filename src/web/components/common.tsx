import type { UseQueryResult } from "@tanstack/react-query"
import { cn } from "cn"
import type { ReactNode } from "react"
import { useCurrentClass } from "@/web/lib/class"

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

/** 列表三种状态：加载中、出错、有数据 */
export function QueryState<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isLoading) return <p className="text-sm text-muted-foreground">加载中…</p>
  if (query.isError) return <p className="text-sm text-destructive">加载失败：{query.error.message}</p>
  if (query.data === undefined) return null
  return <>{children(query.data)}</>
}

/** 班级切换：所有按班查看的页面共用，选择会被记住 */
export function ClassTabs({
  allowAll,
  value,
  onChange,
}: {
  allowAll?: boolean
  value?: string | null
  onChange?: (code: string | null) => void
}) {
  const { classes, current, setCode } = useCurrentClass()
  const selected = value !== undefined ? value : (current?.code ?? null)
  const pick = (code: string | null) => {
    if (code) setCode(code)
    onChange?.(code)
  }
  if (classes.length < 2 && !allowAll) return null
  return (
    <div className="no-print mb-4 inline-flex rounded-lg border bg-card p-0.5 text-sm">
      {allowAll && (
        <button
          type="button"
          onClick={() => pick(null)}
          className={cn("rounded-md px-3 py-1", selected === null && "bg-primary text-primary-foreground")}
        >
          全部
        </button>
      )}
      {classes.map((c) => (
        <button
          key={c.code}
          type="button"
          onClick={() => pick(c.code)}
          className={cn("rounded-md px-3 py-1", selected === c.code && "bg-primary text-primary-foreground")}
        >
          {c.name}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "good" | "bad" | "gold" }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
          tone === "gold" && "text-gold",
        )}
      >
        {value}
      </div>
    </div>
  )
}

/** 积分显示：+3 / -1 / 0 */
export function Delta({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("tabular-nums", n > 0 && "text-success", n < 0 && "text-destructive", className)}>
      {n > 0 ? `+${n}` : n}
    </span>
  )
}
