/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { ToolDefinition, ToolResultContent } from '../api/types'
import type { ToolHandler, ToolContext } from '../tools/tool-types'
import { encodeToolError } from '../tools/tool-result-format'

function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value) ?? String(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function compareToolDefinitions(a: ToolDefinition, b: ToolDefinition): number {
  const categoryPriority: Record<string, number> = {
    file: 10,
    search: 20,
    shell: 30,
    task: 40,
    memory: 50,
    plan: 60,
    capability: 70
  }
  const byPriority = (categoryPriority[a.category ?? ''] ?? 100) - (categoryPriority[b.category ?? ''] ?? 100)
  if (byPriority !== 0) return byPriority
  const byName = a.name.localeCompare(b.name)
  if (byName !== 0) return byName
  const byDescription = a.description.localeCompare(b.description)
  if (byDescription !== 0) return byDescription
  return stableStringify(a.inputSchema).localeCompare(stableStringify(b.inputSchema))
}

/**
 * Tool Registry - manages tool handlers with a pluggable registration pattern.
 * New tools are added by calling register() without modifying core code.
 */
class ToolRegistry {
  private tools = new Map<string, ToolHandler>()
  private listeners = new Set<() => void>()
  private definitionsCache: ToolDefinition[] | null = []
  private namesCache: string[] | null = []
  private stableDefinitionsCache: ToolDefinition[] | null = []
  private stableNamesCache: string[] | null = []

  private invalidate(): void {
    this.definitionsCache = null
    this.namesCache = null
    this.stableDefinitionsCache = null
    this.stableNamesCache = null
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  register(handler: ToolHandler): void {
    const prev = this.tools.get(handler.definition.name)
    this.tools.set(handler.definition.name, handler)
    if (prev !== handler) {
      this.invalidate()
      this.emit()
    }
  }

  unregister(name: string): void {
    if (this.tools.delete(name)) {
      this.invalidate()
      this.emit()
    }
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  getDefinitions(): ToolDefinition[] {
    if (!this.definitionsCache) {
      this.definitionsCache = Array.from(this.tools.values()).map((t) => t.definition)
    }
    return this.definitionsCache
  }

  getStableDefinitions(): ToolDefinition[] {
    if (!this.stableDefinitionsCache) {
      this.stableDefinitionsCache = [...this.getDefinitions()].sort(compareToolDefinitions)
    }
    return this.stableDefinitionsCache
  }

  getNames(): string[] {
    if (!this.namesCache) {
      this.namesCache = Array.from(this.tools.keys())
    }
    return this.namesCache
  }

  getStableNames(): string[] {
    if (!this.stableNamesCache) {
      this.stableNamesCache = this.getStableDefinitions().map((tool) => tool.name)
    }
    return this.stableNamesCache
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResultContent> {
    const handler =
      ctx.localToolHandlers?.[name] ?? ctx.inlineToolHandlers?.[name] ?? this.tools.get(name)
    if (!handler) {
      return encodeToolError(`Unknown tool: ${name}`)
    }
    try {
      return await handler.execute(input, ctx)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return encodeToolError(message)
    }
  }

  checkRequiresApproval(name: string, input: Record<string, unknown>, ctx: ToolContext): boolean {
    const handler =
      ctx.localToolHandlers?.[name] ?? ctx.inlineToolHandlers?.[name] ?? this.tools.get(name)
    if (!handler) return true // Unknown tools always require approval
    return handler.requiresApproval?.(input, ctx) ?? false
  }
}

export const toolRegistry = new ToolRegistry()
