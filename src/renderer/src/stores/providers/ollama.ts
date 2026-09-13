/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { BuiltinProviderPreset } from '@renderer/stores/providers/types'

export const ollamaPreset: BuiltinProviderPreset = {
  builtinId: 'ollama',
  version: 2,
  name: 'Ollama',
  type: 'openai-chat',
  defaultBaseUrl: 'http://localhost:11434/v1',
  homepage: 'https://ollama.com',
  apiKeyUrl: 'https://ollama.com/download',
  defaultModels: [],
  requiresApiKey: false
}
