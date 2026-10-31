// 检查项（默写、背书……）的口径。前端显示和后端计算都用这一份，保证统计口径一致。

export const checkKinds = {
  dictation: "默写",
  recite: "背书",
  homework: "作业订正",
  other: "其他",
} as const
export type CheckKind = keyof typeof checkKinds

export const checkModes = { score: "分数登记", mark: "快速标记" } as const
export type CheckMode = keyof typeof checkModes

export const marks = {
  pass: "过",
  pass_retry: "二次过",
  fail: "未过",
  leave: "请假",
  exempt: "免",
} as const
export type Mark = keyof typeof marks

/** 一条结果的状态：达标 / 未达标 / 请假（不计入分母）/ 还没登记 */
export type ResultStatus = "passed" | "failed" | "leave" | "empty"

export function resultStatus(
  check: { passLine: number },
  r: { score: number | null; mark: string | null } | null | undefined,
): ResultStatus {
  if (!r) return "empty"
  if (r.mark === "pass" || r.mark === "pass_retry" || r.mark === "exempt") return "passed"
  if (r.mark === "leave") return "leave"
  if (r.mark === "fail") return "failed"
  if (r.score != null) return r.score >= check.passLine ? "passed" : "failed"
  return "empty"
}

const markAliases: Record<string, Mark> = {
  过: "pass",
  "✓": "pass",
  "√": "pass",
  pass: "pass",
  二次过: "pass_retry",
  未过: "fail",
  不过: "fail",
  "✕": "fail",
  "×": "fail",
  x: "fail",
  fail: "fail",
  请假: "leave",
  假: "leave",
  缺: "leave",
  缺考: "leave",
  leave: "leave",
  免: "exempt",
  exempt: "exempt",
}

/**
 * 把老师输入的一个格子解析成结果：数字是分数，"请假/免/过/未过" 等是标记，空白表示清除。
 * 返回 null 表示看不懂。
 */
export function parseResultValue(
  raw: string | number | null | undefined,
): { score: number | null; mark: Mark | null } | "clear" | null {
  if (raw == null) return "clear"
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? { score: raw, mark: null } : null
  const v = raw.trim()
  if (v === "") return "clear"
  const mark = markAliases[v] ?? markAliases[v.toLowerCase()]
  if (mark) return { score: null, mark }
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0) return { score: n, mark: null }
  return null
}

export type CheckStats = {
  entered: number
  counted: number
  passed: number
  failed: number
  leave: number
  full: number
  /** 达标率（0~1），没有可统计的人时为 null */
  passRate: number | null
}

export function checkStats(
  check: { passLine: number; fullScore: number },
  results: { score: number | null; mark: string | null }[],
): CheckStats {
  const s = { entered: 0, counted: 0, passed: 0, failed: 0, leave: 0, full: 0 }
  for (const r of results) {
    const st = resultStatus(check, r)
    if (st === "empty") continue
    s.entered++
    if (st === "leave") s.leave++
    else {
      s.counted++
      if (st === "passed") s.passed++
      else s.failed++
    }
    if (r.score != null && r.score >= check.fullScore) s.full++
  }
  return { ...s, passRate: s.counted ? s.passed / s.counted : null }
}

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

/** 姓名规整：去掉空白和 * 号（名单里的星号标记不做任何功能） */
export function cleanName(name: string) {
  return name.replace(/[\s*＊]/g, "")
}
