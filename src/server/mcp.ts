import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { OpError, runOp } from "./core/define"
import { availableOps, disabledModules, modules } from "./registry"

// 把业务操作注册成 MCP 工具。stdio（banji mcp）和 HTTP（/mcp）共用这一份。

const baseInstructions = `这是一位老师的「班级工作台」，记录班级名册、默写/背书等检查、待过关名单和学生积分。

使用约定：
- 学生可以直接用姓名或学号指代；有重名或对不上时工具会报错并列出候选，请让老师确认，不要猜。
- 写操作执行后会返回 changesetId，老师说“撤销”时调用 undo。
- 危险操作（导入名册、删除检查）第一次调用只返回预览和 confirm 码：把预览讲给老师听，老师确认后再带 confirm 调用。
- 统计口径：默写过关线默认 80；“请假”不计入达标率；未达标且没销账的记录就是待过关名单。
- 成绩、积分排名只供老师本人参考，不要建议公开排名，也不要把学生信息发到其他服务。
- 每天开始工作时可以先调用 brief_today。`

const kindHint = {
  read: "【只读】",
  write: "【会修改数据，可撤销】",
  danger: "【危险操作：先不带 confirm 调用拿到预览，老师确认后再带 confirm 调用】",
} as const

export async function createMcpServer(actor: string) {
  const off = await disabledModules()
  const enabled = modules.filter((m) => m.core || !off.has(m.id))
  const instructions = `${baseInstructions}\n\n已启用的功能：\n${enabled.map((m) => `- ${m.title}：${m.description}`).join("\n")}`
  const server = new McpServer({ name: "banji", version: "0.1.0" }, { instructions })

  // 只注册已启用模块的操作
  for (const op of await availableOps()) {
    if (op.hideFromMcp) continue
    server.registerTool(
      op.name.replaceAll(".", "_"),
      {
        title: op.title,
        description: `${kindHint[op.kind]}${op.title}。${op.description}`,
        inputSchema: op.input.shape,
        annotations: { readOnlyHint: op.kind === "read", destructiveHint: op.kind === "danger" },
      },
      async (args) => {
        try {
          const out = await runOp(op, args, { actor })
          return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 1) }] }
        } catch (err) {
          const message = err instanceof OpError ? err.message : `出错了：${(err as Error).message}`
          return { content: [{ type: "text" as const, text: message }], isError: true }
        }
      },
    )
  }

  server.registerPrompt(
    "weekly_report",
    { title: "本周班级周报", description: "汇总本周的默写过关、待过关、积分情况，写成给老师自己看的周报" },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "请用 brief_today、checks_list、pending_list、points_leaderboard（period=week）汇总本周情况，写一份简短周报：各班默写达标率变化、仍待过关的学生（特别是欠了多场的）、积分前几名和扣分较多的学生，最后给出下周需要重点关注的 3~5 件事。只给老师本人看，不要出现公开排名的建议。",
          },
        },
      ],
    }),
  )

  return server
}
