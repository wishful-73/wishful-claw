import { faq } from '../content/site'
import { Reveal, Section } from '../components/ui'

export function Faq() {
  return (
    <Section id="faq" eyebrow="FAQ" title={faq.title}>
      <Reveal>
        <div className="flex flex-col divide-y divide-ink-700 rounded-[13px] border border-ink-700 bg-paper">
          {faq.items.map((item) => (
            <details key={item.q} className="group px-6 py-4">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-base font-medium text-ink-950 marker:hidden">
                <span className="inline-block text-accent transition-transform group-open:rotate-90">›</span>
                {item.q}
              </summary>
              <p className="mt-3 pl-6 text-sm leading-relaxed text-ink-900/65">{item.a}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </Section>
  )
}
