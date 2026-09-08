import type { UpdateProgressSnapshot } from '@shared/updater/types'

/**
 * The label every unknown value collapses to. Bound once by the factory so callers never have to
 * remember it per field, and so a `null` can never be rendered as `0` — an unknown total shown as
 * "0 B / 0 B" reads as a stalled download, which is exactly the misreading this module exists to
 * prevent.
 */
export interface UpdateProgressFormatter {
  percent(value: number | null): string
  bytes(value: number | null): string
  speed(value: number | null): string
  elapsed(value: number | null): string
  transferredOfTotal(values: Pick<UpdateProgressSnapshot, 'transferred' | 'total'>): string
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const

function isMeasurable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * Truncates rather than rounds: rounding 1023.999 KiB up would print "1024 KiB", a value that
 * cannot exist in the unit it is labelled with.
 */
function formatScaled(amount: number, unitIndex: number): string {
  if (unitIndex === 0) return `${Math.round(amount)} ${BYTE_UNITS[0]}`
  const truncated = Math.floor(amount * 10) / 10
  const text = Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(1)
  return `${text} ${BYTE_UNITS[unitIndex]}`
}

export function createUpdateProgressFormatter(unknownLabel: string): UpdateProgressFormatter {
  function bytes(value: number | null): string {
    if (!isMeasurable(value)) return unknownLabel

    let amount = value
    let unitIndex = 0
    while (amount >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
      amount /= 1024
      unitIndex += 1
    }
    return formatScaled(amount, unitIndex)
  }

  return {
    percent(value: number | null): string {
      if (!isMeasurable(value)) return unknownLabel
      return `${Math.round(value)}%`
    },

    bytes,

    speed(value: number | null): string {
      // A real 0 B/s stays 0 B/s: unlike an unknown speed, a measured stall is worth showing.
      if (!isMeasurable(value)) return unknownLabel
      return `${bytes(value)}/s`
    },

    elapsed(value: number | null): string {
      if (!isMeasurable(value)) return unknownLabel

      const totalSeconds = Math.floor(value / 1000)
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      return hours > 0
        ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
        : `${minutes}:${pad2(seconds)}`
    },

    transferredOfTotal(values): string {
      // Either side can be missing on its own, so each is rendered independently rather than
      // dropping the whole line when one is unknown.
      const transferred = isMeasurable(values.transferred) ? bytes(values.transferred) : unknownLabel
      const total = isMeasurable(values.total) ? bytes(values.total) : unknownLabel
      if (transferred === unknownLabel && total === unknownLabel) return unknownLabel
      return `${transferred} / ${total}`
    }
  }
}
