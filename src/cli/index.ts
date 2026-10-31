import { readFileSync } from "node:fs"
import { Command } from "commander"

// banji：班级工作台的命令行。直接读写本机的数据库文件，网页服务没开也能用。
// 通用入口 `banji call <操作名> '<JSON 参数>'` 可以调用任何业务操作；其余命令是常用操作的简写。
//
// 注意：数据库模块在每个命令里按需导入（restore 必须在打开数据库之前执行）。

const ACTOR = "cli"
const program = new Command()
  .name("banji")
  .description("班级工作台命令行。所有修改都会记录，可以用 banji undo 撤销。")
  .showHelpAfterError()

async function core() {
  const [{ runOp, OpError }, { ops, findOp, opList }, { ensureDefaultRules }] = await Promise.all([
    import("@/server/ops/define"),
    import("@/server/ops/index"),
    import("@/server/ops/points"),
  ])
  await ensureDefaultRules()
  return { runOp, OpError, ops, findOp, opList }
}

/** ISO 时间 → 本地时间 "2026-11-02 08:15" */
function localTime(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function print(v: unknown) {
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2))
}

function fail(err: unknown): never {
  console.error((err as Error).message ?? String(err))
  process.exit(1)
}

type Outcome = { applied: boolean; confirm: string | null; changesetId: number | null; summary: string; data: unknown }

/** 执行操作并打印结果；危险操作先打印预览，--yes 时自动确认 */
async function exec(name: string, input: Record<string, unknown>, opts: { yes?: boolean; json?: boolean } = {}) {
  const { runOp, findOp } = await core()
  const op = findOp(name)
  if (!op) fail(`没有这个操作：${name}。用 banji ops 查看全部操作`)
  let out = (await runOp(op, input, { actor: ACTOR }).catch(fail)) as Outcome
  if (!out.applied) {
    print(out.data)
    if (!opts.yes) {
      console.log(`\n以上是预览，数据还没有改动。确认无误后执行：`)
      console.log(`  banji call ${name} '${JSON.stringify(input)}' --confirm ${out.confirm}`)
      return out
    }
    out = (await runOp(op, { ...input, confirm: out.confirm }, { actor: ACTOR }).catch(fail)) as Outcome
  }
  if (opts.json || op.kind === "read") print(out.data)
  if (out.summary) console.log(`✓ ${out.summary}`)
  if (out.changesetId && name !== "undo") console.log(`  （变更编号 ${out.changesetId}，撤销：banji undo）`)
  return out
}

program
  .command("ops")
  .description("列出全部业务操作")
  .action(async () => {
    const { opList } = await core()
    const kind = { read: "只读", write: "可撤销", danger: "需确认" }
    for (const op of opList) console.log(`${op.name.padEnd(22)} ${kind[op.kind]}  ${op.title}`)
    console.log("\n查看参数：banji describe <操作名>；调用：banji call <操作名> '<JSON 参数>'")
  })

program
  .command("describe <name>")
  .description("查看一个操作的说明和参数（JSON Schema）")
  .action(async (name: string) => {
    const { findOp } = await core()
    const { z } = await import("zod")
    const op = findOp(name)
    if (!op) fail(`没有这个操作：${name}`)
    print(`${op.title}（${op.kind}）\n${op.description}\n`)
    print(z.toJSONSchema(op.input, { io: "input" }))
  })

program
  .command("call <name> [json]")
  .description("调用任意业务操作。参数是 JSON，也可以用 - 从标准输入读取")
  .option("--confirm <code>", "危险操作的确认码")
  .option("-y, --yes", "危险操作：打印预览后直接确认")
  .action(async (name: string, json: string | undefined, opts: { confirm?: string; yes?: boolean }) => {
    const text = json === "-" ? readFileSync(0, "utf8") : (json ?? "{}")
    let input: Record<string, unknown>
    try {
      input = JSON.parse(text)
    } catch {
      fail("参数不是合法的 JSON")
    }
    if (opts.confirm) input.confirm = opts.confirm
    await exec(name, input, { yes: opts.yes, json: true })
  })

