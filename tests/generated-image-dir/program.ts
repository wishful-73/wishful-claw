/*
 * 工具产出物的默认落点（iter-36 S-153）。
 *
 * 存在理由：截图等内置产出物此前无条件落 `~/wishful-claw/image` —— 一个任何会话沙箱都不覆盖的
 * 固定目录。净效果是 agent 截完图拿到路径，回读时被沙箱拒掉（「自己产出的东西自己看不见」）。
 * 规则抽成 `src/main/lib/generated-image-dir.ts` 后，这里把三路分家钉死：
 *
 *   本地项目  → {workingFolder}/.wishful-claw/image   （沙箱根就是 workingFolder）
 *   SSH 项目  → {dataRoot}/projects/{projectId}/image （跟随记忆落点）
 *   全局/其它 → {dataRoot}/image                      （数据根无条件挂进沙箱）
 *
 * 重点两条：① 本地项目必须落在 workingFolder 的 `.wishful-claw` 子目录里（而不是数据根，也不是
 * 旧硬编码目录）；② 项目会话缺了本分支需要的事实（SSH 无 projectId / 本地无 workingFolder）时
 * 一律回落到数据根 —— 那是唯一「任何沙箱都覆盖得到」的保底位置。
 */

import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { resolveGeneratedImagesDir } from '../../src/main/lib/generated-image-dir'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

const DATA_ROOT = join('C:', 'data', '.wishful-claw-dev')
const WORKING_FOLDER = join('D:', 'claw', 'wishful-claw')
const PROJECT_ID = 'proj-abc123'

const DATA_ROOT_IMAGES = join(DATA_ROOT, 'image')
const LEGACY_IMAGES = join(homedir(), 'wishful-claw', 'image')

// ─── 1. 全局会话 → 数据根 ───

check(
  resolveGeneratedImagesDir({}, DATA_ROOT) === DATA_ROOT_IMAGES,
  '空 scope 回落到数据根 image/'
)
check(
  resolveGeneratedImagesDir({ scope: 'global' }, DATA_ROOT) === DATA_ROOT_IMAGES,
  'scope=global 落数据根 image/'
)
check(
  resolveGeneratedImagesDir({ scope: 'global', workingFolder: WORKING_FOLDER }, DATA_ROOT) ===
    DATA_ROOT_IMAGES,
  '全局会话即使带了 workingFolder 也落数据根（全局 ≠ 项目）'
)

// ─── 2. 本地项目 → {workingFolder}/.wishful-claw/image ───

const LOCAL_PROJECT_IMAGES = join(WORKING_FOLDER, '.wishful-claw', 'image')

check(
  resolveGeneratedImagesDir({ scope: 'project', workingFolder: WORKING_FOLDER }, DATA_ROOT) ===
    LOCAL_PROJECT_IMAGES,
  '本地项目落 {workingFolder}/.wishful-claw/image'
)
check(
  LOCAL_PROJECT_IMAGES.startsWith(WORKING_FOLDER + sep),
  '本地项目落点是 workingFolder 的子路径（沙箱天然覆盖）'
)
check(
  LOCAL_PROJECT_IMAGES !== DATA_ROOT_IMAGES,
  '本地项目不落数据根（否则多项目产出物会互相串）'
)
check(
  resolveGeneratedImagesDir(
    { scope: 'project', workingFolder: WORKING_FOLDER, sshConnectionId: '' },
    DATA_ROOT
  ) === LOCAL_PROJECT_IMAGES,
  'sshConnectionId 为空串（trim 后）走本地分支'
)
check(
  resolveGeneratedImagesDir(
    { scope: 'project', workingFolder: WORKING_FOLDER, sshConnectionId: '   ' },
    DATA_ROOT
  ) === LOCAL_PROJECT_IMAGES,
  'sshConnectionId 为纯空白走本地分支'
)

// ─── 3. SSH 项目 → {dataRoot}/projects/{projectId}/image ───

const SSH_PROJECT_IMAGES = join(DATA_ROOT, 'projects', PROJECT_ID, 'image')

