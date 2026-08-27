/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { normalizeLanguageCode, SUPPORTED_LANGUAGE_CODES } from '@renderer/lib/i18n-language'

type LocaleNamespace = Record<string, unknown>
type LanguageResources = Record<string, LocaleNamespace>

const localeLoaders = import.meta.glob<LocaleNamespace>('./*/*.json', {
  import: 'default'
})

const languageResourcePromises = new Map<string, Promise<LanguageResources>>()
let initializePromise: Promise<void> | null = null

function loadLanguageResources(language: string): Promise<LanguageResources> {
  const normalizedLanguage = normalizeLanguageCode(language)
  const existing = languageResourcePromises.get(normalizedLanguage)
  if (existing) return existing

  const prefix = `./${normalizedLanguage}/`
  const promise = Promise.all(
    Object.entries(localeLoaders)
      .filter(([path]) => path.startsWith(prefix))
      .map(async ([path, load]) => {
        const namespace = path.slice(prefix.length).replace(/\.json$/, '')
        return [namespace, await load()] as const
      })
  ).then((entries) => Object.fromEntries(entries))

  languageResourcePromises.set(normalizedLanguage, promise)
  return promise
}

export function initializeI18n(): Promise<void> {
  initializePromise ??= (async () => {
    const language = normalizeLanguageCode(useSettingsStore.getState().language)
    const languages = language === 'en' ? ['en'] : ['en', language]
    const loadedResources = await Promise.all(
      languages.map(async (code) => [code, await loadLanguageResources(code)] as const)
    )

    await i18n.use(initReactI18next).init({
      resources: Object.fromEntries(loadedResources),
      lng: language,
      supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
      fallbackLng: 'en',
      // Shared keys (action.*, status.*, etc.) live in common.json; other
      // namespaces fall back to it instead of showing raw key names.
      fallbackNS: 'common',
      nonExplicitSupportedLngs: true,
      defaultNS: 'common',
      load: 'currentOnly',
      interpolation: {
        escapeValue: false
      }
    })
  })()

  return initializePromise
}

export async function changeI18nLanguage(language: string): Promise<void> {
  await initializeI18n()
  const normalizedLanguage = normalizeLanguageCode(language)
  const resources = await loadLanguageResources(normalizedLanguage)

  for (const [namespace, content] of Object.entries(resources)) {
    if (!i18n.hasResourceBundle(normalizedLanguage, namespace)) {
      i18n.addResourceBundle(normalizedLanguage, namespace, content, true, true)
    }
  }

  await i18n.changeLanguage(normalizedLanguage)
}

export default i18n
