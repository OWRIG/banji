import { beforeAll, describe, expect, it } from "vitest"
import { runOp } from "@/server/core/define"
import { initModules, ops } from "@/server/registry"
import { rankOf, scoreStats } from "./shared"

const as = { actor: "test" }

const names5 = ["李明", "王芳", "张三", "赵四", "钱五"]
const roster = {
  classes: [
    {
      code: "705",
      name: "七5班",
      students: names5.map((name, i) => ({ studentNo: `7050${i + 1}`, name, gender: "男" })),
    },
    {
      code: "707",
      name: "七7班",
      students: ["孙一", "周二"].map((name, i) => ({ studentNo: `7070${i + 1}`, name, gender: "女" })),
    },
  ],
}

async function points(student: string) {
  const p = await runOp(ops["students.profile"], { student }, as)
  return p.data.sections.points?.net ?? 0
}

beforeAll(async () => {
  await initModules()
  const preview = await runOp(ops["roster.import"], roster, as)
  await runOp(ops["roster.import"], { ...roster, confirm: preview.confirm }, as)
})

describe("口径", () => {
  it("同分同名次", () => {
    const r = rankOf(
      new Map([
        ["a", 90],
        ["b", 95],
        ["c", 90],
        ["d", null],
        ["e", 80],
      ]),
    )
    expect([...r.entries()].sort()).toEqual([
      ["a", 2],
      ["b", 1],
      ["c", 2],
      ["e", 4],
    ])
  })

  it("按满分折算及格率、优秀率", () => {
    const s = scoreStats(120, [72, 71, 102, 110, null])
    expect(s.count).toBe(4)
    expect(s.passRate).toBe(0.75)
    expect(s.excellentRate).toBe(0.5)
    expect(s.median).toBe(87)
  })
})

describe("考试", () => {
  it("多科考试：数学满分 120，总分自动相加，请假不算总分", async () => {
    const out = await runOp(
      ops["exams.create"],
      {
        class: "705",
        type: "monthly",
        title: "9月阶段测试",
        date: "2026-09-28",
        subjects: [
          { name: "语文", full: 100 },
          { name: "数学", full: 120 },
          { name: "英语", full: 100 },
        ],
      },
      as,
    )
    expect(out.data).toHaveLength(1)
    await runOp(
      ops["exams.record"],
      {
        exam: "9月阶段测试",
        results: [
          { student: "李明", subject: "语文", value: 90 },
          { student: "李明", subject: "数学", value: 110 },
          { student: "李明", subject: "英语", value: 95 },
          { student: "王芳", subject: "语文", value: 80 },
          { student: "王芳", subject: "数学", value: "请假" },
          { student: "王芳", subject: "英语", value: 88 },
          { student: "李明", subject: "总分", classRank: 3, schoolRank: 40 },
        ],
      },
      as,
    )
    const d = (await runOp(ops["exams.get"], { exam: "9月阶段测试" }, as)).data
    const li = d.rows.find((r) => r.student.name === "李明")
    const wang = d.rows.find((r) => r.student.name === "王芳")
    expect(li?.cells.总分.score).toBe(295)
    // 导入的名次优先
    expect(li?.cells.总分.classRank).toBe(3)
    expect(li?.cells.总分.schoolRank).toBe(40)
    expect(wang?.cells.数学.status).toBe("leave")
    expect(wang?.cells.总分.score).toBeNull()
    expect(d.stats.find((s) => s.subject === "数学")?.full).toBe(120)
  })

  it("参数不对：超过满分、看不懂、科目不存在、直接填总分", async () => {
    const rec = (results: object[]) => runOp(ops["exams.record"], { exam: "9月阶段测试", results }, as)
    await expect(rec([{ student: "张三", subject: "数学", value: 130 }])).rejects.toThrow(/超过了满分/)
    await expect(rec([{ student: "张三", subject: "数学", value: "优" }])).rejects.toThrow(/看不懂/)
    await expect(rec([{ student: "张三", subject: "物理", value: 80 }])).rejects.toThrow(/没有科目/)
    await expect(rec([{ student: "张三", subject: "总分", value: 300 }])).rejects.toThrow(/各科相加/)
    await expect(runOp(ops["exams.get"], { exam: "不存在的考试" }, as)).rejects.toThrow(/找不到/)
  })

  it("撤销登记", async () => {
    const out = await runOp(
      ops["exams.record"],
      { exam: "9月阶段测试", results: [{ student: "张三", subject: "英语", value: 70 }] },
      as,
    )
    await runOp(ops.undo, { changesetId: out.changesetId ?? undefined }, as)
    const d = (await runOp(ops["exams.get"], { exam: "9月阶段测试" }, as)).data
    expect(d.rows.find((r) => r.student.name === "张三")?.cells.英语.score).toBeNull()
  })

  it("已有成绩的科目不能删", async () => {
    await expect(
      runOp(ops["exams.update"], { exam: "9月阶段测试", subjects: [{ name: "语文", full: 100 }] }, as),
    ).rejects.toThrow(/已经有成绩/)
    const up = await runOp(
      ops["exams.update"],
      {
        exam: "9月阶段测试",
        subjects: [
          { name: "语文", full: 100 },
          { name: "数学", full: 120 },
          { name: "英语", full: 100 },
          { name: "道法", full: 50, inTotal: false },
        ],
      },
      as,
    )
    expect(up.data?.subjects).toHaveLength(4)
    await runOp(ops.undo, { changesetId: up.changesetId ?? undefined }, as)
    const d = (await runOp(ops["exams.get"], { exam: "9月阶段测试" }, as)).data
    expect(d.exam.subjects).toHaveLength(3)
  })
})

