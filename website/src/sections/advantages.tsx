import { advantages } from '../content/site'
import { AssetPlaceholder, Reveal, Section } from '../components/ui'

// 两类按 content/site.ts 内既定顺序呈现：门槛低（lead）→ 好看
export function Advantages() {
  return (
    <Section id="advantages" eyebrow="Why WishfulClaw" title={advantages.title}>
      <div className="flex flex-col gap-12">
        {advantages.groups.map((group) => (
          <Reveal key={group.category}>
            <p className="mb-4 inline-block rounded-full bg-accent/10 px-3.5 py-1 text-xs font-semibold text-accent">
              {group.category}
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              {group.items.map((item) => (
                <article
                  key={item.name}
                  className="rounded-[13px] border border-ink-700 bg-paper p-7 transition-shadow hover:shadow-[0_12px_32px_-16px_rgba(27,30,36,0.24)]"
                >
                  <h3 className="text-lg font-semibold text-ink-950">{item.name}</h3>
                  <p className="mt-2 font-medium text-accent">{item.quote}</p>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-900/65">{item.body}</p>
                  {'image' in item && item.image && (
                    <div className="mt-5">
                      <AssetPlaceholder label={item.image.label} assetNo={item.image.assetNo} aspect={item.image.aspect} />
                    </div>
                  )}
                </article>
              ))}
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}
