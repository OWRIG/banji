import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { parseResponse } from "hono/client"
import { type FormEvent, useState } from "react"
import { type CreateTodoInput, createTodoSchema } from "@/shared/todos"
import { Button } from "@/web/components/ui/button"
import { Checkbox } from "@/web/components/ui/checkbox"
import { Input } from "@/web/components/ui/input"
import { api } from "@/web/lib/api"

// 示例页面：演示查询列表、新增、修改、删除，以及加载中 / 出错 / 空列表三种状态。
export const Route = createFileRoute("/todos")({ component: TodosPage })

const todosKey = ["todos"]

function TodosPage() {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: todosKey })

  const todos = useQuery({
    queryKey: todosKey,
    queryFn: () => parseResponse(api.todos.$get()),
  })
  const createTodo = useMutation({
    mutationFn: (json: CreateTodoInput) => parseResponse(api.todos.$post({ json })),
    onSuccess: refresh,
  })
  const toggleTodo = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) =>
      parseResponse(api.todos[":id"].$patch({ param: { id: String(id) }, json: { done } })),
    onSuccess: refresh,
  })
  const deleteTodo = useMutation({
    mutationFn: (id: number) => parseResponse(api.todos[":id"].$delete({ param: { id: String(id) } })),
    onSuccess: refresh,
  })

  const [title, setTitle] = useState("")
  const [formError, setFormError] = useState<string>()

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const result = createTodoSchema.safeParse({ title })
    if (!result.success) {
      setFormError(result.error.issues[0]?.message)
      return
    }
    setFormError(undefined)
    createTodo.mutate(result.data, { onSuccess: () => setTitle("") })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">待办</h1>

      <form onSubmit={handleSubmit} className="space-y-1">
        <div className="flex gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="要做什么？" />
          <Button type="submit" disabled={createTodo.isPending}>
            添加
          </Button>
        </div>
        {formError && <p className="text-sm text-destructive">{formError}</p>}
        {createTodo.isError && <p className="text-sm text-destructive">添加失败，请重试</p>}
      </form>

      {todos.isPending ? (
        <p className="text-muted-foreground">加载中…</p>
      ) : todos.isError ? (
        <p className="text-destructive">加载失败：{todos.error.message}</p>
      ) : todos.data.length === 0 ? (
        <p className="text-muted-foreground">还没有待办，先添加一条吧</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {todos.data.map((todo) => (
            <li key={todo.id} className="flex items-center gap-3 px-4 py-3">
              <Checkbox
                checked={todo.done}
                onCheckedChange={(checked) => toggleTodo.mutate({ id: todo.id, done: checked === true })}
              />
              <span className={todo.done ? "flex-1 text-muted-foreground line-through" : "flex-1"}>{todo.title}</span>
              <Button variant="ghost" size="sm" onClick={() => deleteTodo.mutate(todo.id)}>
                删除
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
