/*
 * S-270 回归：工具名显示必须全覆盖。
 *
 * 为什么不能只靠 `test:i18n-coverage` —— 那个测试静态扫 `t('字面量')`，而工具名的
 * 取键是 `t(`permission.toolLabels.${name}`)`，动态拼接，静态扫**天生扫不到**。
 * 于是「新工具没补中文」这件事一路静默到用户脸上（老大 2026-10-29 报的现象）。
 *
 * 这里换成另一半判据：**扫代码里声明的工具名，反过来查表**。
 * 新增工具常量却忘了补 `permission.toolLabels` ⇒ 这条测试直接红。
 *
 * 第二组钉 `resolveToolDisplayName` 的兜底链路：即便扫漏了、或者工具来自插件 /
 * MCP 这类运行时名字，也绝不允许把裸 camelCase / snake_case 丢到界面上。
 */

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { normalizeToolName } from '../../src/renderer/src/lib/tools/tool-name-aliases'
import { resolveToolDisplayName } from '../../src/renderer/src/lib/tools/tool-display-name'

const repoRoot = path.resolve(__dirname, '../../..')
const sourceRoot = path.join(repoRoot, 'src/renderer/src')
const localesRoot = path.join(sourceRoot, 'locales')
const runtimeRoot = path.join(repoRoot, 'src/runtime')

const tests: Array<[string, () => void]> = []

function test(name: string, run: () => void): void {
  tests.push([name, run])
}

/** `t` 的替身：先查表，再走 `defaultValue`，两者都要做插值；都落空返回 key（同 i18next）。 */
function fakeT(key: string, options?: Record<string, unknown>): string {
  const found = lookup(key)
  const fallback = options?.defaultValue
  const template = found ?? (typeof fallback === 'string' ? fallback : null)
  if (template == null) return key
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(options?.[k] ?? ''))
}

const zhChat = JSON.parse(
  fs.readFileSync(path.join(localesRoot, 'zh/chat.json'), 'utf8').replace(/^\uFEFF/, '')
) as Record<string, unknown>
const enChat = JSON.parse(
  fs.readFileSync(path.join(localesRoot, 'en/chat.json'), 'utf8').replace(/^\uFEFF/, '')
) as Record<string, unknown>

function lookup(key: string): string | null {
  const walk = (root: Record<string, unknown>): string | null => {
    let node: unknown = root
    for (const part of key.split('.')) {
      if (!node || typeof node !== 'object') return null
      node = (node as Record<string, unknown>)[part]
    }
    return typeof node === 'string' ? node : null
  }
  return walk(zhChat)
}

const zhLabels = (zhChat as any).permission.toolLabels as Record<string, string>
const enLabels = (enChat as any).permission.toolLabels as Record<string, string>

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!/^(node_modules|out|dist)$/.test(entry.name)) walkFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * 扫「工具名常量」：变量名含 `TOOL_NAME` / `TOOL_NAMES`，值里的字符串字面量。
 *
 * 只认同一个 `=` 表达式内的字面量（最多 400 字符），避免把文件里无关字符串带进来。
 * 过滤掉明显不是工具名的（小写单词、连字符指令名），保留 camelCase / snake_case 工具名。
 */
function collectDeclaredToolNames(): Map<string, string> {
  const found = new Map<string, string>()
  const declRe =
    /\b(?:const|let)\s+(\w*TOOL_NAMES?\w*)\b\s*(?::[^=\r\n]+)?=\s*([\s\S]{0,400}?)(?=\r?\n\r?\n|\r?\nexport|\r?\n\/\*|$)/g

  for (const file of walkFiles(sourceRoot)) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(declRe)) {
      const [, varName, body] = match
      for (const literal of body.matchAll(/'([^'\r\n]{1,64})'/g)) {
        const name = literal[1]
        // 工具名特征：含大写字母或下划线。纯小写单词多半是分类值（'hidden' / 'custom'）。
        if (!/[A-Z_]/.test(name)) continue
        // 指令 / 通道名之类：带连字符的短串
        if (name.includes('-')) continue
        if (!found.has(name)) found.set(name, path.relative(repoRoot, file))
      }
    }
  }
  return found
}

function walkCsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!/^(node_modules|out|dist|bin|obj)$/.test(entry.name)) walkCsFiles(full, out)
    } else if (/\.cs$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * 扫 **C# 侧** 的第一方工具名。
 *
 * dev 第 7 轮审查坐实的漏网：第一版只扫 `src/renderer/src` 的 TS 常量，而 cron / goal /
 * 全局任务 / 子代理 / Terminal / Monitor 这些工具**全在 C# 里声明**，一道闸都没看着 ——
 * 于是 60+ 个第一方工具长期只有「工具 · 原名」兜底，本该有中文。
 *
 * 两种声明方式（都收）：
 *  1. `registry.Register(new ToolDefinitionPlaceholder("CronList", ...))` —— Provider 注册
 *  2. `public string Name => "SubAgentStatus";` —— IToolExecutor 实现
 *
 * 只扫 `Tools/` 目录：Module / Resolver 也有 `public string Name => "git"` 这类同名属性，
 * 混进来会把模块名当工具名。纯小写无下划线的名字再过滤一次（同 TS 侧判据）。
 */
function collectCsharpToolNames(): Map<string, string> {
  const found = new Map<string, string>()
  const patterns = [
    /ToolDefinitionPlaceholder\s*\(\s*"([A-Za-z0-9_]+)"/g,
    /public\s+string\s+Name\s*=>\s*"([A-Za-z0-9_]+)"/g
  ]

  for (const file of walkCsFiles(runtimeRoot)) {
    if (!/[\\/]Tools[\\/]/.test(file)) continue
    const source = fs.readFileSync(file, 'utf8')
    const rel = path.relative(repoRoot, file)
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const name = match[1]
        if (!/[A-Z_]/.test(name)) continue
        if (!found.has(name)) found.set(name, rel)
      }
    }
  }
  return found
}

