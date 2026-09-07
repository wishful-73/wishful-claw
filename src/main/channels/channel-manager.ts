/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type {
  ChannelInstance,
  ChannelEvent,
  MessagingChannelService,
  ChannelServiceFactory,
  ChannelWsMessageParser
} from './channel-types'
import type { BasePluginService } from './base-plugin-service'

/**
 * ChannelManager — manages channel service lifecycle with a factory registry pattern.
 * Adding a new provider = register one factory function.
 */
export class ChannelManager {
  private factories = new Map<string, ChannelServiceFactory>()
  private parsers = new Map<string, ChannelWsMessageParser>()
  private services = new Map<string, MessagingChannelService>()
  private statuses = new Map<string, 'running' | 'stopped' | 'error'>()

  /** Register a service factory for a plugin type */
  registerFactory(type: string, factory: ChannelServiceFactory): void {
    this.factories.set(type, factory)
  }

  /** Register a WS message parser for a plugin type */
  registerParser(type: string, parser: ChannelWsMessageParser): void {
    this.parsers.set(type, parser)
  }

  /** Start a plugin instance — creates service via factory, calls .start() */
  async startPlugin(
    instance: ChannelInstance,
    notify: (event: ChannelEvent) => void
  ): Promise<void> {
    // Stop existing service if running
    if (this.services.has(instance.id)) {
      await this.stopPlugin(instance.id)
    }

    const factory = this.factories.get(instance.type)
    if (!factory) {
      const error = new Error(`No factory registered for type: ${instance.type}`)
      console.error(`[ChannelManager] ${error.message}`)
      this.statuses.set(instance.id, 'error')
      throw error
    }

    try {
      const service = await factory(instance, notify)

      // Lazy factories may register their parser while resolving the provider module.
      const parser = this.parsers.get(instance.type)
      if (parser && typeof (service as BasePluginService).setParser === 'function') {
        ;(service as BasePluginService).setParser(parser)
      }

      this.services.set(instance.id, service)
      this.statuses.set(instance.id, 'stopped')
      await service.start()
      this.statuses.set(instance.id, 'running')
      console.log(`[ChannelManager] Started channel: ${instance.name} (${instance.id})`)
    } catch (err) {
      console.error(`[ChannelManager] Failed to start channel ${instance.id}:`, err)
      this.statuses.set(instance.id, 'error')
      this.services.delete(instance.id)
      throw err
    }
  }

  async stopPlugin(id: string): Promise<void> {
    const service = this.services.get(id)
    if (!service) return

    try {
      await service.stop()
      console.log(`[ChannelManager] Stopped channel: ${id}`)
    } catch (err) {
      console.error(`[ChannelManager] Error stopping channel ${id}:`, err)
    } finally {
      this.services.delete(id)
      this.statuses.set(id, 'stopped')
    }
  }

  async restartPlugin(
    instance: ChannelInstance,
    notify: (event: ChannelEvent) => void
  ): Promise<void> {
    await this.stopPlugin(instance.id)
    await this.startPlugin(instance, notify)
  }

  getService(id: string): MessagingChannelService | undefined {
    return this.services.get(id)
  }

  getStatus(id: string): 'running' | 'stopped' | 'error' {
    return this.statuses.get(id) ?? 'stopped'
  }

  hasFactory(type: string): boolean {
    return this.factories.has(type)
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.services.keys())
    await Promise.allSettled(ids.map((id) => this.stopPlugin(id)))
    console.log(`[ChannelManager] All channels stopped`)
  }
}
