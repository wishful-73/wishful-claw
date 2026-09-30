/*
 * 图像生成端点解析（iter-37 S-166）。
 *
 * 存在理由：旧实现只认 `type === 'openai'` 的 provider，其余一律报
 * 「No OpenAI-compatible provider with API key configured」—— 用 DeepSeek / 智谱 / Anthropic
 * 的用户生图直接不可用。现在改为「优先当前激活 provider，其次任何声明了图像模型的 provider」，
 * 这里把三条规则钉死：
 *
 *   ① 激活 provider 有图像模型 → 用它（baseUrl / key / model 都取该 provider）
 *   ② 激活 provider 没声明图像模型，但 baseUrl host 在已知映射表里 → 用映射的模型名
 *   ③ 都没有 → 回落到其他可用 provider；再没有就返回 null（调用方给可操作的报错）
 */

import assert from 'node:assert/strict'
import {
  resolveImageEndpoint,
  summarizeApiError,
  type ProviderRecord
} from '../../src/main/lib/image-endpoint'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

const BIGMODEL_BASE = 'https://open.bigmodel.cn/api/paas/v4'
const OPENAI_BASE = 'https://api.openai.com/v1'

function provider(overrides: ProviderRecord): ProviderRecord {
  return { id: 'p1', name: 'Provider One', apiKey: 'sk-test', ...overrides }
}

// ─── 1. 没有任何可用 provider ───

check(resolveImageEndpoint([], 'p1') === null, '空 provider 列表 → null')
check(
  resolveImageEndpoint([provider({ apiKey: '' })], 'p1') === null,
  '无 apiKey 的 provider 被跳过 → null'
)
check(
  resolveImageEndpoint([provider({ baseUrl: 'https://api.deepseek.com/v1', models: [] })], 'p1') ===
    null,
  '激活 provider 无图像模型且 host 不在映射表 → null'
)

// ─── 2. 激活 provider 自己声明了图像模型 ───

const declared = resolveImageEndpoint(
  [
    provider({
      baseUrl: BIGMODEL_BASE,
      models: [
        { id: 'glm-5.3-flash', category: 'chat', enabled: true },
        { id: 'cogview-4', category: 'image', enabled: true }
      ]
    })
  ],
  'p1'
)
check(declared?.model === 'cogview-4', '取激活 provider 声明的图像模型')
check(declared?.baseUrl === BIGMODEL_BASE, 'baseUrl 取该 provider')
check(declared?.apiKey === 'sk-test', 'apiKey 取该 provider')
check(declared?.providerName === 'Provider One', 'providerName 取显示名')
check(declared?.officialOpenAI === false, '智谱端点不算 OpenAI 官方')

check(
  resolveImageEndpoint(
    [
      provider({
        baseUrl: OPENAI_BASE,
        models: [{ id: 'gpt-image-1', category: 'image', enabled: true }]
      })
    ],
    'p1'
  )?.officialOpenAI === true,
  'OpenAI 官方 host 标记 officialOpenAI'
)

// 图像模型优先取 enabled 的那个；全部禁用时仍不放弃（用户显式配过就认）
check(
  resolveImageEndpoint(
    [
      provider({
        baseUrl: OPENAI_BASE,
        models: [
          { id: 'gpt-image-2', category: 'image', enabled: false },
          { id: 'gpt-image-1', category: 'image', enabled: true }
        ]
      })
    ],
    'p1'
  )?.model === 'gpt-image-1',
  '优先取 enabled 的图像模型'
)

// ─── 3. 没声明图像模型，但 host 命中已知映射 ───

const mapped = resolveImageEndpoint([provider({ baseUrl: BIGMODEL_BASE })], 'p1')
check(mapped?.model === 'cogview-3-flash', '智谱 host 命中映射表 → cogview-3-flash')
check(
  resolveImageEndpoint([provider({ baseUrl: `${OPENAI_BASE}/` })], 'p1')?.model === 'gpt-image-1',
  'OpenAI host 命中映射表 → gpt-image-1'
)
check(
  resolveImageEndpoint([provider({ baseUrl: `${OPENAI_BASE}/` })], 'p1')?.baseUrl === OPENAI_BASE,
  'baseUrl 去掉尾部斜杠'
)

