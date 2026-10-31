import { useEffect, useState } from "react"
import { useOp } from "./ops"

// 当前查看的班级：记在浏览器里，下次打开还是这个班

const KEY = "banji.currentClass"

export function useClasses() {
  return useOp("classes.list", {})
}

export function useCurrentClass() {
  const classes = useClasses()
  const [code, setCode] = useState<string | null>(() => localStorage.getItem(KEY))
  const list = classes.data ?? []
  const current = list.find((c) => c.code === code) ?? list[0]

  useEffect(() => {
    if (code) localStorage.setItem(KEY, code)
  }, [code])

  return { classes: list, current, setCode, isLoading: classes.isLoading }
}
