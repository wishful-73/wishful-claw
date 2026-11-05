import type { ExtensionToolResult, ExtensionUiKind } from '../../../../shared/extension-types'
export type { ExtensionToolResult }

// S-305：插件卡片渲染通道的渲染端总闸。
// 主进程把插件工具结果包装成 `__wishfulClawExtensionResult: true` 的 JSON，这里只认它；
// 其它任何形状一律返回 null，由调用方退回普通工具输出 —— 宁可退化，不要空白卡片。
const UI_KINDS: ReadonlySet<string> = new Set<ExtensionUiKind>([
  'card',
  'table',
  'form',
  'chart',
  'html',
  'component'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodePayload(value: unknown): Record<string, unknown> | null {
  const candidates: string[] = []
  if (typeof value === 'string') {
    candidates.push(value)
  } else if (Array.isArray(value)) {
    const texts = value
      .map((block) =>
        isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : null
      )
      .filter((text): text is string => text !== null)
    if (texts.length === 0) return null
    // 包装 JSON 可能被切成多个 text block，两种拼法都试一次。
    candidates.push(texts.join('\n'), texts.join(''))
  } else {
    return null
  }

  for (const candidate of candidates) {
    if (candidate.length === 0) continue
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (isRecord(parsed)) return parsed
    } catch {
      // 换个拼法或直接放弃
    }
  }
  return null
}

function readUi(value: unknown): ExtensionToolResult['ui'] | undefined {
  if (!isRecord(value)) return undefined
  const kind = value.kind
  // 认不出的 kind 不认 —— 渲染器分派不出来，退化成普通输出比空白卡片强。
  if (typeof kind !== 'string' || !UI_KINDS.has(kind)) return undefined
  return value as ExtensionToolResult['ui']
}

export function parseExtensionToolResult(text: unknown): ExtensionToolResult | null {
  const payload = decodePayload(text)
  if (!payload) return null
  if (payload.__wishfulClawExtensionResult !== true) return null

  const extensionId = payload.extensionId
  if (typeof extensionId !== 'string' || extensionId.length === 0) return null

  return {
    __wishfulClawExtensionResult: true,
    extensionId,
    toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
    text: typeof payload.text === 'string' ? payload.text : undefined,
    data: payload.data,
    ui: readUi(payload.ui)
  }
}
