// iter-32 S-84 —— 会话级「请求上下文上限」的取值规则。
//
// 三条口径：
//   1. 上限记着它是在哪个模型上设的，模型换了即作废（老大：切换模型时这个值改成
//      模型的最大上下文，需要重新设置）。判据必须严格到「模型 id 不同就不生效」，
//      因为这是唯一能挡住旧数值悄悄套到新窗口上的地方。
//   2. 量程 200K ~ 当前模型窗口；模型窗口本身不超过 200K 时给不出有意义区间，
//      返回 null（调用方据此不渲染控件）。
//   3. applySessionContextCap 只往下夹，不往上抬。
//
// 另有一条**显示口径**的断言：滑杆左下角那个 200K 是十进制还是二进制，用户一眼就能
// 看出对不上（二进制 200*1024 会被 formatTokens 显示成 205k）。这条不是洁癖 —— 是
// 老大真机拖到最左看到 205k 报上来的。
//
// iter-34 S-107 在本文件尾部追加了「全局上限 + 会话继承」一组：全局值存的是**绝对
// token 数**（0 = 不限制），会话没设过就继承它；会话值仍然受 S-84 的「换模型作废」
// 约束，而**全局值不绑模型** —— 两者口径不同，别顺手统一。
//
// 同一组后来又追加了「全局上限调档」（老大：不要手输，只给 200K / 400K / 800K / 1M）：
// clampGlobalContextCapTokens 的语义从「夹到量程」改成了「吸附到档位」，档位是**白名单**
// 不是范围 —— 老配置里的 384000 会在收口时被迁到 400K。档位里**没有 0 / 不限制**：
// 全局上限永远是个具体数字，老配置的 0 与缺失值都落到默认档 1M，不能被压到最低档。

import assert from 'node:assert/strict'
import {
  MIN_SESSION_CONTEXT_CAP_TOKENS,
  CONTEXT_CAP_STEP_TOKENS,
  SESSION_COMPRESSION_THRESHOLD_STEP,
  applySessionContextCap,
  clampSessionCompressionThreshold,
  resolveEffectiveContextCapTokens,
  resolveSessionContextCapRange,
  resolveSessionContextCapTokens,
  resolveSessionCompressionThreshold
} from '../../src/renderer/src/lib/agent/context-compression-config'
import {
  GLOBAL_CONTEXT_CAP_STAGES,
  clampGlobalContextCapTokens,
  globalContextCapStageIndex
} from '../../src/renderer/src/stores/settings-store-types'
import { formatTokens } from '../../src/renderer/src/lib/format-tokens'

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

// 模型档案里的窗口就是十进制（见 stores/providers/*.ts），夹具跟着用十进制。
const ONE_M = 1_000_000
const SOME_CAP = 256_000

// —— resolveSessionContextCapTokens：模型绑定 ——

eq(
  resolveSessionContextCapTokens({
    capTokens: SOME_CAP,
    capModelId: 'model-a',
    currentModelId: 'model-a'
  }),
  SOME_CAP,
  '同一个模型上设的上限生效'
)

eq(
  resolveSessionContextCapTokens({
    capTokens: SOME_CAP,
    capModelId: 'model-a',
    currentModelId: 'model-b'
  }),
  0,
  '换了模型上限即作废'
)

eq(
  resolveSessionContextCapTokens({
    capTokens: SOME_CAP,
    capModelId: null,
    currentModelId: 'model-a'
  }),
  0,
  '没记模型 id 的上限不生效'
)

eq(
  resolveSessionContextCapTokens({
    capTokens: SOME_CAP,
    capModelId: 'model-a',
    currentModelId: null
  }),
  0,
  '拿不到当前模型时不生效'
)

eq(
  resolveSessionContextCapTokens({
    capTokens: 0,
    capModelId: 'model-a',
    currentModelId: 'model-a'
  }),
  0,
  '0 就是不限制'
)

eq(
  resolveSessionContextCapTokens({
    capTokens: -1,
    capModelId: 'model-a',
    currentModelId: 'model-a'
  }),
  0,
  '负数当不限制处理'
)

