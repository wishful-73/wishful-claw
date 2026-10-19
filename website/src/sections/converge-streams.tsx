import { useEffect, useRef } from 'react'

// 整页背景层「万剑归宗」：一束束细拖尾螺旋收向主 CTA（立即下载）。
//
// 2026-10-19（老大第二次返工）：前两版是「色雾 + 平行漂移的线稿」，老大都否了 —— 平行漂移不朝任何点收。
// 他指定参考 astra-gate.si 的「都汇集到中心元素上」。读参考站源码后确认：它是常驻 rAF 的 canvas，
// 粒子在极坐标里向目标元素收（半径递减、越近加速、角度带微自旋 = 螺旋），再把最近 14 帧位置连成折线、
// 用线性渐变做尾迹。纯 CSS/SVG 做不出「螺旋 + 逐帧加速 + 尾迹」，所以改用 canvas：
// 本仓唯一一处 canvas，其余动画（.reveal / .dl-shine / 色雾）照旧 CSS，零依赖。
//
// 2026-10-19（老大第三次要求）：① 顶栏要透出动画；② 这是整页的全局背景。
// 2026-10-19 10:30（第五次要求，收回）：老大改主意 ——「这个光束可以就集中在首屏么，不是整个首页，
// 之前的暖色背景是整站的这个是对的」⇒ 本层搬回 hero 内 `absolute`（见 sections/hero.tsx），
// 只覆盖首屏那一块；**雾那一层不动**，继续整站（两次要求的范围不同，别一起回滚）。
// 顺带：「滚出视口要把收敛点夹回视口」的补丁也就不需要了 —— 按钮和 canvas 同在一个 hero 里，
// 相对位置不随滚动变（见 updateTarget / 监听器一处）。
//
// 参数基本照抄参考站，只换三样：配色换成我们自己的（10-19 后从「墨 + 琥珀」放开整合圈色相，见下方 PALETTE）、线宽略粗、粒子数按面积算（原来是首屏大小，
// 现在是首屏那一块）。下面几个数取自参考站实测值，改之前先想清楚是不是真需要动：
//   速度 v = 1.4 + 2 * random，逐帧再乘 (1 + 220 / (r + 40)) —— 近距离明显加速
//   自旋 spin = ±(0.002 ~ 0.007) rad/帧 —— 收束轨迹偏一点点螺旋，不呆板
//   尾迹 14 点，线宽 1.5
// 2026-10-19 10:22（老大：「颜色可以多一点」）：原来 3 条里 #EA580C / #F97316 几乎同色，
// 实际读起来就是「墨 + 一个橙」⇒ 先放开成一条暖色光谱；
// 10:24 老大再放开边界：「不需要跟着暖色光谱走，紫色 蓝色 绿色这些都可以要」⇒ 改为整圈色相，
// rose → amber → lime → emerald → teal → sky → blue → indigo → violet → fuchsia → pink。
// 统一取 600 档饱和度：纸面是白的，400/500 档太浅会糊成一片；墨色留一条当骨架，免得全彩没结构。
// alpha 不是随手给的：白底上彩度越低的色越吃 alpha，所以亮档（lime / sky）给得比深档高。
const PALETTE = [
  { rgb: '27 30 36', alpha: 0.50 },   // ink-950 墨：留一条当骨架
  { rgb: '225 29 72', alpha: 0.62 },  // rose-600 玫红
  { rgb: '234 88 12', alpha: 0.75 },  // accent 品牌主色：权重最高，别被彩海淹了
  { rgb: '217 119 6', alpha: 0.70 },  // amber-600
  { rgb: '101 163 13', alpha: 0.70 }, // lime-600
  { rgb: '5 150 105', alpha: 0.70 },  // emerald-600
  { rgb: '13 148 136', alpha: 0.70 }, // teal-600
  { rgb: '2 132 199', alpha: 0.70 },  // sky-600
  { rgb: '37 99 235', alpha: 0.72 },  // blue-600
  { rgb: '79 70 229', alpha: 0.72 },  // indigo-600
  { rgb: '124 58 237', alpha: 0.72 }, // violet-600
  { rgb: '192 38 211', alpha: 0.62 }, // fuchsia-600
  { rgb: '219 39 119', alpha: 0.62 }, // pink-600
]
const TRAIL = 14
const LINE_WIDTH = 1.5
// 收敛终点半径：到 48px 以内算「入鞘」，粒子消失（首屏处按钮本身更宽，视觉上就是被按钮吃掉）
const END_RADIUS = 48
// 每束笔触摊到的面积（px²）：密度 = 画布面积 ÷ 此值，再夹到 [36, 220]，所以画布多大都是同样的疏密。
// 数值沿革（都是老大当场看效果定的）：6500（首屏初版）→ 10:12「首页去下载的光点过于密集了，
// 减少一半」⇒ 13000 → 10:17「再减少3分之一」⇒ 19500 → 10:19「减少到下限试试」⇒ 26000。
// 现在画布是首屏那一块（957×956 视口下约 526k px² ⇒ 20 束，被 36 的下限兜住），即**恒定 36 束**。
// ⚠️ 两条要知道的：① 10:30 画布由整屏缩回首屏后，同样的 36 束摊在更小的面积上 ⇒ 单位密度比老大
// 认可那一刻（整屏 36 束）更高，嫌密就把此值再往上加；② 它仍是「按面积」的：大屏的 hero 更大，
// 会涨上去（2560 宽的 hero ≈ 138 束、4K 撞 220 上限）。要各处恒定 36 束，就直接去掉这个乘法。
// 粒子数 = 视口面积 / 这个值 ⇒ 视口多大都是同样的疏密。
const AREA_PER_STREAK = 26000

