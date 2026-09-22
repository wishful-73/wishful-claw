import { SiteHeader } from './components/site-header'
import { Hero } from './sections/hero'
import { Advantages } from './sections/advantages'
import { ValueLadder } from './sections/value-ladder'
import { Features } from './sections/features'
import { DownloadCta } from './sections/download-cta'
import { QuickStart } from './sections/quick-start'
import { Faq } from './sections/faq'
import { SiteFooter } from './sections/site-footer'

// 区块顺序（2026-09-21 六次改，S-127 方案 A）：Hero → 三层阶梯（窄带）→ 优势区（门槛低 / 好看）→ 功能展示 → 下载 → 快速上手 → FAQ → 页脚
// 上一版把「不花钱，也能用起来」整块压到 Hero 之上，实测首屏被它占满 618px、产品主标题被挤到 770px、截图整个出屏 ⇒ 回退。
// 现在「不花钱」由 Hero 副标题显式承担，三层阶梯压成窄带紧随其后；Hero 的 `pt` 恢复「页面第一块」的呼吸位。
// 痛点对照与成本对比两版已删（老大：「没事引战干啥」）—— 拿大厂当靶子的对比不留在首页。
// 更新日志不在单页里（老大裁定）：已有独立页 /changelog，入口走顶栏，单页不再重复一份列表。
export default function App() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <ValueLadder />
        <Advantages />
        <Features />
        <DownloadCta />
        <QuickStart />
        <Faq />
      </main>
      <SiteFooter />
    </>
  )
}
