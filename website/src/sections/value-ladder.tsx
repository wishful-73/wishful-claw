import { valueLadder } from '../content/site'
import { Reveal } from '../components/ui'

// 2026-09-21（S-127 方案 A）：原来是 Section（py-24 + 英文眉标 + 大标题 + 三张 283px 的卡）整块 618px，
// 搬到 Hero 之上后把产品主标题挤出首屏 ⇒ 压成 Hero 之后的一条窄带：去掉 Section 的 py-24 与英文眉标
// （眉标 ZERO-COST FIRST 是全页第一行英文，对中文目标人群是噪音），三列紧凑，每列「层名 + 费用 + 一句说明」。
// 弃用 items 列表 —— 列表正是把区块撑高的东西。`scroll-mt-24` 保留：顶栏 sticky，锚点跳转要留出顶栏高度。
// 2026-09-23（老大）：「它能干什么」标题掉出首屏 —— 本块 `pb-20`(80px) 与 features 的 `pt-24`(96px)
// 叠出 176px 空白。两头一起收：这里 `pb-20 → pb-5`(20px)，features 那边 `pt-24 → pt-5`。
export function ValueLadder() {
  return (
    <section id="value-ladder" className="scroll-mt-24 pb-5">
      <div className="w-full px-6 sm:px-10 lg:px-14">
        <Reveal>
          <div className="rounded-[13px] border border-ink-700 bg-paper-soft px-8 py-7">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {/* 闪光不上这里（2026-09-23 老大）：它跟首屏大标题离得太近，一个屏里闪两处太吵 */}
              <h2 className="text-xl font-semibold tracking-tight text-ink-950">{valueLadder.title}</h2>
              <p className="text-sm text-ink-900/55">{valueLadder.note}</p>
            </div>
            {/* 三列**占满卡片**，不再钉 max-w-3xl（2026-09-23 老大回退我上一版）。
                上一版为了治「三块离太远」把内容钉到 768px，代价是：
                  · 卡片 959px、内容 768px ⇒ 边框里左右各空 96px，像被掐住；
                  · 每列只剩 240px，而零成本层一行要 549px ⇒ 硬折成 3 行（重度层 511px 同样 3 行）。
                实测 1079 视口下三列各 287px ⇒ 全部 ≤2 行；宽屏（1900 上下）各 570px 左右
                ⇒ 三段都回到 1 行，且文字自己撑满列宽，不会再显得「隔着一大片」。 */}
            <div className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-3">
              {valueLadder.tiers.map((tier, i) => (
                // `tier` 类的样式（三列自动依次点亮、顶上那条线走一道橙光）在 index.css
                <div key={tier.name} className="tier border-t border-ink-700 pt-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold text-ink-950">{tier.name}</span>
                    <span className={`text-xs font-medium ${i === 2 ? 'text-ink-900/55' : 'text-accent'}`}>{tier.cost}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-900/60">{tier.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
