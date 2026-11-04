import { useEffect, useRef, useState } from 'react'
import { quickStart } from '../content/site'
import { AssetPlaceholder, Reveal, Section } from '../components/ui'

// 鼠标从卡片移到配图上的这段路，用来兜住「正在路上」的空档。
// 20px 的间距 + 从卡片底边走到图上，正常人不到 100ms，260ms 有富余。
// 不给这个宽限会出老大实测到的那个毛病：移入卡片图出来了，手往下走准备看图，
// 半路离开卡片 → 立刻收起 → 图在眼前消失。
const CLOSE_DELAY_MS = 260

// 2026-09-23（老大）：配图改成「移入才出来」—— 官网配图太密，这块不该一进来就压一张大图在下面。
// 挂钩挂在**对应的那步卡片**上（数据驱动：media 里 `step` 对上哪张卡片，就哪张卡片管这张图），
// 不是挂在整个区块上 —— 否则鼠标随便飘过四步区都会弹图。
//
// 三个入口都留了，缺一个就有人用不了：
//   · 鼠标移入 / 移出 —— 桌面端主路径
//   · 焦点进入 / 离开 —— 键盘 Tab 到卡片也能看
//   · 点击切换        —— 触屏没有 hover，只能点
//
// ⚠️ 收起不是「鼠标一离开卡片就立刻收」：
//   ① 卡片离开 → 起一个 260ms 的定时器，不是马上收；
//   ② **配图区自己也算悬停区**（移入取消定时器）—— 这是让「卡片 → 图」这条动线走得通的关键；
//   ③ 整个区块都离开了才立即收，免得延迟收在那空等。
// 配图位默认**零高度**（grid-rows 0fr → 1fr 过渡），所以不打开时它一点都不占版面，
// 这才是「图太多」要的效果；代价是展开会把下面的 FAQ 顶下去，属于预期内的位移。
export function QuickStart() {
  const [openStep, setOpenStep] = useState<string | null>(null)
  const closeTimer = useRef<number | null>(null)

  const cancelClose = (): void => {
    if (closeTimer.current === null) return
    window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }

  // 「别急着收」——留出从卡片走到配图的时间
  const closeSoon = (): void => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setOpenStep(null)
    }, CLOSE_DELAY_MS)
  }

  // 整个区块都离开了，就不用再等
  const closeNow = (): void => {
    cancelClose()
    setOpenStep(null)
  }

  const open = (name: string): void => {
    cancelClose()
    setOpenStep(name)
  }

  const toggle = (name: string): void => {
    cancelClose()
    setOpenStep((prev) => (prev === name ? null : name))
  }

  // 卸载时清掉没落地的定时器，否则会对着已卸载的组件 setState
  useEffect(() => cancelClose, [])

  return (
    <Section id="quick-start" eyebrow="Get started" title={quickStart.title}>
      <Reveal>
        <div onMouseLeave={closeNow}>
          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {quickStart.steps.map((step, i) => {
              const shot = quickStart.media.some((m) => m.step === step.name)
              const isOpen = shot && openStep === step.name
              return (
                <li
                  key={step.name}
                  onMouseEnter={shot ? () => open(step.name) : undefined}
                  onMouseLeave={shot ? closeSoon : undefined}
                  onFocus={shot ? () => open(step.name) : undefined}
                  onBlur={shot ? closeSoon : undefined}
                  onClick={shot ? () => toggle(step.name) : undefined}
                  tabIndex={shot ? 0 : undefined}
                  className={`rounded-[13px] border border-ink-700 bg-paper p-7 ${
                    shot ? 'cursor-pointer transition-colors' : ''
                  } ${isOpen ? 'border-accent/60 bg-accent/[0.03]' : ''}`}
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-950 text-sm font-semibold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-ink-950">{step.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-900/65">{step.desc}</p>
                  {/* 这行提示必须**常驻**（只换字）：它一出现/消失，四张卡的行高就变，整块会跟着跳 */}
                  {shot && (
                    <p className="mt-3 text-xs text-ink-900/40">
                      {isOpen ? '配图见下方 ↓' : '移入查看配图 ↓'}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>

          {/* 2026-09-23（老大）：截图组从「两列并排」改成单张占满整行。
              原先是 sm:grid-cols-2 并排两张（服务商设置页 + 全流程），「全流程」那条占位已撤，
              只剩一张 —— 排半幅既浪费宽度、又让服务商页的界面细节看不清。 */}
          {quickStart.media.map((item) => {
            const isOpen = openStep === item.step
            return (
              <div
                key={item.assetNo}
                id="quick-start-shot"
                aria-hidden={!isOpen}
                // 配图区 = 悬停区的下半截：鼠标从卡片走到这里，图得一直在
                onMouseEnter={cancelClose}
                onMouseLeave={closeSoon}
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                  isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="overflow-hidden">
                  <figure className="pt-5">
                    <AssetPlaceholder label={item.label} assetNo={item.assetNo} aspect="16 / 10" />
                    <figcaption className="mt-2 text-xs text-ink-900/45">{item.step}</figcaption>
                  </figure>
                </div>
              </div>
            )
          })}
        </div>
      </Reveal>
    </Section>
  )
}
