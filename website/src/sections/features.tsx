import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, CSSProperties } from 'react'
import { features } from '../content/site'
import { assetSources, Reveal, Section } from '../components/ui'

// 「它能干什么」—— banner 形态（S-227，2026-10-26）
//
// §沿革：2026-09-23 定的是「左侧 176px tab 列表 + 右侧单条面板」，四条约束互相拉扯 ——
//   ① 画面占满整行（2520×1608 的宽幅截图排三列只剩三百来像素，细节全糊）
//   ② 九条竖排会把区块撑到六千像素 ⇒ 用选项卡 ③ 自动轮播 ④ hover 即切、点击保留。
// 2026-10-26 10:14 老大改口要 banner 形态（17:08 拍板「电商首页那种单张全宽大图 + 标题浮层」）
//   ⇒ 左侧 tab 列表整个拆掉，`role=tablist/tab/tabpanel` 一并消失；hover 切换随 tab 删除自然消失。
//   现在只有三种输入：自动轮播、左右箭头、指示点。
//
// §为什么图按需挂载：8 张 2520×1608 的 PNG 全塞进 DOM，首屏要白吃好几 MB。
//   `seen` 记录「用户真正看过的」，切到哪张才建那张的 <img>，其余连节点都不生成；
//   加载过的留在集合里 —— 回头再看直接命中浏览器缓存。首张 `loading="eager"`，其余 `lazy`。
//
// §窄屏为什么把文字挪到图下：2520×1608 缩到 375 宽只剩 240 来像素高，浮层压上去会糊成一坨
//   （形态定稿第五条）。宽屏浮层绝对定位压图底部（不额外占高），窄屏是图下方一张独立文字卡。
//
// §图片一律 object-cover：素材尺寸不统一（2520×1608 全屏 / 1688×1050 浮窗 / 1226×1263 竖版微信），
//   舞台钉死 2520/1608 才不会切换时跳高。竖版那张（微信遥控）会被裁掉上下 —— 不为一张图引特殊分支，
//   真机上看着别扭再单独调。
//
// §高度为什么要钳（2026-10-27 老大：「banner 的高度超出了一屏」→「可以用 vw vh 去给高宽，还有需要居中」）：
//   `Section` 是通栏的（ui.tsx 去掉了 max-w-5xl 收束），所以只按比例算时舞台高度 = 视口宽 ÷ 1.567：
//   1920 屏 1808÷1.567 ≈ 1154px，加顶栏 57 + 区块标题约 112 + 指示点 22 直接破屏，2560 屏更到 1562px。
//   **比例本身没错，错在分母是宽度而不是高度。**
//   现在反过来定：先框死可用高度（100vh 减掉顶栏 / 标题 / 指示点 / 余量 = 18rem），
//   再按 2520/1608 反推宽度上限，`mx-auto` 居中。
//   ⇒ 图**完整显示、不裁上下**，超宽屏两侧留白；窄屏仍然吃满 100% 宽，不套这个上限。
//   ⚠️ Tailwind 任意值里的 calc 必须用下划线代替空格，写成 `calc(100vh-18rem)` 是无效 CSS。
//   ⚠️ 注释里别写完整类名 —— Tailwind 连注释一起扫，扫到就在产物里多生成一条规则。
const SLIDE_RATIO = '2520 / 1608' // 与真机截图同比例：切换时舞台高度不跳
const SLIDE_RATIO_NUM = 1.567 // 上面这个比例的数值形态，给宽度上限的 calc 用（CSS calc 别写 2520/1608，老浏览器不认）
const AUTOPLAY_MS = 3500 // 2026-09-23 老大「切换有点慢」：5s → 3.5s，沿用

// 舞台的宽高策略：宽度上限由可用高度反推（见文件头 §高度为什么要钳）。
// 比例走 CSS 变量传给 className 里的 calc —— 只留一个来源，改 SLIDE_RATIO 时那行不用跟着改。
const stageStyle = {
  aspectRatio: SLIDE_RATIO,
  '--slide-ratio': SLIDE_RATIO_NUM
} as CSSProperties

