import { BRAND, hero } from '../content/site'
import { ConvergeStreams } from './converge-streams'

// 2026-09-23（老大）：首屏大图撤掉 —— 主界面截图压在「不花钱，也能用起来」上方太突兀。
// 那张图已交给「它能干什么 → 真干活」，首屏回归纯文案 + 两个入口。
//
// 2026-10-16（S-206）：首屏加一层装饰性背景，同时整体撤掉原先的文字扫光 —— 老大 08:58 定
// 「保动画、扫光让步」：扫光最早做的目的就是觉得静态页面太素，这个岗位现在由背景动画接。
// 撤掉的两处是配套的，必须一起改：
//   ① 顶部那行的 `shine shine-muted`；② h1 的 `hero-shine` 与 `data-text`
//   （`data-text` 是 `.hero-shine::after` 的 content 来源，只删 CSS 不删它就会脏在 DOM 里）。
//
// 2026-10-19（第三次要求）：收束层从首屏搬到了整页（老大：「这个是整个页面的全局背景」）。
//
// 2026-10-19（第四次要求）：暖色雾也从首屏搬到整站，挂到三张页面（.site-mist）。
//
// 2026-10-19（第五次要求，10:30）：**光束收回首屏**（老大：「这个光束可以就集中在首屏么，不是整个
// 首页，之前的暖色背景是整站的这个是对的」）⇒ 收束层搬回这里，雾不回来、继续整站。
// 于是 `relative isolate` 又需要了 —— 给这层的负 z-index 就地建堆叠上下文（见 index.css §背景动画层）。
export function Hero() {
  return (
    <section className="relative isolate pt-28 pb-16 sm:pt-36">
      <ConvergeStreams />
      <div className="w-full px-6 text-center sm:px-10 lg:px-14">
        <p className="reveal mb-3 text-sm tracking-[0.24em] text-ink-900/45">{BRAND.vision}</p>
        <h1 className="reveal mx-auto max-w-3xl text-4xl leading-tight font-semibold tracking-tight text-ink-950 sm:text-[52px] sm:leading-[1.15]">
          {hero.title.lead}
          <span className="text-accent">{hero.title.highlight}</span>
        </h1>
        <p className="reveal mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-ink-900/65">{hero.subtitle}</p>
        <div className="reveal mt-9 flex flex-wrap items-center justify-center gap-4">
          <a
            href={hero.primaryCtaHref}
            data-converge-target
            className="rounded-[10px] bg-accent px-7 py-3 text-base font-semibold text-white transition-opacity hover:opacity-90"
          >
            {hero.primaryCta}
          </a>
        </div>
      </div>
    </section>
  )
}
