import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { usePersonaStore } from '@renderer/stores/persona-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import type { PersonaConfig } from '@renderer/lib/persona/persona-types'

interface PersonaGeneratorDialogProps {
  open: boolean
  onClose: () => void
  workingFolder?: string
  onSaved?: (id: string) => void
}

const TABS = ['identity', 'soul', 'ontology', 'agents'] as const
type TabKey = typeof TABS[number]

export function PersonaGeneratorDialog({
  open,
  onClose,
  workingFolder,
  onSaved
}: PersonaGeneratorDialogProps) {
  const { t } = useTranslation('settings')
  const { generatePersona, savePersona } = usePersonaStore()
  const providerStore = useProviderStore()

  const [prompt, setPrompt] = useState('')
  const [referenceId, setReferenceId] = useState('')
  const [draft, setDraft] = useState<PersonaConfig | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('identity')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return
    const activeProvider = providerStore.getActiveProvider()
    if (!activeProvider) {
      setError(t('persona.noProvider'))
      return
    }
    const modelId = providerStore.activeModelId || activeProvider.defaultModel || activeProvider.models.find((m: any) => m.enabled)?.id
    if (!modelId) {
      setError(t('persona.noModel'))
      return
    }

    setGenerating(true)
    setError(null)
    try {
      const provider = {
        id: activeProvider.id,
        name: activeProvider.name,
        type: activeProvider.type,
        apiKey: activeProvider.apiKey,
        baseUrl: activeProvider.baseUrl,
        model: modelId
      }
      const result = await generatePersona(prompt, provider, referenceId || undefined, workingFolder)
      if (result.success && result.draft) {
        const d = result.draft
        setDraft({
          id: '',
          name: d.name ?? '',
          tagline: d.tagline ?? '',
          description: d.description ?? '',
          isBuiltin: false,
          identityMarkdown: d.identityMarkdown ?? '',
          soulMarkdown: d.soulMarkdown ?? '',
          ontologyMarkdown: d.ontologyMarkdown ?? '',
          agentsMarkdown: d.agentsMarkdown ?? ''
        })
        setActiveTab('identity')
      } else {
        setError(result.error ?? 'Generation failed')
      }
    } catch {
      setError('Generation failed')
    } finally {
      setGenerating(false)
    }
  }, [prompt, referenceId, workingFolder, generatePersona, providerStore, t])

  const handleSave = useCallback(async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const result = await savePersona(draft, workingFolder)
      if (result.success && result.id) {
        onSaved?.(result.id)
        handleClose()
      } else {
        setError(result.error ?? 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }, [draft, workingFolder, savePersona, onSaved])

  const handleClose = useCallback(() => {
    setPrompt('')
    setReferenceId('')
    setDraft(null)
    setError(null)
    onClose()
  }, [onClose])

  const updateDraft = useCallback((field: keyof PersonaConfig, value: string) => {
    setDraft((prev) => prev ? { ...prev, [field]: value } : prev)
  }, [])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div
        className="flex max-h-[85vh] w-[720px] flex-col rounded-lg bg-[var(--bg-color,#1e1e1e)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="text-base font-semibold text-white">
            {t('persona.aiCreate')}
          </h2>
          <button onClick={handleClose} className="text-white/50 hover:text-white">✕</button>
        </div>

        {!draft ? (
          /* ── Prompt input phase ── */
          <div className="flex flex-col gap-4 p-5">
            <p className="text-sm text-white/60">{t('persona.aiCreateDesc')}</p>
            <textarea
              className="h-24 w-full resize-none rounded border border-white/10 bg-black/20 p-3 text-sm text-white placeholder-white/30 focus:border-blue-500 focus:outline-none"
              placeholder={t('persona.promptPlaceholder')}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={generating}
            />
            <input
              className="w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-blue-500 focus:outline-none"
              placeholder={t('persona.referencePlaceholder')}
              value={referenceId}
              onChange={(e) => setReferenceId(e.target.value)}
              disabled={generating}
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
              className="self-end rounded bg-blue-600 px-5 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {generating ? t('persona.generating') : t('persona.generate')}
            </button>
          </div>
        ) : (
          /* ── Preview & edit phase ── */
          <>
            <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-3">
              <div className="flex gap-3">
                <input
                  className="flex-1 rounded border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                  placeholder={t('persona.name')}
                  value={draft.name}
                  onChange={(e) => updateDraft('name', e.target.value)}
                />
                <input
                  className="flex-1 rounded border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                  placeholder={t('persona.tagline')}
                  value={draft.tagline}
                  onChange={(e) => updateDraft('tagline', e.target.value)}
                />
              </div>
              <input
                className="w-full rounded border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                placeholder={t('persona.description')}
                value={draft.description}
                onChange={(e) => updateDraft('description', e.target.value)}
              />
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-white/10 px-5">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-2 text-xs font-medium uppercase transition-colors ${
                    activeTab === tab
                      ? 'border-b-2 border-blue-500 text-white'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Editor */}
            <textarea
              className="flex-1 resize-none bg-transparent p-5 font-mono text-xs text-white/90 focus:outline-none"
              value={draft[`${activeTab}Markdown` as keyof PersonaConfig] as string ?? ''}
              onChange={(e) => updateDraft(`${activeTab}Markdown` as keyof PersonaConfig, e.target.value)}
            />

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-white/10 px-5 py-3">
              <button
                onClick={() => setDraft(null)}
                className="text-sm text-white/50 hover:text-white"
              >
                {t('persona.regenerate')}
              </button>
              <div className="flex gap-2">
                {error && <p className="self-center text-sm text-red-400">{error}</p>}
                <button
                  onClick={handleClose}
                  className="rounded px-4 py-1.5 text-sm text-white/60 hover:text-white"
                >
                  {t('action.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !draft.name.trim()}
                  className="rounded bg-green-600 px-5 py-1.5 text-sm text-white hover:bg-green-500 disabled:opacity-40"
                >
                  {saving ? t('persona.saving') : t('persona.confirmSave')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
