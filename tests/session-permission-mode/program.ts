// iter-31 S-59 —— 权限档与协作模式解绑。
//
// 背景：以前 permissionMode 被 collaborationMode 死绑（非 cowork 一律 default），
// 导致全局会话（恒 chat）与项目 chat 会话永远拿不到 YOLO，每次跑 shell 都得点审批。
// 现在改成两条独立规则，本测试锁死它们，防止哪天有人把耦合加回来。
//
// 规则：
//   1. 显式选择（default / fullAccess）永远优先，任何 scope / 协作模式都保留
//   2. 缺省（null / undefined / 非法串）一律取 defaults.coworkPermissionMode
//      —— 聊天 / 协作 / 全局共用同一个默认来源（老大："YOLO 也共享 cowork 中的默认值"）
//   3. global 的 collaborationMode 恒为 chat（这条没动，顺带锁住）
//   4. 渠道会话的 YOLO 不靠缺省：use-channel-auto-reply 显式传 fullAccess（见该处注释）

import assert from 'node:assert/strict'
import { normalizeSessionContext } from '../../src/renderer/src/lib/session-context'
import type { SessionContextDefaults } from '../../src/renderer/src/lib/session-context'

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

const DEFAULTS: SessionContextDefaults = {
  projectCollaborationMode: 'cowork',
  coworkPermissionMode: 'fullAccess'
}

const DEFAULTS_STRICT: SessionContextDefaults = {
  projectCollaborationMode: 'cowork',
  coworkPermissionMode: 'default'
}

function permission(
  input: Parameters<typeof normalizeSessionContext>[0],
  defaults: SessionContextDefaults = DEFAULTS
): string {
  return normalizeSessionContext(input, defaults).permissionMode
}

// ── 全局会话：恒 chat，但权限归自己说了算 ────────────────────────────────

eq(
  normalizeSessionContext({ scope: 'global', permissionMode: 'fullAccess' }, DEFAULTS).collaborationMode,
  'chat',
  'global 的协作模式恒为 chat'
)
eq(permission({ scope: 'global' }), 'fullAccess', 'global 缺省取共享默认值')
eq(permission({ scope: 'global' }, DEFAULTS_STRICT), 'default', 'global 缺省跟随设置里的 default')
eq(permission({ scope: 'global', permissionMode: null }), 'fullAccess', 'global 传 null 回落共享默认值')
eq(permission({ scope: 'global', permissionMode: 'fullAccess' }), 'fullAccess', 'global 可显式选 YOLO')
eq(permission({ scope: 'global', permissionMode: 'default' }), 'default', 'global 可显式选 default')
eq(
  permission({ scope: 'global', permissionMode: 'whitelist' as never }),
  'fullAccess',
  'global 传非法值回落共享默认值'
)

// 缺 projectId 时按 global 走（这条是既有推断逻辑，顺带锁住）
eq(permission({}), 'fullAccess', '无 scope 无 projectId 推断为 global')
eq(permission({}, DEFAULTS_STRICT), 'default', '推断出的 global 同样跟随设置')
eq(permission({ permissionMode: 'fullAccess' }), 'fullAccess', '推断出的 global 同样可显式选 YOLO')

// 关键回归：共享默认值必须真的渗进 global（旧口径下这里被硬挡成 default）
eq(
  permission({ scope: 'global' }, { projectCollaborationMode: 'cowork', coworkPermissionMode: 'fullAccess' }),
  'fullAccess',
  'global 缺省跟随 coworkPermissionMode'
)

// ── 项目会话 chat：同样解绑 ─────────────────────────────────────────────

const projectChat = { scope: 'project' as const, projectId: 'p-1', collaborationMode: 'chat' as const }

eq(permission(projectChat), 'fullAccess', '项目 chat 缺省取共享默认值')
eq(permission(projectChat, DEFAULTS_STRICT), 'default', '项目 chat 缺省跟随设置里的 default')
eq(permission({ ...projectChat, permissionMode: 'fullAccess' }), 'fullAccess', '项目 chat 可显式选 YOLO')
eq(
  permission({ ...projectChat, permissionMode: null }, DEFAULTS_STRICT),
  'default',
  '项目 chat 传 null 回落设置值'
)
eq(
  permission({ ...projectChat, permissionMode: 'default' }),
  'default',
  '项目 chat 显式 default 优先于设置'
)

// ── 项目会话 cowork：同一个默认来源 ─────────────────────────────────────

const projectCowork = { scope: 'project' as const, projectId: 'p-1', collaborationMode: 'cowork' as const }

eq(permission(projectCowork), 'fullAccess', '项目 cowork 缺省取共享默认值')
eq(
  permission(projectCowork, DEFAULTS_STRICT),
  'default',
  '项目 cowork 缺省跟随设置里的 default'
)
eq(permission({ ...projectCowork, permissionMode: 'default' }), 'default', '项目 cowork 显式 default 优先于设置')

// 未指定协作模式时跟随项目默认设置 —— 但权限档与协作模式无关了，两者必须解耦
eq(
  permission(
    { scope: 'project', projectId: 'p-1' },
    { projectCollaborationMode: 'chat', coworkPermissionMode: 'fullAccess' }
  ),
  'fullAccess',
  '项目默认 chat 下缺省仍是共享默认值'
)
eq(
  permission({ scope: 'project', projectId: 'p-1', permissionMode: 'fullAccess' },
    { projectCollaborationMode: 'chat', coworkPermissionMode: 'default' }),
  'fullAccess',
  '项目默认 chat 下显式 YOLO 依然保留'
)
eq(
  permission({ scope: 'project', projectId: 'p-1' },
    { projectCollaborationMode: 'cowork', coworkPermissionMode: 'default' }),
  'default',
  '协作模式不同不再改变缺省值'
)

// ── 结构性约束：不变量仍成立 ────────────────────────────────────────────

eq(
  normalizeSessionContext({ scope: 'global', projectId: 'p-ignored' }, DEFAULTS).projectId,
  undefined,
  'global 会清掉 projectId'
)

checks++
assert.throws(
  () => normalizeSessionContext({ scope: 'project' }, DEFAULTS),
  /projectId/,
  'project 缺 projectId 必须抛错'
)

console.log(`session-permission-mode: ${checks} assertions passed`)
