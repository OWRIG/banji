// 各模块建表时共用的小工具（单独成文件，避免模块 schema 和核心 schema 互相引用时出现初始化顺序问题）

/** created_at 的默认值：ISO 时间字符串 */
export const now = () => new Date().toISOString()
