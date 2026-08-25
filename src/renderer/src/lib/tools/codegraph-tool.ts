/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { toolRegistry } from '../agent/tool-registry'
import { agentBridge } from '../ipc/agent-bridge'

// Injected into the per-run <system-reminder> when the CodeGraph plugin is enabled
// (see buildRuntimeReminder). The ported SERVER_INSTRUCTIONS playbook, condensed:
// prefer one explore call over many Read/Grep rounds for code-navigation questions.
export const CODEGRAPH_SYSTEM_GUIDANCE = [
  'CodeGraph is enabled for this workspace. For code retrieval and navigation questions —',
  '"how does X work", "where is Y defined/used", "who calls Z", "what breaks if I change W" —',
  'prefer the codegraph_explore tool FIRST: one call returns ranked, connected source across',
  'files (call paths, callers, impact) and replaces many Read/Grep/Glob rounds.',
  'Use Read/Grep only for exact file contents or when explore reports it is still indexing',
  '(then retry it shortly) or unavailable.'
].join(' ')
import { encodeStructuredToolResult } from './tool-result-format'
import type { ToolHandler } from './tool-types'

// MVP surface for the opt-in CodeGraph sidecar: a single `codegraph_explore`
// tool. Its definition is registered/unregistered dynamically from the
// `codegraphEnabled` setting (mirroring WebSearch/Browser/Wiki), and execution
// routes to the CodeGraph worker via agentBridge.request('codegraph/explore').
// The main-process router gates the call on the same setting and resolves
// success-shaped when disabled, so a stale reference never throws into the loop.

interface CodeGraphExploreInput {
  query?: unknown
  projectPath?: unknown
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const codegraphExploreHandler: ToolHandler = {
  definition: {
    name: 'codegraph_explore',
    description:
      'Explore the indexed code graph for the current project: resolve a symbol or ' +
      'natural-language query into related definitions, callers/callees, and files. ' +
      'Requires the opt-in CodeGraph feature to be enabled.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A symbol name or natural-language question about the codebase structure.'
        },
        projectPath: {
          type: 'string',
          description:
            'Optional absolute path to the project root to explore. Defaults to the active working folder.'
        }
      },
      required: ['query']
    }
  },
  execute: async (input, ctx) => {
    const source = input as CodeGraphExploreInput
    const query = readNonEmptyString(source.query)
    if (!query) {
      return encodeStructuredToolResult({ error: 'codegraph_explore requires a non-empty query.' })
    }

    const projectPath = readNonEmptyString(source.projectPath) ?? ctx.workingFolder

    try {
      const result = await agentBridge.request('codegraph:tool', {
        name: codegraphExploreHandler.definition.name,
        input: {
          query,
          ...(projectPath ? { projectPath } : {})
        },
        ...(ctx.workingFolder ? { workingFolder: ctx.workingFolder } : {})
      })
      return encodeStructuredToolResult(
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : { result }
      )
    } catch (error) {
      return encodeStructuredToolResult({
        error: `CodeGraph explore failed: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  },
  requiresApproval: () => false
}

let _registered = false

export function registerCodeGraphExploreTool(): void {
  if (_registered) return
  _registered = true
  toolRegistry.register(codegraphExploreHandler)
}

export function unregisterCodeGraphExploreTool(): void {
  if (!_registered) return
  _registered = false
  toolRegistry.unregister(codegraphExploreHandler.definition.name)
}

export function isCodeGraphExploreToolRegistered(): boolean {
  return _registered
}

// ---------------------------------------------------------------------------
// Full tool surface (M7-W3): the worker's `codegraph/tools-list` already shapes
// the definitions (tiny-repo gating, CODEGRAPH_MCP_TOOLS allowlist, projectPath
// required when no default project) — register whatever it returns beyond
// explore, verbatim. Opt-in via settings.codegraphFullToolSurface (default off,
// matching upstream's explore-only DEFAULT_MCP_TOOLS).
// ---------------------------------------------------------------------------

interface CodeGraphToolsListResult {
  success?: boolean
  tools?: Array<{
    name?: string
    description?: string
    inputSchema?: Record<string, unknown>
  }>
}

const _dynamicToolNames = new Set<string>()

function makeCodeGraphToolHandler(
  name: string,
  description: string,
  rawSchema: Record<string, unknown>
): ToolHandler {
  const properties =
    rawSchema.properties && typeof rawSchema.properties === 'object'
      ? (rawSchema.properties as Record<string, unknown>)
      : {}
  const required = Array.isArray(rawSchema.required)
    ? rawSchema.required.filter((r): r is string => typeof r === 'string')
    : undefined
  return {
    definition: {
      name,
      description,
      inputSchema: { type: 'object', properties, ...(required ? { required } : {}) }
    },
    execute: async (input, ctx) => {
      const source = (input ?? {}) as Record<string, unknown>
      const projectPath = readNonEmptyString(source.projectPath) ?? ctx.workingFolder
      try {
        const result = await agentBridge.request('codegraph:tool', {
          name,
          input: {
            ...source,
            ...(projectPath ? { projectPath } : {})
          },
          ...(ctx.workingFolder ? { workingFolder: ctx.workingFolder } : {})
        })
        return encodeStructuredToolResult(
          result && typeof result === 'object' && !Array.isArray(result)
            ? (result as Record<string, unknown>)
            : { result }
        )
      } catch (error) {
        return encodeStructuredToolResult({
          error: `CodeGraph ${name} failed: ${error instanceof Error ? error.message : String(error)}`
        })
      }
    },
    requiresApproval: () => false
  }
}

export async function registerCodeGraphFullSurface(): Promise<void> {
  let listed: CodeGraphToolsListResult
  try {
    listed = (await agentBridge.request('codegraph/tools-list', {})) as CodeGraphToolsListResult
  } catch (error) {
    console.error('[codegraph] tools-list failed; keeping explore-only surface:', error)
    return
  }

  const tools = Array.isArray(listed?.tools) ? listed.tools : []
  for (const tool of tools) {
    const name = typeof tool?.name === 'string' ? tool.name : ''
    if (!name || name === codegraphExploreHandler.definition.name) continue
    if (_dynamicToolNames.has(name)) continue
    _dynamicToolNames.add(name)
    toolRegistry.register(
      makeCodeGraphToolHandler(
        name,
        typeof tool.description === 'string' ? tool.description : '',
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? (tool.inputSchema as Record<string, unknown>)
          : { type: 'object', properties: {} }
      )
    )
  }
}

export function unregisterCodeGraphFullSurface(): void {
  for (const name of _dynamicToolNames) {
    toolRegistry.unregister(name)
  }
  _dynamicToolNames.clear()
}

export function isCodeGraphFullSurfaceRegistered(): boolean {
  return _dynamicToolNames.size > 0
}
