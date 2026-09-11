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
 */
export interface GlobalChannelSettings {
  /** Auto-reply to incoming messages using the Agent */
  autoReply: boolean
  /** Display-only this iteration: streaming is decided by the service's `supportsStreaming` */
  streamingReply: boolean
  /** Connect enabled channels when the app launches */
  autoStart: boolean
  /**
   * Ask the user before a channel run executes shell. Gates confirmation only —
   * the shell tools stay visible either way. Replaces the retired `allowShell`,
   * whose name implied a visibility switch.
   */
  shellRequiresApproval: boolean
  /** Display-only this iteration: no enforcement point */
  allowReadHome: boolean
  /** Display-only this iteration: no enforcement point */
  readablePathPrefixes: string[]
  /** Display-only this iteration: no enforcement point */
  allowWriteOutside: boolean
  /** Display-only this iteration: no enforcement point */
  allowSubAgents: boolean
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
  /** Per-tool enablement flags (missing = default enabled) */
  tools?: Record<string, boolean>
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
}

/** Factory function type — registered per provider */
export type ChannelServiceFactory = (
  instance: ChannelInstance,
  notify: (event: ChannelEvent) => void
) => MessagingChannelService | Promise<MessagingChannelService>

/** WebSocket message parser — converts raw WS frames to normalized data */
export type ChannelWsMessageParser = (raw: string) => ChannelIncomingMessageData | null