type Streak = {
  angle: number
  radius: number
  speed: number
  spin: number
  color: number
  trail: [number, number][]
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export function ConvergeStreams() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    // 系统开了「减少动态效果」：一帧都不画。首屏退化为静态纸面 + 色雾，不是一片空白。
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let width = 0
    let height = 0
    let centerX = 0
    let centerY = 0
    let fieldRadius = 0
    let count = 0
    let streaks: Streak[] = []
    let raf = 0
    let running = false
    let targetDirty = true

    const spawn = (initial: boolean): Streak => ({
      angle: Math.random() * Math.PI * 2,
      radius: initial ? 80 + Math.random() * fieldRadius : fieldRadius + 10,
      speed: 1.4 + 2 * Math.random(),
      spin: (0.002 + 0.005 * Math.random()) * (Math.random() > 0.5 ? 1 : -1),
      color: Math.floor(PALETTE.length * Math.random()),
      trail: [],
    })

    // 首帧的拖尾不能是空的 —— 空拖尾的粒子在画面上是「无」（只有 2 个点才画得出来），
    // 而这一帧很可能是读者唯一看到的一帧（页面被判不可见时 rAF 一次都不回调）。
    // 所以按当前速度把拖尾沿轨迹往回补齐，开局就是「剑已在飞」的样子，而不是从零星几点慢慢长出来。
    const seedTrail = (streak: Streak) => {
      const step = streak.speed * (1 + 220 / (streak.radius + 40))
      for (let i = TRAIL - 1; i >= 0; i--) {
        const r = streak.radius + step * i
        const angle = streak.angle - streak.spin * i
        streak.trail.push([centerX + Math.cos(angle) * r, centerY + Math.sin(angle) * r * 0.72])
      }
    }

    // 收敛点：主 CTA 的几何中心（canvas 内坐标）。夹在 canvas 内（留 6% / 10% 余量）——
    // 万一按钮在 hero 里被挤到边上，不夹的话视野里所有笔触会朝同一个方向平飞，看着就不像「收」了。
    const updateTarget = () => {
      const cta = document.querySelector('[data-converge-target]')?.getBoundingClientRect()
      const box = canvas.getBoundingClientRect()
      centerX = clamp(cta ? cta.left + cta.width / 2 - box.left : width / 2, width * 0.1, width * 0.9)
      centerY = clamp(cta ? cta.top + cta.height / 2 - box.top : height * 0.5, height * 0.06, height * 0.94)
      targetDirty = false
    }

    // 场 = 视口（canvas 是 fixed inset-0，量它自己等于量视口）。
    // 纵向按 0.72 压缩 = 把矩形场拉成一个扁椭圆，粒子起步时不会在竖直方向甩太远。
    const measureField = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const box = canvas.getBoundingClientRect()
      width = box.width
      height = box.height
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      updateTarget()

      const corners: [number, number][] = [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height],
      ]
      fieldRadius = Math.max(...corners.map(([x, y]) => Math.hypot(x - centerX, (y - centerY) / 0.72)))

      count = clamp(Math.round((width * height) / AREA_PER_STREAK), 36, 220)
      streaks = Array.from({ length: count }, () => {
        const streak = spawn(true)
        seedTrail(streak)
        return streak
      })
    }

    // 一帧的绘制单独拎出来：既能被 rAF 循环调用，也能在不可见环境里被同步调一次
    const render = () => {
      // 滚动只更新收敛点，不重建整场（重建会把动画打回起点）
      if (targetDirty) updateTarget()

      ctx.clearRect(0, 0, width, height)
      ctx.lineWidth = LINE_WIDTH
      ctx.lineCap = 'round'

      // 补员：已入鞘的粒子腾出的位置慢慢补回来，画面密度保持稳定
      if (streaks.length < count && Math.random() < 0.6) streaks.push(spawn(false))

      for (const streak of streaks) {
        streak.radius -= streak.speed * (1 + 220 / (streak.radius + 40))
        streak.angle += streak.spin
        streak.trail.push([
          centerX + Math.cos(streak.angle) * streak.radius,
          centerY + Math.sin(streak.angle) * streak.radius * 0.72,
        ])
        if (streak.trail.length > TRAIL) streak.trail.shift()
        if (streak.trail.length < 2) continue

        const stroke = PALETTE[streak.color]
        // 远端淡入（不然会在外圈凭空出现）+ 临近目标淡出（不然会硬生生截断在按钮边上）
        const alpha =
          stroke.alpha *
          Math.min(1, (fieldRadius - streak.radius) / 140) *
          Math.min(1, Math.max(0, (streak.radius - END_RADIUS) / 90))
        if (alpha <= 0.01) continue

        const head = streak.trail[0]
        const tail = streak.trail[streak.trail.length - 1]
        const gradient = ctx.createLinearGradient(head[0], head[1], tail[0], tail[1])
        gradient.addColorStop(0, `rgb(${stroke.rgb} / 0)`)
        gradient.addColorStop(1, `rgb(${stroke.rgb} / ${alpha})`)
        ctx.strokeStyle = gradient
        ctx.beginPath()
        ctx.moveTo(head[0], head[1])
        for (let i = 1; i < streak.trail.length; i++) ctx.lineTo(streak.trail[i][0], streak.trail[i][1])
        ctx.stroke()
      }

      streaks = streaks.filter((streak) => streak.radius > END_RADIUS)
    }

    const loop = () => {
      render()
      raf = requestAnimationFrame(loop)
    }

    const start = () => {
      if (running) return
      running = true
      raf = requestAnimationFrame(loop)
    }

    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    // 浏览器把不可见页面挂起时别空转（内置浏览器面板里 rAF 实测 2.5s 零回调，留着只是耗电）
    const onVisibilityChange = () => (document.hidden ? stop() : start())

    const observer = new ResizeObserver(() => {
      measureField()
      render()
    })
    measureField()
    // 同步画一帧：面板 / 截图 / 打印这类拿不到 rAF 的场景，至少能看到「剑已出鞘」的那一帧
    render()
    start()
    observer.observe(canvas)
    document.addEventListener('visibilitychange', onVisibilityChange)
    // 首屏层不跟滚动走（按钮和 canvas 同在一个 hero 里，相对位置不变）⇒ 不需要 scroll 监听，
    // 那点「每滚一帧就量一次按钮」的开销也省掉。但**字体换掉**会让按钮在 hero 内挪位、而 canvas
    // 尺寸没变（ResizeObserver 不触发），所以补一次「字体就绪」后的重算。
    document.fonts.ready.then(() => {
      targetDirty = true
    })

    return () => {
      stop()
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className="hero-converge" />
}