program
  .command("brief")
  .description("今日概览：各班待过关、今天的检查")
  .action(async () => {
    const { runOp, ops } = await core()
    const { data } = await runOp(ops["brief.today"], {}, { actor: ACTOR }).catch(fail)
    console.log(`${data.date}`)
    for (const c of data.classes) {
      console.log(`\n${c.name}（${c.code}）待过关 ${c.pending.length} 条`)
      const byStudent = new Map<string, string[]>()
      for (const p of c.pending) {
        const list = byStudent.get(p.student.name) ?? []
        list.push(`${p.check.title}${p.score != null ? `（${p.score}）` : ""}`)
        byStudent.set(p.student.name, list)
      }
      for (const [name, items] of byStudent) console.log(`  ${name}：${items.join("；")}`)
    }
    if (data.todayChecks.length) {
      console.log("\n今天的检查：")
      for (const c of data.todayChecks)
        console.log(`  ${c.title}：已录 ${c.stats.entered} 人，未达标 ${c.stats.failed}`)
    }
    console.log(`\n最近备份：${data.lastBackup ? localTime(data.lastBackup.createdAt) : "还没有"}`)
  })

program
  .command("pending [class]")
  .description("待过关名单")
  .action(async (cls: string | undefined) => {
    const { runOp, ops } = await core()
    const { data } = await runOp(ops["pending.list"], { class: cls }, { actor: ACTOR }).catch(fail)
    if (!data.length) return console.log("没有待过关的记录")
    for (const p of data)
      console.log(
        `#${p.resultId}  ${p.classCode}  ${p.student.name.padEnd(4, "　")}  ${p.check.title}  ${p.score ?? p.mark ?? ""}`,
      )
    console.log(`\n共 ${data.length} 条。销账：banji clear <编号...>`)
  })

program
  .command("clear <resultIds...>")
  .description("销账（已补过），参数是待过关名单里的编号")
  .option("--note <text>", "备注")
  .action(async (ids: string[], opts: { note?: string }) => {
    await exec("pending.clear", { resultIds: ids.map(Number), note: opts.note ?? "" })
  })

program
  .command("checks [class]")
  .description("检查场次列表")
  .action(async (cls: string | undefined) => {
    const { runOp, ops } = await core()
    const { data } = await runOp(ops["checks.list"], { class: cls, limit: 30 }, { actor: ACTOR }).catch(fail)
    for (const c of data) {
      const rate = c.stats.passRate == null ? "—" : `${Math.round(c.stats.passRate * 100)}%`
      console.log(
        `#${c.id}  ${c.classCode}  ${(c.date ?? "无日期").padEnd(10)}  ${c.title}  已录 ${c.stats.entered}  达标率 ${rate}  待过关 ${c.pending}`,
      )
    }
  })

program
  .command("record <check> <entries...>")
  .description("登记结果，例如：banji record 12 李明=95 王芳=请假 张三=过")
  .option("--class <class>", "班级（按标题指定检查时需要）")
  .action(async (check: string, entries: string[], opts: { class?: string }) => {
    const results = entries.map((e) => {
      const i = e.indexOf("=")
      if (i < 1) fail(`格式应为 姓名=结果：${e}`)
      return { student: e.slice(0, i), value: e.slice(i + 1) }
    })
    const ref = /^\d+$/.test(check) ? Number(check) : check
    await exec("checks.record", { check: ref, class: opts.class, results })
  })

program
  .command("add <rule> <students...>")
  .description("按规则加分/扣分，例如：banji add 课堂发言/答对 李明 王芳")
  .option("--class <class>", "班级")
  .option("--note <text>", "备注")
  .action(async (rule: string, students: string[], opts: { class?: string; note?: string }) => {
    await exec("points.add", { rule, students, class: opts.class, note: opts.note ?? "" })
  })

program
  .command("undo [changesetId]")
  .description("撤销最近一次操作（或指定变更编号）")
  .action(async (id: string | undefined) => {
    await exec("undo", { changesetId: id ? Number(id) : undefined })
  })