eq(
  resolveSessionContextCapTokens({
    capTokens: Number.NaN,
    capModelId: 'model-a',
    currentModelId: 'model-a'
  }),
  0,
  'NaN 当不限制处理'
)

eq(resolveSessionContextCapTokens({}), 0, '什么都没给就是不限制')

eq(
  resolveSessionContextCapTokens({
    capTokens: 250_000.7,
    capModelId: 'model-a',
    currentModelId: 'model-a'
  }),
  250_000,
  '小数向下取整'
)

// —— resolveSessionContextCapRange：量程 ——

const oneMRange = resolveSessionContextCapRange(ONE_M)
eq(oneMRange?.min, MIN_SESSION_CONTEXT_CAP_TOKENS, '量程下限固定 200K')
eq(oneMRange?.max, ONE_M, '量程上限是模型窗口')
eq(oneMRange?.step, CONTEXT_CAP_STEP_TOKENS, '步长固定')

eq(
  resolveSessionContextCapRange(MIN_SESSION_CONTEXT_CAP_TOKENS),
  null,
  '窗口恰好等于下限时没有可压区间'
)

eq(resolveSessionContextCapRange(128_000), null, '窗口小于下限时没有可压区间')

eq(resolveSessionContextCapRange(0), null, '拿不到窗口时不渲染控件')

eq(resolveSessionContextCapRange(Number.NaN), null, '窗口非法时不渲染控件')

eq(
  resolveSessionContextCapRange(MIN_SESSION_CONTEXT_CAP_TOKENS + 4_000)?.max,
  MIN_SESSION_CONTEXT_CAP_TOKENS + 4_000,
  '刚超过下限就有区间'
)

// —— 与显示口径对齐（老大真机拖到最左看到 205k 的那次） ——

eq(
  formatTokens(MIN_SESSION_CONTEXT_CAP_TOKENS),
  '200k',
  '滑杆拖到最左显示 200k，不能是 205k'
)
eq(
  MIN_SESSION_CONTEXT_CAP_TOKENS % 1_000,
  0,
  '下限要能被 1000 整除，否则 formatTokens 会显示成带零头'
)
eq(
  CONTEXT_CAP_STEP_TOKENS % 1_000,
  0,
  '步长同样按十进制，拖出来的每个刻度都是整千'
)

// —— applySessionContextCap：只往下夹 ——

eq(applySessionContextCap(ONE_M, 200_000), 200_000, '大窗口夹到上限')
eq(applySessionContextCap(128_000, 200_000), 128_000, '小窗口保持原值')
eq(applySessionContextCap(ONE_M, 0), ONE_M, '上限 0 时不夹')
eq(applySessionContextCap(ONE_M, null), ONE_M, '上限 null 时不夹')
eq(applySessionContextCap(ONE_M, undefined), ONE_M, '上限 undefined 时不夹')
eq(applySessionContextCap(ONE_M, Number.NaN), ONE_M, '上限 NaN 时不夹')
eq(applySessionContextCap(ONE_M, -5), ONE_M, '上限负数时不夹')
eq(applySessionContextCap(ONE_M, ONE_M), ONE_M, '恰好等于窗口时不夹')
eq(applySessionContextCap(0, 200_000), 0, '窗口为 0 时不夹')

// —— iter-32 S-85：会话级「压缩阈值」（0 = 跟随全局）——

// clampSessionCompressionThreshold 与 clampCompressionThreshold 在越界时的行为**相反**：
// 前者必须落回 0（= 没设过），后者夹到边界。写反了用户就永远退不回「跟随全局」。
eq(clampSessionCompressionThreshold(0.5), 0.5, '区间内的会话阈值原样保留')
eq(clampSessionCompressionThreshold(0.3), 0.3, '下边界 0.3 合法（含）')
eq(clampSessionCompressionThreshold(0.9), 0.9, '上边界 0.9 合法（含）')
eq(clampSessionCompressionThreshold(0.29), 0, '低于下界回落 0 = 跟随全局，不夹到 0.3')
eq(clampSessionCompressionThreshold(0.91), 0, '高于上界回落 0，不夹到 0.9')
eq(clampSessionCompressionThreshold(0), 0, '0 就是哨兵值本身')
eq(clampSessionCompressionThreshold(Number.NaN), 0, 'NaN 回落 0')
eq(clampSessionCompressionThreshold(Number.POSITIVE_INFINITY), 0, 'Infinity 回落 0')
eq(clampSessionCompressionThreshold(undefined), 0, 'undefined 回落 0')
eq(clampSessionCompressionThreshold(null), 0, 'null 回落 0')

