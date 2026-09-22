import { features } from '../content/site'
import { AssetPlaceholder, Reveal, Section } from '../components/ui'

export function Features() {
  return (
    <Section id="features" eyebrow="What it does" title={features.title}>
      <Reveal>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.items.map((item) => (
            <article
              key={item.name}
              className="flex flex-col rounded-[13px] border border-ink-700 bg-paper p-7 transition-shadow hover:shadow-[0_12px_32px_-16px_rgba(27,30,36,0.24)]"
            >
              <h3 className="text-lg font-semibold text-ink-950">{item.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-900/65">{item.desc}</p>
              {'image' in item && item.image && (
                <div className="mt-5">
                  <AssetPlaceholder label={item.image.label} assetNo={item.image.assetNo} aspect="4 / 3" />
                </div>
              )}
            </article>
          ))}
        </div>
      </Reveal>
    </Section>
  )
}
