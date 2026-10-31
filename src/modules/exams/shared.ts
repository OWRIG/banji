// 考试成绩的口径（前后端共用）：及格 = 满分 60%，优秀 = 满分 85%，临界 = 线下 10% 满分以内。

export const examTypes = {
  unit: "单元检测",
  stage: "阶段测试",
  monthly: "月考",
  midterm: "期中",
  final: "期末",
  other: "其他",
} as const
export type ExamType = keyof typeof examTypes

export type Subject = { name: string; full: number; inTotal: boolean }

/** 总分这一"科"的名字。成绩表里这一行只存导入的总分名次 */
export const TOTAL = "总分"

export const PASS_RATE = 0.6
export const EXCELLENT_RATE = 0.85
export const BORDER_RATE = 0.1

export const scoreStatuses = { leave: "请假", absent: "缺考" } as const
export type ScoreStatus = keyof typeof scoreStatuses

const statusAliases: Record<string, ScoreStatus> = {
  请假: "leave",
  假: "leave",
  leave: "leave",
  缺考: "absent",
  缺: "absent",
  absent: "absent",
}

/** 解析一个成绩格子：数字是分数，请假/缺考是状态，空白表示清除；看不懂返回 null */
export function parseScoreValue(
  raw: string | number | null | undefined,
): { score: number | null; status: ScoreStatus | null } | "clear" | null {
  if (raw == null) return "clear"
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? { score: raw, status: null } : null
  const v = raw.trim()
  if (v === "") return "clear"
  const status = statusAliases[v] ?? statusAliases[v.toLowerCase()]
  if (status) return { score: null, status }
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0) return { score: n, status: null }
  return null
}

export function totalFull(subjects: Subject[]) {
  return subjects.filter((s) => s.inTotal).reduce((a, s) => a + s.full, 0)
}

/** 有两科以上计入总分时才有「总分」这一列（单科考试的总分就是这一科，不重复显示） */
export function hasTotal(subjects: Subject[]) {
  return subjects.filter((s) => s.inTotal).length >= 2
}

/** 默认看哪一科：有总分看总分，否则看第一科 */
export function mainSubject(subjects: Subject[]) {
  return hasTotal(subjects) ? TOTAL : subjects[0].name
}

/** 某一"科"（包括总分）的满分 */
export function fullOf(subjects: Subject[], subject: string) {
  if (subject === TOTAL) return totalFull(subjects)
  return subjects.find((s) => s.name === subject)?.full ?? 100
}

/** 计入总分的科目都有分数时才有总分（请假、缺考、没录完的不算总分） */
export function sumTotal(subjects: Subject[], scores: Record<string, number | null | undefined>) {
  const counted = subjects.filter((s) => s.inTotal)
  if (counted.length === 0) return null
  let sum = 0
  for (const s of counted) {
    const v = scores[s.name]
    if (v == null) return null
    sum += v
  }
  return sum
}

/** 名次：分数高的在前，同分同名次（1、2、2、4） */
export function rankOf<K>(values: Map<K, number | null>) {
  const sorted = [...values.entries()].filter((e): e is [K, number] => e[1] != null).sort((a, b) => b[1] - a[1])
  const ranks = new Map<K, number>()
  sorted.forEach(([k, v], i) => {
    ranks.set(k, i > 0 && sorted[i - 1][1] === v ? (ranks.get(sorted[i - 1][0]) as number) : i + 1)
  })
  return ranks
}

export type ScoreStats = {
  count: number
  avg: number | null
  median: number | null
  max: number | null
  min: number | null
  /** 及格率、优秀率（0~1） */
  passRate: number | null
  excellentRate: number | null
}

export function scoreStats(full: number, scores: (number | null | undefined)[]): ScoreStats {
  const xs = scores.filter((x): x is number => x != null).sort((a, b) => a - b)
  const n = xs.length
  if (n === 0) return { count: 0, avg: null, median: null, max: null, min: null, passRate: null, excellentRate: null }
  const mid = Math.floor(n / 2)
  return {
    count: n,
    avg: xs.reduce((a, b) => a + b, 0) / n,
    median: n % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2,
    max: xs[n - 1],
    min: xs[0],
    passRate: xs.filter((x) => x >= full * PASS_RATE).length / n,
    excellentRate: xs.filter((x) => x >= full * EXCELLENT_RATE).length / n,
  }
}

/** 分数档位，用于着色：<60% 偏低，≥85% 优秀 */
export function scoreLevel(score: number | null | undefined, full: number): "low" | "high" | null {
  if (score == null) return null
  if (score < full * PASS_RATE) return "low"
  if (score >= full * EXCELLENT_RATE) return "high"
  return null
}
