import { useSyncExternalStore } from "react"
import { useOp } from "./ops"

// 当前查看的班级：记在浏览器里，下次打开还是这个班；同一页面内所有组件共享订阅，切换即时同步

const KEY = "banji.currentClass"
const listeners = new Set<() => void>()

function getSnapshot(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem(KEY)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

function setCurrentClassCode(next: string | null) {
  if (next) localStorage.setItem(KEY, next)
  else localStorage.removeItem(KEY)
  for (const listener of listeners) listener()
}

export function useClasses() {
  return useOp("classes.list", {})
}

export function useCurrentClass() {
  const classes = useClasses()
  const code = useSyncExternalStore(subscribe, getSnapshot, () => null)
  const list = classes.data ?? []
  const current = list.find((c) => c.code === code) ?? list[0]

  return { classes: list, current, setCode: setCurrentClassCode, isLoading: classes.isLoading }
}
