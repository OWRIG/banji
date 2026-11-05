import { useEffect, useMemo, useSyncExternalStore } from "react"
import { authClient } from "./auth-client"
import { EntryAutosave, type EntryCell } from "./entry-autosave"

// 切换表格后尚未结束的请求仍由同一队列管理，避免返回页面时出现两个保存队列。
const queues = new Map<string, EntryAutosave>()

export function useEntryAutosave(
  sheet: string,
  cells: Record<string, EntryCell>,
  save: (entries: { key: string; value: string }[]) => Promise<unknown>,
) {
  const { data: session } = authClient.useSession()
  const storageKey = `banji:entry:${session?.user.id}:${sheet}`
  const queue = useMemo(() => {
    const existing = queues.get(storageKey)
    if (existing) return existing
    const created = new EntryAutosave({
      cells,
      save,
      read: () => sessionStorage.getItem(storageKey),
      write: (value) => {
        if (value === null) sessionStorage.removeItem(storageKey)
        else sessionStorage.setItem(storageKey, value)
      },
    })
    queues.set(storageKey, created)
    return created
  }, [storageKey, cells, save])
  queue.configure({ cells, save })
  const state = useSyncExternalStore(queue.subscribe, queue.snapshot)
  useEffect(() => {
    queue.start()
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!Object.keys(queue.snapshot().drafts).length) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", beforeUnload)
    window.addEventListener("online", queue.start)
    return () => {
      window.removeEventListener("beforeunload", beforeUnload)
      window.removeEventListener("online", queue.start)
    }
  }, [queue])
  return { ...state, queue }
}
