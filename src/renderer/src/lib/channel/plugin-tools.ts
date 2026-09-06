import { toolRegistry } from '../agent/tool-registry'
import type { ToolHandler } from '../tools/tool-types'

// ── Unified Plugin Tools ──
// ChannelSendImage/ChannelSendFile route from the current channel session.
import { pluginSendMessage, pluginReplyMessage, pluginGetGroupMessages, pluginListGroups, pluginSummarizeGroup, pluginGetCurrentChatMessages, nativeOnlyPluginResult } from './plugin-message-tools'

const channelSendImage: ToolHandler = {
  definition: {
    name: 'ChannelSendImage',
    description: 'Send an image to the current channel conversation. The channel and chat are inferred from the current session.',
    inputSchema: {
      type: 'object',
      properties: { file_path: { type: 'string', description: 'Absolute local file path or HTTP/HTTPS URL' } },
      required: ['file_path']
    }
  },
  execute: async () => nativeOnlyPluginResult('ChannelSendImage'),
  requiresApproval: (_input, ctx) => !ctx.channelSession
}

const channelSendFile: ToolHandler = {
  definition: {
    name: 'ChannelSendFile',
    description: 'Send a file to the current channel conversation. The channel and chat are inferred from the current session.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute local file path or HTTP/HTTPS URL' },
        file_type: { type: 'string', description: 'Optional file type override' }
      },
      required: ['file_path']
    }
  },
  execute: async () => nativeOnlyPluginResult('ChannelSendFile'),
  requiresApproval: (_input, ctx) => !ctx.channelSession
}

const feishuSendImage: ToolHandler = {
  definition: {
    name: 'FeishuSendImage',
    description:
      'Send an image to a Feishu chat. Accepts either an absolute local file path (e.g. /home/user/pic.png or C:\\Users\\...\\pic.png) or an HTTP/HTTPS URL (e.g. https://example.com/image.png). The tool automatically downloads URLs and uploads the image to Feishu.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The Feishu channel instance ID' },
        chat_id: { type: 'string', description: 'The Feishu chat ID to send the image to' },
        file_path: {
          type: 'string',
          description: 'Absolute local file path OR an HTTP/HTTPS URL pointing to the image'
        }
      },
      required: ['plugin_id', 'chat_id', 'file_path']
    }
  },
  execute: async () => nativeOnlyPluginResult('FeishuSendImage'),
  requiresApproval: (_input, ctx) => !ctx.channelSession
}

const feishuSendFile: ToolHandler = {
  definition: {
    name: 'FeishuSendFile',
    description:
      'Send a file to a Feishu chat. Accepts either an absolute local file path (e.g. /home/user/doc.pdf) or an HTTP/HTTPS URL (e.g. https://example.com/report.pdf). The tool automatically downloads URLs, detects the file type from the extension (pdf, doc/docx, xls/xlsx, ppt/pptx, mp4, opus → stream for others), and uploads to Feishu.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The Feishu channel instance ID' },
        chat_id: { type: 'string', description: 'The Feishu chat ID to send the file to' },
        file_path: {
          type: 'string',
          description: 'Absolute local file path OR an HTTP/HTTPS URL pointing to the file'
        },
        file_type: {
          type: 'string',
          description:
            'Override file type: opus, mp4, pdf, doc, xls, ppt, or stream. Omit to auto-detect from extension.',
          enum: ['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream']
        }
      },
      required: ['plugin_id', 'chat_id', 'file_path']
    }
  },
  execute: async () => nativeOnlyPluginResult('FeishuSendFile'),
  requiresApproval: (_input, ctx) => !ctx.channelSession
}

const weixinSendImage: ToolHandler = {
  definition: {
    name: 'WeixinSendImage',
    description:
      'Send an image to an official Weixin chat. Accepts either an absolute local file path or an HTTP/HTTPS URL. Optionally send `content` as a text message before the image.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The official Weixin channel instance ID' },
        chat_id: { type: 'string', description: 'The Weixin chat ID to send the image to' },
        file_path: {
          type: 'string',
          description: 'Absolute local file path OR an HTTP/HTTPS URL pointing to the image'
        },
        content: {
          type: 'string',
          description: 'Optional text to send before the image as a separate text message'
        }
      },
      required: ['plugin_id', 'chat_id', 'file_path']
    }
  },
  execute: async () => nativeOnlyPluginResult('WeixinSendImage'),
  requiresApproval: (_input, ctx) => !ctx.channelSession
}

