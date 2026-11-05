// 检查项（默写、背书……）的口径。前端显示和后端计算都用这一份，保证统计口径一致。

export const checkKinds = {
  dictation: "默写",
  recite: "背书",
  homework: "作业订正",
  other: "其他",
} as const
export type CheckKind = keyof typeof checkKinds

/** 登记截止日统一按北京时间计算，不受服务器所在时区影响。 */
export function checkDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

export const checkModes = { score: "分数登记", mark: "快速标记", level: "分等级" } as const
export type CheckMode = keyof typeof checkModes

export const marks = {
  pass: "过",
  pass_retry: "二次过",
  fail: "未过",
  copy: "抄书",
  read: "读书",
  partial: "背部分",
  full: "全背",
  leave: "请假",
  exempt: "免",
} as const
export type Mark = keyof typeof marks

/** 背书的等级，从低到高。判定过关时只有「全背」算过关 */
export const levels = ["copy", "read", "partial", "full"] as const satisfies Mark[]

/** 每种登记方式能用哪些标记（分数登记时还可以填数字） */
export const modeMarks: Record<CheckMode, Mark[]> = {
  score: ["leave", "exempt", "pass", "fail"],
  mark: ["pass", "pass_retry", "fail", "leave", "exempt"],
  level: [...levels, "leave", "exempt"],
}

/** 新建检查时的默认登记方式：背书默认快速标记，其他登记分数 */
export function defaultMode(kind: string): CheckMode {
  return kind === "recite" ? "mark" : "score"
}

/** 背书简洁勾选模式下：勾选写入的标记 */
export function reciteTickValue(mode: string): "全背" | "过" {
  return mode === "level" ? "全背" : "过"
}

/** 背书简洁勾选模式下：一条结果是否算已完成（已背） */
export function isReciteDone(
  mode: string,
  r: { score: number | null; mark: string | null } | null | undefined,
): boolean {
  if (!r?.mark) return false
  if (mode === "level") return r.mark === "full"
  return r.mark === "pass" || r.mark === "pass_retry"
}

/** 显示一条结果：分数，或者"请假/过/全背"等标记 */
export function resultText(r: { score: number | null; mark: string | null } | null | undefined) {
  if (!r) return ""
  if (r.mark) return marks[r.mark as Mark] ?? r.mark
  return r.score == null ? "" : String(Math.round(r.score * 10) / 10)
}

/**
 * 一条结果的状态：达标 / 未达标 / 请假（不计入分母）/ 已登记（这场检查不判定过关）/ 还没登记。
 * 只有「判定过关」的检查才会出现未达标，进入待过关名单。
 */
export type ResultStatus = "passed" | "failed" | "leave" | "recorded" | "empty"

export function resultStatus(
  check: { passLine: number; requirePass: boolean },
  r: { score: number | null; mark: string | null } | null | undefined,
): ResultStatus {
  if (!r || (r.mark == null && r.score == null)) return "empty"
  if (r.mark === "leave") return "leave"
  if (!check.requirePass) return "recorded"
  if (r.mark === "pass" || r.mark === "pass_retry" || r.mark === "exempt" || r.mark === "full") return "passed"
  if (r.mark) return "failed"
  return (r.score ?? 0) >= check.passLine ? "passed" : "failed"
}

const markAliases: Record<string, Mark> = {
  过: "pass",
  "✓": "pass",
  "√": "pass",
  pass: "pass",
  二次过: "pass_retry",
  抄书: "copy",
  抄: "copy",
  读书: "read",
  读: "read",
  背部分: "partial",
  部分: "partial",
  全背: "full",
  背出: "full",
  全: "full",
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
  /** 达标率（0~1）；不判定过关、或没有可统计的人时为 null */
  passRate: number | null
  /** 平均分（只算有分数的） */
  avg: number | null
  /** 各等级人数（分等级时用） */
  levels: Partial<Record<Mark, number>>
}

export function checkStats(
  check: { passLine: number; fullScore: number; requirePass: boolean },
  results: { score: number | null; mark: string | null }[],
): CheckStats {
  const s = { entered: 0, counted: 0, passed: 0, failed: 0, leave: 0, full: 0 }
  const levelCounts: Partial<Record<Mark, number>> = {}
  const scores: number[] = []
  for (const r of results) {
    const st = resultStatus(check, r)
    if (st === "empty") continue
    s.entered++
    if (st === "leave") s.leave++
    else {
      s.counted++
      if (st === "passed") s.passed++
      if (st === "failed") s.failed++
    }
    if (r.score != null) scores.push(r.score)
    if (r.score != null && r.score >= check.fullScore) s.full++
    if (r.mark && (levels as readonly string[]).includes(r.mark)) {
      levelCounts[r.mark as Mark] = (levelCounts[r.mark as Mark] ?? 0) + 1
    }
  }
  return {
    ...s,
    passRate: check.requirePass && s.counted ? s.passed / s.counted : null,
    avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    levels: levelCounts,
  }
}
