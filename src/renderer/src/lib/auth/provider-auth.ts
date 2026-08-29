import { getProviderById, setProviderAuth, isAccountRateLimited, getAccountsArray, REFRESH_SKEW_MS } from './provider-auth-utils'
import type { AIProvider, ProviderOAuthAccount, OAuthToken, AccountRateLimit } from '@renderer/lib/api/types'
import { clearCopilotQuota, isCopilotProvider, resolveCopilotApiKey, syncCopilotQuota, exchangeCopilotToken } from './copilot'

export function pickUsableAccount(provider: AIProvider): {

  account: ProviderOAuthAccount | null
  nextAccounts: ProviderOAuthAccount[]
  changed: boolean
} {
  const accounts = getAccountsArray(provider)
  if (accounts.length === 0) {
    return { account: null, nextAccounts: accounts, changed: false }
  }

  const now = Date.now()
  let changed = false
  const swept: ProviderOAuthAccount[] = accounts.map((acc) => {
    if (acc.rateLimit && acc.rateLimit.resetAt <= now) {
      changed = true
      const { rateLimit: _rl, ...rest } = acc
      return rest as ProviderOAuthAccount
    }
    return acc
  })

  // Prefer active account when it's still usable.
  const activeId = provider.activeAccountId
  if (activeId) {
    const active = swept.find((a) => a.id === activeId)
    if (active && !isAccountRateLimited(active)) {
      return { account: active, nextAccounts: swept, changed }
    }
  }

  // Otherwise first non-rate-limited in priority order.
  const firstUsable = swept.find((a) => !isAccountRateLimited(a))
  if (firstUsable) {
    return { account: firstUsable, nextAccounts: swept, changed }
  }

  // All limited → return the one with the earliest resetAt so we still attempt something.
  const earliest = [...swept].sort(
    (a, b) => (a.rateLimit?.resetAt ?? 0) - (b.rateLimit?.resetAt ?? 0)
  )[0]
  return { account: earliest ?? null, nextAccounts: swept, changed }
}

export function buildOAuthProviderPatch(provider: AIProvider, token: OAuthToken): Partial<AIProvider> {
  const apiKey = getProviderApiKey(provider, token)
  const patch: Partial<AIProvider> = {
    authMode: 'oauth',
    oauth: token,
    apiKey
  }
  if (isCopilotProvider(provider) && token.copilotApiUrl) {
    patch.baseUrl = token.copilotApiUrl
  }
  return patch
}

/**
 * Build a provider patch that: replaces the accounts array, updates activeAccountId,
 * and projects the active account's token into the top-level oauth/apiKey/baseUrl fields
 * so provider consumers see the current account transparently.
 */
export function buildAccountProjectionPatch(
  provider: AIProvider,
  accounts: ProviderOAuthAccount[],
  activeAccountId: string
): Partial<AIProvider> {
  const active = accounts.find((a) => a.id === activeAccountId)
  const patch: Partial<AIProvider> = {
    authMode: 'oauth',
    oauthAccounts: accounts,
    activeAccountId
  }
  if (active) {
    patch.oauth = active.oauth
    patch.apiKey = getProviderApiKey(provider, active.oauth)
    if (isCopilotProvider(provider) && active.oauth.copilotApiUrl) {
      patch.baseUrl = active.oauth.copilotApiUrl
    }
  } else {
    patch.oauth = undefined
    patch.apiKey = ''
  }
  return patch
}

export function upsertAccountInList(
  accounts: ProviderOAuthAccount[],
  account: ProviderOAuthAccount
): ProviderOAuthAccount[] {
  const idx = accounts.findIndex((a) => a.id === account.id)
  if (idx >= 0) {
    const next = accounts.slice()
    next[idx] = account
    return next
  }
  return [...accounts, account]
}

function getProviderApiKey(provider: AIProvider, token: OAuthToken): string {
  return isCopilotProvider(provider) ? resolveCopilotApiKey(token) : token.accessToken
}

export async function finalizeOAuthToken(provider: AIProvider, token: OAuthToken): Promise<OAuthToken> {
  if (!isCopilotProvider(provider)) {
    return token
  }
  const next =
    token.copilotAccessToken &&
    token.copilotExpiresAt &&
    token.copilotExpiresAt - Date.now() > REFRESH_SKEW_MS
      ? token
      : await exchangeCopilotToken(provider, token)
  syncCopilotQuota(provider, next)
  return next
}

/** Remove a specific account. If it was active, the next usable account becomes active. */
export function removeOauthAccount(providerId: string, accountId: string): void {
  const provider = getProviderById(providerId)
  if (!provider) return
  const nextAccounts = getAccountsArray(provider).filter((a) => a.id !== accountId)
  if (nextAccounts.length === 0) {
    if (isCopilotProvider(provider)) clearCopilotQuota(provider)
    setProviderAuth(providerId, {
      oauth: undefined,
      apiKey: '',
      oauthAccounts: [],
      activeAccountId: undefined
    })
    return
  }
  const nextActiveId =
    provider.activeAccountId === accountId ? nextAccounts[0].id : provider.activeAccountId!
  setProviderAuth(providerId, buildAccountProjectionPatch(provider, nextAccounts, nextActiveId))
}

