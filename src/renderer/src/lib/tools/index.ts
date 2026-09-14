/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { registerTaskTools } from './todo-tool'
import { registerFsTools } from './fs-tool'
import { registerSearchTools } from './search-tool'
import {
  registerCodeGraphExploreTool,
  unregisterCodeGraphExploreTool,
  isCodeGraphExploreToolRegistered,
  registerCodeGraphFullSurface,
  unregisterCodeGraphFullSurface,
  isCodeGraphFullSurfaceRegistered
} from './codegraph-tool'
import { useSettingsStore } from '../../stores/settings-store'
import { registerBashTools } from './bash-tool'
import { registerTeamTools } from '../agent/teams/register'
import { registerWidgetTools } from './widget-tool'
import { registerAskUserTools } from './ask-user-tool'
import { registerPlanTools } from './plan-tool'
import { registerCronTools } from './cron-tool'
import { registerNotifyTool } from './notify-tool'
import { registerGoalTools } from './goal-tool'
import { registerMemoryTools } from './memory-tool'
import { refreshDynamicToolCatalog } from './dynamic-tool-catalog'
import { registerCodeCompatibleTools } from './code-compatible-tool'
import { registerSkillManagementTools } from './skill-management-tool'
import { registerBrowserSearchTool } from './browser-search'

let _allToolsRegistered = false

export async function registerAllTools(): Promise<void> {
  if (_allToolsRegistered) return
  _allToolsRegistered = true

  registerTaskTools()
  registerFsTools()
  registerSearchTools()
  // Note: codegraph_explore is NOT registered here — it's registered/unregistered
  // dynamically based on the codegraphEnabled setting (see codegraph-tool.ts)
  registerBashTools()
  registerWidgetTools()
  registerAskUserTools()
  registerPlanTools()
  registerCronTools()
  registerNotifyTool()
  registerGoalTools()
  registerMemoryTools()

  // Skills and SubAgents are user-editable catalogs; load them once here and
  // refresh them again before every request via ensureRequestToolCatalogFresh().
  await refreshDynamicToolCatalog()

  // Code-agent-compatible aliases and tool shells layer over the existing
  // WishfulClaw implementations.
  registerCodeCompatibleTools()

  // Skill management tools for the installation assistant agent
  registerSkillManagementTools()

  // Multi-engine web search (no API key required). Always on — the engine set
  // and intent routing are configured in Settings, not by registering/unregistering.
  registerBrowserSearchTool()

  // Agent Team tools
  registerTeamTools()

  // Plugin tools are registered/unregistered dynamically via channel-store toggle
  // They are NOT registered here — see plugin-tools.ts registerPluginTools/unregisterPluginTools
}

export function updateCodeGraphToolRegistration(enabled: boolean): void {
  const isRegistered = isCodeGraphExploreToolRegistered()
  if (enabled && !isRegistered) {
    registerCodeGraphExploreTool()
  } else if (!enabled && isRegistered) {
    unregisterCodeGraphExploreTool()
  }

  // Full 8-tool surface (M7-W3): opt-in via settings.codegraphFullToolSurface;
  // the worker's tools-list shapes what actually registers (tiny-repo gating,
  // allowlist). Fire-and-forget — registration failure keeps explore-only.
  const wantFull = enabled && useSettingsStore.getState().codegraphFullToolSurface
  if (wantFull && !isCodeGraphFullSurfaceRegistered()) {
    void registerCodeGraphFullSurface()
  } else if (!wantFull && isCodeGraphFullSurfaceRegistered()) {
    unregisterCodeGraphFullSurface()
  }
}

export { ensureRequestToolCatalogFresh, refreshDynamicToolCatalog } from './dynamic-tool-catalog'
