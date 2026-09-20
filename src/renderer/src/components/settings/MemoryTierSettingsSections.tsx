import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { SettingsSection, SettingRow, SettingHint } from './settings-primitives'

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/** Clamp a day threshold and keep Cold >= Warm per priority tier. */
function clampTierDays(value: number, kind: 'warm' | 'cold', counterpart: number): number {
  const clamped = clampInt(value, 1, 365, counterpart)
  return kind === 'warm' ? Math.min(clamped, counterpart) : Math.max(clamped, counterpart)
}

function TierRow(props: {
  label: string
  warm: number
  cold: number
  setWarm: (value: number) => void
  setCold: (value: number) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  return (
    <>
      <div className="text-sm font-medium">{props.label}</div>
      <div className="flex w-28 items-center justify-center gap-1.5">
        <Input
          type="number"
          min={1}
          max={365}
          value={props.warm}
          onChange={(event) => props.setWarm(Number(event.target.value))}
          className="w-20 text-xs"
        />
        <span className="text-xs text-muted-foreground">{t('memoryPage.tiers.days')}</span>
      </div>
      <div className="flex w-28 items-center justify-center gap-1.5">
        <Input
          type="number"
          min={1}
          max={365}
          value={props.cold}
          onChange={(event) => props.setCold(Number(event.target.value))}
          className="w-20 text-xs"
        />
        <span className="text-xs text-muted-foreground">{t('memoryPage.tiers.days')}</span>
      </div>
    </>
  )
}

/**
 * Tier thresholds and recall tuning, split out of MemorySettingsPanel so that page stays inside
 * the 500-line budget. Both sections read the settings store themselves — they take no props.
 */
export function MemoryTiersSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore()

  const tierRows = [
    {
      key: 'ephemeral' as const,
      label: t('memoryPage.tiers.ephemeral'),
      warm: settings.memoryWarmThresholdEphemeral,
      cold: settings.memoryColdThresholdEphemeral,
      setWarm: (v: number) =>
        settings.updateSettings({
          memoryWarmThresholdEphemeral: clampTierDays(v, 'warm', settings.memoryColdThresholdEphemeral)
        }),
      setCold: (v: number) =>
        settings.updateSettings({
          memoryColdThresholdEphemeral: clampTierDays(v, 'cold', settings.memoryWarmThresholdEphemeral)
        })
    },
    {
      key: 'standard' as const,
      label: t('memoryPage.tiers.standard'),
      warm: settings.memoryWarmThresholdStandard,
      cold: settings.memoryColdThresholdStandard,
      setWarm: (v: number) =>
        settings.updateSettings({
          memoryWarmThresholdStandard: clampTierDays(v, 'warm', settings.memoryColdThresholdStandard)
        }),
      setCold: (v: number) =>
        settings.updateSettings({
          memoryColdThresholdStandard: clampTierDays(v, 'cold', settings.memoryWarmThresholdStandard)
        })
    },
    {
      key: 'lasting' as const,
      label: t('memoryPage.tiers.lasting'),
      warm: settings.memoryWarmThresholdLasting,
      cold: settings.memoryColdThresholdLasting,
      setWarm: (v: number) =>
        settings.updateSettings({
          memoryWarmThresholdLasting: clampTierDays(v, 'warm', settings.memoryColdThresholdLasting)
        }),
      setCold: (v: number) =>
        settings.updateSettings({
          memoryColdThresholdLasting: clampTierDays(v, 'cold', settings.memoryWarmThresholdLasting)
        })
    }
  ]

  return (
    <SettingsSection
      id="sec-memory-tiers"
      title={t('memoryPage.tiers.title')}
      description={t('memoryPage.tiers.desc')}
    >
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 gap-y-2">
        <div />
        <div className="w-28 text-center text-xs font-medium text-muted-foreground">
          {t('memoryPage.tiers.warm')}
        </div>
        <div className="w-28 text-center text-xs font-medium text-muted-foreground">
          {t('memoryPage.tiers.cold')}
        </div>
        {tierRows.map((row) => (
          <TierRow
            key={row.key}
            label={row.label}
            warm={row.warm}
            cold={row.cold}
            setWarm={row.setWarm}
            setCold={row.setCold}
          />
        ))}
      </div>
      <SettingHint>{t('memoryPage.tiers.hint')}</SettingHint>
    </SettingsSection>
  )
}

export function MemoryRecallSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore()

  return (
    <SettingsSection
      id="sec-memory-recall"
      title={t('memoryPage.recall.title')}
      description={t('memoryPage.recall.desc')}
    >
      <SettingRow
        label={t('memoryPage.recall.maxNotes.label')}
        description={t('memoryPage.recall.maxNotes.desc')}
        control={
          <Input
            type="number"
            min={1}
            max={32}
            value={settings.memoryRecallMaxNotes}
            onChange={(event) =>
              settings.updateSettings({
                memoryRecallMaxNotes: clampInt(Number(event.target.value), 1, 32, 5)
              })
            }
            className="w-24 text-xs"
          />
        }
      />
      <SettingRow
        label={t('memoryPage.recall.maxChars.label')}
        description={t('memoryPage.recall.maxChars.desc')}
        control={
          <Input
            type="number"
            min={256}
            max={100000}
            step={256}
            value={settings.memoryRecallMaxChars}
            onChange={(event) =>
              settings.updateSettings({
                memoryRecallMaxChars: clampInt(Number(event.target.value), 256, 100_000, 4000)
              })
            }
            className="w-28 text-xs"
          />
        }
      />
      <SettingRow
        label={t('memoryPage.recall.minScore.label')}
        description={t('memoryPage.recall.minScore.desc')}
        control={
          <Input
            type="number"
            min={0}
            max={100}
            value={settings.memoryRecallMinScore}
            onChange={(event) =>
              settings.updateSettings({
                memoryRecallMinScore: clampInt(Number(event.target.value), 0, 100, 0)
              })
            }
            className="w-24 text-xs"
          />
        }
      />
      <SettingRow
        label={t('memoryPage.recall.fallback.label')}
        description={t('memoryPage.recall.fallback.desc')}
        control={
          <Switch
            checked={settings.memoryRecallGlobalFallback}
            onCheckedChange={(checked) =>
              settings.updateSettings({ memoryRecallGlobalFallback: checked })
            }
          />
        }
      />
      <SettingRow
        label={t('memoryPage.recall.visibility.label')}
        description={t('memoryPage.recall.visibility.desc')}
        control={
          <Switch
            checked={settings.memoryRecallVisibility}
            onCheckedChange={(checked) =>
              settings.updateSettings({ memoryRecallVisibility: checked })
            }
          />
        }
      />
    </SettingsSection>
  )
}
