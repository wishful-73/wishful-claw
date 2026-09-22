/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

/** 0 = 不限轮次（iter-34 S-132）：产品层不再拿 maxTurns 当硬截断依据，该值仅作轮次提醒点。 */
export const DEFAULT_SUB_AGENT_MAX_TURNS = 0

export function resolveSubAgentMaxTurns(maxTurns?: number | null): number {
  if (typeof maxTurns === 'number' && Number.isFinite(maxTurns) && maxTurns >= 0) {
    return Math.floor(maxTurns)
  }
  return DEFAULT_SUB_AGENT_MAX_TURNS
}
