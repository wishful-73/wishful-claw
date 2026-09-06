/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { ChannelProviderDescriptor } from './channel-types'

/** Optional WS relay URL — only for platforms without native WS support */
const wsRelayField = {
  key: 'wsUrl',
  label: 'channel.wsUrl',
  type: 'text' as const,
  required: false,
  placeholder: 'wss://your-relay-server/ws'
}

const COMMON_PLUGIN_TOOLS = [
  'ChannelSendImage',
  'ChannelSendFile',
  'PluginSendMessage',
  'PluginReplyMessage',
  'PluginGetGroupMessages',
  'PluginListGroups',
  'PluginSummarizeGroup',
  'PluginGetCurrentChatMessages'
]

const FEISHU_PLUGIN_TOOLS = [
  ...COMMON_PLUGIN_TOOLS,
  'FeishuSendImage',
  'FeishuSendFile',
  'FeishuListChatMembers',
  'FeishuAtMember',
  'FeishuSendUrgent',
  'FeishuBitableListApps',
  'FeishuBitableListTables',
  'FeishuBitableListFields',
  'FeishuBitableGetRecords',
  'FeishuBitableCreateRecords',
  'FeishuBitableUpdateRecords',
  'FeishuBitableDeleteRecords'
]

const WEIXIN_PLUGIN_TOOLS = [...COMMON_PLUGIN_TOOLS, 'WeixinSendImage', 'WeixinSendFile']

/** Built-in channel provider descriptors */
export const CHANNEL_PROVIDERS: ChannelProviderDescriptor[] = [
  // ── China ──
  {
    type: 'weixin-official',
    displayName: '微信',
    description: 'WeChat Official channel (QR login + long polling)',
    icon: 'wechat',
    builtin: true,
    tools: WEIXIN_PLUGIN_TOOLS,
    configSchema: [
      {
        key: 'baseUrl',
        label: 'channel.weixin.baseUrl',
        type: 'text',
        required: false,
        placeholder: 'https://ilinkai.weixin.qq.com'
      },
      {
        key: 'routeTag',
        label: 'channel.weixin.routeTag',
        type: 'text',
        required: false,
        placeholder: 'optional'
      },
      {
        key: 'token',
        label: 'channel.weixin.token',
        type: 'secret',
        required: false
      },
      {
        key: 'accountId',
        label: 'channel.weixin.accountId',
        type: 'text',
        required: false
      },
      {
        key: 'userId',
        label: 'channel.weixin.userId',
        type: 'text',
        required: false
      }
    ]
  },
  {
    type: 'feishu-bot',
    displayName: '飞书',
    description: 'Lark/Feishu messaging bot (built-in WS)',
    icon: 'feishu',
    builtin: true,
    tools: FEISHU_PLUGIN_TOOLS,
    configSchema: [
      {
        key: 'appId',
        label: 'channel.feishu.appId',
        type: 'text',
        required: true,
        placeholder: 'cli_xxxxx'
      },
      {
        key: 'appSecret',
        label: 'channel.feishu.appSecret',
        type: 'secret',
        required: true
      }
    ]
  },
  {
    type: 'qq-bot',
    displayName: 'QQ 机器人',
    description: 'Tencent QQ Bot (official Gateway WS)',
    icon: 'qq',
    builtin: true,
    tools: COMMON_PLUGIN_TOOLS,
    configSchema: [
      {
        key: 'appId',
        label: 'channel.qq.appId',
        type: 'text',
        required: true
      },
      {
        key: 'clientSecret',
        label: 'channel.qq.clientSecret',
        type: 'secret',
        required: true
      },
      {
        key: 'useSandbox',
        label: 'channel.qq.useSandbox',
        type: 'text',
        placeholder: 'true / false'
      },
      {
        key: 'markdownSupport',
        label: 'channel.qq.markdownSupport',
        type: 'text',
        placeholder: 'true / false'
      }
    ]
  },
  {
    type: 'dingtalk-bot',
    displayName: '钉钉',
    description: 'DingTalk messaging bot (built-in WS via Stream API)',
    icon: 'dingtalk',
    builtin: true,
    tools: COMMON_PLUGIN_TOOLS,
    configSchema: [
      {
        key: 'appKey',
        label: 'channel.dingtalk.appKey',
        type: 'text',
        required: true
      },
      {
        key: 'appSecret',
        label: 'channel.dingtalk.appSecret',
        type: 'secret',
        required: true
      },
      {
        key: 'cardTemplateId',
        label: 'channel.dingtalk.cardTemplateId',
        type: 'text',
        required: false,
        placeholder: 'AI streaming card template ID (optional)'
      }
    ]
  },
  {
    type: 'wecom-bot',
    displayName: '企业微信',
    description: 'WeCom messaging bot',
    icon: 'wecom',
    builtin: true,
    tools: COMMON_PLUGIN_TOOLS,
    configSchema: [
      {
        key: 'corpId',
        label: 'channel.wecom.corpId',
        type: 'text',
        required: true
      },
      {
        key: 'secret',
        label: 'channel.wecom.secret',
        type: 'secret',
        required: true
      },
      {
        key: 'agentId',
        label: 'channel.wecom.agentId',
        type: 'text',
        required: true
      },
      wsRelayField
    ]
  },
  // ── International ──
  {
    type: 'telegram-bot',
    displayName: 'Telegram',
    description: 'Telegram messaging bot (needs WS relay)',
    icon: 'telegram',
    builtin: true,
    tools: COMMON_PLUGIN_TOOLS,
    configSchema: [
      {
        key: 'botToken',
        label: 'channel.telegram.botToken',
        type: 'secret',
        required: true
      },
      wsRelayField
    ]
  },
  {
    type: 'discord-bot',
    displayName: 'Discord',
    description: 'Discord messaging bot (built-in Gateway WS)',
    icon: 'discord',
    builtin: true,
    tools: COMMON_PLUGIN_TOOLS,
    configSchema: [
      {
        key: 'botToken',
        label: 'channel.discord.botToken',
        type: 'secret',
        required: true
      }
    ]
  },
  {
    type: 'whatsapp-bot',
    displayName: 'WhatsApp',
    description: 'WhatsApp Cloud API bot (needs WS relay)',
    icon: 'whatsapp',
    builtin: true,
    tools: COMMON_PLUGIN_TOOLS,
    configSchema: [
      {
        key: 'phoneNumberId',
        label: 'channel.whatsapp.phoneNumberId',
        type: 'text',
        required: true
      },
      {
        key: 'accessToken',
        label: 'channel.whatsapp.accessToken',
        type: 'secret',
        required: true
      },
      wsRelayField
    ]
  }
]
