/** Public site — the single source for every outbound link the app shows. */
export const WEBSITE_URL = 'https://wishful-claw.work'

/** Display form of the site address (scheme stripped) — for the About page. */
export const WEBSITE_HOST = WEBSITE_URL.replace(/^https?:\/\//, '')

/**
 * Points at the site's own guide rather than a pinned GitHub blob: the published
 * guide is rendered from the website copy, so a released build always reads the
 * guide that shipped with it. The repo-side `docs/user-guide.md` is no longer
 * maintained (S-160) — do not reintroduce a link to it here.
 */
export const USER_GUIDE_URL = `${WEBSITE_URL}/guide`

export function openUserGuide(): void {
  void window.api.invoke<void>('shell:openExternal', USER_GUIDE_URL)
}

export function openWebsite(): void {
  void window.api.invoke<void>('shell:openExternal', WEBSITE_URL)
}