// ─── 4. 回落：激活 provider 不可用，用别的 ───

const fallback = resolveImageEndpoint(
  [
    provider({ id: 'active', name: 'Active', baseUrl: 'https://api.deepseek.com/v1' }),
    provider({
      id: 'other',
      name: 'Other',
      baseUrl: OPENAI_BASE,
      models: [{ id: 'gpt-image-1', category: 'image', enabled: true }]
    })
  ],
  'active'
)
check(fallback?.providerName === 'Other', '激活 provider 无图像能力时回落到其他 provider')
check(fallback?.baseUrl === OPENAI_BASE, '回落后 baseUrl 跟着换')

check(
  resolveImageEndpoint(
    [
      provider({ id: 'active', baseUrl: 'https://api.deepseek.com/v1' }),
      provider({ id: 'other', baseUrl: BIGMODEL_BASE })
    ],
    'active'
  )?.providerName === 'Provider One',
  '回落也认映射表命中的 provider'
)

// 激活 provider 优先于顺序更靠前、能力更强的 provider
const prefersActive = resolveImageEndpoint(
  [
    provider({
      id: 'stronger',
      name: 'Stronger',
      baseUrl: OPENAI_BASE,
      models: [{ id: 'gpt-image-1', category: 'image', enabled: true }]
    }),
    provider({ id: 'active', name: 'Active', baseUrl: BIGMODEL_BASE })
  ],
  'active'
)
check(prefersActive?.providerName === 'Active', '激活 provider 优先于列表顺序')
check(prefersActive?.model === 'cogview-3-flash', '激活 provider 走映射表')

// ─── 5. 显式请求的模型名 ───

check(
  resolveImageEndpoint(
    [
      provider({
        baseUrl: BIGMODEL_BASE,
        models: [
          { id: 'cogview-4', category: 'image', enabled: true },
          { id: 'cogview-3-flash', category: 'image', enabled: true }
        ]
      })
    ],
    'p1',
    'cogview-3-flash'
  )?.model === 'cogview-3-flash',
  '显式请求的模型在该 provider 里存在 → 用它'
)
check(
  resolveImageEndpoint([provider({ baseUrl: BIGMODEL_BASE })], 'p1', 'cogview-4')?.model ===
    'cogview-4',
  '显式请求的模型即使未声明也认（用户自己知道）'
)

// 没有 baseUrl 时按 OpenAI 官方兜底
const noBaseUrl = resolveImageEndpoint([provider({ baseUrl: '' })], 'p1')
check(noBaseUrl?.baseUrl === OPENAI_BASE, '缺 baseUrl → 兜底 OpenAI 官方')
check(noBaseUrl?.model === 'gpt-image-1', '缺 baseUrl 时也按 host 命中映射表')

// ─── 6. 报错摘要：不能让用户看到原始 HTTP 报文 ───

check(
  summarizeApiError('{"error":{"message":"Invalid API key provided"}}') ===
    'Invalid API key provided',
  'OpenAI 风格嵌套 error.message 被取出'
)
check(summarizeApiError('{"error":"model not found"}') === 'model not found', 'error 为字符串时取出')
check(summarizeApiError('{"message":"rate limited"}') === 'rate limited', '顶层 message 被取出')
check(summarizeApiError('   ') === 'no response body', '空响应体给出可读说明')
check(
  summarizeApiError('<html><body>502 Bad Gateway</body></html>') ===
    'provider returned a non-JSON error page',
  'HTML 错误页不原样透出'
)
check(summarizeApiError('{"error":{"code":1210}}') === '{"error":{"code":1210}}', '取不出消息时回落原文')

const longText = 'x'.repeat(500)
const summarized = summarizeApiError(longText)
check(summarized.length === 301, '超长非 JSON 文本截断到 300 字符 + 省略号')
check(summarized.endsWith('…'), '截断后带省略号')

console.log(`image-endpoint: ${checks} checks passed`)
