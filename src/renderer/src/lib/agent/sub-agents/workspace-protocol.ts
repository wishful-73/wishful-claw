/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

export function resolveSubAgentWorkspaceProtocolPrompt(): null {
  return null
}

export function appendSystemPromptSection(systemPrompt: string, section: string | null): string {
  if (!section?.trim()) return systemPrompt
  return `${systemPrompt.trim()}\n\n${section.trim()}`
}
