export type { BuiltinProviderPreset } from '@renderer/stores/providers/types'

import { openaiPreset } from '@renderer/stores/providers/openai'
import { anthropicPreset } from '@renderer/stores/providers/anthropic'
import { deepseekPreset } from '@renderer/stores/providers/deepseek'
import { openrouterPreset } from '@renderer/stores/providers/openrouter'
import { ollamaPreset } from '@renderer/stores/providers/ollama'
import { azureOpenaiPreset } from '@renderer/stores/providers/azure-openai'
import { googlePreset } from '@renderer/stores/providers/google'
import { longcatPreset } from '@renderer/stores/providers/longcat'
import { moonshotPreset, moonshotCodingPreset } from '@renderer/stores/providers/moonshot'
import { qwenPreset, qwenCodingPreset } from '@renderer/stores/providers/qwen'
import { minimaxPreset, minimaxCodingPreset } from '@renderer/stores/providers/minimax'
import { baiduPreset, baiduCodingPreset } from '@renderer/stores/providers/baidu'
import { siliconflowPreset } from '@renderer/stores/providers/siliconflow'
import { giteeAiPreset } from '@renderer/stores/providers/gitee-ai'
import { xiaomiPreset, xiaomiCodingPreset } from '@renderer/stores/providers/xiaomi'
import { bigmodelPreset, bigmodelCodingPreset } from '@renderer/stores/providers/bigmodel'
import { volcenginePreset } from '@renderer/stores/providers/volcengine'
import { xaiPreset } from '@renderer/stores/providers/x-ai'
import { cerebrasPreset } from '@renderer/stores/providers/cerebras'
import { fireworksPreset } from '@renderer/stores/providers/fireworks'
import { groqPreset } from '@renderer/stores/providers/groq'
import { huggingfacePreset } from '@renderer/stores/providers/huggingface'
import { hunyuanPreset } from '@renderer/stores/providers/hunyuan'
import { infiniPreset } from '@renderer/stores/providers/infini'
import { lmstudioPreset } from '@renderer/stores/providers/lmstudio'
import { metaPreset } from '@renderer/stores/providers/meta'
import { mistralPreset } from '@renderer/stores/providers/mistral'
import { modelscopePreset } from '@renderer/stores/providers/modelscope'
import { novitaPreset } from '@renderer/stores/providers/novita'
import { nvidiaPreset } from '@renderer/stores/providers/nvidia'
import { opencodePreset } from '@renderer/stores/providers/opencode'
import { opencodeGoPreset } from '@renderer/stores/providers/opencode-go'
import { ppioPreset } from '@renderer/stores/providers/ppio'
import { stepfunPreset } from '@renderer/stores/providers/stepfun'
import { togetherPreset } from '@renderer/stores/providers/together'
import { codexOAuthPreset } from '@renderer/stores/providers/codex-oauth'
import { copilotOAuthPreset } from '@renderer/stores/providers/copilot-oauth'
import type { BuiltinProviderPreset } from '@renderer/stores/providers/types'

export const builtinProviderPresets: BuiltinProviderPreset[] = [
  openaiPreset,
  anthropicPreset,
  googlePreset,
  deepseekPreset,
  openrouterPreset,
  ollamaPreset,
  azureOpenaiPreset,
  longcatPreset,
  moonshotCodingPreset,
  moonshotPreset,
  qwenCodingPreset,
  qwenPreset,
  minimaxCodingPreset,
  minimaxPreset,
  baiduCodingPreset,
  baiduPreset,
  siliconflowPreset,
  giteeAiPreset,
  xiaomiCodingPreset,
  xiaomiPreset,
  bigmodelCodingPreset,
  bigmodelPreset,
  volcenginePreset,
  xaiPreset,
  cerebrasPreset,
  fireworksPreset,
  groqPreset,
  huggingfacePreset,
  hunyuanPreset,
  infiniPreset,
  lmstudioPreset,
  metaPreset,
  mistralPreset,
  modelscopePreset,
  novitaPreset,
  nvidiaPreset,
  opencodePreset,
  opencodeGoPreset,
  ppioPreset,
  stepfunPreset,
  togetherPreset,
  codexOAuthPreset,
  copilotOAuthPreset
]
