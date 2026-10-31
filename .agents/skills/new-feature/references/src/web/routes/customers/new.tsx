import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { parseResponse } from "hono/client"
import type { CustomerFormInput } from "@/shared/customers"
import { CustomerForm } from "@/web/components/customers/customer-form"
import { api } from "@/web/lib/api"

export const Route = createFileRoute("/customers/new")({ component: NewCustomerPage })

function NewCustomerPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: (json: CustomerFormInput) => parseResponse(api.customers.$post({ json })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customers"] })
      await navigate({ to: "/customers" })
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">新增客户</h1>
      <CustomerForm submitText="保存" pending={create.isPending} onSubmit={(values) => create.mutate(values)} />
      {create.isError && <p className="text-sm text-destructive">保存失败，请重试</p>}
    </div>
  )
}
