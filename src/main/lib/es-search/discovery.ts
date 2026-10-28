/**
 * S-155 —— es.exe 取数层：**可执行文件的发现与挑选**。
 *
 * 探测档位见 `types.ts` 的 `ES_SOURCE_PRIORITY`；本文件只回答「哪些路径可能是 es.exe」与
 * 「按档位挑第一个真正存在的」。**不碰文件系统**：存在性由调用方注入 `exists`，便于回归套件钉死顺序。
 */

import { join } from 'path'
import { getKnownInstallCandidates, isThirdPartyPrivateEverythingPath } from '../everything-search'
import type { EsExeMatch, EsExeSource } from './types'
import { ES_EXE_BASENAME, ES_SOURCE_PRIORITY } from './types'

/**
 * 内置 es.exe 的路径（随安装包分发的 `resources/es/es.exe`）。
 *
 * `resourcesRoot` 由调用方注入 —— dev 下是仓库根的 `resources/`，打包后是 `process.resourcesPath`
 * （electron-builder 的 `extraResources: from resources/es → to es` 把它摊在 `<resources>/es/`）。
 * 本函数不探测、不碰文件系统：是否真存在交给 `pickEsCandidate` 注入的 `exists` 判。
 */
export function getEsBuiltinPath(resourcesRoot: string | null | undefined): string | null {
  const root = (resourcesRoot ?? '').trim()
  if (!root) return null
  return join(root, 'es', ES_EXE_BASENAME)
}

/** 文件名是不是 es.exe（大小写无关；只看 basename）。 */
export function isEsExecutableName(fileName: string): boolean {
  return (fileName ?? '').trim().toLowerCase() === ES_EXE_BASENAME
}

/**
 * es.exe 的版本信息是否可信。传入的是 PowerShell 读出来的 `ProductName|FileDescription`。
 *
 * 判定比 S-151 的 Everything 版多一条：实测 es.exe 的 `ProductName` **就是 `es`**（FileDescription
 * 才是 `Everything Command Line Interface`），只认 `Everything` 会把它误杀。规则：
 *    - **空串（两个字段都空）= 读不到 ⇒ 放行** —— 精简 / 老版本 exe 可能不带版本信息（fail-open）；
 *    - 任一字段恰好等于 `es` ⇒ 命中；
 *    - 整串含 `everything` ⇒ 命中（covers `FileDescription` 那条）；
 *    - 有值但都不沾 ⇒ 拦（挡同名的杂鱼 exe）。
 */
export function isEsVersionInfoHit(versionInfo: string): boolean {
  const raw = (versionInfo ?? '').trim()
  if (!raw) return true
  const fields = raw.split('|').map((field) => field.trim().toLowerCase())
  if (fields.some((field) => field === 'es')) return true
  return /everything/i.test(raw)
}

/**
 * Everything 本体同目录下的 es.exe —— 把手里的 es.exe 跟 Everything 放一起是最常见的用法。
 *
 * 拿不到本体路径（没探到 Everything）时返回空数组。
 */
export function getEsAlongsideCandidates(everythingExePath: string | null | undefined): string[] {
  const path = (everythingExePath ?? '').trim()
  if (!path) return []
  const sep = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (sep <= 0) return []
  return [join(path.slice(0, sep), ES_EXE_BASENAME)]
}

/**
 * 常见安装位下的 es.exe。
 *
 * 目录清单直接复用 S-151 那份（`getKnownInstallCandidates` 覆盖了标准安装、1.5 alpha、winget /
 * scoop / chocolatey 这些不写官方卸载键的位置 —— 维护一份就够），只把文件名换成 `es.exe`。
 */
export function getEsKnownDirCandidates(
  env: Record<string, string | undefined>,
  platform: string = process.platform
): string[] {
  const found: string[] = []
  for (const everythingExe of getKnownInstallCandidates(env, platform)) {
    const sep = Math.max(everythingExe.lastIndexOf('\\'), everythingExe.lastIndexOf('/'))
    if (sep <= 0) continue
    const candidate = join(everythingExe.slice(0, sep), ES_EXE_BASENAME)
    if (!found.includes(candidate)) found.push(candidate)
  }
  return found
}

/**
 * 解析「一行一个 es.exe 绝对路径」的输出（`where es.exe` 的形状）。
 *
 * 跟 S-151 的 `parseExecutablePathLines` 不能共用 —— 那个只认 Everything 本体名，会把 es.exe
 * 全滤掉。第三方私有副本（uTools / WPS 自带那份 Everything 的配套 es.exe）同样剔除：它们挂在
 * 私有的 Everything 实例上，结果被对方的 excludes 规则改写，接上去就是「假故障」。
 */
export function parseEsPathLines(stdout: string): string[] {
  const paths: string[] = []
  for (const rawLine of (stdout ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const base = line.split(/[\\/]/).pop() ?? ''
    if (!isEsExecutableName(base)) continue
    if (isThirdPartyPrivateEverythingPath(line)) continue
    if (!paths.includes(line)) paths.push(line)
  }
  return paths
}

/** 按 `ES_SOURCE_PRIORITY` 挑第一个**实际存在**的候选。`exists` 由调用方注入。 */
export function pickEsCandidate(
  candidatesBySource: Partial<Record<EsExeSource, string[]>>,
  exists: (path: string) => boolean
): EsExeMatch | null {
  for (const source of ES_SOURCE_PRIORITY) {
    for (const candidate of candidatesBySource[source] ?? []) {
      if (candidate && exists(candidate)) return { path: candidate, source }
    }
  }
  return null
}
