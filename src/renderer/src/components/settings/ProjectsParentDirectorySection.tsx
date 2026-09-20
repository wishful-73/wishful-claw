import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { SettingsSection, SettingHint } from './settings-primitives'

type ProjectsParentState = {
  path?: string
  configured?: boolean
  error?: string
}

/**
 * 工作目录父目录（iter-33 S-103）。
 *
 * 一个值管两件事：全局 PM 用 create_project 建项目的唯一落点，以及全局会话沙箱的额外允许根。
 * 所以这里必须把后果说出来 —— 整棵父目录对全局 PM 都是放行的，选得越高，它够得着的范围越大。
 *
 * 值存在 C# 侧的 config.json（键 projectsParentDir），读它的也是 C#：沙箱在 PathBoundary 里读、
 * create_project 在执行器里读。它刻意不跟 sandboxEnabled 那样走渲染端设置 —— 那个开关散在多个
 * run params 组装点，漏传一处就静默失效；这里是安全边界，只认一个来源。
 *
 * 「恢复默认」= 删键（Worker 侧把 null/空串都当删），所以按钮只在显式配置过时可用。
 */
function ProjectsParentDirectorySection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [path, setPath] = useState('')
  const [configured, setConfigured] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyState = useCallback((state: ProjectsParentState | null | undefined): void => {
    if (!state || typeof state !== 'object') return
    if (typeof state.path === 'string') setPath(state.path)
    setConfigured(Boolean(state.configured))
    setError(state.error ?? null)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api
      .workerRequest<ProjectsParentState>('config/projects-parent', {})
      .then((state) => {
        if (!cancelled) applyState(state)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => { cancelled = true }
  }, [applyState])

  const save = useCallback(
    async (next: string | null): Promise<void> => {
      setBusy(true)
      try {
        const state = await window.api.workerRequest<ProjectsParentState>(
          'config/projects-parent/set',
          { path: next }
        )
        applyState(state)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [applyState]
  )

  const handleBrowse = useCallback(async (): Promise<void> => {
    const result = (await ipcClient.invoke('fs:select-folder', {
      defaultPath: path || undefined
    })) as { canceled?: boolean; path?: string }
    if (result?.canceled || !result?.path) return
    await save(result.path)
  }, [path, save])

  // 盘符根（D: / D:\）是唯一能可靠判定的「过宽」—— 用户主目录本身同样过宽，但主进程没有
  // 暴露取主目录的通道，硬猜一个字符串只会误报，所以那条留在提示文案里说。
  const tooBroad = /^[a-zA-Z]:[\\/]?$/.test(path.trim())

  return (
    <SettingsSection
      id="sec-runtime-projects-parent"
      title={t('general.projectsParent.label')}
      description={t('general.projectsParent.desc')}
      actions={
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleBrowse()}
            className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {t('general.projectsParent.browse')}
          </button>
          <button
            type="button"
            disabled={busy || !configured}
            onClick={() => void save(null)}
            className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {t('general.projectsParent.reset')}
          </button>
        </div>
      }
    >
      <div className="break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
        {loaded ? path : '\u2026'}
      </div>
      {tooBroad && <p className="text-xs text-amber-500">{t('general.projectsParent.tooBroad')}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <SettingHint>{t('general.projectsParent.hint')}</SettingHint>
    </SettingsSection>
  )
}

export { ProjectsParentDirectorySection }
