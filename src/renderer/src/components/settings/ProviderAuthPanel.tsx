/**
 * 授权 AI 服务商（S-218）。
 *
 * 独立于「服务商」页：那里的服务商靠 API Key 计费，这里的是用你自己的账号登录、
 * 消耗你已有的套餐额度 —— 登录走 server_poll 流程，不用填 Key，也不用做客户端注册。
 *
 * 目前只有 WorkBuddy 两个 build 走这条路；面板按 flowType 自动收录，新增同类服务商
 * 只需在预设里声明 oauthConfig，不用改这里。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, Loader2, LogIn, LogOut, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { useProviderStore } from '@renderer/stores/provider-store'
import { signInWithWorkBuddy } from '@renderer/lib/auth/workbuddy-signin'
import { pressCheckin } from '@renderer/lib/auth/workbuddy-checkin'
import { buildOAuthProviderPatch, disconnectProviderOAuth } from '@renderer/lib/auth/provider-auth'
import { setProviderAuth } from '@renderer/lib/auth/provider-auth-utils'
import type { AIProvider } from '../../../../shared/types/provider'

function isServerPollProvider(provider: AIProvider): boolean {
  return provider.authMode === 'oauth' && provider.oauthConfig?.flowType === 'server_poll'
}

function accountLabelOf(provider: AIProvider): string {
  return provider.oauth?.accountId || provider.oauth?.uid || ''
}

function ProviderAuthCard({
  provider,
  busy,
  checkinBusy,
  onSignIn,
  onCancel,
  onDisconnect,
  onCheckin,
  onToggleAutoCheckin
}: {
  provider: AIProvider
  busy: boolean
  checkinBusy: boolean
  onSignIn: (provider: AIProvider) => void
  onCancel: () => void
  onDisconnect: (provider: AIProvider) => void
  onCheckin: (provider: AIProvider) => void
  onToggleAutoCheckin: (provider: AIProvider, enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const connected = Boolean(provider.oauth?.accessToken)
  const accountLabel = accountLabelOf(provider)
  const autoCheckin = provider.oauth?.autoCheckin !== false

  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{provider.name}</span>
            {connected ? (
              <span className="shrink-0 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                {t('providerAuth.connected', { defaultValue: '已连接' })}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {connected && accountLabel ? accountLabel : provider.homepage}
          </div>
        </div>

        {busy ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('providerAuth.waiting', { defaultValue: '等待浏览器登录…' })}
            </span>
            <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={onCancel}>
              {t('providerAuth.cancel', { defaultValue: '取消' })}
            </Button>
          </div>
        ) : connected ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 px-2.5 text-xs"
              disabled={checkinBusy}
              onClick={() => onCheckin(provider)}
            >
              {checkinBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CalendarCheck className="size-3.5" />
              )}
              {t('providerAuth.checkin', { defaultValue: '签到' })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 px-2.5 text-xs"
              onClick={() => onSignIn(provider)}
            >
              <LogIn className="size-3.5" />
              {t('providerAuth.reauthorize', { defaultValue: '重新授权' })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => onDisconnect(provider)}
            >
              <LogOut className="size-3.5" />
              {t('providerAuth.disconnect', { defaultValue: '断开' })}
            </Button>
          </div>
        ) : (
          <Button size="sm" className="h-8 shrink-0 gap-1.5 px-3 text-xs" onClick={() => onSignIn(provider)}>
            <LogIn className="size-3.5" />
            {t('providerAuth.signIn', { defaultValue: '登录' })}
          </Button>
        )}
      </div>

      {connected ? (
        <div className="flex items-center justify-between gap-4 border-t px-4 py-2.5">
          <div className="min-w-0">
            <div className="text-xs font-medium">
              {t('providerAuth.autoCheckin', { defaultValue: '自动签到' })}
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {t('providerAuth.autoCheckinHint', {
                defaultValue: '应用运行时每天自动领一次；关掉后仍可手动签到。'
              })}
            </p>
          </div>
          <Switch
            size="sm"
            checked={autoCheckin}
            onCheckedChange={(next) => onToggleAutoCheckin(provider, next)}
          />
        </div>
      ) : null}
    </div>
  )
}

function ProviderAuthPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const providers = useProviderStore((s) => s.providers)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [checkinBusyId, setCheckinBusyId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const targets = useMemo(() => providers.filter(isServerPollProvider), [providers])

  // 面板卸载时中断还在跑的轮询，免得后台挂满 5 分钟
  useEffect(() => () => abortRef.current?.abort(), [])

  const handleSignIn = async (provider: AIProvider): Promise<void> => {
    if (busyId) return
    const controller = new AbortController()
    abortRef.current = controller
    setBusyId(provider.id)
    try {
      const { token } = await signInWithWorkBuddy(provider, controller.signal)
      setProviderAuth(provider.id, buildOAuthProviderPatch(provider, token))
      toast.success(
        t('providerAuth.signInSuccess', {
          defaultValue: '已连接：{{account}}',
          account: token.accountId ?? provider.name
        })
      )
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setBusyId(null)
      abortRef.current = null
    }
  }

  const handleCancel = (): void => {
    abortRef.current?.abort()
  }

  const handleDisconnect = (provider: AIProvider): void => {
    disconnectProviderOAuth(provider.id)
    toast.success(t('providerAuth.disconnectDone', { defaultValue: '已断开' }))
  }

  const handleCheckin = async (provider: AIProvider): Promise<void> => {
    if (checkinBusyId) return
    setCheckinBusyId(provider.id)
    try {
      const result = await pressCheckin(provider)
      if (result.outcome === 'claimed') {
        toast.success(
          t('providerAuth.checkinClaimed', {
            defaultValue: '签到成功：+{{credit}} 额度，连续 {{streak}} 天',
            credit: result.credit ?? 0,
            streak: result.streak ?? 0
          })
        )
      } else if (result.outcome === 'done') {
        toast.info(
          t('providerAuth.checkinDone', {
            defaultValue: '今天已经签过了（今日 {{credit}} 额度，连续 {{streak}} 天）',
            credit: result.credit ?? 0,
            streak: result.streak ?? 0
          })
        )
      } else if (result.outcome === 'captcha') {
        toast.warning(
          t('providerAuth.checkinCaptcha', {
            defaultValue: '服务商要求人机验证，请到官网手动签到。'
          })
        )
      } else {
        toast.error(result.message || t('providerAuth.checkinFailed', { defaultValue: '签到失败' }))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setCheckinBusyId(null)
    }
  }

  // 开关落在 provider.oauth 上，主进程定时器每分钟重读 provider 文件，所以不需要额外通知
  const handleToggleAutoCheckin = (provider: AIProvider, enabled: boolean): void => {
    setProviderAuth(provider.id, {
      oauth: { ...provider.oauth, accessToken: provider.oauth?.accessToken ?? '', autoCheckin: enabled }
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 pb-16 pt-10">
        <header className="mb-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <UserCheck className="size-4 text-muted-foreground" />
            {t('tabs.providerAuth.label', { defaultValue: '授权 AI 服务商' })}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t('providerAuth.description', {
              defaultValue: '用你自己的账号登录，消耗你已有的套餐额度，不需要填写 API Key。'
            })}
          </p>
        </header>

        {targets.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {t('providerAuth.empty', { defaultValue: '暂无支持账号登录的服务商。' })}
          </div>
        ) : (
          <div className="space-y-2.5">
            {targets.map((provider) => (
              <ProviderAuthCard
                key={provider.id}
                provider={provider}
                busy={busyId === provider.id}
                checkinBusy={checkinBusyId === provider.id}
                onSignIn={(target) => void handleSignIn(target)}
                onCancel={handleCancel}
                onDisconnect={handleDisconnect}
                onCheckin={(target) => void handleCheckin(target)}
                onToggleAutoCheckin={handleToggleAutoCheckin}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export { ProviderAuthPanel }
