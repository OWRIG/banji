import { relations, sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { now } from "./columns"

// 平台的核心数据表（名册、积分、系统、登录）。功能模块的表放在 src/modules/<id>/schema.ts，
// 并在本文件末尾 export * 出来（drizzle 生成迁移、建立连接都只看这个文件）。改完后运行 pnpm db:generate。
// 业务表的时间统一存 ISO 字符串（created_at）或 YYYY-MM-DD（业务日期），方便撤销时原样还原。

// ---- 班级与名册 ----

export const classes = sqliteTable("classes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // 班级代号，例如 "705"；导入、CLI、agent 都用它指代班级
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  // 我在这个班的角色，例如 "班主任,英语"
  roles: text("roles").notNull().default(""),
  sort: integer("sort").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(now),
})

export const groups = sqliteTable(
  "groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [uniqueIndex("groups_class_name_idx").on(t.classId, t.name)],
)

export const students = sqliteTable(
  "students",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id),
    studentNo: text("student_no").notNull(),
    name: text("name").notNull(),
    gender: text("gender").notNull().default(""),
    groupId: integer("group_id").references(() => groups.id),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("students_no_idx").on(t.studentNo), index("students_class_idx").on(t.classId)],
)

// ---- 积分 ----

export const pointRules = sqliteTable("point_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  delta: integer("delta").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // 自动规则：check_full_score 检查满分 / recite_first_pass 背书一次过
  autoTrigger: text("auto_trigger"),
  sort: integer("sort").notNull().default(0),
})

// 积分流水只追加；撤销时填 revoked_at，不删除
export const pointEvents = sqliteTable(
  "point_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    delta: integer("delta").notNull(),
    ruleId: integer("rule_id").references(() => pointRules.id),
    // 规则名快照：规则改名后，历史流水仍显示当时的名字
    ruleName: text("rule_name").notNull().default(""),
    note: text("note").notNull().default(""),
    // 自动积分的来源，例如 check_result:123
    sourceType: text("source_type"),
    sourceId: integer("source_id"),
    actor: text("actor").notNull().default(""),
    createdAt: text("created_at").notNull().$defaultFn(now),
    revokedAt: text("revoked_at"),
  },
  (t) => [
    index("point_events_student_idx").on(t.studentId),
    // 同一来源、同一规则只能有一条生效的自动积分（幂等的最后一道防线）
    uniqueIndex("point_events_auto_idx")
      .on(t.ruleId, t.sourceType, t.sourceId)
      .where(sql`revoked_at is null and source_id is not null`),
  ],
)

// ---- 系统 ----

// 每次写操作的变更记录：用于撤销和审计
export const changesets = sqliteTable(
  "changesets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actor: text("actor").notNull(),
    opName: text("op_name").notNull(),
    summary: text("summary").notNull().default(""),
    // JSON：[{ table, id, before, after }]
    changes: text("changes").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(now),
    undoneAt: text("undone_at"),
  },
  (t) => [index("changesets_created_idx").on(t.createdAt)],
)

// 访问令牌：给远程 agent（HTTP MCP）用。只存哈希
export const apiTokens = sqliteTable("api_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: text("created_at").notNull().$defaultFn(now),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
})

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
})

// ---- 登录相关的表（由 Better Auth 官方命令生成，不要手动修改字段）----

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
)

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
)

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
)

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

// ---- 功能模块的数据表 ----
export * from "@/modules/checks/schema"
