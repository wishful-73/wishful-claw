import type { CSSProperties } from 'react'
import type { UpdateBannerPosition } from '@shared/updater/types'

/**
 * Geometry for the hand-placed update banner. Split out of the component so the arithmetic can be
 * reasoned about (and the persisted position repaired) without a mounted React tree.
 */

/** Breathing room kept between the banner and the viewport edges once it is hand-placed. */
export const BANNER_VIEWPORT_MARGIN = 8

/** Mirrors the banner's `max-w-sm`. The inline cap below has to agree with the class. */
export const BANNER_MAX_WIDTH = 384

/** Floor for the inline cap: narrower than this and the two status lines stop being readable. */
export const BANNER_MIN_WIDTH = 200

export interface BannerViewport {
  width: number
  height: number
}

export interface BannerSize {
  width: number
  height: number
}

/**
 * Keeps a position inside the viewport. Both bounds are clamped in the "too big" direction as well
 * as the "too small" one, so a banner taller than the window pins to the top edge instead of
 * producing a negative bound that would push it back off-screen.
 */
export function clampUpdateBannerPosition(
  position: UpdateBannerPosition,
  viewport: BannerViewport,
  size: BannerSize
): UpdateBannerPosition {
  const maxLeft = Math.max(
    BANNER_VIEWPORT_MARGIN,
    viewport.width - size.width - BANNER_VIEWPORT_MARGIN
  )
  const maxTop = Math.max(
    BANNER_VIEWPORT_MARGIN,
    viewport.height - size.height - BANNER_VIEWPORT_MARGIN
  )
  return {
    left: Math.min(maxLeft, Math.max(BANNER_VIEWPORT_MARGIN, position.left)),
    top: Math.min(maxTop, Math.max(BANNER_VIEWPORT_MARGIN, position.top))
  }
}

/**
 * Inline style for a placed banner. `max-w-sm` caps the width at 384px but knows nothing about
 * where the banner sits, so a banner near the right edge also needs the cap to follow its own left
 * edge — otherwise a longer status line (downloading → "update X downloaded, waiting to install")
 * widens the banner straight past the viewport. The inner lines already truncate, so a tighter cap
 * shortens the text rather than overflowing.
 */
export function placedBannerStyle(
  position: UpdateBannerPosition,
  viewport: BannerViewport
): CSSProperties {
  return {
    left: position.left,
    top: position.top,
    bottom: 'auto',
    maxWidth: Math.min(
      BANNER_MAX_WIDTH,
      Math.max(BANNER_MIN_WIDTH, viewport.width - position.left - BANNER_VIEWPORT_MARGIN)
    )
  }
}
