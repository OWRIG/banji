import type { LinkProps } from "@tanstack/react-router"
import type { ComponentType } from "react"
import { checksWeb } from "@/modules/checks/web"
import { notesWeb } from "@/modules/notes/web"
import { pointsWeb } from "@/modules/points/web"
import type { OpData } from "@/server/registry"

// 网页端的模块登记表：和 src/server/registry.ts 的 modules 一一对应（没有网页内容的模块可以不写）。
// 每个模块在自己的 web.tsx 里声明：导航入口、首页卡片、学生档案卡片。页面文件仍放在 src/web/routes/ 下。

export type WebModule = {
  id: string
  /** 左侧导航里的入口（放在「今日」之后） */
  nav?: { to: LinkProps["to"]; label: string }[]
  /** 首页右上角的快捷按钮 */
  HomeActions?: ComponentType
  /** 首页卡片：数据来自 brief.today 的 sections[模块 id]（模块停用时没有数据，返回 null 即可） */
  HomeCard?: ComponentType<{ brief: OpData<"brief.today"> }>
  /** 学生档案里的卡片：数据来自 students.profile 的 sections[模块 id] */
  ProfileCard?: ComponentType<{ profile: OpData<"students.profile"> }>
}

export const webModules: WebModule[] = [checksWeb, notesWeb, pointsWeb]
