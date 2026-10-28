export interface MessageSearchHit {
  messageId: string
  sessionId: string
  sessionTitle: string
  snippet: string
  createdAt: number
}

export interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}
