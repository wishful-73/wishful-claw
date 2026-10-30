/*
 * S-271 测试桩：`@renderer/lib/agent/teams/register` 的替身。
 *
 * 为什么要桩：`register.ts` 除了这个常量还 import 了 `useChatStore` / `useTeamStore` /
 * `useUIStore` / `inbox-poller` / `runtime-client` —— 在 node 里 bundle 会一路拖进
 * IPC 层并在加载时摸 `window`（`ReferenceError: window is not defined`）。
 * 被测的 `execution-outline.ts` 只用它一个常量，不该为它拖整个 store 图。
 *
 * 值与 `register.ts:22-24` **逐字同构**：同样从四个 tool 定义派生出名字集合，
 * 不手抄字符串 —— 工具改名时这里自动跟上，桩不会漂。
 */

import { teamCreateTool } from '@renderer/lib/agent/teams/tools/team-create'
import { sendMessageTool } from '@renderer/lib/agent/teams/tools/send-message'
import { teamStatusTool } from '@renderer/lib/agent/teams/tools/team-status'
import { teamDeleteTool } from '@renderer/lib/agent/teams/tools/team-delete'

const TEAM_TOOLS = [teamCreateTool, sendMessageTool, teamStatusTool, teamDeleteTool]

export const TEAM_TOOL_NAMES = new Set(TEAM_TOOLS.map((t) => t.definition.name))
