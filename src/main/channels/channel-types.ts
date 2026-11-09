/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

// ── Plugin System — Shared Types ──

/** Config field schema for descriptor-driven UI */
export interface ConfigFieldSchema {
  key: string
  label: string
  type: 'text' | 'secret'
  placeholder?: string
  required?: boolean
}

/** Static metadata describing a channel provider type */
export interface ChannelProviderDescriptor {
  type: string
  displayName: string
  description: string
  icon: string
  builtin?: boolean
  configSchema: ConfigFieldSchema[]
  /** Supported tool names for this plugin provider */
  tools?: string[]
}

/**
 * Worker-owned global channel settings. The Worker applies the defaults, so
 * consumers read these fields without local fallbacks — a second default here
 * is how the previous five-way disagreement happened.
 *
 * Only enforced settings live here. Auto-reply is not a switch (a configured channel
 * exists to reply; the per-channel enable flag is the gate), and the retired
 * `streamingReply` / `allowReadHome` / `readablePathPrefixes` / `allowWriteOutside` /
 * `allowSubAgents` were display-only fields no code path ever read.
 */
export interface GlobalChannelSettings {
  /** Connect enabled channels when the app launches */
  autoStart: boolean
  /**
   * Ask the user before a channel run executes shell. Gates confirmation only —
   * the shell tools stay visible either way. Replaces the retired `allowShell`,
   * whose name implied a visibility switch.
   */
  shellRequiresApproval: boolean
}

/** Persisted channel instance configuration */
export interface ChannelInstance {
  id: string
  type: string
  name: string
  enabled: boolean
  builtin?: boolean
  config: Record<string, string>
  createdAt: number
  /** Bound project ID (null = unbound) */
  projectId?: string | null
  /** Provider ID for this plugin's auto-reply agent (null = use global active provider) */
  providerId?: string | null
  /** Model override for this plugin's auto-reply agent (null = use global default) */
  model?: string | null
}

/** Normalized message format returned by all providers */
export interface ChannelMessage {
  id: string
  senderId: string
  senderName: string
  chatId: string
  chatName?: string
  content: string
  timestamp: number
  raw?: unknown
}

/** Normalized group/chat format */
export interface ChannelGroup {
  id: string
  name: string
  memberCount?: number
  raw?: unknown
}

/** Events emitted by channel services */
export interface ChannelEvent {
  type: 'incoming_message' | 'error' | 'status_change'
  pluginId: string
  pluginType: string
  data: unknown
}

/** Incoming message event data */
export interface ChannelIncomingMessageData {
  chatId: string
  senderId: string
  senderName: string
  content: string
  messageId: string
  /** Message timestamp in milliseconds */
  timestamp?: number
  /** Base64-encoded image attachments from the incoming message */
  images?: Array<{ base64: string; mediaType: string }>
  /** Audio attachment metadata (download via platform API) */
  audio?: { fileKey: string; fileName?: string; mediaType?: string; durationMs?: number }
  /**
   * 入站媒体的待下载地址（解析层填，服务层下载后转 images / audio 并清空）。
   * 瞬态字段：只在主进程内活一次，绝不能落库，也不该出现在渲染端。
   */
  mediaRefs?: Array<{ url: string; contentType?: string; fileName?: string }>
  /** Original message type from the platform (e.g. text, image, file) */
  msgType?: string
  /** Resolved chat/group name from the platform */
  chatName?: string
  /** Chat type: p2p (private) or group */
  chatType?: 'p2p' | 'group'
}

/** Streaming message handle — allows incremental updates to a sent message */
export interface ChannelStreamingHandle {
  /** Update the streaming message content (accumulated, not delta) */
  update(content: string): Promise<void>
  /** Finalize the streaming message */
  finish(finalContent: string): Promise<void>
}

/**
 * 出站媒体的形态。
 *
 * 与入站的 `images` / `audio` 对称 —— 那边是「收到了什么」，这边是「要发什么」。
 * 刻意只有三种：`image`（图片）、`file`（任意文件）、`audio`（语音消息）。
 * 视频不单列 —— 走 `file`，能预览的渠道自己认 MIME。
 */
export type ChannelMediaKind = 'image' | 'file' | 'audio'

/**
 * 出站媒体的统一载荷。
 *
 * 只带「要发什么、从哪儿读」，不带平台细节（飞书的 `file_type`、微信的
 * 缩略图之类）—— 那些由各渠道的 `sendMedia` 实现自己推。
 */
export interface ChannelMediaPayload {
  kind: ChannelMediaKind
  /** 本地绝对路径，或 http(s) URL */
  source: string
  /** 显式文件名。缺省从 `source` 推断 */
  fileName?: string
  /** MIME 类型。缺省由渠道实现从扩展名推断 */
  mimeType?: string
  /** 音频时长（毫秒）—— 部分平台限制时长，由渠道实现自行校验 */
  durationMs?: number
}

/** Runtime service interface — every messaging channel must implement this */
export interface MessagingChannelService {
  readonly pluginId: string
  readonly pluginType: string
  /** Stable display name used when a channel session is created for the first time. */
  readonly botName?: string

  // Lifecycle
  start(): Promise<void>
  stop(): Promise<void>
  isRunning(): boolean

  // Unified messaging operations
  sendMessage(chatId: string, content: string): Promise<{ messageId: string }>
  replyMessage(messageId: string, content: string): Promise<{ messageId: string }>
  getGroupMessages(chatId: string, count?: number): Promise<ChannelMessage[]>
  listGroups(): Promise<ChannelGroup[]>

  // Streaming output (optional — override in services that support it)
  supportsStreaming?: boolean
  sendStreamingMessage?(
    chatId: string,
    initialContent: string,
    replyToMessageId?: string
  ): Promise<ChannelStreamingHandle>

  // Outbound media (optional — declare supportedMediaKinds to opt in)
  /**
   * 本渠道能发出的媒体形态。缺省或空数组 = 只能发文本。
   *
   * 调用方不必先查这个字段 —— 走 `sendMediaOrText`（`channel-media.ts`）
   * 会自动降级成文本。这个字段是给「想提前知道」的场景用的。
   */
  readonly supportedMediaKinds?: readonly ChannelMediaKind[]
  /** 发送媒体。只在本渠道 `supportedMediaKinds` 含该形态时才会被调用 */
  sendMedia?(chatId: string, media: ChannelMediaPayload): Promise<{ messageId: string }>
}

/** Factory function type — registered per provider */
export type ChannelServiceFactory = (
  instance: ChannelInstance,
  notify: (event: ChannelEvent) => void
) => MessagingChannelService | Promise<MessagingChannelService>

/** WebSocket message parser — converts raw WS frames to normalized data */
export type ChannelWsMessageParser = (raw: string) => ChannelIncomingMessageData | null
