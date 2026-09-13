/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { toolRegistry } from '../agent/tool-registry'
import { encodeBashToolResult } from './bash-output'
import type { ToolHandler } from './tool-types'

const DEFAULT_COMMAND_TIMEOUT_MS = 600_000

function nativeOnlyBashResult(): string {
  return encodeBashToolResult({
    exitCode: 1,
    stderr: 'Bash execution has migrated to .NET Native Worker.'
  })
}

const bashHandler: ToolHandler = {
  // 真实执行与授权判定都在 .NET Worker（ToolCallProcessor 的审批门）；
  // 这里只是把工具名与入参 schema 交给渲染端注册表。
  definition: {
    name: 'Bash',
    description: 'Execute a shell command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        timeout: {
          type: 'number',
          description: `Timeout in milliseconds (max 3600000, default ${DEFAULT_COMMAND_TIMEOUT_MS})`
        },
        run_in_background: {
          type: 'boolean',
          description:
            'Run command in background without blocking; if omitted, long-running commands are auto-detected'
        },
        force_foreground: {
          type: 'boolean',
          description:
            'Force foreground execution for long-running commands (default false; use only when necessary)'
        },
        description: { type: 'string', description: '5-10 word description of the command' }
      },
      required: ['command']
    }
  },
  execute: async () => nativeOnlyBashResult()
}

export function registerBashTools(): void {
  toolRegistry.register(bashHandler)
}
