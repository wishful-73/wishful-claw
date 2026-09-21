// 官网全站文案 —— 内容口径权威源：知识库《官网方案》第三节「文案纲要」
// 改文案只改这里，不散落进 JSX。
// 命名口径（2026-09-21 老大改定，取代 2026-09-20 定的旧中文名）：名 = 心相，「智能助手」是品类介绍词，
// 备案全称「心相智能助手」。唯一出口是下面的 BRAND —— index.html / download.html 的 title 与 description
// 是静态投影面（HTML 引不了 TS），改 BRAND 时那 4 行要一起改。

export const BRAND = {
  name: '心相',
  category: '智能助手',
  fullName: '心相智能助手',
  latin: 'WishfulClaw',
  vision: '心之所向，心想事成'
} as const

export const GITHUB_REPO_URL = 'https://github.com/wishful-73/wishful-claw'

// 只放页面真正读的字段；阶段 4 由 latest.yml 派生时再按需加（别为假想需求预留字段）
export interface LatestInfo {
  version: string
  downloads: { windows: string; github: string; macos: string; linux: string }
}

// 下载平台：urlKey 对应 latest.json 的 downloads 字段，留空即置灰、填了 URL 自动变真按钮。
// key 一律按平台命名（windows / macos / linux）。原 Windows 用 'direct'（「官网直链」）——
// 那是把「包放哪」的实现细节写进了数据键名；包今天在 GitHub、明天在官网，键名不该跟着搬家。
// 2026-09-21：Windows 先填 GitHub Release 的安装包直链 —— 有包就不该给灰按钮（参考 Reasonix 官网，
// 它的下载区里没有「通道建设中」这种东西）。官网上线后把 latest.json 里这个值换成官网地址，前端零改动。
// Mac / Linux 能出包（老大 2026-09-21：目前用不到所以没做）⇒ 是「待发布」占位，不是「不支持」，不给时间承诺。
// 不写系统要求备注：产物是 AOT self-contained，不挑运行环境（老大 2026-09-21）。
export const platforms = [
  { id: 'windows', label: 'Windows', urlKey: 'windows', pendingTag: '暂不可用' },
  { id: 'macos', label: 'macOS', urlKey: 'macos', pendingTag: '待发布' },
  { id: 'linux', label: 'Linux', urlKey: 'linux', pendingTag: '待发布' }
] as const

export const hero = {
  // 首屏只讲用户得到什么。原「你的 AI 助手，key 自己带」两宗罪：① 第一句就跟大厂吵架（碰瓷感）；
  // ② 「key」是行话，目标人群正是被高配置门槛挡住的人 —— 与自家红线「不写成程序员工具」冲突。
  // 自带 Key 这个差异点退到副标题，并写成「模型 Key」让人看得懂。老大 2026-09-21 拍板。
  // 2026-09-21（S-127 方案 A）：Hero 回归首屏第一块，「不花钱」这个卖点由副标题显式承担。
  // 原做法是把整块价值阶梯搬到 Hero 之上来「先说不用花钱」，实测代价是产品主标题被挤到 770px、CTA 挤到 945px、
  // 截图整个出屏 —— 卖点优先做成了区块搬家，本末倒置。现在改为卖点进首屏文案，区块回到它该在的位置。
  title: { lead: '你说一句，', highlight: '它去把活干完' },
  subtitle: `跑在你自己电脑上的${BRAND.category}：读写文件、执行命令、操作浏览器和桌面软件。不花钱就能开始——装完打开先问起来；要它真动手，填一个模型 Key，用哪家、花多少你说了算。`,
  primaryCta: '立即下载',
  primaryCtaHref: './download',
  // 原为「三种用法 →」跳 #value-ladder；2026-09-21 三层阶梯被挪到 Hero 之上后，往下滚的按钮不能回头指向上方，
  // 曾改指功能展示。S-127 方案 A 把阶梯放回 Hero 之下 ⇒ 本按钮跟着改回指它，文案取区块标题的动词化，不另造词。
  secondaryCta: '不花钱怎么用 →',
  secondaryAnchor: '#value-ladder',
  image: { label: '主界面截图（聊天 + 侧栏）', assetNo: 1, aspect: '16 / 10' }
}

// 顶栏（老大 2026-09-21 定）：首页 / 使用指引 / 更新日志 / FAQ + 下载按钮。
// 页内锚点（为什么是它 / 不花钱也能用起来 / 它能干什么 / 快速上手）不在顶栏 —— 中文在顶栏 flex 里挤不下更多项，会逐字折行。
// href 带首页文件名：在其他页上点击也能跳回单页对应锚点，而非死链到本页
export const nav = [
  { label: '首页', href: './' },
  { label: '使用指引', href: './guide' },
  { label: '更新日志', href: './changelog' },
  { label: 'FAQ', href: './#faq' }
]

