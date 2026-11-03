import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { formatAssetSize, onAssetProgress } from '@renderer/lib/plugins/plugin-assets'
import type { CgAssetStatus } from './types'

/**
 * 插件资产目录里的代码图谱包 id（主进程 `plugin-asset-catalog.ts` 里的同名字符串）。
 *
 * 下载**中途**的百分比只能从通用的 `plugin-asset:progress` 拿 —— `codegraph:download-progress`
 * 只报阶段（下载/解压/重启），没有字节数。两个频道一起用：字节进度走通用那条，阶段走自己这条。
 */
const CODEGRAPH_ASSET_ID = 'codegraph/win-x64.zip'

interface CodegraphAssetSectionProps {
  codegraphAsset: CgAssetStatus | null
  /** 安装 / 移除 / 手动重新检测后让父组件重新拉一次状态。 */
  onChanged?: () => void | Promise<void>
}

type GrammarsPhase = 'downloading' | 'extracting' | 'restarting' | 'ready' | 'failed'

interface GrammarsProgress {
  phase: GrammarsPhase
  percent?: number
  message?: string
}

interface TransferProgress {
  received: number
  total: number
  percent: number
}

// S-303: 语言包（42.5 MB 的 tree-sitter 原生库）不再随安装包发布，改成这里按需下载。
// 主进程侧的 installGrammars 会依次做「下载 → 解压 → 重启 worker」，每个阶段推一条
// codegraph:download-progress，所以这个组件只负责把阶段和失败原因如实摆出来。
export function CodegraphAssetSection({
  codegraphAsset,
  onChanged
}: CodegraphAssetSectionProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [busy, setBusy] = useState<'install' | 'remove' | null>(null)
  const [rechecking, setRechecking] = useState(false)
  const [progress, setProgress] = useState<GrammarsProgress | null>(null)
  const [transfer, setTransfer] = useState<TransferProgress | null>(null)
  /**
   * 主进程说「正在装」。
   *
   * 切到别的插件再切回来，本组件是重新挂载的，busy / transfer 全丢 —— 只有这个字段能
   * 让界面继续显示安装中，而不是退回「下载代码图谱」（2026-11-03 老大真机报的）。
   */
  const [remoteInstalling, setRemoteInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return ipcClient.on(IPC.CODEGRAPH_DOWNLOAD_PROGRESS, (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const value = payload as Partial<GrammarsProgress>
      if (typeof value.phase !== 'string') return
      setProgress({
        phase: value.phase as GrammarsPhase,
        percent: typeof value.percent === 'number' ? value.percent : undefined,
        message: typeof value.message === 'string' ? value.message : undefined
      })
    })
  }, [])

  // 字节级进度。主进程 `installGrammars` 只广播阶段，真正的下载百分比在通用的
  // `plugin-asset:progress` 上 —— 不订阅这条，用户点完下载就只能看着一个不动的
  // 「正在安装…」，分不清是在下、卡住了、还是早就失败了（2026-11-03 老大报的）。
  useEffect(() => {
    return onAssetProgress((event) => {
      if (event.id !== CODEGRAPH_ASSET_ID) return
      if (event.state === 'downloading' || event.state === 'verifying') {
        setTransfer({
          received: event.receivedBytes,
          total: event.totalBytes,
          percent: event.percent
        })
      } else {
        // ready / failed / absent：这一段传完了，别把最后的百分比留在屏幕上
        setTransfer(null)
        setRemoteInstalling(false)
      }
    })
  }, [])

  // 挂载时向主进程要一次真实状态 —— 切走再切回来靠这条把「正在装」接回来。
  // 进度本身会自动续上：下载还在跑，`onAssetProgress` 每 200ms 就推一帧。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = (await ipcClient.invoke(IPC.CODEGRAPH_ASSET_STATUS)) as CgAssetStatus
        if (!cancelled) setRemoteInstalling(Boolean(status?.installing))
      } catch {
        // 读不到就当没在装，不影响其它功能
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const runInstall = useCallback(async (): Promise<void> => {
    setBusy('install')
    setError(null)
    try {
      const result = (await ipcClient.invoke(IPC.CODEGRAPH_DOWNLOAD_ASSETS)) as {
        ok?: boolean
        message?: string
      }
      if (result?.ok === false) {
        setError(result.message ?? t('plugin.codegraph.installFailed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      setProgress(null)
      setTransfer(null)
      setRemoteInstalling(false)
      onChanged?.()
    }
  }, [onChanged, t])

  const runRemove = useCallback(async (): Promise<void> => {
    setBusy('remove')
    setError(null)
    try {
      // 主进程失败时走的是普通返回值 `{ ok: false, message }`，不靠 throw ——
      // 不接就会界面毫无反应（2026-11-03 移除时报 EPERM，提示没出来就是这个原因）。
      const result = (await ipcClient.invoke(IPC.CODEGRAPH_REMOVE_ASSETS)) as {
        ok?: boolean
        message?: string
      }
      if (result?.ok === false) {
        setError(result.message ?? t('plugin.codegraph.removeFailed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      setTransfer(null)
      setRemoteInstalling(false)
      onChanged?.()
    }
  }, [onChanged, t])

  const runRecheck = useCallback(async (): Promise<void> => {
    setRechecking(true)
    setError(null)
    try {
      await onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRechecking(false)
    }
  }, [onChanged])

  const runtimeReady = codegraphAsset?.runtimeReady ?? codegraphAsset?.ready
  /** 安装中 —— 本地在装，或者切走再切回来时主进程说还在装。 */
  const installing = busy === 'install' || remoteInstalling
  const phaseLabel =
    progress?.phase === 'downloading'
      ? t('plugin.codegraph.phaseDownloading', { defaultValue: 'Downloading…' })
      : progress?.phase === 'extracting'
        ? t('plugin.codegraph.phaseExtracting', { defaultValue: 'Extracting…' })
        : progress?.phase === 'restarting'
          ? t('plugin.codegraph.phaseRestarting', { defaultValue: 'Restarting runtime…' })
          : null

  const installButton = (
    <button
      type="button"
      disabled={busy !== null || remoteInstalling}
      onClick={() => void runInstall()}
      className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
    >
      {installing
        ? (phaseLabel ?? t('plugin.codegraph.installing', { defaultValue: 'Installing…' }))
        : t('plugin.codegraph.downloadAssets', { defaultValue: 'Download language pack' })}
    </button>
  )

  const removeButton = (
    <button
      type="button"
      disabled={busy !== null}
      onClick={() => void runRemove()}
      className="shrink-0 rounded-md border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50"
    >
      {busy === 'remove'
        ? t('plugin.codegraph.removing', { defaultValue: 'Removing…' })
        : t('plugin.codegraph.removeAssets', { defaultValue: 'Remove language pack' })}
    </button>
  )

  // 安装过程分四段，用户必须能一眼看出卡在哪一段：下载有字节进度，解压和连引擎只能
  // 靠阶段文案。以前全程只写「正在安装…」，等于什么都没说。
  const stageText =
    busy === 'remove'
      ? t('plugin.codegraph.removing')
      : progress?.phase === 'extracting'
        ? t('plugin.codegraph.phaseExtracting')
        : progress?.phase === 'restarting'
          ? t('plugin.codegraph.phaseRestarting')
          : transfer
            ? t('plugin.codegraph.phaseDownloading')
            : t('plugin.codegraph.installing')

  // 解压开始就意味着下载完成了，条子直接拉满；只有下载段是真实字节比。
  const barPercent =
    progress?.phase === 'extracting' || progress?.phase === 'restarting'
      ? 100
      : transfer
        ? Math.round(transfer.percent * 100)
        : 0

  // 资产状态徽章。以前「运行时已启动」单独飘一行，跟下面「尚未安装」并列出现，读着自相
  // 矛盾 —— 运行时是常驻进程里的一块，在不在跟资产装没装是两件事。现在分开：徽章只说
  // 资产，运行时和落盘路径降成底部小字。
  const assetBadge =
    codegraphAsset === null
      ? { label: t('plugin.checking'), cls: 'bg-muted text-muted-foreground' }
      : runtimeReady
        ? { label: t('plugin.stateReady'), cls: 'bg-emerald-500/10 text-emerald-600' }
        : { label: t('plugin.stateNotInstalled'), cls: 'bg-amber-500/10 text-amber-600' }

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{t('plugin.codegraph.assetsTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('plugin.codegraph.assetsDesc')}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${assetBadge.cls}`}>
          {assetBadge.label}
        </span>
      </div>

      {/* 操作统一一行：装卸是主操作，重新检测固定跟在后面。以前一个在标题行、一个在灰
          框里，上下分成两个操作区，看着乱。 */}
      <div className="flex flex-wrap items-center gap-2">
        {runtimeReady ? null : installButton}
        {/* 「开发环境」一档只在语法库真的来自 dev 专用源时才提 —— 2026-11-03 起 dev
            不再回落 NuGet 缓存，装了插件就是普通「已就绪」，走下面那条分支。 */}
        {runtimeReady && codegraphAsset?.pluginGrammarsReady ? removeButton : null}
        <button
          type="button"
          disabled={rechecking || busy !== null}
          onClick={() => void runRecheck()}
          className="shrink-0 rounded-md border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50"
        >
          {rechecking
            ? t('plugin.codegraph.rechecking', { defaultValue: 'Checking…' })
            : t('plugin.codegraph.recheck', { defaultValue: 'Recheck' })}
        </button>
      </div>

      {installing || busy === 'remove' ? (
        <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-foreground">{stageText}</span>
            {transfer && installing ? (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatAssetSize(transfer.received)} / {formatAssetSize(transfer.total)}
                {' · '}
                {barPercent}%
              </span>
            ) : null}
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${barPercent}%` }}
            />
          </div>
        </div>
      ) : null}

      {codegraphAsset?.grammarSource === 'dev' && codegraphAsset.grammarsReady ? (
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
      ) : runtimeReady && codegraphAsset ? (
        <div className="space-y-1 rounded-lg border bg-muted/20 p-3 text-xs">
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
      ) : (
        <p className="text-xs text-muted-foreground">
          {codegraphAsset && !codegraphAsset.workerReady
            ? t('plugin.codegraph.workerMissing')
            : t('plugin.codegraph.assetsNotInstalled', {
                defaultValue:
                  'The language pack is not installed yet. Code graph and symbol navigation need it.'
              })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
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
          <span className="max-w-full truncate">{codegraphAsset.grammarsDir}</span>
        ) : null}
      </div>

      {error ? <p className="break-words text-xs text-destructive">{error}</p> : null}
    </section>
  )
}