describe("考后分析", () => {
  const u1 = { 李明: 90, 王芳: 60, 张三: 75, 赵四: 50, 钱五: 85 }
  const u2 = { 李明: 80, 王芳: 85, 张三: 76, 赵四: 58, 钱五: 84 }

  beforeAll(async () => {
    for (const [title, data, date] of [
      ["U1", u1, "2026-10-01"],
      ["U2", u2, "2026-10-15"],
    ] as const) {
      await runOp(ops["exams.create"], { class: ["705", "707"], title, date }, as)
      await runOp(
        ops["exams.record"],
        { exam: title, class: "705", results: Object.entries(data).map(([student, value]) => ({ student, value })) },
        as,
      )
    }
    await runOp(
      ops["exams.record"],
      {
        exam: "U2",
        class: "707",
        results: [
          { student: "孙一", value: 70 },
          { student: "周二", value: 90 },
        ],
      },
      as,
    )
  })

  it("两个班同名考试必须指定班级", async () => {
    await expect(runOp(ops["exams.get"], { exam: "U2" }, as)).rejects.toThrow(/多场/)
  })

  it("进退步、临界生、同卷对比", async () => {
    const a = (await runOp(ops["exams.analyze"], { exam: "U2", class: "705", by: "score" }, as)).data
    expect(a.subject).toBe("英语")
    // 默认和同班上一场比
    expect(a.progress?.compareExam.title).toBe("U1")
    expect(a.progress?.improved.map((r) => r.student.name)).toEqual(["王芳", "赵四", "张三"])
    expect(a.progress?.declined[0].student.name).toBe("李明")
    // 临界：及格线 60 以下 10 分以内；优秀线 85 以下 10 分以内
    expect(a.borderline.pass.map((r) => r.student.name)).toEqual(["赵四"])
    expect(a.borderline.excellent.map((r) => r.student.name).sort()).toEqual(["张三", "李明", "钱五"].sort())
    // 同卷的七7班
    expect(a.peers).toHaveLength(1)
    expect(a.peers[0].className).toBe("七7班")
    expect(a.peers[0].subjects[0].theirs.avg).toBe(80)
    expect(a.peers[0].subjects[0].avgDiff).toBeCloseTo(76.6 - 80)
  })

  it("进步奖励：只加一次，重做替换名单，删除考试时撤销", async () => {
    const before = await points("王芳")
    const award = { exam: "U2", class: "705", by: "score" as const, top: 2 }
    const out = await runOp(ops["exams.awardProgress"], award, as)
    expect(out.data.winners.map((w) => w.student.name)).toEqual(["王芳", "赵四"])
    expect(await points("王芳")).toBe(before + 2)

    // 再来一次：不重复加分
    await runOp(ops["exams.awardProgress"], award, as)
    expect(await points("王芳")).toBe(before + 2)

    // 改成只奖励 1 人：赵四的分撤销
    const zhao = await points("赵四")
    await runOp(ops["exams.awardProgress"], { ...award, top: 1 }, as)
    expect(await points("赵四")).toBe(zhao - 2)

    // 撤销上一步：赵四的分回来
    await runOp(ops.undo, {}, as)
    expect(await points("赵四")).toBe(zhao)

    // 删除对比用的 U1：奖励一起撤销
    const preview = await runOp(ops["exams.delete"], { exam: "U1", class: "705" }, as)
    expect(preview.applied).toBe(false)
    expect(await points("王芳")).toBe(before + 2)
    await runOp(ops["exams.delete"], { exam: "U1", class: "705", confirm: preview.confirm }, as)
    expect(await points("王芳")).toBe(before)
  })

  it("学生档案里有考试趋势", async () => {
    const p = (await runOp(ops["students.profile"], { student: "李明" }, as)).data
    const h = p.sections.exams?.history ?? []
    expect(h.map((x) => x.title)).toEqual(["9月阶段测试", "U2"])
    expect(h[1]).toMatchObject({ score: 80, full: 100, rank: 3 })
  })
})
