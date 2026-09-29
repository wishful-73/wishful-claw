import { BRAND, hero } from '../content/site'

// 2026-09-23（老大）：首屏大图撤掉 —— 主界面截图压在「不花钱，也能用起来」上方太突兀。
// 那张图已交给「它能干什么 → 真干活」，首屏回归纯文案 + 两个入口。
export function Hero() {
  return (
    <section className="pt-28 pb-16 sm:pt-36">
      <div className="w-full px-6 text-center sm:px-10 lg:px-14">
        <p className="reveal mb-3 text-sm tracking-[0.24em] text-ink-900/45">
          {/* 闪光挂在内层 span 上：这个 p 自己带 `reveal` 的进场动画，
              同一个元素上压两条 animation 会互相覆盖（后定义的那条赢） */}
          <span className="shine shine-muted">{BRAND.vision}</span>
        </p>
        {/* 整段一起扫光：光由 h1 自己的 ::after 铺（见 index.css 的 .hero-shine），
            data-text 就是它的文字来源 —— 两处得同步改，别只改一边。 */}
        <h1
          data-text={`${hero.title.lead}${hero.title.highlight}`}
          className="hero-shine reveal mx-auto max-w-3xl text-4xl leading-tight font-semibold tracking-tight text-ink-950 sm:text-[52px] sm:leading-[1.15]"
        >
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
