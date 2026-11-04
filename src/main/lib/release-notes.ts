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

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PACKAGED_UPDATE_CONFIG_FILE = 'app-update.yml'
export const DEV_UPDATE_CONFIG_FILE = 'dev-app-update.yml'

/**
 * Long enough for a small document served by the same host that just answered the update check,
 * short enough that a dark server cannot hold the announcement hostage.
 */
const DEFAULT_TIMEOUT_MS = 5_000

/** Short enough that the dialog is not held up twice, long enough to outlast a single hiccup. */
const DEFAULT_RETRY_DELAY_MS = 300

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

/** Where the last successfully fetched document is kept, under `userData`. */
export const RELEASE_NOTES_CACHE_FILE = 'release-notes-cache.json'

interface ReleaseNotesCacheFile {
  version?: unknown
  notes?: unknown
}

/**
 * The cached document for exactly `version`, or '' when there is no usable cache.
 *
 * The version check is the whole point: a cached document under another version number is a stale
 * document, and showing the previous release's notes next to a new one reads as a lie — the same
 * stance `releaseNotesFileName` takes. Anything unreadable (missing file, bad JSON, wrong shape) is
 * simply a miss, never an error.
 */
export function readReleaseNotesCache(path: string, version: string): string {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ReleaseNotesCacheFile | null
    if (!parsed || typeof parsed !== 'object') return ''
    if (parsed.version !== version) return ''
    return typeof parsed.notes === 'string' ? parsed.notes.trim() : ''
  } catch {
    return ''
  }
}

/** Best-effort: a cache we cannot write only costs the next fetch, so failures stay silent. */
export function writeReleaseNotesCache(path: string, version: string, notes: string): void {
  if (!notes) return
  try {
    writeFileSync(path, JSON.stringify({ version, notes }), 'utf8')
  } catch {
    // Ignored on purpose — see above.
  }
}

export interface FetchReleaseNotesWithRetryOptions extends FetchReleaseNotesOptions {
  /** Wait before the single retry. Injectable so tests need not sleep. */
  retryDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

/**
 * One retry on top of {@link fetchReleaseNotes} (S-298).
 *
 * Every miss collapses into '' there, which is right for that function's callers but leaves a
 * transient failure indistinguishable from "this release shipped no notes". One short retry absorbs
 * the common case — a 5 s timeout, a single refused connection — without letting a dark server hold
 * the dialog up twice over.
 */
export async function fetchReleaseNotesWithRetry(
  options: FetchReleaseNotesWithRetryOptions
): Promise<string> {
  const first = await fetchReleaseNotes(options)
  if (first) return first
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  await sleep(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)
  return fetchReleaseNotes(options)
}