test('zh 与 en 的 toolLabels 键集完全一致', () => {
  const zhKeys = Object.keys(zhLabels).sort()
  const enKeys = Object.keys(enLabels).sort()
  const onlyZh = zhKeys.filter((k) => !(k in enLabels))
  const onlyEn = enKeys.filter((k) => !(k in zhLabels))
  assert.deepEqual(
    { onlyZh, onlyEn },
    { onlyZh: [], onlyEn: [] },
    `zh/en 标签键集不一致：只在中 ${onlyZh.join(',')}；只在英 ${onlyEn.join(',')}`
  )
  assert.ok(zhKeys.length >= 60, `toolLabels 只剩 ${zhKeys.length} 条，疑似被误删`)
})

test('代码里声明的每个工具名都有中文标签', () => {
  const declared = collectDeclaredToolNames()
  assert.ok(declared.size > 0, '一个工具名常量都没扫到 —— 扫描正则失效了')
  const missing: string[] = []
  for (const [name, file] of declared) {
    const normalized = normalizeToolName(name)
    if (!(normalized in zhLabels)) missing.push(`${name} (${file})`)
  }
  assert.deepEqual(
    missing,
    [],
    `这些工具名没有 permission.toolLabels 条目（新工具忘了补中文 ⇒ 界面露英文）：\n  ` +
      missing.join('\n  ')
  )
})

test('C# 侧声明的每个第一方工具名都有中文标签', () => {
  const declared = collectCsharpToolNames()
  assert.ok(
    declared.size >= 90,
    `只扫到 ${declared.size} 个 C# 工具名 —— 判据失效了（应 ≥ 90）`
  )
  const missing: string[] = []
  const missingEn: string[] = []
  for (const [name, file] of declared) {
    const normalized = normalizeToolName(name)
    if (!(normalized in zhLabels)) missing.push(`${name} (${file})`)
    if (!(normalized in enLabels)) missingEn.push(`${name} (${file})`)
  }
  assert.deepEqual(
    missing,
    [],
    `这些 C# 第一方工具缺中文标签（聊天窗会显示「工具 · 原名」）：\n  ` + missing.join('\n  ')
  )
  assert.deepEqual(missingEn, [], `这些 C# 第一方工具缺英文标签：\n  ` + missingEn.join('\n  '))
})

test('中文标签里不出现裸露的英文工具名', () => {
  // 专有名词/技术名词白名单：这些本来就该是拉丁字母
  const allowLatin = /^(PowerShell|Shell|MCP|URL|AI|API|SSH)/
  const offenders = Object.entries(zhLabels)
    .filter(([, value]) => /[A-Za-z]{2,}/.test(value) && !allowLatin.test(value))
    .map(([key, value]) => `${key} → ${value}`)
  assert.deepEqual(offenders, [], `中文标签里混了英文：\n  ${offenders.join('\n  ')}`)
})

test('resolveToolDisplayName 命中表里的中文', () => {
  assert.equal(resolveToolDisplayName('Read', fakeT), '读取文件')
  assert.equal(resolveToolDisplayName('BrowserNavigate', fakeT), '打开网址')
  assert.equal(resolveToolDisplayName('DesktopScreenshot', fakeT), '桌面截图')
  assert.equal(resolveToolDisplayName('create_goal', fakeT), '新建目标')
  assert.equal(resolveToolDisplayName('RequestSandboxElevation', fakeT), '申请关闭沙箱')
  assert.equal(resolveToolDisplayName('use_capability', fakeT), '调用能力')
})

test('历史别名归一后再查表（BrowserSearch → WebSearch）', () => {
  assert.equal(resolveToolDisplayName('BrowserSearch', fakeT), '搜索网页')
})

test('codegraph 前缀族显示成「代码图谱 · 动作」，不做裸回退', () => {
  assert.equal(resolveToolDisplayName('codegraph_explore', fakeT), '代码图谱 · 探索')
  const unknownAction = resolveToolDisplayName('codegraph_bogus_action', fakeT)
  assert.ok(unknownAction.startsWith('代码图谱 · '), unknownAction)
})

test('MCP 工具拆词大写，不显示 mcp__ 原文', () => {
  const label = resolveToolDisplayName('mcp__my_server__do_thing', fakeT)
  assert.equal(label, 'Do thing')
  assert.ok(!label.includes('mcp__'), label)
})

test('表里没有的工具兜底成「工具 · 原名」，绝不裸回退', () => {
  const label = resolveToolDisplayName('SomeBrandNewTool', fakeT)
  assert.equal(label, '工具 · SomeBrandNewTool')
})

test('空工具名不炸', () => {
  assert.equal(resolveToolDisplayName('', fakeT), '未知工具')
})

function main(): void {
  for (const [name, run] of tests) {
    run()
    console.log(`PASS: ${name}`)
  }
  console.log(`Tool label coverage tests passed: ${tests.length}`)
}

main()
