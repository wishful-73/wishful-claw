import i18n from 'i18next'

/**
 * Translate a key for code that runs outside React.
 *
 * `i18n.t` is not safe to call bare here: before `initializeI18n()` resolves it
 * returns `undefined` and *ignores* `defaultValue`, and once the instance is
 * initialized but the namespace has not loaded yet it returns the raw key. Both
 * would leak into user-visible text (or crash a `.trim()`), so non-React call
 * sites go through this guard and fall back to a literal.
 */
export function translateOr(
  key: string,
  options: Record<string, unknown>,
  fallback: string
): string {
  const value = i18n.t(key, options)
  if (typeof value !== 'string' || value.length === 0 || value === key) return fallback
  return value
}
