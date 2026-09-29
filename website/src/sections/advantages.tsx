import { advantages } from '../content/site'
import { Reveal, Section } from '../components/ui'

// 两类按 content/site.ts 内既定顺序呈现：门槛低（lead）→ 好看
// 2026-09-23（老大）：优势区不再配图（全页配图太密）——「好看」那条的界面大图撤掉后，
// 全组都没 image 字段了，原先条件渲染配图的那段随之删除，AssetPlaceholder 也不再引入。
export function Advantages() {
  return (
    <Section id="advantages" eyebrow="Why WishfulClaw" title={advantages.title}>
      <div className="flex flex-col gap-12">
        {advantages.groups.map((group) => (
          <Reveal key={group.category}>
            <p className="mb-4 inline-block rounded-full bg-accent/10 px-3.5 py-1 text-xs font-semibold text-accent">
              {group.category}
            </p>
            {/* 单个 item（「好看」那组只有「界面样式好看」一条）不套两列 grid ——
                否则一条卡片只占半幅，右边空一大片（2026-09-23 老大指出）。 */}
            <div className={group.items.length > 1 ? 'grid gap-5 sm:grid-cols-2' : 'grid gap-5'}>
              {group.items.map((item) => (
                <article
                  key={item.name}
                  className="rounded-[13px] border border-ink-700 bg-paper p-7 transition-shadow hover:shadow-[0_12px_32px_-16px_rgba(27,30,36,0.24)]"
                >
                  <h3 className="text-lg font-semibold text-ink-950">{item.name}</h3>
                  <p className="mt-2 font-medium text-accent">{item.quote}</p>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-900/65">{item.body}</p>
                </article>
              ))}
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}
