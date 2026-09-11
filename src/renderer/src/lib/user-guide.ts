export const REPO_URL = 'https://github.com/wishful-73/wishful-claw'

/**
 * `main` is pinned rather than derived from the running branch: released builds
 * must point readers at the guide that shipped with the release, not at an
 * in-flight iteration branch.
 */
export const USER_GUIDE_URL = `${REPO_URL}/blob/main/docs/user-guide.md`

export function openUserGuide(): void {
  void window.api.invoke<void>('shell:openExternal', USER_GUIDE_URL)
}