/** Disconnect ALL OAuth accounts for this provider (legacy "disconnect OAuth" button). */
export function disconnectProviderOAuth(providerId: string): void {
  const provider = getProviderById(providerId)
  if (provider && isCopilotProvider(provider)) {
    clearCopilotQuota(provider)
  }
  setProviderAuth(providerId, {
    oauth: undefined,
    apiKey: '',
    oauthAccounts: [],
    activeAccountId: undefined
  })
}

/** Set a specific account as active for subsequent requests. */
export function setActiveProviderAccount(providerId: string, accountId: string): void {
  const provider = getProviderById(providerId)
  if (!provider) return
  const accounts = getAccountsArray(provider)
  if (!accounts.some((a) => a.id === accountId)) return
  setProviderAuth(providerId, buildAccountProjectionPatch(provider, accounts, accountId))
}

/** Reorder the accounts array (priority order is array order). */
export function reorderProviderAccounts(providerId: string, orderedIds: string[]): void {
  const provider = getProviderById(providerId)
  if (!provider) return
  const byId = new Map(getAccountsArray(provider).map((a) => [a.id, a] as const))
  const next: ProviderOAuthAccount[] = []
  for (const id of orderedIds) {
    const acc = byId.get(id)
    if (acc) {
      next.push(acc)
      byId.delete(id)
    }
  }
  // Append any accounts that weren't in the provided order (defensive).
  for (const acc of byId.values()) next.push(acc)
  const activeId =
    provider.activeAccountId && next.some((a) => a.id === provider.activeAccountId)
      ? provider.activeAccountId
      : next[0]?.id
  if (!activeId) return
  setProviderAuth(providerId, buildAccountProjectionPatch(provider, next, activeId))
}

/** Update email/label metadata on an account. */
export function updateProviderAccountInfo(
  providerId: string,
  accountId: string,
  patch: { email?: string; label?: string }
): void {
  const provider = getProviderById(providerId)
  if (!provider) return
  const accounts = getAccountsArray(provider).map((a) => {
    if (a.id !== accountId) return a
    return {
      ...a,
      ...(patch.email !== undefined ? { email: patch.email.trim() || a.email } : {}),
      ...(patch.label !== undefined ? { label: patch.label.trim() || undefined } : {})
    }
  })
  setProviderAuth(
    providerId,
    buildAccountProjectionPatch(provider, accounts, provider.activeAccountId ?? accounts[0].id)
  )
}

/** Mark an account as rate-limited until `resetAt`. Triggers automatic fall-back via pickUsableAccount. */
export function markAccountRateLimited(
  providerId: string,
  accountId: string,
  info: Omit<AccountRateLimit, 'limitedAt'>
): void {
  const provider = getProviderById(providerId)
  if (!provider) return
  const accounts = getAccountsArray(provider).map((a) =>
    a.id === accountId
      ? { ...a, rateLimit: { limitedAt: Date.now(), ...info } satisfies AccountRateLimit }
      : a
  )
  if (accounts.length === 0) return
  const { account: next } = pickUsableAccount({ ...provider, oauthAccounts: accounts })
  const nextActiveId = next?.id ?? provider.activeAccountId ?? accounts[0].id
  setProviderAuth(providerId, buildAccountProjectionPatch(provider, accounts, nextActiveId))
}

/**
 * Attempt to switch the provider to a different usable account.
 * Returns the previous accountId and the new one if a switch happened, else null.
 * Used by the agent loop to fail over after a rate-limit error.
 */
export function trySwitchProviderAccount(providerId: string): {
  previousAccountId: string | undefined
  nextAccountId: string
} | null {
  const provider = getProviderById(providerId)
  if (!provider) return null
  const accounts = getAccountsArray(provider)
  if (accounts.length < 2) return null
  const previousAccountId = provider.activeAccountId
  const others = accounts.filter((a) => a.id !== previousAccountId && !isAccountRateLimited(a))
  if (others.length === 0) return null
  const next = others[0]
  setProviderAuth(providerId, buildAccountProjectionPatch(provider, accounts, next.id))
  return { previousAccountId, nextAccountId: next.id }
}

/** True when the provider has more than one OAuth account registered. */
export function hasMultipleOauthAccounts(providerId: string): boolean {
  const provider = getProviderById(providerId)
  return !!provider && getAccountsArray(provider).length > 1
}

/** Clear the rate-limit flag on an account (user-initiated "reactivate"). */
export function clearAccountRateLimit(providerId: string, accountId: string): void {
  const provider = getProviderById(providerId)
  if (!provider) return
  const accounts = getAccountsArray(provider).map((a) =>
    a.id === accountId ? { ...a, rateLimit: undefined } : a
  )
  setProviderAuth(
    providerId,
    buildAccountProjectionPatch(
      provider,
      accounts,
      provider.activeAccountId ?? accounts[0]?.id ?? ''
    )
  )
}


// Import/export account functions extracted to provider-auth-accounts.ts
export {
  refreshProviderOAuth,
  ensureProviderAuthReady,
} from './provider-auth-accounts'