// 生效值：会话设过优先，否则全局；两边都不成则用默认 0.8。
eq(resolveSessionCompressionThreshold(0.5, 0.8), 0.5, '会话设过就用会话的')
eq(resolveSessionCompressionThreshold(0.6, 0.7), 0.6, '会话的覆盖全局，不是取小/取大')
eq(resolveSessionCompressionThreshold(0, 0.7), 0.7, '会话为 0（没设过）用全局')
eq(resolveSessionCompressionThreshold(0.95, 0.7), 0.7, '会话值越界视为没设，回落全局')
eq(resolveSessionCompressionThreshold(null, 0.7), 0.7, '会话 null 用全局')
eq(resolveSessionCompressionThreshold(undefined, 0.7), 0.7, '会话 undefined 用全局')
eq(resolveSessionCompressionThreshold(0.5, 0.2), 0.5, '全局越界不影响会话值生效')
// 全局那侧走的是既有的 clampCompressionThreshold：越界**夹到边界**，不是回落默认。
// 会话那侧才回落 0 —— 两套语义不同是有意的，别顺手统一。
eq(resolveSessionCompressionThreshold(0, 0.2), 0.3, '全局越界夹到 0.3（不是回落 0.8）')
eq(resolveSessionCompressionThreshold(0, 5), 0.9, '全局越界夹到 0.9')
eq(resolveSessionCompressionThreshold(0, Number.NaN), 0.8, '全局 NaN 回落默认 0.8')
eq(resolveSessionCompressionThreshold(0, undefined), 0.8, '两边都没给时回落默认 0.8')

// 滑条按百分点走（30~90），所以步长必须能整除 1 个百分点，否则拖出来是 34.99999%。
eq(SESSION_COMPRESSION_THRESHOLD_STEP, 0.05, '步长 5%，落在整百分比刻度上')
eq(
  Math.round((1 / SESSION_COMPRESSION_THRESHOLD_STEP) * 100) % 100,
  0,
  '步长能整除 1 个百分点，滑条刻度不会出现小数'
)

// —— iter-34 S-107：全局「请求上下文上限」与会话继承 ——

// 优先级与会话级压缩阈值同构：会话设过（且仍适用于当前模型）就用会话的，否则落到
// 全局；全局也是 0 就 0 = 不限制。两条容易写错的边界都钉在这里：① 会话值因换模型
// 作废时**落回全局**而不是 0；② 全局值**不绑模型**，没有当前模型 id 照样生效。
const GLOBAL_CAP = 384_000

eq(
  resolveEffectiveContextCapTokens({
    sessionCapTokens: SOME_CAP,
    sessionCapModelId: 'model-a',
    currentModelId: 'model-a',
    globalCapTokens: GLOBAL_CAP
  }),
  SOME_CAP,
  '会话设过且模型匹配 ⇒ 会话值覆盖全局'
)

eq(
  resolveEffectiveContextCapTokens({
    sessionCapTokens: 0,
    sessionCapModelId: 'model-a',
    currentModelId: 'model-a',
    globalCapTokens: GLOBAL_CAP
  }),
  GLOBAL_CAP,
  '会话没设过 ⇒ 继承全局'
)

eq(
  resolveEffectiveContextCapTokens({
    sessionCapTokens: undefined,
    sessionCapModelId: null,
    currentModelId: 'model-a',
    globalCapTokens: GLOBAL_CAP
  }),
  GLOBAL_CAP,
  '会话字段缺失 ⇒ 继承全局'
)

