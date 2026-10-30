/**
 * 全局会话派活的**唯一措辞源**（渲染端这一侧）（iter-v3-5 S-278）。
 *
 * 派活消息以前有两个问题：
 *
 * 1. **一份措辞两处实现，已经漂移** —— C# 的 `AgentRuntimeGlobalTaskExecutor.
 *    SendWorkRequestAsync` 教模型「用 `use_capability` 调 `builtin:reply_global_dispatch`」，
 *    任务板这里教「call the `reply_global_dispatch` tool」。同名工具两种调法，模型行为不一致。
 * 2. **给模型看的协议说明被当成消息正文落库**，用户读到的是一整段英文指令。
 *
 * 修法：wire 文本（模型看，含协议说明）与 display 文本（人看，只有 instruction）
 * 分开，同时把 dispatch 身份写进消息 meta 让渲染端认得出来。
 *
 * ⚠️ **跨语言，共用不了函数**：C# 那份在 `AgentRuntimeGlobalTaskExecutor.cs`，
 * 与本文件各自实现，靠 `tests/global-dispatch-meta` 的源码闸互相钉住（同 S-276 的
 * `RealUserTurnPredicate` 与 `isRealUserTurn` 的做法）。**改措辞必须两份一起改**。
 */

import { PROJECT_DATA_DIR_NAME } from '@renderer/lib/project-data-dir'
import type { GlobalDispatchMeta, MessageMeta } from '@renderer/lib/api/types'

/**
 * 给模型看的完整文本。
 *
 * 那段协议说明是**必需的**：模型不知道要回执就真的不会回执，dispatch 永远停在
 * `sent`。它不该给人看，所以有了 `displayContent`。
 */
export function buildWorkRequestWireText(
  dispatchId: string,
  taskId: string,
  instruction: string
): string {
  return (
    `[GLOBAL AGENT WORK REQUEST] dispatch_id=${dispatchId} global_task_id=${taskId}\n\n` +
    `${instruction}\n\n` +
    'This work request was dispatched by the global agent (Task Board). Decide yourself how to ' +
    'execute it (including whether to create your own temporary Todos). Any notes or briefs you ' +
    `write for it belong in \`${PROJECT_DATA_DIR_NAME}/notes/\`, not loose in the project tree. When you finish, ` +
    'get blocked, or need to ask the global agent a follow-up question, report back via the ' +
    '`use_capability` tool: action="call", capability_id="builtin:reply_global_dispatch", and pass ' +
    `{"dispatchId": "${dispatchId}", "report": "<your result or question>", "status": "in_progress | completed | blocked"} ` +
    'inside `arguments`, so the global agent can track the outcome.'
  )
}

/**
 * 派发消息的形状。三件一起给出去，避免调用点自己拼（拼一次就漂一次）。
 */
export interface WorkRequestDelivery {
  /** 进 `messages`，模型看。 */
  content: string
  /** 落库与人看，只有 instruction。 */
  displayContent: string
  /** 进消息 meta，渲染端据此出卡片。 */
  meta: MessageMeta
}

/**
 * @param taskTitle 派发那一刻的任务标题快照 —— 任务后来改名不改历史消息的显示。
 *                  传 undefined 时 meta 里不带该字段，卡片退化成只显示 dispatchId。
 */
export function buildWorkRequestDelivery(
  dispatchId: string,
  taskId: string,
  instruction: string,
  taskTitle?: string
): WorkRequestDelivery {
  const globalDispatch: GlobalDispatchMeta = {
    dispatchId,
    globalTaskId: taskId,
    kind: 'work_request',
    ...(taskTitle ? { globalTaskTitle: taskTitle } : {})
  }
  return {
    content: buildWorkRequestWireText(dispatchId, taskId, instruction),
    displayContent: instruction,
    meta: { globalDispatch }
  }
}
