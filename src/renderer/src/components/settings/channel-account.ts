/*
 * The account identifier a channel's collapsed row shows.
 *
 * This is the whole reason the row exists: after the first setup you come back to this
 * page to check "which account is this bound to, and is it running?" — that must be
 * readable without opening anything.
 *
 * Only non-secret fields are eligible. Tokens and secrets are deliberately absent: the
 * collapsed row is visible at a glance and gets screenshotted.
 */

/** Structural type so this stays free of store and React imports. */
export interface ChannelLike {
  type: string
  config: Record<string, string>
}

export function channelAccountLabel(channel: ChannelLike): string | null {
  const cfg = channel.config ?? {}
  const pick = (value: string | undefined): string | null => value?.trim() || null

  switch (channel.type) {
    case 'feishu-bot':
      return pick(cfg.appId)
    case 'dingtalk-bot':
      return pick(cfg.appKey)
    case 'wecom-bot':
      return pick(cfg.corpId)
    case 'qq-bot':
      return pick(cfg.appId)
    case 'whatsapp-bot':
      return pick(cfg.phoneNumberId)
    case 'weixin-official':
      return pick(cfg.accountId)
    default:
      return null
  }
}
