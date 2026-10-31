import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { type CustomerFormInput, customerFormSchema } from "@/shared/customers"
import { Button } from "@/web/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/web/components/ui/field"
import { Input } from "@/web/components/ui/input"
import { Textarea } from "@/web/components/ui/textarea"

const emptyCustomer: CustomerFormInput = { name: "", contact: "", phone: "", note: "" }

// 新增和编辑共用的表单。每个字段一个 Controller，校验规则来自 src/shared/customers.ts
export function CustomerForm({
  defaultValues = emptyCustomer,
  submitText,
  pending,
  onSubmit,
}: {
  defaultValues?: CustomerFormInput
  submitText: string
  pending: boolean
  onSubmit: (values: CustomerFormInput) => void
}) {
  const form = useForm<CustomerFormInput>({ resolver: zodResolver(customerFormSchema), defaultValues })

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-xl">
      <FieldGroup>
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>客户名称</FieldLabel>
              <Input {...field} id={field.name} aria-invalid={fieldState.invalid} />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="contact"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>联系人</FieldLabel>
              <Input {...field} id={field.name} aria-invalid={fieldState.invalid} />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="phone"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>电话</FieldLabel>
              <Input {...field} id={field.name} aria-invalid={fieldState.invalid} />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="note"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>备注</FieldLabel>
              <Textarea {...field} id={field.name} aria-invalid={fieldState.invalid} />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Field orientation="horizontal">
          <Button type="submit" disabled={pending}>
            {submitText}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
