import type { MessageListProps } from './utils'

export function areMessageListPropsEqual(prev: MessageListProps, next: MessageListProps): boolean {
  return (
    prev.sessionId === next.sessionId &&
    prev.onEditUserMessage === next.onEditUserMessage &&
    prev.exportAll === next.exportAll &&
    prev.fullWidth === next.fullWidth
  )
}
