/*
 * Guard: every key the code asks for must exist in both locale files.
 *
 * Why this exists. Deleting a batch of dead `autoModel*` strings, I removed a line range
 * from the locale JSON and took `topbar.followGlobalModel` and `followGlobalModelDesc`
 * with it — they sat between the keys I meant to drop. Nothing caught it: type checking
 * does not read locale files, and the "zh vs en" comparison I ran only compares the two
 * languages *against each other*, so a key missing from both looks perfectly aligned.
 *
 * The failure mode is quiet in a specific way: those call sites pass a `defaultValue`, so
 * a Chinese user simply saw English — no raw key, no error, nothing in the log.
 *
 * So compare the other axis: what the code references versus what the files define.
 * A key may live in the file's own namespace, an explicit `ns:key`, or `common` (which is
 * both `defaultNS` and `fallbackNS`).
 */

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

// `__dirname` is the bundled output folder (tests/i18n-coverage/out) — three levels up.
const repoRoot = path.resolve(__dirname, '../../..')
const localesRoot = path.join(repoRoot, 'src/renderer/src/locales')
const sourceRoot = path.join(repoRoot, 'src/renderer/src')

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

/** Every leaf of every namespace, per language, as `key` sets. */
function loadNamespaceKeys(): Map<string, { zh: Set<string>; en: Set<string> }> {
  const byNamespace = new Map<string, { zh: Set<string>; en: Set<string> }>()
  for (const language of ['zh', 'en'] as const) {
    const dir = path.join(localesRoot, language)
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      const namespace = file.replace(/\.json$/, '')
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, ''))
      const entry = byNamespace.get(namespace) ?? { zh: new Set<string>(), en: new Set<string>() }
      collectKeys(raw, '', entry[language])
      byNamespace.set(namespace, entry)
    }
  }
  return byNamespace
}

function collectKeys(value: unknown, prefix: string, out: Set<string>): void {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectKeys(child, prefix ? `${prefix}.${key}` : key, out)
    }
    return
  }
  out.add(prefix)
}

/** Source files that can contain translation calls. */
function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'locales' || entry.name === 'node_modules') continue
      found.push(...sourceFiles(full))
      continue
    }
    if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) found.push(full)
  }
  return found
}

const namespaces = loadNamespaceKeys()
const COMMON = 'common'

/** A plural-form key counts as present when its base is. */
function hasKey(namespace: string, key: string): boolean {
  const entry = namespaces.get(namespace)
  if (!entry) return false
  if (entry.zh.has(key) && entry.en.has(key)) return true
  return ['_one', '_other', '_zero', '_two', '_few', '_many'].some(
    (suffix) => entry.zh.has(`${key}${suffix}`) && entry.en.has(`${key}${suffix}`)
  )
}

interface Missing {
  file: string
  key: string
  namespaces: string[]
  /** Namespaces that *do* define the key — empty means it was never written. */
  foundIn: string[]
}

const missing: Missing[] = []

for (const file of sourceFiles(sourceRoot)) {
  const source = fs.readFileSync(file, 'utf8')

  // Namespaces this file may resolve against — the file must declare them for the check to
  // be meaningful. `useTranslation('layout')` and `useTranslation(['a', 'b'])` both count.
  // A file with no declaration has no statically knowable namespace: it either receives
  // `t` as a prop (the caller's namespace decides) or lives in a helper. Checking those
  // against `common` alone produced nothing but false positives, which would train
  // everyone to ignore this guard — so they are skipped.
  const declared: string[] = []
  const prefixes: string[] = []
  for (const match of source.matchAll(/useTranslation\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")([^)]*)/g)) {
    declared.push(
      ...[...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((quoted) => quoted[1])
    )
    // `{ keyPrefix: 'git' }` rewrites every lookup to `git.<key>` — without this the whole
    // namespace reads as missing (13 keys in GitPage alone).
    const prefix = match[2].match(/keyPrefix:\s*['"]([^'"]+)['"]/)
    if (prefix) prefixes.push(prefix[1])
  }
  if (declared.length === 0) continue
  const candidates = [...new Set([...declared, COMMON])]

  // `t('key')` / `t("key")`. Template literals are skipped: they are built at runtime and
  // cannot be checked statically. So is anything preceded by a dot — that is a different
  // i18n instance (`i18next.t`), with its own namespace rules.
  // The options span lines in practice (`{\n  ns: 'settings',`), so the tail has to reach
  // past the closing paren of the next line rather than stopping at the newline.
  for (const match of source.matchAll(/(?:^|[^\w.$])t\(\s*(['"])([^'"\n]+)\1([^)]*)/g)) {
    const raw = match[2]
    if (!raw || raw.includes('${')) continue

    // `t('key', { ns: 'layout' })` overrides the file's namespace for that one call.
    const explicitNs = match[3]?.match(/\bns:\s*['"]([^'"]+)['"]/)?.[1]

    const separator = raw.indexOf(':')
    const lookups =
      separator > 0
        ? [{ key: raw.slice(separator + 1), namespaces: [raw.slice(0, separator), COMMON] }]
        : explicitNs
          ? [{ key: raw, namespaces: [explicitNs, COMMON] }]
          : [raw, ...prefixes.map((prefix) => `${prefix}.${raw}`)].map((key) => ({
              key,
              namespaces: candidates
            }))

    const resolved = lookups.some(
      (lookup) =>
        !lookup.key.split('.').some((segment) => segment.length === 0) &&
        lookup.namespaces.some((namespace) => hasKey(namespace, lookup.key))
    )
    if (resolved) continue

    // Which namespaces *do* have it — tells "wrong namespace" apart from "never defined",
    // which is the difference between fixing a call site and writing a translation.
    const foundIn = [...namespaces.keys()].filter((namespace) =>
      lookups.some((lookup) => hasKey(namespace, lookup.key))
    )

    missing.push({
      file: path.relative(repoRoot, file),
      key: raw,
      namespaces: candidates,
      foundIn
    })
  }
}

if (missing.length > 0) {
  console.error(`Missing translation keys (${missing.length}):`)
  for (const item of missing) {
    const hint = item.foundIn.length
      ? `defined in: ${item.foundIn.join(', ')} — the call site's namespace is wrong`
      : 'not defined in any namespace'
    console.error(`  ${item.file}  →  ${item.key}   (looked in: ${item.namespaces.join(', ')}; ${hint})`)
  }
}

check(missing.length === 0, `every referenced translation key exists in zh and en`)
check(namespaces.size > 0, 'locale namespaces were loaded')

console.log(`i18n coverage checks passed: ${checks}`)
