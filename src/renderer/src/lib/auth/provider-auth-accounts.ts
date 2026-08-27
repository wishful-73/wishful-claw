import type {
  OAuthToken,
  ProviderOAuthAccount
} from '@renderer/lib/api/types'
import { buildAccountProjectionPatch, buildOAuthProviderPatch, finalizeOAuthToken, upsertAccountInList } from './provider-auth'
import { refreshOAuthFlow } from './oauth'
import { exchangeCopilotToken, isCopilotProvider, resolveCopilotApiKey, syncCopilotQuota } from './copilot'
import { findAccountById, getAccountsArray, getProviderById, pickUsableAccount, resolveOAuthConfig, setProviderAuth } from './provider-auth-utils'

const REFRESH_SKEW_MS = 2 * 60 * 1000

/** Refresh the OAuth token on a specific account (or the active one if accountId is omitted). */
export async function refreshProviderOAuth(
  providerId: string,
  force = false,
  accountId?: string
): Promise<boolean> {
  const provider = getProviderById(providerId)
  if (!provider || provider.authMode !== 'oauth') return false
  const config = resolveOAuthConfig(provider)
  if (!config || !config.tokenUrl || !config.clientId) return false

  const targetId = accountId ?? provider.activeAccountId
  const target = targetId ? findAccountById(provider, targetId) : undefined

  // Multi-account path
  if (target) {
    const current = target.oauth
    if (!current?.refreshToken) return false
    const expiresAt = current.expiresAt ?? 0
    if (!force && expiresAt && expiresAt - Date.now() > REFRESH_SKEW_MS) return true
    const next = await refreshOAuthFlow(config, current.refreshToken, current.deviceId)
    const mergedToken: OAuthToken = {
      ...current,
      ...next,
      refreshToken: next.refreshToken ?? current.refreshToken
    }
    const finalToken = await finalizeOAuthToken(provider, mergedToken)
    const updated: ProviderOAuthAccount = { ...target, oauth: finalToken }
    const accounts = upsertAccountInList(getAccountsArray(provider), updated)
    setProviderAuth(
      providerId,
      buildAccountProjectionPatch(provider, accounts, provider.activeAccountId ?? updated.id)
    )
    return true
  }

  // Legacy single-token fallback (no accounts array).
  const current = provider.oauth
  if (!current?.refreshToken) return false
  const expiresAt = current.expiresAt ?? 0
  if (!force && expiresAt && expiresAt - Date.now() > REFRESH_SKEW_MS) return true
  const next = await refreshOAuthFlow(config, current.refreshToken, current.deviceId)
  const mergedToken: OAuthToken = {
    ...current,
    ...next,
    refreshToken: next.refreshToken ?? current.refreshToken
  }
  const finalToken = await finalizeOAuthToken(provider, mergedToken)
  setProviderAuth(providerId, buildOAuthProviderPatch(provider, finalToken))
  return true
}

