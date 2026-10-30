/*
 * 安装确认对话框（S-244 §4.1）。
 *
 * 老大的原话是「安装是用户自己点的，要确认」—— 所以这里不是风险墙、不是拦截，
 * 只是把「你在装什么、它会碰什么、还要下多大」三件事摆在动手之前。
 *
 * 唯一的强制项是勾选：没勾，安装按钮禁用。勾过一次的插件不会再问（见
 * `lib/extensions/extension-install-guard.ts`）。
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { formatAssetSize } from '@renderer/lib/plugins/plugin-assets'
import type { ExtensionInstallPreview } from '@renderer/lib/extensions/extension-install-guard'

interface ExtensionInstallDialogProps {
  preview: ExtensionInstallPreview | null
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ExtensionInstallDialog({
  preview,
  pending,
  onCancel,
  onConfirm
}: ExtensionInstallDialogProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [ack, setAck] = useState(false)

  // 每次换插件都要重新勾 —— 复用上一次的勾选状态等于把确认变成走过场
  useEffect(() => {
    setAck(false)
  }, [preview?.id])

  const open = preview !== null
  const runHost = (preview?.viewCount ?? 0) > 0
  const showAssets = (preview?.assetCount ?? 0) > 0 && (preview?.assetBytes ?? 0) > 0

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !pending) onCancel() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('extension.install.title', { defaultValue: '安装插件' })}
            {preview ? ` 「${preview.name}」 v${preview.version}` : ''}
          </DialogTitle>
          <DialogDescription>
            {preview
              ? t('extension.install.providerBy', {
                  defaultValue: '由 {{id}} 提供 · 第三方',
                  id: preview.id
                })
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            {runHost
              ? t('extension.install.canRun', {
                  defaultValue: '此插件可访问你的文件、程序与数据，并可在你电脑上运行程序。'
                })
              : t('extension.install.canRunTools', {
                  defaultValue: '此插件会为 Agent 增加工具，可访问你的文件与程序。'
                })}
          </p>
          {showAssets ? (
            <p>
              {t('extension.install.assetsHint', {
                defaultValue: '需额外下载运行文件约 {{size}}（安装后再点下载，不会自动下）。',
                size: formatAssetSize(preview?.assetBytes ?? 0)
              })}
            </p>
          ) : null}
          <p>{t('extension.install.sourceHint', { defaultValue: '请确认来源可信。' })}</p>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-foreground"
            checked={ack}
            onChange={(event) => setAck(event.target.checked)}
          />
          <span>{t('extension.install.confirm', { defaultValue: '我已了解，仍要安装' })}</span>
        </label>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            {t('extension.install.cancel', { defaultValue: '取消' })}
          </Button>
          <Button onClick={onConfirm} disabled={!ack || pending}>
            {t('extension.install.submit', { defaultValue: '安装' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
