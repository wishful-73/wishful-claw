// iter-v3-5 S-247 —— 左侧栏「会话列表签名」。
//
// 为什么需要签名：store 走 immer，`appendTextDelta` 一帧就会把
// sessions 数组 / session / messages 数组 / message 对象整条路径换成新引用。
// 侧栏若直接 `useChatStore((s) => s.sessions)`，每帧 36 个会话全部重渲染
// （连同右键菜单 / 下拉 / Tooltip），DOM 一个节点都不变 —— 纯产垃圾，
// 实测 0 卡片、0 DOM 变化下仍能涨到 3~4 MB/s（见 S-247）。
//
// 所以侧栏改订「元数据签名字符串」：签名不变 ⇒ 不换引用 ⇒ 不重渲染。
// 代价是**签名漏字段 = 侧栏显示陈旧数据**，所以下面两张表是硬约束：
//   · SIDEBAR_SESSION_FIELDS —— 侧栏子树真的会读的字段，必须进签名；
//   · SIDEBAR_IGNORED_SESSION_FIELDS —— 明确不进签名的字段 + 理由。
// `tests/sidebar-session-signature/program.ts` 会强制 Session 的每个字段
// 必须落在这两张表之一，并且逐个验证「进签名的变了签名必须变、
// 没进签名的变了签名必须不变」。**加字段忘了分类 ⇒ 测试直接红。**
//
// 本文件刻意不 import 任何 React / store 运行时：签名要能在 node 里单独测
// （`@renderer/stores/chat-store` 会拖进 zustand + IPC）。

import type { Session } from '@renderer/stores/chat-store/types'

/**
 * 侧栏子树实际读取的 session 字段 —— **grep 出来的，不是推断**。
 * 读取点见 SIDEBAR_SESSION_FIELD_READERS。
 */
export const SIDEBAR_SESSION_FIELDS = [
  'id',
  'title',
  'pinned',
  'updatedAt',
  'projectId'
] as const

export type SidebarSessionField = (typeof SIDEBAR_SESSION_FIELDS)[number]

/** 每个字段的读取点，改代码时对得上号；也是对「为什么它在签名里」的交代。 */
export const SIDEBAR_SESSION_FIELD_READERS: Record<SidebarSessionField, string> = {
  id: 'WorkspaceSidebar.tsx:489/491 + workspace-sidebar-items.tsx:138/536（列表 key / isActive / streamingMessages 查询 / 各 action 入参）',
  title: 'workspace-sidebar-items.tsx:141/241（重命名输入框初值 + 标题文本）',
  pinned: 'workspace-sidebar-items.tsx:83-84/237/258（sortSessions 置顶优先 + 置顶图标 + 菜单文案）',
  updatedAt: 'workspace-sidebar-items.tsx:86/243（sortSessions 时间倒序 + 相对时间显示）',
  projectId: 'WorkspaceSidebar.tsx:113/127-131（按项目分组 + 首次挂载展开所属项目）'
}

/**
 * 明确**不进**签名的字段 + 理由。
 *
 * 判据只有一条：**侧栏子树有没有读它**。不读就不进 —— 进了只会多一次
 * 全侧栏重渲染（`messageCount` 每轮都在变，`messages` 每帧都在变）。
 * 将来侧栏要用某个字段，把它挪到 SIDEBAR_SESSION_FIELDS 并补读取点注释。
 */
export const SIDEBAR_IGNORED_SESSION_FIELDS: Record<string, string> = {
  icon: '侧栏不渲染会话图标（只有插件入口 extensionItems 的 icon，那是别的类型）',
  mode: '侧栏不读；会话模式只在聊天窗 / 设置页用',
  scope: '侧栏不读；「全局会话」分组走的是 projectId 为空，不是 scope',
  collaborationMode: '侧栏不读；只有发送链路用',
  permissionMode: '侧栏不读；只有权限判定用',
  contextCapTokens: '侧栏不读；设置页读',
  contextCapModelId: '侧栏不读；设置页读',
  compressionThreshold: '侧栏不读；设置页读',
  messages: '侧栏不读；而且流式每帧换引用 —— 进签名等于把 S-247 修复直接作废',
  messageCount: '侧栏不读（没有未读/条数角标）；每轮都在变，进签名是纯多余重渲染',
  messagesLoaded: '侧栏不读；分页状态，首屏加载时会变',
  loadedRangeStart: '侧栏不读；分页状态',
  loadedRangeEnd: '侧栏不读；分页状态',
  totalTurns: '侧栏不读；分页状态',
  lastKnownMessageCount: '侧栏不读；分页状态',
  createdAt: '侧栏不读；会话排序只用 updatedAt + pinned（createdAt 只给 sortProjects 用）',
  workingFolder: '侧栏不读；WorkingFolderSelectorDialog 是从 store 现取的',
  sshConnectionId: '侧栏不读；只有发送 / 终端链路用',
  planId: '侧栏不读；计划页用',
  pluginId: '侧栏不读；插件视图入口走 extensionStore',
  pluginType: '侧栏不读；渠道链路用',
  externalChatId: '侧栏不读；渠道链路用',
  pluginChatType: '侧栏不读；渠道链路用',
  pluginSenderId: '侧栏不读；渠道链路用',
  pluginSenderName: '侧栏不读；渠道链路用',
  modelSelectionMode: '侧栏不读；模型解析链路用',
  providerId: '侧栏不读；模型解析链路用',
  modelId: '侧栏不读；模型解析链路用',
  personaId: '侧栏不读；人格链路用',
  sessionCacheHit: '侧栏不读；状态栏读，每条消息结束都会变',
  sessionCacheMiss: '侧栏不读；状态栏读，每条消息结束都会变',
  usageBaseline: '侧栏不读；状态栏读',
  sessionUsageTotals: '侧栏不读；状态栏读，每次 message_end 都会变',
  isRuntimeResident: '侧栏不读；运行态探针用'
}

/**
 * 侧栏会话列表签名。
 *
 * 只读 SIDEBAR_SESSION_FIELDS 里的字段，**不碰** messages / messageCount 等
 * 高频变动项。分隔符用 `\u0001`/`\u0002` 控制字符（会话标题里出现控制字符
 * 的概率可以忽略，比逗号/竖线安全）。
 *
 * 用 for 循环而不是 `.map().join()`：这个函数在**每次 store 通知**上都会跑
 * （≈ 每秒几十次 × 会话数），别为了一次拼接再分配一个等长字符串数组。
 */
export function buildSidebarSessionsSignature(sessions: readonly Session[]): string {
  let signature = ''
  for (const item of sessions) {
    signature +=
      item.id +
      '\u0001' +
      item.title +
      '\u0001' +
      (item.pinned ? '1' : '0') +
      '\u0001' +
      item.updatedAt +
      '\u0001' +
      (item.projectId ?? '') +
      '\u0002'
  }
  return signature
}
