import { quickStart } from '../content/site'
import { AssetPlaceholder, Reveal, Section } from '../components/ui'

export function QuickStart() {
  return (
    <Section id="quick-start" eyebrow="Get started" title={quickStart.title}>
      <Reveal>
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {quickStart.steps.map((step, i) => (
            <li key={step.name} className="rounded-[13px] border border-ink-700 bg-paper p-7">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-950 text-sm font-semibold text-white">
                {i + 1}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-ink-950">{step.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-900/65">{step.desc}</p>
            </li>
          ))}
        </ol>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {quickStart.media.map((item) => (
            <figure key={item.assetNo}>
              <AssetPlaceholder label={item.label} assetNo={item.assetNo} aspect="16 / 10" />
              <figcaption className="mt-2 text-xs text-ink-900/45">{item.step}</figcaption>
            </figure>
          ))}
        </div>
      </Reveal>
    </Section>
  )
}