export function Features() {
  const items = features.items
  const total = items.length
  const [active, setActive] = useState(0)
  // 自动轮播的三个刹车：鼠标停在区块里、键盘焦点在区块里、区块不在视口内。
  // 前两个是「用户正在看，别抢屏」，第三个是「看不到的地方翻页没意义」。
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [inView, setInView] = useState(false)
  // 手动翻过之后重新计这一轮，否则刚点到第 5 张，3.5s 一到就被轮播抢走
  const [cycle, setCycle] = useState(0)
  // 已经挂过 DOM 的图（按需加载，见文件头 §为什么图按需挂载）
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]))
  const wrapRef = useRef<HTMLDivElement>(null)
  const item = items[active]

  // 区块滚出视口就停轮播
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    setSeen((prev) => (prev.has(active) ? prev : new Set(prev).add(active)))
  }, [active])

  useEffect(() => {
    if (hovered || focused || !inView) return
    // 系统开了「减少动态效果」就不自动翻页，交给用户自己点
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setActive((prev) => (prev + 1) % total), AUTOPLAY_MS)
    return () => window.clearInterval(timer)
  }, [hovered, focused, inView, cycle, total])

  // 预取下一张：inView 后延迟 1.5s 再加载，避开首屏关键路径，又赶在 3.5s 自动翻页之前。
  // 没有这一步，切到没看过的图会先空一帧（`seen` 门控住 <img>，图到位前舞台只剩底色）。
  useEffect(() => {
    if (!inView) return
    const next = (active + 1) % total
    const timer = window.setTimeout(() => {
      setSeen((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [inView, active, total])

  // 负数和越界都归一到 0..total-1：箭头和指示点都走这一条
  const pick = (i: number): void => {
    setActive(((i % total) + total) % total)
    setCycle((c) => c + 1)
  }

  // 左/右方向键翻页。原来那套 roving tabindex 是 tablist 的键盘约定，tab 拆掉后
  // 容器自己接管 —— 它带 tabIndex=0，本来就是 Tab 序列里的一站。
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    pick(active + (e.key === 'ArrowRight' ? 1 : -1))
  }

  return (
    <Section id="features" eyebrow="What it does" title={features.title} paddingTopClass="pt-5">
      <Reveal>
        <div
          ref={wrapRef}
          role="group"
          aria-roledescription="carousel"
          aria-label={features.title}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          // 焦点刹车只认**键盘来源**。React 的 onFocus 走 focusin，会从子按钮冒泡上来 ——
          // 鼠标点一下箭头或指示点，按钮就获焦；若无条件刹车，focused 会一直停在 true
          // （鼠标移开也不复位，焦点还在那个按钮上），3.5s 自动轮播从此再也不启动。
          // `:focus-visible` 正好区分两者：鼠标点击按钮为 false，Tab 进来为 true。
          onFocus={(e) => {
            if ((e.target as HTMLElement).matches(':focus-visible')) setFocused(true)
          }}
          onBlur={() => setFocused(false)}
          className="group/carousel rounded-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2"
        >
          {/* 图区：八张叠放，靠 opacity 交叉淡入淡出。
              `mx-auto` + sm 断点的宽度上限是「不超一屏」的唯一实现点，别删 —— 见文件头 §高度为什么要钳 */}
          <div
            className="relative mx-auto w-full overflow-hidden rounded-[13px] border border-ink-700 bg-paper-soft sm:w-[min(100%,calc((100vh_-_18rem)*var(--slide-ratio)))]"
            style={stageStyle}
          >
            {items.map((it, i) => {
              const src = assetSources[it.image.assetNo]
              return (
                <div
                  key={it.name}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`第 ${i + 1} / ${total}：${it.name}`}
                  aria-hidden={i !== active}
                  className={`absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none ${
                    i === active ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  {seen.has(i) &&
                    (src ? (
                      <img
                        src={src}
                        alt={it.image.label}
                        loading={i === 0 ? 'eager' : 'lazy'}
                        className="h-full w-full object-cover object-center"
                      />
                    ) : (
                      // 素材位回退：**当前 8 条的 assetNo 全部已在 ui.tsx 的 assetSources 登记，这个分支
                      // 现在走不到**。保留是因为 site.ts 加条目时素材未必同时到位 —— 那时没有它这里就是
                      // 一张空白舞台，比占位框难查。别当死代码删掉。
                      <div className="flex h-full w-full items-center justify-center bg-paper-soft text-center text-sm text-ink-900/55">
                        <span>
                          素材 #{it.image.assetNo} · {it.image.label}
                          <span className="mt-1 block text-xs text-ink-900/40">（占位，真机素材就绪后替换）</span>
                        </span>
                      </div>
                    ))}
                </div>
              )
            })}

            {/* 宽屏文字浮层：压在图的底部，不额外占高。
                `key` 让每次换条重放一次 reveal 淡入 —— 硬切太生硬；窄屏那套文字卡同理。 */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden bg-linear-to-t from-ink-950/88 via-ink-950/50 to-transparent px-7 pt-16 pb-6 sm:block">
              <div key={active} className="reveal">
                <p className="text-lg font-semibold text-white">{item.name}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-white/80">{item.desc}</p>
              </div>
            </div>

            {/* 左右箭头：宽屏 hover 或键盘聚焦才浮现，窄屏常显（触屏没有 hover） */}
            <button
              type="button"
              aria-label="上一项"
              onClick={() => pick(active - 1)}
              className="absolute top-1/2 left-3 z-10 -translate-y-1/2 rounded-full bg-ink-950/55 px-2.5 py-2 text-white opacity-0 transition-opacity duration-200 hover:bg-ink-950/75 focus-visible:opacity-100 group-hover/carousel:opacity-100 motion-reduce:transition-none max-sm:opacity-100"
            >
              <Chevron dir="left" />
            </button>
            <button
              type="button"
              aria-label="下一项"
              onClick={() => pick(active + 1)}
              className="absolute top-1/2 right-3 z-10 -translate-y-1/2 rounded-full bg-ink-950/55 px-2.5 py-2 text-white opacity-0 transition-opacity duration-200 hover:bg-ink-950/75 focus-visible:opacity-100 group-hover/carousel:opacity-100 motion-reduce:transition-none max-sm:opacity-100"
            >
              <Chevron dir="right" />
            </button>
          </div>

          {/* 窄屏文字卡：图下方正常流，不压图（见文件头 §窄屏为什么把文字挪到图下） */}
          <div className="mt-3 rounded-[13px] border border-ink-700 bg-paper px-4 py-3.5 sm:hidden">
            <div key={active} className="reveal">
              <p className="text-[15px] font-semibold text-ink-950">{item.name}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-900/65">{item.desc}</p>
            </div>
          </div>

          {/* 指示点：常驻，不看 hover。当前项拉长成短横条 —— 与全站「选中就变粗」同一套语法 */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {items.map((it, i) => (
              <button
                key={it.name}
                type="button"
                aria-label={`第 ${i + 1} 项：${it.name}`}
                aria-current={i === active ? 'true' : undefined}
                onClick={() => pick(i)}
                className={`h-1.5 rounded-full transition-all duration-200 motion-reduce:transition-none ${
                  i === active ? 'w-7 bg-accent' : 'w-1.5 bg-ink-900/55 hover:bg-ink-900/75'
                }`}
              />
            ))}
          </div>
        </div>
      </Reveal>
    </Section>
  )
}

// 箭头图标：内联 SVG，不引图标库（整站零依赖，同 AssetPlaceholder 的取舍）
function Chevron(props: { dir: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path d={props.dir === 'left' ? 'M15 5 8 12l7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  )
}
