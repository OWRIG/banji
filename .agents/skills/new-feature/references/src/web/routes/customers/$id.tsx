import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { parseResponse } from "hono/client"
import type { CustomerFormInput } from "@/shared/customers"
import { CustomerForm } from "@/web/components/customers/customer-form"
import { Button } from "@/web/components/ui/button"
import { api } from "@/web/lib/api"

export const Route = createFileRoute("/customers/$id")({ component: CustomerDetailPage })

function CustomerDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const backToList = async () => {
    await queryClient.invalidateQueries({ queryKey: ["customers"] })
    await navigate({ to: "/customers" })
  }

  const customer = useQuery({
    queryKey: ["customers", "detail", id],
    queryFn: () => parseResponse(api.customers[":id"].$get({ param: { id } })),
  })
  const update = useMutation({
    mutationFn: (json: CustomerFormInput) => parseResponse(api.customers[":id"].$put({ param: { id }, json })),
    onSuccess: backToList,
  })
  const remove = useMutation({
    mutationFn: () => parseResponse(api.customers[":id"].$delete({ param: { id } })),
    onSuccess: backToList,
  })

  if (customer.isPending) return <p className="text-muted-foreground">加载中…</p>
  if (customer.isError) return <p className="text-destructive">找不到这个客户，可能已被删除</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">编辑客户</h1>
        <Button
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`确定删除「${customer.data.name}」吗？删除后无法恢复。`)) remove.mutate()
          }}
        >
          删除
        </Button>
      </div>
      <CustomerForm
        defaultValues={customer.data}
        submitText="保存修改"
        pending={update.isPending}
        onSubmit={(values) => update.mutate(values)}
      />
      {(update.isError || remove.isError) && <p className="text-sm text-destructive">操作失败，请重试</p>}
    </div>
  )
}
