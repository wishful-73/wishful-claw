import { useTranslation } from 'react-i18next'
import type { CgAssetStatus } from './types'

interface CodegraphAssetSectionProps {
  codegraphAsset: CgAssetStatus | null
}

export function CodegraphAssetSection({
  codegraphAsset
}: CodegraphAssetSectionProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div>
        <p className="text-sm font-medium">{t('plugin.codegraph.assetsTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('plugin.codegraph.assetsDesc')}</p>
      </div>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span
          className={`rounded-full px-2 py-0.5 ${
            codegraphAsset?.workerRunning
              ? 'bg-emerald-500/10 text-emerald-600'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {codegraphAsset?.workerRunning
            ? t('plugin.codegraph.workerRunning')
            : t('plugin.codegraph.workerStopped')}
        </span>
        {codegraphAsset?.grammarsDir ? (
          <span className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            {codegraphAsset.grammarsDir}
          </span>
        ) : null}
      </div>
      {codegraphAsset?.isDev && codegraphAsset.grammarsReady ? (
        <div className="space-y-1 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-600">
          <p>{t('plugin.codegraph.devMode', { count: codegraphAsset.grammarCount })}</p>
          {codegraphAsset.availableLanguages?.length > 0 ? (
            <p className="break-words text-muted-foreground">
              {t('plugin.codegraph.availableLanguages', {
                defaultValue: 'Available languages: {{languages}}',
                languages: codegraphAsset.availableLanguages.join(', ')
              })}
            </p>
          ) : null}
        </div>
      ) : (codegraphAsset?.runtimeReady ?? codegraphAsset?.ready) ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/20 p-3 text-xs">
          <div className="min-w-0 space-y-1">
            <p className="text-foreground">
              {t('plugin.codegraph.ready', { count: codegraphAsset.grammarCount })}
            </p>
            {codegraphAsset.availableLanguages?.length > 0 ? (
              <p className="break-words text-muted-foreground">
                {t('plugin.codegraph.availableLanguages', {
                  defaultValue: 'Available languages: {{languages}}',
                  languages: codegraphAsset.availableLanguages.join(', ')
                })}
              </p>
            ) : null}
            {codegraphAsset.invalidGrammarFiles?.length > 0 ? (
              <p className="break-words text-destructive">
                {t('plugin.codegraph.invalidFiles', {
                  defaultValue: 'Invalid grammar files: {{files}}',
                  files: codegraphAsset.invalidGrammarFiles.join(', ')
                })}
              </p>
            ) : null}
            {codegraphAsset.unrecognizedGrammars?.length > 0 ? (
              <p className="break-words text-destructive">
                {t('plugin.codegraph.unrecognizedGrammars', {
                  defaultValue: 'Unrecognized grammar libraries: {{grammars}}',
                  grammars: codegraphAsset.unrecognizedGrammars.join(', ')
                })}
              </p>
            ) : null}
            {codegraphAsset.missingLanguages?.length > 0 ? (
              <p className="break-words text-amber-600">
                {t('plugin.codegraph.missingLanguages', {
                  defaultValue: 'Unavailable languages: {{languages}}',
                  languages: codegraphAsset.missingLanguages.join(', ')
                })}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">
            {codegraphAsset && !codegraphAsset.workerReady
              ? t('plugin.codegraph.workerMissing')
              : codegraphAsset?.diagnostic === 'core-library-missing'
                ? t('plugin.codegraph.coreLibraryMissing', {
                    defaultValue:
                      'The tree-sitter runtime library is missing or invalid. Reinstall or update OpenCowork.'
                  })
                : codegraphAsset?.diagnostic === 'language-grammars-missing'
                  ? t('plugin.codegraph.languageGrammarsMissing', {
                      defaultValue:
                        'No valid language grammar libraries were found. Reinstall or update OpenCowork.'
                    })
                  : codegraphAsset?.diagnostic === 'invalid-grammar-files'
                    ? t('plugin.codegraph.invalidGrammarPackage', {
                        defaultValue:
                          'Some CodeGraph grammar files are invalid. Reinstall or update OpenCowork.'
                      })
                    : t('plugin.codegraph.bundledUnavailable')}
          </p>
        </div>
      )}
    </section>
  )
}