// 竞争优势：按「门槛低 / 好看」两类呈现，门槛低打头（2026-09-20 定稿三类；2026-09-21 S-124 删掉「自由」整类）
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
          body: '读写文件、执行命令、控制浏览器、操作桌面软件——在你自己的电脑上真执行。但门槛不高：装好、填个模型 Key，就能开始派活。不像 Codex 这类工具要装环境、改配置文件。'
        },
        {
          name: '方便',
          quote: '订阅购买，点一下就到了。',
          body: 'AI 服务商页面内置大部分服务商官网地址，要充值、要订阅，直接点过去。其它工具还得自己搜「这家怎么买」。'
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
// 2026-09-21（S-127 方案 A）：从「整块独立区块」压成 Hero 之后的一条窄带 —— 每层一行层名 + 一行说明，
// 弃用 items 列表（列表把区块撑到 618px，正是它把产品主标题挤出首屏的原因）。
// 2026-09-21（S-128）：重度层原「自带 key、自选渠道，用多少花多少」两处歧义都指向相反意思
// —— 「自带」被读成软件白送、「用多少花多少」被读成软件按量收费，把「不花钱」直接翻成「要花钱」。
// 改成下面这版：主体明确是用户自己，费用明确由上游按量结算，并明说「软件不收费」。
export const valueLadder = {
  title: '不花钱，也能用起来',
  // 原「先让人敢用，再谈省钱。」是写给团队的策略话，不是给访客的话（S-127 附带项）。
  note: '先不花钱用起来，要它多干活时再接一家服务商。',
  tiers: [
    {
      name: '零成本层',
      cost: '完全不花钱',
      detail: '快捷启动、剪贴板增强、免费对话（内置浏览器，含 DeepSeek / Kimi / 元宝 / 豆包等网页版）'
    },
    {
      name: '免费层',
      cost: '免费额度内不花钱',
      detail: '免费体验 Agent 干活；Agnes、商汤日日新等提供免费模型调用'
    },
    {
      name: '重度层',
      cost: '软件不收费，费用按实际用量结算',
      detail: '模型 Key 自己填、服务商自己选，费用由你接的那家按量算；内置用量统计，账单看得见'
    }
  ]
}

export const features = {
  title: '它能干什么',
  items: [
    { name: '真干活', desc: '在你电脑上读写文件、跑命令、改代码，不是只会在对话框里聊天' },
    { name: '全局助理派活', desc: '一个总助理管多个项目会话，派活、盯进度、汇总回报', image: { label: '全局派活录屏（GIF）', assetNo: 5 } },
    { name: '微信遥控', desc: '出门在外发条微信，家里电脑照干，结果推回微信', image: { label: '微信遥控截图（手机 + 电脑对照）', assetNo: 6 } },
    { name: '定时任务', desc: '按间隔或固定时间自动跑，无人值守', image: { label: '定时任务配置页截图', assetNo: 10 } },
    { name: '用量统计', desc: '曲线图 / 柱状图 / 请求明细，花了多少一目了然', image: { label: '用量统计页截图', assetNo: 3 } },
    { name: '桌面控制', desc: `能操作${BRAND.name}之外的任意桌面程序`, image: { label: '桌面控制演示 GIF', assetNo: 8 } }
  ]
}

// 上手流程（2026-09-21 老大改定口径）：原「三步」把最省事的入口漏了，直接把人往「配 key」上引。
// 站点清单是内置的（DEFAULT_FREE_CHAT_SITES），登录在软件内置浏览器里完成，故不写「去它官网」。
// 素材位不放进步骤卡：四步文字长短差很多，配图进卡会把短的那张撑出大片空白，故单独成行并标注属于第几步。
export const quickStart = {
  title: '四步开始',
  steps: [
    {
      name: '下载安装',
      desc: '装完就能打开。首次进入会让你填个称呼、挑外观、选一个常用的对话角色，一屏引导走完就进主界面——不装环境、不改配置文件。'
    },
    {
      name: '轻度使用',
      desc: '点开「免费对话」，挑一个喜欢的——DeepSeek、Kimi、智谱清言、腾讯元宝、豆包，全是官方服务内嵌，登录就能聊。'
    },
    {
      name: '接入服务商',
      desc: '想让它替你干活，才需要这一步：注册一家服务商，把 API key 填进来。服务商页内置各家官网地址，点过去注册再填回来；想先零成本试，选限时免费的那几家。'
    },
    { name: '开始派活', desc: '直接说你要干什么，它在你的电脑上执行。' }
  ],
  media: [
    { step: '第 3 步', label: '服务商设置页截图（含添加自定义服务商）', assetNo: 2 },
    { step: '全流程', label: '上手流程 GIF（安装 → 免费对话 → 填 key → 派活）', assetNo: 7 }
  ]
}

export const faq = {
  title: '常见问题',
  items: [
    {
      q: '要花钱吗？',
      a: `不花钱就能开始：先用「免费对话」，一分钱不用花就能问；要它在你的电脑上真干活，才需要模型 key，费用取决于你接哪家——免费额度、低价渠道都行。`
    },
    {
      q: '免费对话是给谁用的？',
      a: `所有人。查资料、拿不准想问一句、随手翻译总结，它是日常提问的默认去处，不是「不想花钱的人才会用」的降级入口。付费与否只区别一件事：要它读写文件、跑命令、操作桌面这些真执行时，模型调用需要 key。`
    },
    { q: '支持哪些服务商？', a: '不设白名单，任何提供 OpenAI 兼容接口的服务商都能接。' },
    { q: '我的数据安全吗？', a: '所有执行都在你自己的电脑上，文件不上传。对话内容只发往你自己配置的服务商。' },
    {
      q: '和 Cursor / Claude Code 有什么区别？',
      a: `它们是给程序员的编程工具。${BRAND.name}面向普通用户，且服务商完全自由。`
    },
    {
      q: '支持 Mac / Linux 吗？',
      a: '能出，技术上不是障碍。当前把 Windows 版打磨稳是重点，Mac 和 Linux 的安装包还在准备中，就绪后直接挂在下载区。'
    },
    { q: '稳定吗？', a: '日常使用没问题。仍在按迭代推进，碰到 bug 或不符合预期的地方，到 GitHub 提 issue，后续版本修掉。' }
  ]
}

export const footer = {
  github: `${GITHUB_REPO_URL}/releases`,
  feedback: `${GITHUB_REPO_URL}/issues`
}
