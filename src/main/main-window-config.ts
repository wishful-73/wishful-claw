import { app } from 'electron'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { registerMessagePackHandler } from './ipc/messagepack-handler'
import { registerPriorityShortcut, unregisterPriorityShortcut } from './priority-shortcuts'
import { toggleMainWindow } from './main-window-visibility'
import { resolveDataDir } from './lib/data-dir'
import { HIDDEN_FLAG } from './startup-flags'

/**
 * The "main window" shortcut tab: config storage, the login-item sync and the
 * IPC endpoints, all in one module.
 *
 * A new file rather than an addition to `priority-shortcuts.ts` or `index.ts`:
 * both are past the 500-line limit with no exemption, and new logic must not
 * grow them further.
 */

/** One config object for the whole tab: read once, written once. */
export interface MainWindowConfig {
  /** Master switch for the show/hide shortcut. */
  enabled: boolean
  /** Global accelerators that toggle the main window. */
  accelerators: string[]
  /** Come up tray-only when launched by the OS login item. */
  hideWindowOnLaunch: boolean
}

/**
 * `accelerators` is empty on purpose: a global shortcut is exclusive, so any
 * default we pick is already owned by another app on some machines, and that
 * collision gets blamed on us instead of on the default.
 *
 * `hideWindowOnLaunch` defaults to off: a login launch that shows nothing is
 * indistinguishable from a failed start for a user who never asked for it.
 * Only an explicit opt-in makes a boot come up tray-only.
 */
const DEFAULT_CONFIG: MainWindowConfig = {
  enabled: false,
  accelerators: [],
  hideWindowOnLaunch: false
}

const CONFIG_FILE = join(resolveDataDir(), 'main-window-config.json')

function loadConfig(): MainWindowConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
      const accelerators = Array.isArray(parsed.accelerators)
        ? parsed.accelerators
            .filter((value: unknown): value is string => typeof value === 'string')
            .filter(
              (value: string, index: number, values: string[]) => values.indexOf(value) === index
            )
        : []
      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_CONFIG.enabled,
        // Deliberately unlike clipboard/launcher, which fall back to
        // `DEFAULT_CONFIG.accelerators` when the stored list is empty: "leave it
        // unbound" is a real choice here, and that fallback would silently
        // re-bind a shortcut the user just cleared.
        accelerators,
        hideWindowOnLaunch:
          typeof parsed.hideWindowOnLaunch === 'boolean'
            ? parsed.hideWindowOnLaunch
            : DEFAULT_CONFIG.hideWindowOnLaunch
      }
    }
  } catch {
    // Missing or corrupt file — fall through to defaults.
  }
  return { ...DEFAULT_CONFIG }
}

let config: MainWindowConfig = loadConfig()

function saveConfig(): void {
  try {
    fs.mkdirSync(resolveDataDir(), { recursive: true, mode: 0o700 })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
  } catch {
    // Non-fatal: the in-memory value still governs this session.
  }
}

/** True when a login-item launch should come up hidden. Read at boot by `index.ts`. */
export function shouldHideWindowOnLaunch(): boolean {
  return config.hideWindowOnLaunch
}

// ── Shortcut registration ──

const SHORTCUT_ID_PREFIX = 'main-window'
const registeredIds: string[] = []

function unregisterShortcuts(): void {
  for (const id of registeredIds) unregisterPriorityShortcut(id)
  registeredIds.length = 0
}

/**
 * (Re)register the toggle shortcut from the current config. Mirrors
 * `quick-launcher.ts`: clear what we own first, refuse when disabled, then
 * register each accelerator and remember the ids so the next pass can clear them.
 */
export function applyMainWindowShortcuts(): boolean {
  unregisterShortcuts()
  if (!config.enabled) return false
  let allOk = true
  for (let index = 0; index < config.accelerators.length; index++) {
    const id = `${SHORTCUT_ID_PREFIX}-${index}`
    const ok = registerPriorityShortcut(id, config.accelerators[index], () => toggleMainWindow())
    registeredIds.push(id)
    if (!ok) allOk = false
  }
  return allOk
}

// ── Login item ──

/**
 * The single writer of the OS login item.
 *
 * `args` is not decoration: the OS stores one literal command line, so
 * `HIDDEN_FLAG` has to be part of it for a boot to come up quiet. Every writer —
 * the renderer's `app:set-login-item-settings`, the settings switch below and
 * the boot reconciliation — goes through here, because three call sites each
 * invoking `setLoginItemSettings` would eventually disagree about the args.
 *
 * Calling it is also what makes a changed `args` take effect: the registry entry
 * is a snapshot, not a reference to our config.
 */
export function applyLoginItem(openAtLogin: boolean, hideWindow: boolean): void {
  app.setLoginItemSettings({
    openAtLogin,
    args: hideWindow ? [HIDDEN_FLAG] : []
  })
}

/**
 * Re-assert the login item once at boot.
 *
 * Two things drift under a stored entry nobody rewrites: an install whose
 * registry command still points at an old path (app updated or moved), and an
 * entry created before this feature existed, which carries no `args` at all.
 * Those users would keep booting with a window while the settings switch reads
 * "on", and nothing would ever correct it. Rewriting on every start makes both
 * self-heal without a migration.
 *
 * The open-at-login value is read back from the OS rather than from our config:
 * that switch lives in the renderer's settings store, and
 * `app:get-login-item-settings` only exposes `openAtLogin`, so the registry is
 * the only source of truth reachable here.
 */
export function reconcileLoginItemOnStartup(): void {
  applyLoginItem(app.getLoginItemSettings().openAtLogin, config.hideWindowOnLaunch)
}

// ── IPC ──

export interface MainWindowConfigUpdateResult extends MainWindowConfig {
  shortcutRegistered: boolean
}

export function registerMainWindowHandlers(): void {
  registerMessagePackHandler<void, MainWindowConfig>('main-window:get-config', () => config)

  registerMessagePackHandler<Partial<MainWindowConfig>, MainWindowConfigUpdateResult>(
    'main-window:update-config',
    (patch) => {
      config = { ...config, ...patch }
      saveConfig()

      let shortcutRegistered = true
      if (patch.enabled !== undefined || patch.accelerators !== undefined) {
        shortcutRegistered = applyMainWindowShortcuts()
      }

      // A login item is a literal command line in the registry, so flipping the
      // switch is not enough on its own — the entry has to be rewritten for the
      // new args to take effect at the next boot.
      if (patch.hideWindowOnLaunch !== undefined) {
        applyLoginItem(app.getLoginItemSettings().openAtLogin, config.hideWindowOnLaunch)
      }

      return { ...config, shortcutRegistered }
    }
  )
}
