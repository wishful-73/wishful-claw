/**
 * Fallback fetch for release notes (iter-38 S-175 ②).
 *
 * `latest.yml` carries `releaseNotes` only when a build was told to inline it, and this project
 * never told it to: the field is produced from `releaseInfo` / `build/release-notes.md`, neither of
 * which is configured, so published manifests stay clean. The notes travel instead as
 * `release-notes-<version>.md`, published next to the manifest.
 *
 * Two rules shape this module:
 *
 * - The publish URL is read from the update config electron-builder wrote into the package
 *   (`app-update.yml`), never hard-coded here. The notes must live in the directory the updater
 *   trusts, and a second copy of the URL would be a second source of truth. Upstream keeps
 *   `loadUpdateConfig()` / `_appUpdateConfigPath` private, so the file is read directly.
 * - The file name carries the version, and a miss means "no notes", never another version's notes:
 *   a stale document offered next to an update is worse than none, the same stance taken with the
 *   blockmap cleanup.
 *
 * Kept free of Electron imports on purpose: the rules are pure and are covered by
 * `tests/release-notes-fetch`, which runs in plain node. The main process passes
 * `process.resourcesPath` / `app.getAppPath()` in.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const PACKAGED_UPDATE_CONFIG_FILE = 'app-update.yml'
export const DEV_UPDATE_CONFIG_FILE = 'dev-app-update.yml'

/**
 * Long enough for a small document served by the same host that just answered the update check,
 * short enough that a dark server cannot hold the announcement hostage.
 */
const DEFAULT_TIMEOUT_MS = 5_000

/** The version becomes a path segment, so anything stepping outside one is refused outright. */
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/

export function releaseNotesFileName(version: string): string | null {
  const trimmed = version.trim()
  if (!SAFE_VERSION.test(trimmed)) return null
  return `release-notes-${trimmed}.md`
}

export function buildReleaseNotesUrl(publishUrl: string, version: string): string | null {
  const name = releaseNotesFileName(version)
  const base = publishUrl.trim()
  if (!name || !base) return null
  const separator = base.endsWith('/') ? '' : '/'
  return `${base}${separator}${name}`
}

/** The `url:` line of an electron-builder update config. */
export function parsePublishUrl(configText: string): string | null {
  for (const line of configText.split(/\r?\n/)) {
    const match = /^\s*url:\s*(.+?)\s*$/.exec(line)
    if (!match) continue
    const value = match[1].replace(/^["']|["']$/g, '').trim()
    return value.length > 0 ? value : null
  }
  return null
}

export interface PublishUrlInput {
  isPackaged: boolean
  /** `process.resourcesPath` — where the packaged `app-update.yml` lives. */
  resourcesPath?: string
  /** `app.getAppPath()` — the repository root in development. */
  appRoot?: string
  /** Injectable for tests; reads from disk otherwise. */
  readFile?: (path: string) => string
}

export function resolvePublishUrl(input: PublishUrlInput): string | null {
  const configPath = input.isPackaged
    ? input.resourcesPath
      ? join(input.resourcesPath, PACKAGED_UPDATE_CONFIG_FILE)
      : null
    : input.appRoot
      ? join(input.appRoot, DEV_UPDATE_CONFIG_FILE)
      : null
  if (!configPath) return null

  const readFile = input.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  try {
    return parsePublishUrl(readFile(configPath))
  } catch {
    // A missing or unreadable config means "no fallback source", not a failure worth surfacing.
    return null
  }
}

export interface FetchReleaseNotesOptions {
  publishUrl: string
  version: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * Returns the notes document for `version`, or an empty string for every kind of miss: unusable
 * version, 404, an empty body, a redirect serving another document, a timeout, a network error.
 * Callers read empty as "this release shipped no notes" — the dialog already has an empty state for
 * it, and a missing document must never block an available update.
 */
export async function fetchReleaseNotes(options: FetchReleaseNotesOptions): Promise<string> {
  const url = buildReleaseNotesUrl(options.publishUrl, options.version)
  if (!url) return ''

  const doFetch = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const response = await doFetch(url, { signal: controller.signal })
    if (!response.ok) return ''
    if (!servesFileNamed(response.url, url)) return ''
    const body = await response.text()
    const trimmed = body.trim()
    return trimmed.length > 0 ? trimmed : ''
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

/** A rewrite rule or a redirect can answer with some other document; only this version's counts. */
function servesFileNamed(finalUrl: string, requestedUrl: string): boolean {
  const fileName = (value: string): string => value.split(/[?#]/)[0].split('/').pop() ?? ''
  const requested = fileName(requestedUrl)
  return requested.length > 0 && fileName(finalUrl) === requested
}
