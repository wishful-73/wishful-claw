import { isMcpTool, parseMcpToolName } from '@renderer/lib/mcp/mcp-tools'
import { resolveProxyStatusName } from '@renderer/lib/agent/use-capability-proxy'
import { normalizeToolName } from './tool-name-aliases'

/**
 * S-270 —�?工具名的**唯一**显示出口�?
 *
 * 改这个文件之前先�?`docs/plans/iter-v3-4/requirements/S-270.md`�?
 *
 * 问题不是「某次忘了一条」，而是机制上的三处漏洞�?
 *  1. `permission.toolLabels` 停在 OpenCowork 迁移期那批（23 条），之后每个迭代新增的
 *     浏览�?/ 桌面 / codegraph / 目标 / 交互类工�?*一个都没补**�?
 *  2. 渲染点是 `t(key, { defaultValue: name })` —�?key 缺失静默回退英文原名�?
 *     没有告警、没有兜底、没有测试，于是「漏登记」这件事永远沉默�?
 *  3. `FileChangeCard` �?`ProcessTextLine` 根本不查表，直接渲染原始 `name`�?
 *
 * 所以这里做三件事：**先归一化历史别�?�?查表 �?表里没有就结构化兜底**�?
 * 绝不再把 `BrowserNavigate` / `codegraph_explore` 这种�?camelCase / snake_case
 * 丢到用户脸上。`tests/tool-labels-coverage` 钉住�?1 条，兜底托住�?2�? 条�?
 */

/** �?`execution-outline.ts` �?`TranslationFn` 同形；须是绑�?`chat` 命名空间�?`t`�?*/
export type ToolTranslateFn = (key: string, options?: Record<string, unknown>) => string

const TOOL_LABEL_KEY_PREFIX = 'permission.toolLabels.'
const CODEGRAPH_TOOL_PREFIX = 'codegraph_'

/**
 * 读取 `permission.toolLabels.<name>`�?*缺失时返�?null**�?
 *
 * 判据不依�?i18next �?`returnNull` / `parseMissingKeyHandler` 配置：缺 key �?
 * i18next 逐级 fallback（当前语言 �?`en` �?`fallbackNS: common`），全部落空�?
 * 返回 key 本身。所以「返回值等�?key」就是确定的未命中信号�?
 */
function readToolLabel(t: ToolTranslateFn, toolName: string): string | null {
  const key = TOOL_LABEL_KEY_PREFIX + toolName
  const value = t(key)
  if (!value || value === key) return null
  return value
}

/**
 * `mcp__<server>__<tool>` �?�?tool 部分拆词首字母大写�?
 * �?`ToolCallCard/index.tsx` 搬进�?—�?它是「工具名显示」的一部分�?
 * 留在卡片里会让其它显示点（折叠条、文件变更行、纯文本行）各写一套�?
 */
function formatMcpToolDisplayName(name: string): string {
  const parsed = parseMcpToolName(name)
  const toolName = parsed?.toolName ?? name
  const label = toolName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .join(' ')
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : toolName
}

/**
 * 解析工具显示名�?*任何工具名都必须经过这里**，不要再在组件里直接渲染 `name`�?
 *
 * 顺序：历史别名归一 �?i18n �?�?MCP �?codegraph 前缀�?�?通用兜底�?
 * 「通用兜底」的文案是「工�?· 原名」（老大 2026-10-29 拍的口径）—�?
 * 比假装认识它更诚实，也比�?`FooBarTool` 可读�?
 */
export function resolveToolDisplayName(name: string, t: ToolTranslateFn): string {
  const normalized = normalizeToolName(name)
  if (!normalized) return t('toolCall.unknownToolLabel', { defaultValue: '未知工具' })

  const labelled = readToolLabel(t, normalized)
  if (labelled) return labelled

  if (isMcpTool(normalized)) return formatMcpToolDisplayName(normalized)

  if (normalized.startsWith(CODEGRAPH_TOOL_PREFIX)) {
    const action = normalized.slice(CODEGRAPH_TOOL_PREFIX.length)
    const actionLabel = t(`toolCall.codegraphAction.${action}`, { defaultValue: action })
    return t('toolCall.codegraphToolLabel', {
      action: actionLabel,
      defaultValue: '代码图谱 · {{action}}'
    })
  }

  return t('toolCall.genericToolLabel', { name: normalized, defaultValue: '工具 · {{name}}' })
}

const SKILL_CAPABILITY_PREFIX = 'skill:'

/**
 * 状态栏专用：输入框左上角（`ComposerStatusIndicator`）与完整运行态面�?
 * （`ComposerRuntimeStatus`）的「正在执�?XX�?「等待批准：XX」�?
 *
 * **S-270 的第六个漏点**（老大 2026-10-29 16:53 报「状态栏这里也是一样的问题�?
 * 使用工具的时候显示的是工具英文名称」）：这两处以前只调 `resolveProxyStatusName()` —�?
 * 它唯一的职责是�?`use_capability` 拆回它代理的那个真实工具（`NotebookEdit` /
 * `mcp__server__tool`），**对非代理工具原样返回**。所以卡片、折叠条、文件变更行都中文化了，
 * 状态栏还在�?`BrowserNavigate`�?
 *
 * 顺序不能反：先代理解析（拿到真实工具名），再过统一出口（查�?/ MCP 拆词 / 兜底）�?
 *
 * `skill:<id>` 是能�?id、不是工具名，翻不动 �?保持原样（与接这条之前的显示一致）�?
 */
export function resolveStatusToolName(
  name: string | null | undefined,
  input: Record<string, unknown> | undefined,
  t: ToolTranslateFn
): string | null {
  const resolved = resolveProxyStatusName(name, input)
  if (!resolved) return null
  if (resolved.startsWith(SKILL_CAPABILITY_PREFIX)) return resolved
  return resolveToolDisplayName(resolved, t)
}
