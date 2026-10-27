/**
 * 反馈数据（需求 S-226 §8.3）。
 *
 * 空态口径与 `site-stats` 一致：**拿不到就整段不渲染**，不显示「暂无反馈」、
 * 不显示 0、不报错 —— 服务没起、接口挂了、本地 dev 没有后端，都不该在首页留一块疤。
 */

import { useEffect, useState } from 'react'

import { apiData, apiRequest, type ApiResult } from './api'

/** 只有需求与 Bug 两种，与服务端 `lib/validate.mjs` 的 TYPES 一致 */
export type FbType = 'bug' | 'feature'

/**
 * 公开列表只可能出现这两种状态 —— `pending` / `rejected` 在 SQL 层就被挡掉了，
 * 前端类型不该给出「可能会来 pending」的错觉。
 */
export type FbStatus = 'todo' | 'done'

export interface FbEntry {
  id: number
  type: FbType
  title: string
  content: string
  status: FbStatus
  /** ISO 8601（UTC），展示时本地化 */
  created_at: string
}

/** 提交体 —— `page` 由调用方补，`website` 是蜜罐（正常用户永远为空） */
export interface FbSubmitInput {
  type: FbType
  title: string
  content: string
  contact: string
  page: string
  website: string
}

const PRODUCT = 'wishfulclaw'

/**
 * 公开列表。返回 `undefined` 表示「还没拿到 / 拿不到」——
 * 调用方据此决定整段不渲染。
 */
export function useFeedbackList(): FbEntry[] | undefined {
  const [items, setItems] = useState<FbEntry[]>()

  useEffect(() => {
    let alive = true
    apiData<FbEntry[]>(`./api/feedback?product=${PRODUCT}`)
      .then((list) => {
        if (!alive || !Array.isArray(list)) return
        setItems(list)
      })
      .catch(() => {
        // 整段不渲染，见文件头
      })
    return () => {
      alive = false
    }
  }, [])

  return items
}

/**
 * 提交。**返回信封而不是直接抛异常**：调用方要按码给不同反馈
 * （限流要提示等待、超长要把焦点打回正文），用 `ApiResult` 判 `code` 比 catch 顺手。
 *
 * 传参里刻意不带 `product` 由这里补 —— 前端只有这一个产品，别让每个调用点都能改。
 */
export function submitFeedback(input: FbSubmitInput): Promise<ApiResult<{ id: number }>> {
  return apiRequest<{ id: number }>('./api/feedback', {
    method: 'POST',
    body: JSON.stringify({ ...input, product: PRODUCT })
  })
}
