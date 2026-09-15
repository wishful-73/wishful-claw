/**
 * Renderer-side mirror of the Worker's AgentRuntimeUseCapabilityExecutor.
 * ResolveProxyDisplay: a use_capability(action=call) proxy call is displayed
 * as the underlying real tool (NotebookEdit, Skill, mcp__server__tool, ...)
 * instead of an opaque "use_capability" card.
 *
 * Applied once in stream-event-adapter so every downstream consumer
 * (chat-store, agent-store, activity panel) sees the rewritten identity.
 */

interface ProxyDisplay {
  name: string
  input: Record<string, unknown>
}

const USE_CAPABILITY_TOOL = 'use_capability'

export function isUseCapabilityTool(name: string): boolean {
  return name === USE_CAPABILITY_TOOL
}

/**
 * Display name for status indicators (composer status bar, floating pill).
 *
 * Deliberately NOT resolveProxyDisplay: that one feeds tool cards, where
 * `Skill` is a meaningful card identity. Status surfaces should instead name
 * the concrete capability so the operator sees what is really being invoked
 * (`skill:commit` rather than `Skill`).
 *
 * Also works around event ordering: `tool_use_streaming_start` arrives with an
 * empty input, so the proxy cannot be resolved there. Resolving at the display
 * site picks the real name as soon as args land, whatever the event sequence.
 * Falls back to the raw name while args are still streaming.
 */
export function resolveProxyStatusName(
  name: string | null | undefined,
  input: Record<string, unknown> | undefined
): string | null {
  if (!name) return null
  if (!isUseCapabilityTool(name)) return name
  const resolved = resolveProxyDisplay(input)
  if (!resolved) return name
  const capabilityId =
    input && typeof input.capability_id === 'string' ? input.capability_id.trim() : ''
  // skill:name → show the capability itself; resolveProxyDisplay collapses every
  // skill to the bare "Skill" card identity.
  if (capabilityId.startsWith('skill:')) return capabilityId
  return resolved.name
}

export function resolveProxyDisplay(
  input: Record<string, unknown> | undefined
): ProxyDisplay | null {
  if (!input || typeof input !== 'object') return null

  const action = typeof input.action === 'string' ? input.action.trim() : ''
  if (action.toLowerCase() !== 'call') return null

  const capabilityId =
    typeof input.capability_id === 'string' ? input.capability_id.trim() : ''
  if (!capabilityId) return null

  const emptyObject: Record<string, unknown> = {}
  const readArguments = (): Record<string, unknown> => {
    const args = input.arguments
    return args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : emptyObject
  }

  // builtin:ToolName → ToolName with arguments as-is
  if (capabilityId.startsWith('builtin:')) {
    return {
      name: capabilityId.slice('builtin:'.length),
      input: readArguments()
    }
  }

  // skill:name → Skill tool with SkillName input
  if (capabilityId.startsWith('skill:')) {
    return {
      name: 'Skill',
      input: { SkillName: capabilityId.slice('skill:'.length) }
    }
  }

  // mcp-tool:server/tool → mcp__server__tool (matches isMcpTool)
  if (capabilityId.startsWith('mcp-tool:')) {
    const rest = capabilityId.slice('mcp-tool:'.length)
    const slashIdx = rest.indexOf('/')
    if (slashIdx > 0 && slashIdx + 1 < rest.length) {
      const serverId = rest.slice(0, slashIdx)
      const toolName = rest.slice(slashIdx + 1)
      return {
        name: `mcp__${serverId}__${toolName}`,
        input: readArguments()
      }
    }
  }

  return null
}

/**
 * Rewrites a tool-use block when it belongs to a use_capability proxy call.
 * Returns null when the block is not a resolvable proxy call.
 */
export function rewriteProxyToolUseBlock(block: {
  id: string
  name: string
  input?: Record<string, unknown>
} | undefined | null): { id: string; name: string; input: Record<string, unknown> } | null {
  if (!block || !isUseCapabilityTool(block.name)) return null
  const resolved = resolveProxyDisplay(block.input)
  if (!resolved) return null
  return { id: block.id, name: resolved.name, input: resolved.input }
}
