/*
 * S-225：受控的档位派生状态。
 *
 * 解决的问题：`useState(初值)` 只在挂载时取一次初值，用户切档后已挂载的卡片
 * 不会重新折叠 —— 功能等于半残。而 `key` 强制重挂载会丢滚动位置与流式渲染池，
 * 五处各写一个 `useEffect(setState)` 又会覆盖用户手动展开。
 *
 * 采用的模型（与 `AssistantMessage/index.tsx` 既有的 `collapsedByRunId[run.id] ?? defaultCollapsed`
 * 是同一套语义，只是把「按 runId 覆盖」泛化成「按档位覆盖」）：
 *
 *   value = override?.density === 当前档位 ? override.value : derive()
 *
 * ⇒ 用户手动开合 → 写入 override，在本档内一直有效
 * ⇒ 切档           → override.density 不再匹配，自动失效、回落到新档位的派生值，立即生效
 */

import { useCallback, useRef, useState } from 'react'
import { useSettingsStore } from '@renderer/stores/settings-store'
import type { ChatRenderDensity } from '@renderer/stores/settings-store-types'
import { getDensityPolicy, type ChatRenderDensityPolicy } from './render-density'

export interface DensityContext {
  density: ChatRenderDensity
  policy: ChatRenderDensityPolicy
}

/** 读当前档位与它的策略矩阵。 */
export function useDensityPolicy(): DensityContext {
  const density = useSettingsStore((s) => s.chatRenderDensity)
  return { density, policy: getDensityPolicy(density) }
}

/**
 * 受控派生开合状态。
 *
 * @param derive 当前档位下的默认值。**必须纯粹**（只依赖 props / 已有状态），
 *               每次渲染都会调用一次，不要在里面做副作用或昂贵计算。
 * @returns `[值, 设值, 清除覆盖]`
 *
 * `设值` 支持函数式更新（与原 `setState` 用法一致，`(v) => !v` 照旧能写）。
 * `清除覆盖` 用于「状态迁移时强制回落到默认值」—— 例如思考块从进行中转为结束，
 * 原实现是 `setCollapsed(true)` 强制折叠，这里对应 `reset()`。
 */
export function useDensityOverride<T>(
  derive: () => T
): [T, (next: T | ((prev: T) => T)) => void, () => void] {
  const density = useSettingsStore((s) => s.chatRenderDensity)
  const [override, setOverride] = useState<{ density: ChatRenderDensity; value: T } | null>(null)

  const derived = derive()
  const derivedRef = useRef(derived)
  derivedRef.current = derived

  const value = override && override.density === density ? override.value : derived

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setOverride((current) => {
        const base = current && current.density === density ? current.value : derivedRef.current
        return {
          density,
          value: typeof next === 'function' ? (next as (prev: T) => T)(base) : next
        }
      })
    },
    [density]
  )

  const reset = useCallback(() => setOverride(null), [])

  return [value, setValue, reset]
}
