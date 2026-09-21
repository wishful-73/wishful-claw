import { valueLadder } from '../content/site'
import { Reveal } from '../components/ui'

// 2026-09-21（S-127 方案 A）：原来是 Section（py-24 + 英文眉标 + 大标题 + 三张 283px 的卡）整块 618px，
// 搬到 Hero 之上后把产品主标题挤出首屏 ⇒ 压成 Hero 之后的一条窄带：去掉 Section 的 py-24 与英文眉标
// （眉标 ZERO-COST FIRST 是全页第一行英文，对中文目标人群是噪音），三列紧凑，每列「层名 + 费用 + 一句说明」。
// 弃用 items 列表 —— 列表正是把区块撑高的东西。`scroll-mt-24` 保留：顶栏 sticky，锚点跳转要留出顶栏高度。
export function ValueLadder() {
  return (
    <section id="value-ladder" className="scroll-mt-24 pb-20">
      <div className="mx-auto w-full max-w-5xl px-6">
        <Reveal>
          <div className="rounded-[13px] border border-ink-700 bg-paper-soft px-8 py-7">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="text-xl font-semibold tracking-tight text-ink-950">{valueLadder.title}</h2>
              <p className="text-sm text-ink-900/55">{valueLadder.note}</p>
            </div>
            <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-3">
              {valueLadder.tiers.map((tier, i) => (
                <div key={tier.name} className="border-t border-ink-700 pt-4">
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