const weixinSendFile: ToolHandler = {
  definition: {
    name: 'WeixinSendFile',
    description:
      'Send a file to an official Weixin chat. Accepts either an absolute local file path or an HTTP/HTTPS URL. Optionally send `content` as a text message before the file.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The official Weixin channel instance ID' },
        chat_id: { type: 'string', description: 'The Weixin chat ID to send the file to' },
        file_path: {
          type: 'string',
          description: 'Absolute local file path OR an HTTP/HTTPS URL pointing to the file'
        },
        content: {
          type: 'string',
          description: 'Optional text to send before the file as a separate text message'
        }
      },
      required: ['plugin_id', 'chat_id', 'file_path']
    }
  },
  execute: async () => nativeOnlyPluginResult('WeixinSendFile'),
  requiresApproval: (_input, ctx) => !ctx.channelSession
}

const feishuListChatMembers: ToolHandler = {
  definition: {
    name: 'FeishuListChatMembers',
    description: 'List members in a Feishu chat/group. Returns member IDs for @mentions.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The Feishu channel instance ID' },
        chat_id: {
          type: 'string',
          description: 'The Feishu chat ID (optional, defaults to current)'
        },
        page_size: { type: 'number', description: 'Page size (1-50, default 50)' },
        page_token: { type: 'string', description: 'Pagination token' },
        member_id_type: {
          type: 'string',
          enum: ['open_id', 'user_id', 'union_id'],
          description: 'Member ID type (default open_id)'
        }
      },
      required: ['plugin_id']
    }
  },
  execute: async () => nativeOnlyPluginResult('FeishuListChatMembers')
}

const feishuAtMember: ToolHandler = {
  definition: {
    name: 'FeishuAtMember',
    description:
      'Mention members in a Feishu group chat (group-only). Use FeishuListChatMembers to get open_id values.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The Feishu channel instance ID' },
        chat_id: {
          type: 'string',
          description: 'The Feishu chat ID (optional, defaults to current)'
        },
        user_ids: { type: 'array', items: { type: 'string' }, description: 'User IDs to mention' },
        at_all: { type: 'boolean', description: 'Mention all members' },
        text: { type: 'string', description: 'Message text to send (without @ tags)' }
      },
      required: ['plugin_id', 'text']
    }
  },
  execute: async () => nativeOnlyPluginResult('FeishuAtMember'),
  requiresApproval: () => true
}

const feishuSendUrgent: ToolHandler = {
  definition: {
    name: 'FeishuSendUrgent',
    description: 'Send urgent push (app/sms) to Feishu message recipients.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The Feishu channel instance ID' },
        message_id: { type: 'string', description: 'Target message_id for urgent push' },
        user_ids: { type: 'array', items: { type: 'string' }, description: 'User IDs to notify' },
        urgent_types: {
          type: 'array',
          items: { type: 'string', enum: ['app', 'sms'] },
          description: 'Urgent types to send (app, sms)'
        }
      },
      required: ['plugin_id', 'message_id', 'user_ids', 'urgent_types']
    }
  },
  execute: async () => nativeOnlyPluginResult('FeishuSendUrgent'),
  requiresApproval: () => true
}

const feishuBitableListApps: ToolHandler = {
  definition: {
    name: 'FeishuBitableListApps',
    description: 'List accessible Feishu Bitable apps.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The Feishu channel instance ID' }
      },
      required: ['plugin_id']
    }
  },
  execute: async () => nativeOnlyPluginResult('FeishuBitableListApps')
}

const feishuBitableListTables: ToolHandler = {
  definition: {
    name: 'FeishuBitableListTables',
    description: 'List tables in a Feishu Bitable app.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The Feishu channel instance ID' },
        app_token: { type: 'string', description: 'Bitable app token' }
      },
      required: ['plugin_id', 'app_token']
    }
  },
  execute: async () => nativeOnlyPluginResult('FeishuBitableListTables')
}

const feishuBitableListFields: ToolHandler = {
  definition: {
    name: 'FeishuBitableListFields',
    description: 'List fields for a Feishu Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The Feishu channel instance ID' },
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Bitable table ID' }
      },
      required: ['plugin_id', 'app_token', 'table_id']
    }
  },
  execute: async () => nativeOnlyPluginResult('FeishuBitableListFields')
}

const feishuBitableGetRecords: ToolHandler = {
  definition: {
    name: 'FeishuBitableGetRecords',
    description: 'Get records from a Feishu Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The Feishu channel instance ID' },
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Bitable table ID' },
        filter: { type: 'string', description: 'Optional filter formula' },
        page_size: { type: 'number', description: 'Page size (default 50)' },
        page_token: { type: 'string', description: 'Page token for pagination' }
      },
      required: ['plugin_id', 'app_token', 'table_id']
    }
  },
  execute: async () => nativeOnlyPluginResult('FeishuBitableGetRecords')
}

