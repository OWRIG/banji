import { defineModule } from "@/server/core/module"
import { classes, groups, students } from "@/server/db/schema"
import { importRoster, listClasses, listGroups, resolveStudentsOp, setStudentGroup } from "./ops"

// 「名册」核心模块：班级、学生、分组。其他模块都建立在它上面。

export const rosterModule = defineModule({
  id: "roster",
  title: "名册",
  description: "班级、学生、分组",
  core: true,
  ops: [listClasses, resolveStudentsOp, listGroups, setStudentGroup, importRoster],
  tables: [classes, groups, students],
})
