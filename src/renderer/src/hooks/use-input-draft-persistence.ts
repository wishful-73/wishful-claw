import { useCallback, useEffect, useRef, useState } from 'react'
import type { InputDraftValue } from '@renderer/lib/input-drafts'
import {
  getCachedInputDraft,
  getInputDraft,
  hasInputDraftContent,
  removeInputDraft,
  setInputDraft,
  setCachedInputDraft
} from '@renderer/lib/input-drafts'

interface DraftContext {
  [key: string]: unknown
}

interface UseInputDraftPersistenceResult {
  hydrated: boolean
  loadedDraft: InputDraftValue | null
  saveDraft: (draft: InputDraftValue) => Promise<void>
  removeDraft: () => Promise<void>
}

/**
 * Bridges the composer with the main-process draft store (input-draft:*
 * channels). Hydrates the draft for the active key (in-memory cache first,
 * disk fallback), and exposes save/remove used by the debounced save effect
 * and the post-send composer reset.
 */
export function useInputDraftPersistence(options: {
  draftKey: string
  context?: DraftContext
}): UseInputDraftPersistenceResult {
  const { draftKey } = options
  const [hydrated, setHydrated] = useState(false)
  const [loadedDraft, setLoadedDraft] = useState<InputDraftValue | null>(null)
  // Guards against a slow disk read resolving after the key already changed.
  const requestRef = useRef(0)
  const draftKeyRef = useRef(draftKey)
  draftKeyRef.current = draftKey

  useEffect(() => {
    if (!draftKey) {
      setHydrated(false)
      setLoadedDraft(null)
      return
    }
    const requestId = ++requestRef.current
    setHydrated(false)
    const cached = getCachedInputDraft(draftKey)
    if (cached) {
      setLoadedDraft(cached)
      setHydrated(true)
      return
    }
    setLoadedDraft(null)
    void getInputDraft(draftKey)
      .then((record) => {
        if (requestRef.current !== requestId || draftKeyRef.current !== draftKey) return
        if (record) setCachedInputDraft(draftKey, record)
        setLoadedDraft(record)
        setHydrated(true)
      })
      .catch(() => {
        if (requestRef.current !== requestId || draftKeyRef.current !== draftKey) return
        setHydrated(true)
      })
  }, [draftKey])

  const saveDraft = useCallback(
    async (draft: InputDraftValue): Promise<void> => {
      const key = draftKeyRef.current
      if (!key) return
      if (!hasInputDraftContent(draft)) {
        // Empty composer -> drop the stored entry instead of saving junk.
        await removeInputDraft(key)
        return
      }
      await setInputDraft({ draftKey: key, draft })
    },
    []
  )

  const removeDraft = useCallback(async (): Promise<void> => {
    const key = draftKeyRef.current
    if (!key) return
    await removeInputDraft(key)
    setLoadedDraft(null)
  }, [])

  return { hydrated, loadedDraft, saveDraft, removeDraft }
}