const feishuBitableCreateRecords: ToolHandler = {
  definition: {
    name: 'FeishuBitableCreateRecords',
    description: 'Create records in a Feishu Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The Feishu channel instance ID' },
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Bitable table ID' },
        records: {
          type: 'array',
          description: 'Records payload array',
          items: { type: 'object', description: 'Record payload object' }
        }
      },
      required: ['plugin_id', 'app_token', 'table_id', 'records']
    }
  },
  execute: async () => nativeOnlyPluginResult('FeishuBitableCreateRecords')
}

const feishuBitableUpdateRecords: ToolHandler = {
  definition: {
    name: 'FeishuBitableUpdateRecords',
    description: 'Update records in a Feishu Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The Feishu channel instance ID' },
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Bitable table ID' },
        records: {
          type: 'array',
          description: 'Records payload array',
          items: { type: 'object', description: 'Record payload object' }
        }
      },
      required: ['plugin_id', 'app_token', 'table_id', 'records']
    }
  },
  execute: async () => nativeOnlyPluginResult('FeishuBitableUpdateRecords')
}

const feishuBitableDeleteRecords: ToolHandler = {
  definition: {
    name: 'FeishuBitableDeleteRecords',
    description: 'Delete records from a Feishu Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_id: { type: 'string', description: 'The Feishu channel instance ID' },
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Bitable table ID' },
        record_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Record IDs to delete'
        }
      },
      required: ['plugin_id', 'app_token', 'table_id', 'record_ids']
    }
  },
  execute: async () => nativeOnlyPluginResult('FeishuBitableDeleteRecords')
}

const FEISHU_TOOLS: ToolHandler[] = [
  feishuSendImage,
  feishuSendFile,
  feishuListChatMembers,
  feishuAtMember,
  feishuSendUrgent,
  feishuBitableListApps,
  feishuBitableListTables,
  feishuBitableListFields,
  feishuBitableGetRecords,
  feishuBitableCreateRecords,
  feishuBitableUpdateRecords,
  feishuBitableDeleteRecords
]

const WEIXIN_TOOLS: ToolHandler[] = [weixinSendImage, weixinSendFile]
const COMMON_PLUGIN_TOOL_HANDLERS: ToolHandler[] = [channelSendImage, channelSendFile]
const COMMON_PLUGIN_TOOL_NAMES = [
  ...COMMON_PLUGIN_TOOL_HANDLERS,
  pluginSendMessage,
  pluginReplyMessage,
  pluginGetGroupMessages,
  pluginListGroups,
  pluginSummarizeGroup,
  pluginGetCurrentChatMessages
].map((tool) => tool.definition.name)
const FEISHU_PLUGIN_TOOL_NAMES = [
  ...COMMON_PLUGIN_TOOL_NAMES,
  ...FEISHU_TOOLS.map((tool) => tool.definition.name)
]
const WEIXIN_PLUGIN_TOOL_NAMES = [
  ...COMMON_PLUGIN_TOOL_NAMES,
  ...WEIXIN_TOOLS.map((tool) => tool.definition.name)
]

const ALL_PLUGIN_TOOLS: ToolHandler[] = [
  pluginSendMessage,
  pluginReplyMessage,
  pluginGetGroupMessages,
  pluginListGroups,
  pluginSummarizeGroup,
  pluginGetCurrentChatMessages,
  ...COMMON_PLUGIN_TOOL_HANDLERS,
  ...WEIXIN_TOOLS,
  ...FEISHU_TOOLS
]

export const PLUGIN_TOOL_DEFINITIONS = ALL_PLUGIN_TOOLS.map((tool) => ({
  name: tool.definition.name,
  description: tool.definition.description
}))

export function getDefaultPluginToolNamesForType(pluginType?: string): string[] {
  const type = (pluginType ?? '').toLowerCase()
  if (type === 'weixin-official') return [...WEIXIN_PLUGIN_TOOL_NAMES]
  if (type === 'feishu-bot' || type === 'feishu') return [...FEISHU_PLUGIN_TOOL_NAMES]
  return [...COMMON_PLUGIN_TOOL_NAMES]
}

let _registered = false

export function registerPluginTools(): void {
  if (_registered) return
  _registered = true
  for (const tool of ALL_PLUGIN_TOOLS) {
    toolRegistry.register(tool)
  }
}

export function unregisterPluginTools(): void {
  if (!_registered) return
  _registered = false
  for (const tool of ALL_PLUGIN_TOOLS) {
    toolRegistry.unregister(tool.definition.name)
  }
}

export function isPluginToolsRegistered(): boolean {
  return _registered
}
