/**
 * QR Code binding panel.
 *
 * Supports two scan-to-bind flows:
 *   - WeChat: long-polling QR login (existing weixin-login.ts)
 *   - Feishu: OAuth Device Flow registration (feishu-install.ts)
 *     User scans QR → authorizes in Feishu app → App ID + Secret auto-obtained
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import { RefreshCw, QrCode, Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import {
  useChannelStore,
  type PluginInstance
} from '@renderer/stores/channel-store'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { cn } from '@renderer/lib/utils'

interface FeishuInstallResult {
  ok: boolean
  installId?: string
  qrUrl?: string
  userCode?: string
  expireIn?: number
  interval?: number
  message?: string
}

interface FeishuPollResult {
  done: boolean
  status: 'pending' | 'connected' | 'error'
  message?: string
  error?: string
  appId?: string
  appSecret?: string
  domain?: string
  userId?: string
}

export function QrLoginPanel({ channel }: { channel: PluginInstance }): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [loginStatus, setLoginStatus] = useState<'idle' | 'loading' | 'waiting' | 'connected' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [timeLeft, setTimeLeft] = useState(0)
  const pollRef = useRef<AbortController | null>(null)
  const feishuInstallIdRef = useRef<string | null>(null)
  const feishuPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { updateChannel } = useChannelStore()

  const isWeixin = channel.type === 'weixin-official'
  const isFeishu = channel.type === 'feishu-bot'
  const hasStoredBinding = isWeixin
    ? Boolean(channel.config.token)
    : Boolean(channel.config.appId && channel.config.appSecret)
  const showBoundSummary =
    loginStatus === 'connected' ||
    (hasStoredBinding && loginStatus !== 'loading' && loginStatus !== 'waiting' && loginStatus !== 'error')
  const boundChannelLabel = isWeixin
    ? t('channel.qr.weixinChannel', { defaultValue: '微信' })
    : t('channel.qr.feishuChannel', { defaultValue: '飞书' })
  const boundAccount = isWeixin
    ? channel.config.accountId || channel.config.userId || t('channel.qr.localCredential', { defaultValue: '本地微信凭证' })
    : channel.config.appId || t('channel.qr.credentialReady', { defaultValue: '已配置' })
  const boundScope = channel.projectId
    ? t('channel.qr.projectScope', { defaultValue: '当前项目' })
    : t('channel.qr.globalScope', { defaultValue: '全局' })

  const cleanup = useCallback(() => {
    pollRef.current?.abort()
    if (feishuPollTimerRef.current) {
      clearTimeout(feishuPollTimerRef.current)
      feishuPollTimerRef.current = null
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
  }, [])

  // ── WeChat QR login ──
  const startWeixinLogin = useCallback(async () => {
    cleanup()
    setLoginStatus('loading')
    setStatusMessage('')
    setQrDataUrl(null)

    try {
      const result = (await ipcClient.invoke(IPC.PLUGIN_WEIXIN_LOGIN_START, {
        pluginId: channel.id,
        baseUrl: channel.config.baseUrl || undefined,
        routeTag: channel.config.routeTag || undefined,
        accountId: channel.config.accountId || undefined,
        force: true
      })) as { qrDataUrl?: string; qrUrl?: string; message?: string; sessionKey?: string }

      if (result.qrDataUrl) {
        setQrDataUrl(result.qrDataUrl)
        setLoginStatus('waiting')
        setStatusMessage(t('channel.qr.waiting', { defaultValue: '请使用微信扫描二维码' }))

        const controller = new AbortController()
        pollRef.current = controller
        const poll = async (): Promise<void> => {
          if (controller.signal.aborted) return

          try {
            const waitResult = (await ipcClient.invoke(IPC.PLUGIN_WEIXIN_LOGIN_WAIT, {
              pluginId: channel.id,
              baseUrl: channel.config.baseUrl || undefined,
              routeTag: channel.config.routeTag || undefined,
              sessionKey: result.sessionKey || '',
              timeoutMs: 30000
            })) as { connected?: boolean; message?: string; botToken?: string; userId?: string; baseUrl?: string }

            if (controller.signal.aborted) return

            if (waitResult.connected) {
              setLoginStatus('connected')
              setStatusMessage(t('channel.qr.connected', { defaultValue: '绑定成功!' }))

              const patch: Partial<PluginInstance> = {
                config: {
                  ...channel.config,
                  token: (waitResult as Record<string, unknown>).token as string || (channel.config as Record<string, unknown>).token as string,
                  userId: waitResult.userId || channel.config.userId,
                  baseUrl: waitResult.baseUrl || channel.config.baseUrl,
                  accountId: (waitResult as Record<string, unknown>).accountId as string || (channel.config as Record<string, unknown>).accountId as string
                } as Record<string, string>,
                enabled: true
              }
              await updateChannel(channel.id, patch)
              toast.success(t('channel.qr.connected', { defaultValue: '绑定成功!' }))
              return
            }

            if (controller.signal.aborted) return
            setStatusMessage(waitResult.message || t('channel.qr.waiting', { defaultValue: '等待扫描...' }))
            void poll()
          } catch {
            if (!controller.signal.aborted) {
              setLoginStatus('error')
              setStatusMessage(t('channel.qr.expired', { defaultValue: '二维码已过期，请刷新' }))
            }
          }
        }
        void poll()
      } else {
        setLoginStatus('error')
        setStatusMessage(result.message || t('channel.qr.failed', { defaultValue: '获取二维码失败' }))
      }
    } catch (err) {
      setLoginStatus('error')
      setStatusMessage(err instanceof Error ? err.message : String(err))
    }
  }, [channel, t, updateChannel, cleanup])

  // ── Feishu OAuth Device Flow ──
  const startFeishuInstall = useCallback(async () => {
    cleanup()
    setLoginStatus('loading')
    setStatusMessage('')
    setQrDataUrl(null)
    feishuInstallIdRef.current = null

    try {
      const result = (await ipcClient.invoke(IPC.PLUGIN_FEISHU_INSTALL_START, {
        domain: 'feishu'
      })) as FeishuInstallResult

      if (!result.ok || !result.qrUrl || !result.installId) {
        setLoginStatus('error')
        setStatusMessage(result.message || t('channel.qr.failed', { defaultValue: '获取二维码失败' }))
        return
      }

      // Render QR code from the verification URL
      const dataUrl = await QRCode.toDataURL(result.qrUrl, { width: 200, margin: 1 })
      setQrDataUrl(dataUrl)
      setLoginStatus('waiting')
      setStatusMessage(t('channel.qr.feishuWaiting', { defaultValue: '请使用飞书扫描二维码完成授权' }))
      feishuInstallIdRef.current = result.installId

      // Start countdown
      const expireIn = result.expireIn ?? 300
      setTimeLeft(expireIn)
      countdownTimerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            cleanup()
            setLoginStatus('error')
            setStatusMessage(t('channel.qr.expired', { defaultValue: '二维码已过期，请刷新' }))
            return 0
          }
          return prev - 1
        })
      }, 1000)

      // Start polling
      const pollInterval = (result.interval ?? 5) * 1000
      const poll = async (): Promise<void> => {
        if (!feishuInstallIdRef.current) return

        try {
          const pollResult = (await ipcClient.invoke(
            IPC.PLUGIN_FEISHU_INSTALL_POLL,
            feishuInstallIdRef.current
          )) as FeishuPollResult

          if (pollResult.done && pollResult.appId && pollResult.appSecret) {
            // Success — save credentials
            cleanup()
            setLoginStatus('connected')
            setStatusMessage(t('channel.qr.feishuConnected', { defaultValue: '飞书授权成功!' }))

            await updateChannel(channel.id, {
              config: {
                ...channel.config,
                appId: pollResult.appId,
                appSecret: pollResult.appSecret
              },
              enabled: true
            })
            toast.success(t('channel.qr.feishuConnected', { defaultValue: '飞书授权成功!' }))
            return
          }

          if (pollResult.status === 'error') {
            cleanup()
            setLoginStatus('error')
            setStatusMessage(pollResult.error || t('channel.qr.failed', { defaultValue: '授权失败' }))
            return
          }

          // Still pending
          setStatusMessage(pollResult.message || t('channel.qr.feishuWaiting', { defaultValue: '等待扫码授权...' }))
          feishuPollTimerRef.current = setTimeout(() => void poll(), pollInterval)
        } catch {
          feishuPollTimerRef.current = setTimeout(() => void poll(), pollInterval)
        }
      }

      feishuPollTimerRef.current = setTimeout(() => void poll(), pollInterval)
    } catch (err) {
      setLoginStatus('error')
      setStatusMessage(err instanceof Error ? err.message : String(err))
    }
  }, [channel, t, updateChannel, cleanup])

  useEffect(() => {
    cleanup()
    setQrDataUrl(null)
    setLoginStatus('idle')
    setStatusMessage('')
    setTimeLeft(0)
    feishuInstallIdRef.current = null
  }, [channel.id, cleanup])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  if (!isWeixin && !isFeishu) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('channel.qr.notSupported', { defaultValue: '此渠道不支持扫码绑定，请使用 API 凭据配置' })}
      </div>
    )
  }

  const formatTime = (s: number): string => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  return (
    <div className="flex flex-col items-center gap-4 px-8 py-6">
      <h3 className="text-sm font-medium text-foreground">
        {t('channel.qr.title', { defaultValue: '扫码绑定' })}
      </h3>

      {/* QR Code display */}
      <div className="flex w-full flex-col items-center gap-3">
        <div
          className={cn(
            'relative flex items-center justify-center rounded-lg',
            showBoundSummary
              ? 'w-full max-w-md border border-emerald-500/30 bg-emerald-500/5 p-5'
              : 'size-[240px] border-2 border-dashed border-border bg-white p-2'
          )}
        >
          {showBoundSummary ? (
            <div className="w-full space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                  <CheckCircle2 className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {t('channel.qr.boundTitle', { defaultValue: '已绑定' })}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('channel.qr.boundDescription', {
                      defaultValue: '连接凭证已保存，可直接启动渠道或重新绑定。'
                    })}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                  {t('channel.qr.connectedStatus', { defaultValue: '连接已配置' })}
                </span>
              </div>

              <div className="grid gap-3 rounded-lg border border-border/60 bg-background/80 p-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t('channel.qr.channelLabel', { defaultValue: '渠道' })}
                  </span>
                  <p className="mt-1 text-xs font-medium text-foreground">{boundChannelLabel}</p>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t('channel.qr.accountLabel', { defaultValue: '账号标识' })}
                  </span>
                  <p className="mt-1 truncate text-xs font-medium text-foreground" title={boundAccount}>
                    {boundAccount}
                  </p>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t('channel.qr.scopeLabel', { defaultValue: '作用域' })}
                  </span>
                  <p className="mt-1 text-xs font-medium text-foreground">{boundScope}</p>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t('channel.qr.credentialLabel', { defaultValue: '凭证' })}
                  </span>
                  <p className="mt-1 text-xs font-medium text-foreground">
                    {t('channel.qr.credentialSaved', { defaultValue: '已安全保存' })}
                  </p>
                </div>
              </div>
            </div>
          ) : qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="QR Code"
              className="aspect-square rounded-md bg-white p-2 object-contain"
            />
          ) : loginStatus === 'loading' ? (
            <Spinner className="size-8" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <QrCode className="size-12 opacity-30" />
              <span className="text-xs">
                {t('channel.qr.placeholder', { defaultValue: '点击下方按钮获取二维码' })}
              </span>
            </div>
          )}
        </div>

        {/* Status message + countdown */}
        {statusMessage && (
          <div className="flex flex-col items-center gap-1">
            <p className={cn(
              'text-xs',
              loginStatus === 'connected' ? 'text-green-600' : loginStatus === 'error' ? 'text-red-500' : 'text-muted-foreground'
            )}>
              {statusMessage}
            </p>
            {loginStatus === 'waiting' && timeLeft > 0 && (
              <span className="text-[10px] text-muted-foreground/60">
                {formatTime(timeLeft)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => void (isWeixin ? startWeixinLogin() : startFeishuInstall())}
        disabled={loginStatus === 'loading'}
      >
        {loginStatus === 'loading' ? (
          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1.5 size-3.5" />
        )}
        {showBoundSummary
          ? t('channel.qr.rebind', { defaultValue: '重新绑定' })
          : loginStatus === 'error'
            ? t('channel.qr.retry', { defaultValue: '重试' })
            : t('channel.qr.refresh', { defaultValue: '刷新二维码' })}
      </Button>

      {/* Instructions */}
      {!showBoundSummary && (
        <div className="max-w-sm rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          {isWeixin ? (
            <p>{t('channel.qr.weixinInstructions', { defaultValue: '1. 点击"刷新二维码"获取二维码\n2. 使用微信扫描显示的二维码\n3. 在手机上确认授权\n4. 绑定成功后渠道将自动启用' })}</p>
          ) : (
            <p>{t('channel.qr.feishuInstructions', { defaultValue: '1. 使用飞书 App 扫描二维码\n2. 在飞书中确认授权创建应用\n3. 授权成功后自动获取 App ID 和 App Secret\n4. 绑定成功后渠道将自动启用' })}</p>
          )}
        </div>
      )}
    </div>
  )
}
