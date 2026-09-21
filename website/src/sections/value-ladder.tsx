import { valueLadder } from '../content/site'
import { Reveal, Section } from '../components/ui'

export function ValueLadder() {
  return (
    <Section id="value-ladder" eyebrow="Zero-cost first" title={valueLadder.title}>
      <p className="-mt-8 mb-10 text-[15px] text-ink-900/55">{valueLadder.note}</p>
      <Reveal>
        <div className="grid gap-5 sm:grid-cols-3">
          {valueLadder.tiers.map((tier, i) => (
            <div
              key={tier.name}
              className={`rounded-[13px] border p-7 ${i === 0 ? 'border-accent/45 bg-accent/[0.04]' : 'border-ink-700 bg-paper'}`}
            >
              <p className="text-xs text-ink-900/45">第 {i + 1} 层</p>
              <h3 className="mt-1 text-lg font-semibold text-ink-950">{tier.name}</h3>
              <p className={`mt-1 text-sm font-medium ${i === 2 ? 'text-ink-900/55' : 'text-accent'}`}>{tier.cost}</p>
              <ul className="mt-5 space-y-2.5 text-sm leading-relaxed text-ink-900/65">
                {tier.items.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Reveal>
    </Section>
  )
}
