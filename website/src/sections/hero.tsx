import { BRAND, hero } from '../content/site'
import { AssetPlaceholder } from '../components/ui'

export function Hero() {
  return (
    <section className="pt-28 pb-16 sm:pt-36">
      <div className="mx-auto w-full max-w-5xl px-6 text-center">
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
          <a href={hero.secondaryAnchor} className="px-2 text-base font-medium text-ink-950 transition-colors hover:text-accent">
            {hero.secondaryCta}
          </a>
        </div>
        <div className="reveal mx-auto mt-16 max-w-4xl" style={{ animationDelay: '0.12s' }}>
          <AssetPlaceholder label={hero.image.label} assetNo={hero.image.assetNo} aspect={hero.image.aspect} />
        </div>
      </div>
    </section>
  )
}
