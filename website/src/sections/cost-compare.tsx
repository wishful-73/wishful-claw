import { costCompare } from '../content/site'
import { AssetPlaceholder, Reveal, Section } from '../components/ui'

// 口径红线：成本数据必须真实跑出来的 —— 阶段 1 数据未就绪，只放占位框，严禁编数字
export function CostCompare() {
  return (
    <Section id="cost" eyebrow="Real bill, not estimate" title={costCompare.title}>
      <Reveal>
        <p className="mb-6 max-w-2xl leading-relaxed text-ink-900/65">{costCompare.lead}</p>
        <div className="rounded-[13px] border border-ink-700 bg-paper-soft p-6">
          <AssetPlaceholder label={costCompare.image.label} assetNo={costCompare.image.assetNo} aspect={costCompare.image.aspect} />
          <p className="mt-5 text-center text-sm text-ink-900/55">{costCompare.placeholder}</p>
        </div>
        <p className="mt-4 text-xs text-ink-900/40">* {costCompare.footnote}</p>
      </Reveal>
    </Section>
  )
}
