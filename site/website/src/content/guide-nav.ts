// 指引页侧栏与首屏的导航数据。侧栏标题与副标题从 markdown 标题本身推导（见 splitTitle），
// 这里只补三样推导不出来的东西：英文锚点、章节分组、以及标题里没有「：」的那几章副标题。
// 分组与副标题的键用章号（标题行首的 "N."）—— 章号比标题文字稳定，改措辞不会把导航弄断。

/**
 * 标题原文 → 英文锚点（全小写），只当 URL 里的 #id 用，不在界面上显示。
 * 没给的标题会退回中文 slug —— 那是更早一版的做法，链接里带汉字既难看又不好复制，别留退回项。
 */
export const guideSlugs: Record<string, string> = {
  '1. 安装与启动': 'install',
  '2. 不花钱先用起来：免费对话与效率工具': 'start-free',
  '3. 配置模型': 'models',
  '4. 界面导览': 'interface',
  '5. 项目下会话：干活的地方': 'project-session',
  '6. 全局会话：调配资源的那一层': 'global-session',
  '7. 权限模式与工具确认': 'permissions',
  '8. 记忆系统': 'memory',
  '9. 人格系统': 'persona',
  '10. 它能动手做什么': 'capabilities',
  '11. 扩展能力：插件 / 扩展 / Skills / MCP': 'extensions',
  '12. 渠道集成（微信 / 飞书 / QQ 等）': 'channels',
  '13. 定时任务与任务看板': 'automation',
  '14. 外观、语言与快捷键': 'appearance',
  '15. 用量统计与成本': 'usage',
  '16. 更新、日志与常见问题': 'updates-faq',
  '免费对话': 'free-chat',
  '效率工具': 'productivity',
  '辅助模型与补位模型': 'auxiliary-models',
  '正常用法': 'normal-usage',
  '对话与协作：区别是能给它的工具多少': 'chat-vs-cowork',
  '计划模式与 Goal 模式：协作干活时的两种执行方式': 'plan-and-goal',
  '长对话怎么管': 'long-conversations',
  '它只调配资源，不动手改文件': 'read-only-by-design',
  '让全局会话主动起来': 'stay-proactive',
  '定时任务（左侧栏 → 扩展 → 自动化）': 'scheduled-tasks',
  '任务看板（左侧栏 → 扩展 → 任务看板）': 'task-board'
}

export const guideGroups: { title: string; chapters: number[] }[] = [
  { title: '开始使用', chapters: [1, 2, 3, 4] },
  { title: '会话与权限', chapters: [5, 6, 7] },
  { title: '让它更懂你', chapters: [8, 9, 10, 11] },
  { title: '自动化与接入', chapters: [12, 13] },
  { title: '日常与排障', chapters: [14, 15, 16] }
]

/** 标题里没有「：」可拆时的副标题 */
export const guideFallbackDescs: Record<number, string> = {
  1: '下载、装好、首次引导',
  3: '填 Key，选服务商',
  4: '三栏各管什么',
  7: '默认与 YOLO 两档',
  8: '三层流转，主动检索',
  9: '说话风格与预设',
  10: '文件、命令、浏览器、桌面',
  12: '在外面发一句，家里就干活',
  13: '到点自己醒，催没交的活',
  14: '主题、语言、热键',
  15: '花了多少，命中率',
  16: '排障先看这里'
}

/** 首屏四张入口卡：一句话说清这类人来是为了看哪几章 */
export const guideCards: { title: string; sentence: { text: string; chapter: number }[] }[] = [
  {
    title: '新手路径',
    sentence: [
      { text: '下载安装', chapter: 1 },
      { text: '不配 Key 先问一句', chapter: 2 },
      { text: '接上服务商', chapter: 3 }
    ]
  },
  {
    title: '派活与协作',
    sentence: [
      { text: '项目下会话四步', chapter: 5 },
      { text: '全局会话派活', chapter: 6 },
      { text: '权限两档', chapter: 7 }
    ]
  },
  {
    title: '让它主动起来',
    sentence: [
      { text: '定时任务', chapter: 13 },
      { text: '微信 / 飞书发需求', chapter: 12 },
      { text: '任务看板', chapter: 13 }
    ]
  },
  {
    title: '查阅细节',
    sentence: [
      { text: '记忆怎么流转', chapter: 8 },
      { text: '它能动手做什么', chapter: 10 },
      { text: '常见问题', chapter: 16 }
    ]
  }
]
