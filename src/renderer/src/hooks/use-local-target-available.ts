/**
 * 「这个路径真的存在吗」的异步判定。
 *
 * 判定结论按 (sshConnectionId, path) 缓存，streaming 期间同一路径重复挂载
 * 不会重复 stat；同一路径的并发挂载共用一次在途请求。
 * 结论返回 null 表示还没探测完 —— 调用方据此不要渲染成可点，避免点开才发现不存在。
 */

import { useEffect, useState } from 'react'
import { localTargetIsAvailable } from '@renderer/lib/preview/local-target'

const availabilityCache = new Map<string, boolean>()
const inflightProbes = new Map<string, Promise<boolean>>()

function cacheKey(filePath: string, sshConnectionId?: string): string {
  return `${sshConnectionId ?? ''}\u0000${filePath}`
}

/** 文件被外部删除后缓存会过期；会话/项目切换或测试里可主动清。 */
export function resetLocalTargetAvailabilityCache(): void {
  availabilityCache.clear()
  inflightProbes.clear()
}

export function useLocalTargetAvailable(
  filePath: string | null | undefined,
  sshConnectionId?: string
): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(() =>
    filePath ? (availabilityCache.get(cacheKey(filePath, sshConnectionId)) ?? null) : null
  )

  useEffect(() => {
    if (!filePath) {
      setAvailable(null)
      return
    }
    const key = cacheKey(filePath, sshConnectionId)
    const cached = availabilityCache.get(key)
    if (cached !== undefined) {
      setAvailable(cached)
      return
    }

    let cancelled = false
    let pending = inflightProbes.get(key)
    if (!pending) {
      pending = localTargetIsAvailable(filePath, sshConnectionId)
      inflightProbes.set(key, pending)
    }
    void pending.then((ok) => {
      availabilityCache.set(key, ok)
      inflightProbes.delete(key)
      if (!cancelled) setAvailable(ok)
    })

    return () => {
      cancelled = true
    }
  }, [filePath, sshConnectionId])

  return available
}
