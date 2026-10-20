/** Public site — the single source for every outbound link the app shows. */
export const WEBSITE_URL = 'https://wishful-claw.work'

/** Display form of the site address (scheme stripped) — for the About page. */
export const WEBSITE_HOST = WEBSITE_URL.replace(/^https?:\/\//, '')

/**
 * One outbound link is enough: the site's own guide lives at `/guide`, and the site
 * header already links to it (S-214 removed the duplicate entry from the About page —
 * do not add a second in-app entry point here). The repo-side `docs/user-guide.md` is
 * no longer maintained (S-160) — do not reintroduce a link to it either.
 */
export function openWebsite(): void {
  void window.api.invoke<void>('shell:openExternal', WEBSITE_URL)
}
