import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { OpOutcome } from "@/server/ops/define"
import type { OpData, OpInput, OpName } from "@/server/ops/index"
import { authClient } from "./auth-client"

// 前端调用业务操作的唯一入口：参数和返回值的类型直接来自 src/server/ops/。
// 写操作成功后弹出提示，带"撤销"按钮。

export class OpCallError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export async function callOp<N extends OpName>(name: N, input: OpInput<N>): Promise<OpOutcome<OpData<N>>> {
  const res = await fetch(`/api/ops/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  })
  const body = await res.json().catch(() => ({ message: "服务器没有响应" }))
  if (!res.ok) throw new OpCallError(body.message ?? "操作失败", res.status)
  return body
}

/** 读数据 */
export function useOp<N extends OpName>(name: N, input: OpInput<N>, options?: { enabled?: boolean }) {
  // 确认已登录之后才请求数据，避免页面刚打开时先发出一个 401
  const { data: session } = authClient.useSession()
  return useQuery<OpData<N>, Error>({
    queryKey: ["op", name, input],
    queryFn: async (): Promise<OpData<N>> => (await callOp(name, input)).data,
    enabled: !!session && options?.enabled !== false,
  })
}

/** 撤销某次变更，然后刷新页面数据 */
export function useUndo() {
  const queryClient = useQueryClient()
  return async (changesetId: number) => {
    try {
      const out = await callOp("undo", { changesetId })
      toast.success(out.summary)
    } catch (err) {
      toast.error((err as Error).message)
    }
    await queryClient.invalidateQueries({ queryKey: ["op"] })
  }
}

/** 写数据：成功后刷新所有数据，并弹出带"撤销"按钮的提示 */
export function useOpMutation<N extends OpName>(name: N, opts: { silent?: boolean } = {}) {
  const queryClient = useQueryClient()
  const undo = useUndo()
  return useMutation({
    mutationFn: (input: OpInput<N>) => callOp(name, input),
    onSuccess: async (out) => {
      await queryClient.invalidateQueries({ queryKey: ["op"] })
      if (opts.silent || !out.applied || !out.summary) return
      const id = out.changesetId
      toast.success(out.summary, id ? { action: { label: "撤销", onClick: () => undo(id) } } : undefined)
    },
    onError: (err) => toast.error(err.message),
  })
}
