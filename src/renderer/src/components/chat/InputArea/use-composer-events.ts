import * as React from 'react'
import { composerEvents } from '@renderer/lib/composer-events'

export function useComposerEvents(
  setText: (text: string) => void,
  focusInputAtEnd: () => void
): void {
  React.useEffect(() => {
    const unsub = composerEvents.on((event) => {
      setText(event.text)
      focusInputAtEnd()
    })
    return unsub
  }, [focusInputAtEnd, setText])
}
