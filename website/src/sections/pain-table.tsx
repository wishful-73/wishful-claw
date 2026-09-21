import { painTable } from '../content/site'
import { Reveal, Section } from '../components/ui'

export function PainTable() {
  return (
    <Section id="pain" title={painTable.title}>
      <Reveal>
        <div className="overflow-hidden rounded-[13px] border border-ink-700 bg-paper">
          <table className="w-full text-left text-sm sm:text-base">
            <thead className="bg-paper-soft text-ink-900/60">
              <tr>
                <th className="px-6 py-4 font-medium">{painTable.leftHead}</th>
                <th className="px-6 py-4 font-semibold text-accent">{painTable.rightHead}</th>
              </tr>
            </thead>
            <tbody>
              {painTable.rows.map(([left, right]) => (
                <tr key={left} className="border-t border-ink-700">
                  <td className="px-6 py-4 text-ink-900/55">{left}</td>
                  <td className="px-6 py-4 font-medium text-ink-950">{right}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
    </Section>
  )
}
