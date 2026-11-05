import type { EntrySnapshot } from "@/web/lib/entry-autosave"
import { Button } from "./ui/button"

export function EntrySaveStatus({
  state,
  onRetry,
  onDiscard,
}: {
  state: EntrySnapshot
  onRetry: () => void
  onDiscard: () => void
}) {
  const pending = Object.keys(state.drafts).length
  const errors = Object.values(state.errors)
  return (
    <div className="no-print mb-2 flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
      <span className={errors.length || (pending && state.storageError) ? "text-destructive" : "text-muted-foreground"}>
        {state.saving
          ? `正在保存（${pending} 格）…`
          : pending
            ? `${pending} 格尚未保存${state.storageError ? "，本页草稿备份不可用，请勿刷新" : "，草稿已保留，刷新后可恢复"}`
            : "全部已保存"}
        {errors.length > 0 && `。${errors[0]}`}
      </span>
      {pending > 0 && (
        <Button size="xs" variant="outline" disabled={state.saving} onClick={onRetry}>
          {errors.length ? "保存本页输入" : "立即保存"}
        </Button>
      )}
      {errors.length > 0 && (
        <Button size="xs" variant="ghost" disabled={state.saving} onClick={onDiscard}>
          放弃草稿，使用已保存成绩
        </Button>
      )}
    </div>
  )
}