program
  .command("history")
  .description("最近的操作记录")
  .option("-n <count>", "条数", "20")
  .action(async (opts: { n: string }) => {
    const { runOp, ops } = await core()
    const { data } = await runOp(ops.history, { limit: Number(opts.n) }, { actor: ACTOR }).catch(fail)
    for (const h of data)
      console.log(
        `#${h.id}  ${localTime(h.createdAt)}  ${h.actor.padEnd(14)} ${h.undoneAt ? "[已撤销] " : ""}${h.summary}`,
      )
  })

program
  .command("import <file>")
  .description("导入名册（JSON，格式见 examples/roster.example.json）。先预览，--yes 直接确认")
  .option("-y, --yes", "打印预览后直接确认")
  .option("--deactivate-missing", "名单里没有的本班学生标记为离班")
  .action(async (file: string, opts: { yes?: boolean; deactivateMissing?: boolean }) => {
    const input = JSON.parse(readFileSync(file, "utf8"))
    if (opts.deactivateMissing) input.deactivateMissing = true
    await exec("roster.import", input, { yes: opts.yes })
  })

program
  .command("backup")
  .description("立即备份数据库")
  .action(async () => {
    const { createBackup } = await import("@/server/backup")
    const file = await createBackup("manual")
    console.log(file ? `已备份到 ${file}` : "还没有数据库文件")
  })

program
  .command("backups")
  .description("列出备份文件")
  .action(async () => {
    const { listBackups } = await import("@/server/backup")
    for (const b of listBackups()) console.log(`${localTime(b.createdAt)}  ${b.file}`)
  })

program
  .command("restore <file>")
  .description("用备份文件替换当前数据（请先停止网页服务）。替换前会自动备份当前数据")
  .action(async (file: string) => {
    const { restoreBackup } = await import("@/server/backup")
    const out = await restoreBackup(file).catch(fail)
    console.log(`已恢复：${out.restoredFrom}`)
    if (out.previousBackup) console.log(`恢复前的数据已备份到：${out.previousBackup}`)
    // 打开一次数据库，把旧备份升级到当前表结构
    await import("@/server/db")
    console.log("数据库结构已是最新。现在可以重新启动网页服务。")
  })

const auth = program.command("auth").description("账号")
auth
  .command("reset-password <email> <password>")
  .description("重置密码（忘记密码时用），所有设备需要重新登录")
  .action(async (email: string, password: string) => {
    const { resetPassword } = await import("@/server/auth")
    await resetPassword(email, password).catch(fail)
    console.log("密码已重置")
  })

const token = program.command("token").description("远程 agent 的访问令牌")
token
  .command("create <name>")
  .description("生成访问令牌（只显示一次）")
  .action(async (name: string) => {
    const { runOp, ops } = await core()
    const { data } = await runOp(ops["tokens.create"], { name }, { actor: ACTOR }).catch(fail)
    console.log(`令牌「${data.name}」：\n\n  ${data.token}\n\n只显示这一次，请马上保存。`)
  })
token
  .command("list")
  .description("列出访问令牌")
  .action(async () => {
    const { runOp, ops } = await core()
    const { data } = await runOp(ops["tokens.list"], {}, { actor: ACTOR }).catch(fail)
    for (const t of data)
      console.log(
        `#${t.id}  ${t.name}  ${t.revokedAt ? "已作废" : `最近使用 ${t.lastUsedAt ? localTime(t.lastUsedAt) : "从未"}`}`,
      )
  })

program
  .command("mcp")
  .description("以 stdio 方式启动 MCP 服务，供本机的 agent（Claude、Codex 等）连接")
  .option("--name <name>", "记录在操作日志里的 agent 名称", "agent")
  .action(async (opts: { name: string }) => {
    await core()
    const [{ createMcpServer }, { StdioServerTransport }] = await Promise.all([
      import("@/server/mcp"),
      import("@modelcontextprotocol/sdk/server/stdio.js"),
    ])
    await createMcpServer(`mcp:${opts.name}`).connect(new StdioServerTransport())
  })

await program.parseAsync()
