import { SiteHeader } from './components/site-header'
import { Hero } from './sections/hero'
import { PainTable } from './sections/pain-table'
import { Advantages } from './sections/advantages'
import { ValueLadder } from './sections/value-ladder'
import { CostCompare } from './sections/cost-compare'
import { Features } from './sections/features'
import { DownloadCta } from './sections/download-cta'
import { QuickStart } from './sections/quick-start'
import { Changelog } from './sections/changelog'
import { Faq } from './sections/faq'
import { SiteFooter } from './sections/site-footer'

// 区块顺序 = 官网方案第二节裁定：Hero → 痛点对照 → 四大优势 → 三层阶梯 → 成本对比 → 功能展示 → 下载 → 快速上手 → 更新日志 → FAQ → 页脚
export default function App() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <PainTable />
        <Advantages />
        <ValueLadder />
        <CostCompare />
        <Features />
        <DownloadCta />
        <QuickStart />
        <Changelog />
        <Faq />
      </main>
      <SiteFooter />
    </>
  )
}
