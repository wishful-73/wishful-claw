/**
 * 反馈服务码表 —— **前端副本**。
 *
 * 唯一真源是 `server/feedback/lib/codes.mjs`。两边不同步就会出现
 * 「前端按 A 判断、后端按 B 返回」这种最难查的 bug，
 * 所以 `tests/feedback-api` 有一条断言逐个比对这份文件的数字。
 *
 * 改码表 = 改两个文件 + 跑 `npm run test:feedback-api`。
 */

export const CODE = {
  OK: 0,

  // 1xxxx 公共
  PARAM: 10001,
  BAD_JSON: 10002,
  TOO_LONG: 10003,
  HONEYPOT: 10004,
  ROUTE: 10005,

  // 2xxxx 反馈
  TYPE_INVALID: 20001,
  TOO_FREQUENT: 20002,
  NOT_FOUND: 20003,

  // 3xxxx 管理 —— 预留未用，认证在 nginx basic auth

  // 9xxxx 兜底
  STORAGE: 90001
} as const
