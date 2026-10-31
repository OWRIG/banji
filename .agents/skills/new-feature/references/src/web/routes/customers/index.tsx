import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { parseResponse } from "hono/client"
import { useState } from "react"
import { Button } from "@/web/components/ui/button"
import { Input } from "@/web/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table"
import { api } from "@/web/lib/api"

export const Route = createFileRoute("/customers/")({ component: CustomersPage })

function CustomersPage() {
  const [q, setQ] = useState("")
  const customers = useQuery({
    queryKey: ["customers", "list", q],
    queryFn: () => parseResponse(api.customers.$get({ query: { q } })),
    placeholderData: keepPreviousData, // 搜索时保留上一次的结果，避免列表闪烁
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">客户</h1>
        <Button asChild>
          <Link to="/customers/new">新增客户</Link>
        </Button>
      </div>

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="按客户名称或联系人搜索"
        className="max-w-sm"
      />

      {customers.isPending ? (
        <p className="text-muted-foreground">加载中…</p>
      ) : customers.isError ? (
        <p className="text-destructive">加载失败：{customers.error.message}</p>
      ) : customers.data.length === 0 ? (
        <p className="text-muted-foreground">{q ? "没有找到匹配的客户" : "还没有客户，先新增一个吧"}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>客户名称</TableHead>
              <TableHead>联系人</TableHead>
              <TableHead>电话</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.data.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>
                  <Link to="/customers/$id" params={{ id: String(customer.id) }} className="underline">
                    {customer.name}
                  </Link>
                </TableCell>
                <TableCell>{customer.contact}</TableCell>
                <TableCell>{customer.phone}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