export async function ensureProviderAuthReady(providerId: string): Promise<boolean> {
  const provider = getProviderById(providerId)
  if (!provider) return false

  const authMode = provider.authMode ?? 'apiKey'
  if (authMode === 'apiKey') {
    if (provider.requiresApiKey === false) return true
    return !!provider.apiKey
  }

  if (authMode === 'oauth') {
    // --- Multi-account path ---
    const accounts = getAccountsArray(provider)
    if (accounts.length > 0) {
      // 1. Pick a usable account and persist any sweep/activation change.
      const { account, nextAccounts, changed } = pickUsableAccount(provider)
      if (!account) return false

      let working = provider
      if (changed || provider.activeAccountId !== account.id) {
        setProviderAuth(providerId, buildAccountProjectionPatch(provider, nextAccounts, account.id))
        working = getProviderById(providerId) ?? provider
      }

      // 2. Refresh that account's token if it's near expiry.
      let targetAccount = findAccountById(working, account.id) ?? account
      const expiresAt = targetAccount.oauth.expiresAt ?? 0
      if (expiresAt && expiresAt - Date.now() <= REFRESH_SKEW_MS) {
        try {
          const refreshed = await refreshProviderOAuth(providerId, true, targetAccount.id)
          if (!refreshed) return false
          working = getProviderById(providerId) ?? working
          targetAccount = findAccountById(working, account.id) ?? targetAccount
        } catch {
          return false
        }
      }

      // 3. Copilot: maintain derived copilotAccessToken.
      if (isCopilotProvider(working)) {
        const token = targetAccount.oauth
        const copilotExpiresAt = token.copilotExpiresAt ?? 0
        if (
          !token.copilotAccessToken ||
          (copilotExpiresAt && copilotExpiresAt - Date.now() <= REFRESH_SKEW_MS)
        ) {
          try {
            const next = await exchangeCopilotToken(working, token)
            const updatedAccount: ProviderOAuthAccount = { ...targetAccount, oauth: next }
            const updatedAccounts = upsertAccountInList(getAccountsArray(working), updatedAccount)
            setProviderAuth(
              providerId,
              buildAccountProjectionPatch(working, updatedAccounts, updatedAccount.id)
            )
            syncCopilotQuota(working, next)
            return true
          } catch {
            return false
          }
        }
        syncCopilotQuota(working, token)
      }

      // 4. Stamp lastUsedAt (best-effort, no full projection rewrite needed).
      const latest = getProviderById(providerId) ?? working
      const touched = getAccountsArray(latest).map((a) =>
        a.id === targetAccount.id ? { ...a, lastUsedAt: Date.now() } : a
      )
      setProviderAuth(providerId, {
        oauthAccounts: touched
      })
      return true
    }

    // --- Legacy single-token path (pre-migration) ---
    let latestProvider = provider
    let token = latestProvider.oauth
    if (!token?.accessToken) return false

    const expiresAt = token.expiresAt ?? 0
    if (expiresAt && expiresAt - Date.now() <= REFRESH_SKEW_MS) {
      try {
        const refreshed = await refreshProviderOAuth(providerId, true)
        if (!refreshed) return false
        latestProvider = getProviderById(providerId) ?? latestProvider
        token = latestProvider.oauth
        if (!token?.accessToken) return false
      } catch {
        return false
      }
    }

    if (isCopilotProvider(latestProvider)) {
      const copilotExpiresAt = token.copilotExpiresAt ?? 0
      if (
        !token.copilotAccessToken ||
        (copilotExpiresAt && copilotExpiresAt - Date.now() <= REFRESH_SKEW_MS)
      ) {
        try {
          const next = await exchangeCopilotToken(latestProvider, token)
          setProviderAuth(providerId, buildOAuthProviderPatch(latestProvider, next))
          return true
        } catch {
          return false
        }
      }
      const apiKey = resolveCopilotApiKey(token)
      if (!apiKey) return false
      if (
        latestProvider.apiKey !== apiKey ||
        (token.copilotApiUrl && latestProvider.baseUrl !== token.copilotApiUrl)
      ) {
        setProviderAuth(providerId, {
          apiKey,
          ...(token.copilotApiUrl ? { baseUrl: token.copilotApiUrl } : {})
        })
      }
      syncCopilotQuota(latestProvider, token)
      return true
    }

    if (!latestProvider.apiKey) {
      setProviderAuth(providerId, { apiKey: token.accessToken })
    }
    return true
  }

  if (authMode === 'channel') {
    const accessToken = provider.channel?.accessToken
    if (!accessToken) return false
    if (!provider.apiKey) {
      setProviderAuth(providerId, { apiKey: accessToken })
    }
    const expiresAt = provider.channel?.accessTokenExpiresAt
    if (expiresAt && Date.now() > expiresAt) {
      return false
    }
    return true
  }

  return false
}
