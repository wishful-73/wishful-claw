// 官网全站文案 —— 权威源：知识库《官网方案》第三节「文案纲要」+ 第一节口径裁定
// 改文案只改这里，不散落进 JSX。命名口径：中文「心相龙虾」/ 英文「WishfulClaw」（与「心相平台」不是一个东西）

export const GITHUB_REPO_URL = 'https://github.com/wishful-73/wishful-claw'

export interface LatestInfo {
  version: string
  systemRequirements: string
  officialRelease: boolean
  downloads: { direct: string; github: string }
  releasesUrl: string
}

export const hero = {
  title: '你的 AI 助手，key 自己带',
  subtitle:
    '大厂的免费额度是鱼饵。心相龙虾（WishfulClaw）让你接上任意服务商——包括你手里那些便宜渠道——重度使用也不肉疼。',
  primaryCta: '免费下载（Windows）',
  primaryCtaHref: './download.html',
  secondaryCta: '不花钱怎么用 →',
  secondaryAnchor: '#value-ladder',
  image: { label: '主界面截图（聊天 + 侧栏）', assetNo: 1, aspect: '16 / 10' }
}

// href 带首页文件名：导航在 download.html 上点击也能跳回单页对应锚点，而非死链到本页
export const nav = [
  { label: '它能干什么', href: './index.html#features' },
  { label: '不花钱怎么用', href: './index.html#value-ladder' },
  { label: '快速上手', href: './index.html#quick-start' },
  { label: 'FAQ', href: './index.html#faq' },
  { label: '下载', href: './index.html#download' }
]

export const painTable = {
  title: '同一个需求，两种命运',
  leftHead: '大厂 AI 工具',
  rightHead: '心相龙虾',
  rows: [
    ['免费额度吸引你进来', '付费墙在后面等着'],
    ['重度用两下额度就没了', '自带 key，用多少花多少'],
    ['服务商白名单，只认大厂', '任意渠道都能接'],
    ['定价高，重度使用成本爆炸', '成本自己说了算'],
    ['功能都差不多', '自由和价格才是稀缺的']
  ]
}

// 四大竞争优势：按「门槛低 / 自由 / 好看」三类呈现，门槛低打头（2026-09-20 定稿，取代原三条卖点腿）
export const advantages = {
  title: '为什么是它',
  groups: [
    {
      category: '门槛低',
      lead: true,
      items: [
        {
          name: '易用',
          quote: '不是聊天玩具，是真能干活的 Agent。',
          body: '读写文件、执行命令、控制浏览器、操作桌面软件——在你自己的电脑上真执行。但门槛不高：装好、填个 key，就能开始派活。不像 Codex 这类工具要装环境、改配置文件。'
        },
        {
          name: '方便',
          quote: '订阅购买，点一下就到了。',
          body: 'AI 服务商页面内置大部分服务商官网地址，要充值、要订阅，直接点过去。其它工具还得自己搜「这家怎么买」。'
        }
      ]
    },
    {
      category: '自由',
      items: [
        {
          name: '服务商完全自由',
          quote: '你的渠道，凭什么要别人批准？',
          body: '大厂工具只认白名单里的服务商。你手里那些便宜渠道、免费额度、小众供应商——它不收录，也不让你加。心相龙虾不设白名单。填地址、填 key，保存就能用。'
        }
      ]
    },
    {
      category: '好看',
      items: [
        {
          name: '界面样式好看',
          quote: '不用解释，看一眼就知道。',
          body: '深色界面、清晰的信息层级、顺手的双栏布局。',
          image: { label: '界面大图（样式展示）', assetNo: 9, aspect: '16 / 10' }
        }
      ]
    }
  ]
}

