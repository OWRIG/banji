import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { Empty, PageHeader, QueryState } from "@/web/components/common"
import { useDangerOp } from "@/web/components/danger"
import { Button } from "@/web/components/ui/button"
import { Input } from "@/web/components/ui/input"
import { Textarea } from "@/web/components/ui/textarea"
import { callOp, useOp, useOpMutation, useUndo } from "@/web/lib/ops"

export const Route = createFileRoute("/settings")({ component: SettingsPage })

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="数据与设置" />
      <BackupSection />
      <ModulesSection />
      <HistorySection />
      <RulesSection />
      <ImportSection />
      <TokenSection />
    </div>
  )
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false })
}

function BackupSection() {
  const list = useOp("backup.list", {})
  const create = useOpMutation("backup.create", { silent: true })
  return (
    <Section title="备份" desc="服务开着时每天自动备份一次，保留最近 30 份。建议每周再下载一份放到自己的电脑或网盘。">
      <div className="mb-3 flex flex-wrap gap-2">
        <Button asChild>
          <a href="/api/system/backup/download">下载备份文件</a>
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await create.mutateAsync({})
            toast.success("已备份")
          }}
        >
          立即备份
        </Button>
      </div>
      <QueryState query={list}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有备份</p>
          ) : (
            <ul className="max-h-48 overflow-auto text-sm text-muted-foreground">
              {rows.map((b) => (
                <li key={b.name} className="tabular-nums">
                  {fmtTime(b.createdAt)} · {b.name} · {(b.size / 1024).toFixed(0)} KB
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
      <p className="mt-3 text-xs text-muted-foreground">
        从备份恢复：停止服务后运行 banji restore 备份文件路径（恢复前会自动再备份一次当前数据）。
      </p>
    </Section>
  )
}

function ModulesSection() {
  const list = useOp("modules.list", {})
  const toggle = useOpMutation("modules.setEnabled")
  return (
    <Section
      title="功能模块"
      desc="用不到的功能可以停用：页面、首页内容、agent 工具都会隐藏，数据保留，随时可以重新启用。"
    >
      <QueryState query={list}>
        {(rows) => (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {rows.map((m) => (
              <div key={m.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                <div className="flex-1">
                  <div className={m.enabled ? "font-medium" : "font-medium text-muted-foreground"}>
                    {m.title}
                    {m.core && <span className="ml-2 text-xs font-normal text-muted-foreground">核心</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{m.description}</div>
                </div>
                {!m.core && (
                  <Button size="xs" variant="ghost" onClick={() => toggle.mutate({ id: m.id, enabled: !m.enabled })}>
                    {m.enabled ? "停用" : "启用"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </QueryState>
    </Section>
  )
}

function HistorySection() {
  const list = useOp("history", { limit: 30 })
  const undo = useUndo()
  return (
    <Section
      title="操作记录"
      desc="网页、命令行、agent 的每一次修改都在这里。可以撤销；如果之后数据又被改过，会提示不能直接撤销。"
    >
      <QueryState query={list}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有操作</p>
          ) : (
            <div className="max-h-80 overflow-auto text-sm">
              {rows.map((h) => (
                <div key={h.id} className="flex items-center gap-3 border-t py-1.5 first:border-t-0">
                  <span className="w-36 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {fmtTime(h.createdAt)}
                  </span>
                  <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{h.actor}</span>
                  <span className={`flex-1 ${h.undoneAt ? "text-muted-foreground line-through" : ""}`}>
                    {h.summary}
                  </span>
                  {!h.undoneAt && h.opName !== "undo" && (
                    <Button size="xs" variant="ghost" onClick={() => undo(h.id)}>
                      撤销
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )
        }
      </QueryState>
    </Section>
  )
}

function RulesSection() {
  const rules = useOp("rules.list", { includeDisabled: true })
  const save = useOpMutation("rules.save")

  return (
    <Section
      title="自动加分"
      desc="加分由系统按这些规则自动结算，同一件事只加一次。停用后已加的分会撤销，重新启用会补回；改分值会重新结算。"
    >
      <QueryState query={rules}>
        {(rows) => (
          <div className="divide-y rounded-md border">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className={r.enabled ? "font-medium" : "text-muted-foreground line-through"}>{r.name}</div>
                  {r.autoLabel && <div className="text-xs text-muted-foreground">{r.autoLabel}</div>}
                </div>
                <Input
                  key={`${r.id}-${r.delta}`}
                  defaultValue={String(r.delta)}
                  inputMode="numeric"
                  aria-label={`${r.name} 分值`}
                  className="h-7 w-14 text-right tabular-nums"
                  onBlur={(e) => {
                    const n = Number(e.currentTarget.value)
                    if (Number.isInteger(n) && n !== 0 && n !== r.delta) save.mutate({ id: r.id, delta: n })
                  }}
                />
                <Button size="xs" variant="ghost" onClick={() => save.mutate({ id: r.id, enabled: !r.enabled })}>
                  {r.enabled ? "停用" : "启用"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </QueryState>
    </Section>
  )
}

const importExample = `{
  "classes": [
    {
      "code": "705",
      "name": "七5班",
      "roles": "班主任,英语",
      "students": [
        { "studentNo": "70501", "name": "张三", "gender": "男", "group": "1" }
      ]
    }
  ]
}`

function ImportSection() {
  const [text, setText] = useState("")
  const imp = useDangerOp("roster.import", {
    title: "确认导入名册",
    describe: (report) => (
      <div className="space-y-3">
        {report.map((r) => (
          <div key={r.class}>
            <div className="font-medium">
              {r.class}
              {r.classCreated ? "（新班级）" : ""}：导入后共 {r.total} 人
            </div>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {r.created.length > 0 && (
                <li>
                  新增 {r.created.length} 人：{r.created.join("、")}
                </li>
              )}
              {r.updated.length > 0 && (
                <li>
                  更新 {r.updated.length} 人：{r.updated.join("、")}
                </li>
              )}
              {r.deactivated.length > 0 && (
                <li>
                  离班 {r.deactivated.length} 人：{r.deactivated.join("、")}
                </li>
              )}
              {r.groups.length > 0 && <li>分组：{r.groups.join("、")}</li>}
              {r.warnings.map((w) => (
                <li key={w} className="text-destructive">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    ),
    onDone: () => setText(""),
  })

  function preview() {
    try {
      void imp.start(JSON.parse(text))
    } catch {
      toast.error("内容不是合法的 JSON")
    }
  }

  return (
    <Section
      title="导入名册"
      desc="Excel 名单格式五花八门，最省事的办法是让 agent 读你的 Excel，整理成下面的格式再导入（或者 agent 直接调用导入工具）。只需要学号、姓名、性别、小组，不要导入家长信息和身份证号。"
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={importExample}
        className="h-48 font-mono text-xs"
      />
      <div className="mt-2 flex gap-2">
        <Button onClick={preview} disabled={!text.trim()}>
          预览导入
        </Button>
        <Button variant="ghost" onClick={() => setText(importExample)}>
          填入示例格式
        </Button>
      </div>
      {imp.dialog}
    </Section>
  )
}

function TokenSection() {
  const list = useOp("tokens.list", {})
  const revoke = useOpMutation("tokens.revoke")
  const [name, setName] = useState("")
  const [created, setCreated] = useState<string | null>(null)
  const mcpUrl = `${window.location.origin}/mcp`

  async function create(e: FormEvent) {
    e.preventDefault()
    try {
      const out = await callOp("tokens.create", { name })
      setCreated(out.data.token)
      setName("")
      await list.refetch()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <Section
      title="远程 agent 访问"
      desc="让 Claude、Codex 等 agent 通过网络操作工作台（MCP）。在本机的 agent 也可以不用令牌，直接运行 banji mcp。"
    >
      <div className="mb-3 rounded-md bg-muted px-3 py-2 font-mono text-xs">
        MCP 地址：{mcpUrl}
        <br />
        请求头：Authorization: Bearer &lt;令牌&gt;
      </div>
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="令牌名称，例如 我的 Claude"
          className="h-8 w-56"
          required
        />
        <Button size="sm" type="submit">
          生成令牌
        </Button>
      </form>
      {created && (
        <div className="mt-3 rounded-md border border-gold bg-accent px-3 py-2 text-sm">
          <div className="mb-1 font-medium">令牌只显示这一次，请马上复制保存：</div>
          <code className="break-all text-xs">{created}</code>
        </div>
      )}
      <QueryState query={list}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="mt-3">
              <Empty>还没有令牌</Empty>
            </div>
          ) : (
            <ul className="mt-3 text-sm">
              {rows.map((t) => (
                <li key={t.id} className="flex items-center gap-3 border-t py-1.5 first:border-t-0">
                  <span className={t.revokedAt ? "text-muted-foreground line-through" : ""}>{t.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.lastUsedAt ? `最近使用 ${fmtTime(t.lastUsedAt)}` : "从未使用"}
                  </span>
                  {!t.revokedAt && (
                    <Button size="xs" variant="ghost" className="ml-auto" onClick={() => revoke.mutate({ id: t.id })}>
                      作废
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Section>
  )
}
