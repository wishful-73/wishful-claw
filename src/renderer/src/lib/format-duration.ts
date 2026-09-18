/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`

  const totalSeconds = ms / 1000
  if (totalSeconds < 60) {
    const digits = totalSeconds >= 10 ? 0 : 1
    // toFixed 会产出 "1.0" / "10.0" 这类无意义的小数尾巴，掐掉。
    return `${totalSeconds.toFixed(digits).replace(/\.0+$/, '')}s`
  }

  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - totalMinutes * 60

  // 小时档：超过 60 分钟改写成 1h30m，避免出现 90m0s 这种读数。
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes - hours * 60
    // 整点不写分钟：1h，而不是 1h0m。
    return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`
  }

  const secondsText = seconds.toFixed(seconds >= 10 ? 0 : 1).replace(/\.0+$/, '')
  // 整分不写秒：1m，而不是 1m0s。
  return secondsText === '0' ? `${totalMinutes}m` : `${totalMinutes}m${secondsText}s`
}
