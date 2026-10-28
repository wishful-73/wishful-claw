/**
 * 工具入参陈列的分派层。
 *
 * S-250 把原本 596 行的单组件按工具类型拆到 `./structured-input/` 下：
 * `shell-ops`（命令）、`file-ops`（读写编辑与目录）、`web-ops`（搜索）、
 * `common`（技能 / 子代理 / 定时任务 / 可视化件 / 记忆工具 / 兜底）。
 *
 * 分派仍是原来的 if 链，顺序与条件逐条对应，渲染结果不变。
 * 特别注意 `Write`：原分支只在缺少完整 `content` 时返回，否则继续下探到兜底 —— 这里保留该判断。
 */

import { COMMAND_TOOL_NAMES } from './types'
import { CommandPane } from './structured-input/shell-ops'
import { EditPane, LsPane, ReadPane, SavePlanPane, WritePane } from './structured-input/file-ops'
import { GlobPane, GrepPane } from './structured-input/web-ops'
import {
  CronAddPane,
  CronListPane,
  CronRemovePane,
  CronUpdatePane,
  FallbackPane,
  MemoryAppendPane,
  MemoryHotReadPane,
  MemorySearchPane,
  MemoryUpdatePane,
  MemoryHotWritePane,
  SkillPane,
  TaskPane,
  WidgetPane
} from './structured-input/common'

export function StructuredInput({
  name,
  input
}: {
  name: string
  input: Record<string, unknown>
}): React.JSX.Element {
  if (name === 'Skill') return <SkillPane input={input} />

  if (COMMAND_TOOL_NAMES.has(name)) return <CommandPane input={input} />

  if (name === 'Read') return <ReadPane input={input} />

  if (name === 'Edit') return <EditPane input={input} />

  if (name === 'Write') {
    const content = typeof input.content === 'string' ? input.content : null
    if (!content) return <WritePane input={input} />
  }

  if (name === 'SavePlan') return <SavePlanPane input={input} />

  if (name === 'LS') return <LsPane input={input} />

  if (name === 'Glob') return <GlobPane input={input} />

  if (name === 'Grep') return <GrepPane input={input} />

  if (name === 'Task') return <TaskPane input={input} />

  if (name === 'CronAdd') return <CronAddPane input={input} />

  if (name === 'CronUpdate') return <CronUpdatePane input={input} />

  if (name === 'CronRemove') return <CronRemovePane input={input} />

  if (name === 'CronList') return <CronListPane />

  if (name === 'visualize_show_widget') return <WidgetPane input={input} />

  if (name === 'memory_hot_read') return <MemoryHotReadPane input={input} />

  if (name === 'memory_hot_write') return <MemoryHotWritePane input={input} />

  if (name === 'memory_search') return <MemorySearchPane input={input} />

  if (name === 'memory_append') return <MemoryAppendPane input={input} />

  if (name === 'memory_update') return <MemoryUpdatePane input={input} />

  return <FallbackPane input={input} />
}