eq(
  resolveEffectiveContextCapTokens({
    sessionCapTokens: SOME_CAP,
    sessionCapModelId: 'model-a',
    currentModelId: 'model-b',
    globalCapTokens: GLOBAL_CAP
  }),
  GLOBAL_CAP,
  '会话值因换模型作废 ⇒ 落回全局，不是 0'
)

eq(
  resolveEffectiveContextCapTokens({
    sessionCapTokens: SOME_CAP,
    sessionCapModelId: 'model-a',
    currentModelId: 'model-a',
    globalCapTokens: 0
  }),
  SOME_CAP,
  '全局为 0（不限制）不影响会话值生效'
)

eq(
  resolveEffectiveContextCapTokens({
    sessionCapTokens: 0,
    currentModelId: 'model-a',
    globalCapTokens: 0
  }),
  0,
  '两边都没设 ⇒ 0 = 不限制'
)

eq(
  resolveEffectiveContextCapTokens({ globalCapTokens: GLOBAL_CAP }),
  GLOBAL_CAP,
  '全局值不绑模型，拿不到模型 id 也照样生效'
)

eq(
  resolveEffectiveContextCapTokens({
    sessionCapTokens: 0,
    globalCapTokens: Number.NaN
  }),
  0,
  '全局 NaN 当不限制'
)

eq(
  resolveEffectiveContextCapTokens({
    sessionCapTokens: 0,
    globalCapTokens: -1
  }),
  0,
  '全局负数当不限制'
)

eq(
  resolveEffectiveContextCapTokens({
    sessionCapTokens: 0,
    globalCapTokens: 300_000.9
  }),
  300_000,
  '全局小数向下取整'
)

// —— iter-34 S-107 调档：全局上限只认固定档位 ——

// 档位是白名单不是量程，所以收口是「吸附」不是「夹」：手输的数字要落到最近的档上，
// 顺手把老配置迁走。**没有「不限制」这一档** —— 全局上限永远是个具体数字。
eq(clampGlobalContextCapTokens(200_000), 200_000, '正好在档位上 ⇒ 原样保留')
eq(clampGlobalContextCapTokens(384_000), 400_000, '手输的 384000 吸附到最近的 400K 档')
eq(clampGlobalContextCapTokens(190_000), 200_000, '离 200K 更近 ⇒ 吸附到 200K')
eq(clampGlobalContextCapTokens(100_000), 200_000, '低于最低档 ⇒ 吸附到最低档 200K')
eq(clampGlobalContextCapTokens(1_500_000), 1_000_000, '超出最高档 ⇒ 吸附到 1M')
// 非正数走的是「回落默认档」，**不是**吸附到最低档：老配置里的 0 就是旧的「不限制」，
// 吸附到 200K 等于把老用户的窗口静默砍一半。
eq(clampGlobalContextCapTokens(0), 1_000_000, '老配置的 0（旧「不限制」哨兵）⇒ 默认档 1M')
eq(clampGlobalContextCapTokens(-1), 1_000_000, '负数回落默认档，不吸附到 200K')
eq(clampGlobalContextCapTokens(Number.NaN), 1_000_000, 'NaN 回落默认档')
eq(GLOBAL_CONTEXT_CAP_STAGES.length, 4, '档位数：200K / 400K / 800K / 1M')
eq(GLOBAL_CONTEXT_CAP_STAGES[0], 200_000, '最低档就是 200K，档位里没有 0 / 不限制')

// 滑杆吃的是**下标**，不是 token 数 —— 两边换算只有这一个入口，别在组件里再算一遍。
eq(globalContextCapStageIndex(200_000), 0, '200K = 第 0 档')
eq(globalContextCapStageIndex(384_000), 1, '手输值先吸附到 400K 再取下标 = 第 1 档')
eq(globalContextCapStageIndex(1_000_000), 3, '1M = 最后一档')
eq(globalContextCapStageIndex(0), 3, '0 回落默认档 1M ⇒ 下标落在最后一档')

console.log(`context-cap: ${checks} assertions passed`)
