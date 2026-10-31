// 谈话记录的口径（前后端共用）

export const noteKinds = { talk: "谈话", visit: "家访", observe: "观察" } as const
export type NoteKind = keyof typeof noteKinds
