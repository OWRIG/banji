import { useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import type { OpData, OpInput, OpName } from "@/server/ops/index"
import { Button } from "@/web/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog"
import { callOp, useUndo } from "@/web/lib/ops"

// 危险操作（删除、导入覆盖）：先调用一次拿到预览，弹窗让老师确认，再带确认码真正执行。

export function useDangerOp<N extends OpName>(
  name: N,
  opts: { title: string; describe: (preview: OpData<N>) => ReactNode; onDone?: () => void | Promise<void> },
) {
  const queryClient = useQueryClient()
  const undo = useUndo()
  const [state, setState] = useState<{ input: OpInput<N>; preview: OpData<N>; confirm: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function start(input: OpInput<N>) {
    try {
      const out = await callOp(name, input)
      if (out.applied || !out.confirm) return
      setState({ input, preview: out.data, confirm: out.confirm })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function confirm() {
    if (!state) return
    setBusy(true)
    try {
      const out = await callOp(name, { ...state.input, confirm: state.confirm })
      setState(null)
      // 先离开页面（例如删除后回到列表），再刷新数据，避免刷新已经删除的记录
      await opts.onDone?.()
      await queryClient.invalidateQueries({ queryKey: ["op"] })
      const id = out.changesetId
      toast.success(out.summary, id ? { action: { label: "撤销", onClick: () => undo(id) } } : undefined)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const dialog = (
    <Dialog open={!!state} onOpenChange={(open) => !open && setState(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{opts.title}</DialogTitle>
          <DialogDescription>请确认下面的内容。确认后仍然可以在「数据与设置 → 操作记录」里撤销。</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-auto text-sm">{state && opts.describe(state.preview)}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setState(null)}>
            取消
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { start, dialog }
}
