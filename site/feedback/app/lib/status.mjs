/**
 * 反馈状态机（需求 S-226 §9.7）。
 *
 *   pending ──approve──→ todo ──done──→ done
 *      │                  │  ←──reopen─┘
 *      └──reject──→ rejected
 *                     └──重新打开──→ pending
 *
 * **四状态必须能任意互回退**（§6.3「支持批量 + 任意方向回退」）——
 * 审核点错了要能随手改回去，所以不做「只许前进」的严格流转。
 * 唯一的两条约束：目标是合法状态；目标与当前不同（改到自己身上是空操作，当参数错拒掉）。
 */

export const STATUS = {
  /** 待审：默认态，不进公开列表 */
  PENDING: 'pending',
  /** 待办：审核通过，公开 */
  TODO: 'todo',
  /** 已做：公开，前端打勾 */
  DONE: 'done',
  /** 驳回：永不公开 */
  REJECTED: 'rejected'
}

export const ALL_STATUSES = [STATUS.PENDING, STATUS.TODO, STATUS.DONE, STATUS.REJECTED]

/** 公开集 = 审核过的。「只要审核过的就公开」（老大 2026-10-26 09:47） */
export const PUBLIC_STATUSES = [STATUS.TODO, STATUS.DONE]

/** 前端/管理页展示顺序 */
export const STATUS_LABEL = {
  [STATUS.PENDING]: '待审',
  [STATUS.TODO]: '待办',
  [STATUS.DONE]: '已做',
  [STATUS.REJECTED]: '驳回'
}

/** 大小写与空白都容错；不认识的原样返回，交给 isValidStatus 判 */
export function normalizeStatus(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isValidStatus(value) {
  return ALL_STATUSES.includes(normalizeStatus(value))
}

/** 这条状态能不能给外人看 —— **公开读的唯一判据** */
export function isPublicStatus(value) {
  return PUBLIC_STATUSES.includes(normalizeStatus(value))
}

/**
 * 能不能从 from 改到 to。
 * @returns {{ ok: boolean, reason?: 'invalid' | 'same' }}
 */
export function canTransition(from, to) {
  const a = normalizeStatus(from)
  const b = normalizeStatus(to)
  if (!isValidStatus(a) || !isValidStatus(b)) return { ok: false, reason: 'invalid' }
  if (a === b) return { ok: false, reason: 'same' }
  return { ok: true }
}
