/**
 * Chat route handling — placeholder.
 * Uses in-memory state instead of URL routing for now.
 * TODO (后续迭代): Implement proper URL-based routing with history API.
 */

export interface ChatRoute {
  chatView: 'home' | 'project' | 'archive' | 'git' | 'session'
  projectId: string | null
  sessionId: string | null
}

export function parseChatRoute(): ChatRoute {
  return { chatView: 'home', projectId: null, sessionId: null }
}

export function replaceChatRoute(_route: ChatRoute): void {
  // Placeholder: no URL routing for now.
  // Navigation is driven by ui-store state.
}

export function applyChatRouteFromLocation(): void {
  // Placeholder
}
