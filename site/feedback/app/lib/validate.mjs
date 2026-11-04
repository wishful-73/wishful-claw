/**
 * 提交体校验（需求 S-226 §10 防刷 + §6.3 字段表）。
 *
 * 设计约束：**返回结果对象，不抛异常**。
 * 路由层只需 `if (!r.ok) return fail(r.code)`，异常留给真正的 bug（那是 500 的范畴）。
 */

import { CODE } from './codes.mjs'

export const LIMITS = {
  title: 120,
  content: 2000,
  contact: 120,
  page: 200,
  product: 32
}

export const TYPES = ['bug', 'feature']

/**
 * 只接受字符串。`String(x)` 会把对象变成 "[object Object]"、把数组变成 "a,b"，
 * 那是**替攻击者做归一化**，一律当空处理。
 */
const str = (v) => (typeof v === 'string' ? v : '')

/** product 只允许小写字母数字下划线连字符 —— 它要进 SQL 的 where，别给奇怪字符 */
const PRODUCT_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

/**
 * @returns {{ ok: true, data: {type,title,content,contact,page,product} } | { ok: false, code: number }}
 */
export function validateSubmit(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: CODE.PARAM }
  }

  // ① 蜜罐：真人看不见这个字段，填了就是脚本。**先判它**，别把后面的话术漏给机器人。
  //    返 10004 而不是 0：让脚本以为自己被抓了（返 0 会鼓励它继续试）。
  if (str(raw.website).trim()) {
    return { ok: false, code: CODE.HONEYPOT }
  }

  // ② 类型
  const type = str(raw.type).trim().toLowerCase()
  if (!TYPES.includes(type)) {
    return { ok: false, code: CODE.TYPE_INVALID }
  }

  // ③ 必填
  const title = str(raw.title).trim()
  const content = str(raw.content).trim()
  if (!title || !content) {
    return { ok: false, code: CODE.PARAM }
  }

  // ④ 长度（title / content 是硬上限，超了直接拒，不截断 ——
  //    静默截断会让用户以为提交完整了，实际后半段喂了狗）
  if (title.length > LIMITS.title || content.length > LIMITS.content) {
    return { ok: false, code: CODE.TOO_LONG }
  }

  // ⑤ 选填
  const contact = str(raw.contact).trim()
  const page = str(raw.page).trim()
  if (contact.length > LIMITS.contact || page.length > LIMITS.page) {
    return { ok: false, code: CODE.TOO_LONG }
  }

  const product = str(raw.product).trim().toLowerCase() || 'wishfulclaw'
  if (!PRODUCT_RE.test(product)) {
    return { ok: false, code: CODE.PARAM }
  }

  return {
    ok: true,
    data: {
      type,
      title,
      content,
      // 空串一律存 null：查询与展示都少一种「空」，`IS NULL` 比 `= ''` 好读
      contact: contact || null,
      page: page || null,
      product
    }
  }
}
