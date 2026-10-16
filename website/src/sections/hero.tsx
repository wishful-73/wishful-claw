import { BRAND, hero } from '../content/site'

// 2026-09-23（老大）：首屏大图撤掉 —— 主界面截图压在「不花钱，也能用起来」上方太突兀。
// 那张图已交给「它能干什么 → 真干活」，首屏回归纯文案 + 两个入口。
//
// 2026-10-16（S-206）：首屏加一层装饰性背景（色雾 + 两层细线稿，样式见 index.css 的 .hero-aurora），
// 同时整体撤掉原先的文字扫光 —— 老大 08:58 定「保动画、扫光让步」：扫光最早做的目的就是觉得
// 静态页面太素，这个岗位现在由背景动画接。撤掉的两处是配套的，必须一起改：
//   ① 顶部那行的 `shine shine-muted`；② h1 的 `hero-shine` 与 `data-text`
//   （`data-text` 是 `.hero-shine::after` 的 content 来源，只删 CSS 不删它就会脏在 DOM 里）。
//
// section 上的 `isolate` 是必需的：背景层走负 z-index，只有先在这里建立堆叠上下文，
// 它才会落在「区块背景之上、文字之下」；否则会沉到 body 纸面以下，整层看不见。
export function Hero() {
  return (
    <section className="relative isolate pt-28 pb-16 sm:pt-36">
      {/* 纯装饰：不给鼠标、不进无障碍树。两个 svg 是同一层的两种线（一深墨、一琥珀）。 */}
      <div className="hero-aurora" aria-hidden="true">
        <svg
          className="hero-aurora-lines"
          viewBox="0 0 1400 800"
          preserveAspectRatio="xMidYMid slice"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        >
          <path d="M-60 620C180 520 300 300 560 250s420 90 700 30" />
          <path d="M-40 250C220 180 420 300 700 220s420-60 780 40" />
          <path d="M120 820C300 620 520 560 860 610s460-40 620-180" />
          <circle cx="560" cy="250" r="3" />
          <circle cx="700" cy="220" r="2.5" />
          <circle cx="860" cy="610" r="2.5" />
        </svg>
        <svg
          className="hero-aurora-lines hero-aurora-lines-2"
          viewBox="0 0 1400 800"
          preserveAspectRatio="xMidYMid slice"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        >
          <path d="M-20 470C240 430 420 540 660 470s400-140 800-40" />
          <path d="M240 40C360 200 620 240 900 180s380-20 540 90" />
          <circle cx="660" cy="470" r="3" />
          <circle cx="900" cy="180" r="2.5" />
        </svg>
      </div>
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
            className="rounded-[10px] bg-accent px-7 py-3 text-base font-semibold text-white transition-opacity hover:opacity-90"
          >
            {hero.primaryCta}
          </a>
        </div>
      </div>
    </section>
  )
}