check(
  resolveGeneratedImagesDir(
    { scope: 'project', sshConnectionId: 'ssh-1', projectId: PROJECT_ID },
    DATA_ROOT
  ) === SSH_PROJECT_IMAGES,
  'SSH 项目落 {dataRoot}/projects/{projectId}/image'
)
check(
  SSH_PROJECT_IMAGES.startsWith(join(DATA_ROOT, 'projects')),
  'SSH 项目落点是数据根下 projects/ 的子路径'
)
check(
  resolveGeneratedImagesDir(
    {
      scope: 'project',
      sshConnectionId: 'ssh-1',
      projectId: PROJECT_ID,
      workingFolder: WORKING_FOLDER
    },
    DATA_ROOT
  ) === SSH_PROJECT_IMAGES,
  'SSH 项目即使带了 workingFolder 也跟随记忆落点（远端目录不参与）'
)

// ─── 4. 项目会话缺事实 → 回落数据根（保底）───

check(
  resolveGeneratedImagesDir({ scope: 'project', sshConnectionId: 'ssh-1' }, DATA_ROOT) ===
    DATA_ROOT_IMAGES,
  'SSH 项目缺 projectId 回落数据根'
)
check(
  resolveGeneratedImagesDir(
    { scope: 'project', sshConnectionId: 'ssh-1', projectId: '   ' },
    DATA_ROOT
  ) === DATA_ROOT_IMAGES,
  'SSH 项目 projectId 为纯空白回落数据根'
)
check(
  resolveGeneratedImagesDir({ scope: 'project' }, DATA_ROOT) === DATA_ROOT_IMAGES,
  '项目会话无 workingFolder / 无 ssh 回落数据根'
)
check(
  resolveGeneratedImagesDir({ scope: 'project', workingFolder: '' }, DATA_ROOT) ===
    DATA_ROOT_IMAGES,
  '本地项目 workingFolder 为空串回落数据根'
)
check(
  resolveGeneratedImagesDir({ scope: 'project', workingFolder: '   ' }, DATA_ROOT) ===
    DATA_ROOT_IMAGES,
  '本地项目 workingFolder 为纯空白回落数据根'
)

// ─── 5. 回归：旧硬编码目录必须彻底出局 ───

check(
  LOCAL_PROJECT_IMAGES !== LEGACY_IMAGES,
  '本地项目不再落 ~/wishful-claw/image'
)
check(
  SSH_PROJECT_IMAGES !== LEGACY_IMAGES,
  'SSH 项目不再落 ~/wishful-claw/image'
)
check(DATA_ROOT_IMAGES !== LEGACY_IMAGES, '全局会话不再落 ~/wishful-claw/image')

const allOutputs = [
  resolveGeneratedImagesDir({}, DATA_ROOT),
  resolveGeneratedImagesDir({ scope: 'global' }, DATA_ROOT),
  resolveGeneratedImagesDir({ scope: 'project', workingFolder: WORKING_FOLDER }, DATA_ROOT),
  resolveGeneratedImagesDir(
    { scope: 'project', sshConnectionId: 'ssh-1', projectId: PROJECT_ID },
    DATA_ROOT
  )
]
check(
  allOutputs.every((dir) => dir !== LEGACY_IMAGES),
  '四类会话的落点没有一个等于旧固定目录'
)

// ─── 6. dataRoot 参与拼接：换根结果随之变化 ───

check(
  resolveGeneratedImagesDir({}, join('E:', 'other-root')) ===
    join('E:', 'other-root', 'image'),
  '全局落点跟随传入的数据根（纯函数，无隐藏全局态）'
)
check(
  resolveGeneratedImagesDir(
    { scope: 'project', sshConnectionId: 'ssh-1', projectId: PROJECT_ID },
    join('E:', 'other-root')
  ) === join('E:', 'other-root', 'projects', PROJECT_ID, 'image'),
  'SSH 落点跟随传入的数据根'
)
check(
  resolveGeneratedImagesDir({ scope: 'project', workingFolder: WORKING_FOLDER }, DATA_ROOT) ===
    resolveGeneratedImagesDir({ scope: 'project', workingFolder: WORKING_FOLDER }, join('E:', 'x')),
  '本地项目落点与数据根无关（只取决于 workingFolder）'
)

console.log(`generated-image-dir: ${checks} checks passed`)
