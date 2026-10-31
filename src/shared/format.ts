// 各模块通用的显示和日期小工具（前后端共用）

/** 显示用：最多保留 1 位小数 */
export function fmt(n: number | null | undefined) {
  if (n == null) return ""
  return String(Math.round(n * 10) / 10)
}

export function pct(n: number | null | undefined) {
  if (n == null) return "—"
  return `${Math.round(n * 1000) / 10}%`
}

/** 本地日期 YYYY-MM-DD */
export function today(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
