import type { UseQueryResult } from "@tanstack/react-query"
import { cn } from "cn"
import type { ReactNode } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select"
import { useCurrentClass } from "@/web/lib/class"

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2.5 border-b pb-2.5">
      <div className="min-w-0 basis-full sm:flex-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-1.5">{actions}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
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
    <div className="no-print mb-3 inline-flex rounded-md border bg-card p-0.5 text-sm">
      {allowAll && (
        <button
          type="button"
          onClick={() => pick(null)}
          className={cn(
            "rounded px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground md:px-2.5 md:py-0.5",
            selected === null && "bg-muted font-medium text-foreground",
          )}
        >
          全部
        </button>
      )}
      {classes.map((c) => (
        <button
          key={c.code}
          type="button"
          onClick={() => pick(c.code)}
          className={cn(
            "rounded px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground md:px-2.5 md:py-0.5",
            selected === c.code && "bg-muted font-medium text-foreground",
          )}
        >
          {c.name}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "good" | "bad" | "brand" }) {
  return (
    <div className="inline-flex items-baseline gap-2 rounded-md border bg-card px-2.5 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-base font-semibold tracking-tight tabular-nums",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
          tone === "brand" && "text-brand",
        )}
      >
        {value}
      </span>
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

// Radix Select 不允许空字符串作为选项值，"不限/默认"这类选项用这个占位值代替
const NONE = "__none__"

/**
 * 下拉选择（统一样式，替代原生 select）。
 * options 的 value 可以是空字符串，表示"全部/默认"。
 */
export function Picker({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  label: string
  className?: string
}) {
  return (
    <Select value={value === "" ? NONE : value} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger size="sm" aria-label={label} className={cn("bg-card", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {options.map((o) => (
          <SelectItem key={o.value || NONE} value={o.value || NONE}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