// 三层价值阶梯：「不花钱也能用」的证明（2026-09-20 新增）
export const valueLadder = {
  title: '不花钱，也能用起来',
  note: '先让人敢用，再谈省钱。',
  tiers: [
    {
      name: '零成本层',
      cost: '完全不花钱',
      items: ['快捷启动入口', '剪贴板增强', '免费对话（内置浏览器，含 DeepSeek / Kimi / 元宝 / 豆包等网页版）']
    },
    {
      name: '免费层',
      cost: '免费额度内不花钱',
      items: ['免费体验 Agent 干活', 'Agnes、商汤日日新等提供免费模型调用']
    },
    {
      name: '重度层',
      cost: '花钱买 token',
      items: ['自带 key、自选渠道，用多少花多少', '内置用量统计，账单看得见']
    }
  ]
}

// 成本对比：已降为第 3 层内容，依赖真实数据（素材清单 #4），阶段 1 明示占位、不放任何编造数字
export const costCompare = {
  title: '同一个任务，账单差一个数量级',
  lead: '用大厂 AI 助手干点真活，月底一看用量，心在滴血。同一批任务，换心相龙虾接低价渠道跑，用量统计页的数字是这样的：',
  placeholder: '真实成本对比数据制作中（需要现跑一遍大厂 vs 低价渠道），此处暂不展示数字。',
  footnote: '数据来自真实使用记录，非估算。',
  image: { label: '真实成本对比图（大厂 vs 低价渠道）', assetNo: 4, aspect: '16 / 9' }
}

export const features = {
  title: '它能干什么',
  items: [
    { name: '真干活', desc: '在你电脑上读写文件、跑命令、改代码，不是只会在对话框里聊天' },
    { name: '全局助理派活', desc: '一个总助理管多个项目会话，派活、盯进度、汇总回报', image: { label: '全局派活录屏（GIF）', assetNo: 5 } },
    { name: '微信遥控', desc: '出门在外发条微信，家里电脑照干，结果推回微信', image: { label: '微信遥控截图（手机 + 电脑对照）', assetNo: 6 } },
    { name: '定时任务', desc: '按间隔或固定时间自动跑，无人值守', image: { label: '定时任务配置页截图', assetNo: 10 } },
    { name: '用量统计', desc: '曲线图 / 柱状图 / 请求明细，花了多少一目了然', image: { label: '用量统计页截图', assetNo: 3 } },
    { name: '桌面控制', desc: '能操作心相龙虾之外的任意桌面程序', image: { label: '桌面控制演示 GIF', assetNo: 8 } }
  ]
}

export const quickStart = {
  title: '三步开始',
  steps: [
    { name: '下载安装', desc: '解压即用，无需配置环境' },
    { name: '接入服务商', desc: '设置里填 API 地址和 key，可接任意服务商', image: { label: '服务商设置页截图（含添加自定义服务商）', assetNo: 2 } },
    { name: '开始派活', desc: '直接说你要干什么，它在你的电脑上执行', image: { label: '三步上手 GIF（安装 → 填 key → 派活）', assetNo: 7 } }
  ]
}

export const faq = {
  title: '常见问题',
  items: [
    { q: '要花钱吗？', a: '软件免费。模型调用费用取决于你自己接的服务商——可以接免费额度，也可以接低价渠道。' },
    { q: '支持哪些服务商？', a: '不设白名单，任何提供 OpenAI 兼容接口的服务商都能接。' },
    { q: '我的数据安全吗？', a: '所有执行都在你自己的电脑上，文件不上传。对话内容只发往你自己配置的服务商。' },
    { q: '和 Cursor / Claude Code 有什么区别？', a: '它们是给程序员的编程工具。心相龙虾面向普通用户，且服务商完全自由。' },
    { q: '是套壳吗？', a: '不是。Electron + .NET 自研，不是别人的壳。' },
    { q: '支持 Mac / Linux 吗？', a: '当前仅 Windows。' },
    { q: '稳定吗？', a: '当前为非正式版（0.2.x），日常使用没问题，正式版 1.0.0 仍在打磨。' }
  ]
}

export const footer = {
  disclaimer: '当前为 0.2.x 非正式版，正式版 1.0.0 仍在打磨中。',
  github: `${GITHUB_REPO_URL}/releases`,
  feedback: `${GITHUB_REPO_URL}/issues`
}
