import { assetSources, container } from '../components/ui'
import { PlatformIcon } from '../components/platform-icons'
import { BRAND, hero } from '../content/site'
import { ConvergeStreams } from './converge-streams'

// 2026-09-23（老大）：首屏大图撤掉 —— 主界面截图压在「不花钱，也能用起来」上方太突兀。
// 那张图已交给「它能干什么 → 真干活」，首屏回归纯文案 + 两个入口。
//
// 2026-10-16（S-206）：首屏加一层装饰性背景，同时整体撤掉原先的文字扫光 —— 老大 08:58 定
// 「保动画、扫光让步」：扫光最早做的目的就是觉得静态页面太素，这个岗位现在由背景动画接。
// 撤掉的两处是配套的，必须一起改：
//   ① 顶部那行的 `shine shine-muted`；② h1 的 `hero-shine` 与 `data-text`
//   （`data-text` 是 `.hero-shine::after` 的 content 来源，只删 CSS 不删它就会脏在 DOM 里）。
//
// 2026-10-19（第三次要求）：收束层从首屏搬到了整页（老大：「这个是整个页面的全局背景」）。
//
// 2026-10-19（第四次要求）：暖色雾也从首屏搬到整站，挂到三张页面（.site-mist）。
//
// 2026-10-19（第五次要求，10:30）：**光束收回首屏**（老大：「这个光束可以就集中在首屏么，不是整个
// 首页，之前的暖色背景是整站的这个是对的」）⇒ 收束层搬回这里，雾不回来、继续整站。
// 于是 `relative isolate` 又需要了 —— 给这层的负 z-index 就地建堆叠上下文（见 index.css §背景动画层）。
//
// 2026-11-12（老大）：**首屏大图重新加回来** —— 参照 deepseek.com/harness 的首屏排布（文案 + 单枚
// CTA + 紧跟一张产品窗口图，图宽约八成屏、带圆角细边框投影、底部被裁）。这条**推翻了 2026-09-23
// 「首屏大图撤掉」的裁定**，口径以本条为准；`content/site.ts` 里那段旧注释已同步改写。
// 与 9-23 那版的关键差别（也是这次不再「突兀」的原因）：
//   ① 图不是裸图直接怼在文案下面，而是同款窗口卡片（圆角 + 描边 + 大范围柔和投影），和「它能干什么」
//      轮播舞台是同一套视觉语言；
//   ② 图必须在 CTA 之后、且**完整显示**（见下条）。
//
// 2026-11-12（老大第二次）：「图片可以不剪裁么」+「看看参考网站他们是怎么处理图片对应样式的」
// ⇒ **撤掉高度钳制与裁切**，这是对上面 ② 的修正，口径以本条为准。
//   原写法 `aspectRatio + maxHeight: min(58vh,640px) + object-cover object-top` 是从底部裁图换首屏高度；
//   现在改成按原图比例完整铺开（`h-auto w-full`），图的下半截允许落到首屏之外，让用户往下滚看全。
//   依据：深色参考站 1920×1080 实测 —— 主图 1020×612，y 549→1161，**底部超出视口 81px**，
//   `mask: none`、无 object-fit、无 max-height，就是让整张图自然溢出，靠滚动看全。
//   样式同时对齐它的实测值：圆角 16px、1px 描边用 box-shadow 外圈（`ring-1`，不占布局、不挤压图片比例）、
//   大范围柔和投影。
//   代价（已确认要这个效果，别再加 maxHeight 裁回去）：1440×900 下图溢出首屏约 440px、
//   1920×1080 约 260px，页面因此变长；标题与 CTA 位置不受影响（实测 h1Bottom 292 / ctaBottom 484 不变）。
// 顺序上必须留在 CTA 之后 —— 先在首屏把「是什么 / 怎么拿」说完，再给眼睛看产品长什么样。
//
// 2026-11-13（S-360，老大拍板方案 A）：首屏重排三处 ——
//   ① 眉标从 `BRAND.vision`「心之所向，心想事成」换成「心相 WishfulClaw」。
//      vision 那句诗意但不回答「这是什么」，而首屏第一行是访客目光落点；它没丢，页脚本来就在用
//      （site-footer.tsx:14）。**BRAND.vision 字段保留，不要删**。
//   ② H1 从 52px 提到 64px。**不要给 highlight 加 `block`** —— 2026-11-13 11:3x 老大
//      「大标题别换行呀，我看着有点别扭」：第一版强制两行（`block`），上下两行字重相同、整块成了
//      一个方框，反而糊。现在 10 个字（「不止于聊，更在于行」）在 64px 下约 640px，
//      `max-w-4xl`（896px）放得下，自然单行；视口更窄时才由浏览器自己折行。
//   ③ 三短句（真干活 / 真本地 / 真透明）**加了又删**：2026-11-13 11:29 老大「下面本来就有类似的东西，
//      你这给了就重复了」。valueLadder + features + advantages 讲的就是这三条，首屏再列一遍又成了
//      「区块之间重复自己」。**不要再加回来。**
export function Hero() {
  return (
    <section className="relative isolate pt-28 pb-16 sm:pt-36">
      <ConvergeStreams />
      {/* 2026-11-13：文案区与下面主图共用同一个容器 —— 首屏是这一页的门面，
          两边底色一致才看得出左边缘是一条线。此前这里是通栏，主图却挂在 max-w-6xl 里，
          宽屏上文案比图宽出一截。 */}
      <div className={`${container} text-center`}>
        <p className="reveal mb-3 text-sm tracking-[0.24em] text-ink-900/55">
          {BRAND.name} {BRAND.latin}
        </p>
        <h1 className="reveal mx-auto max-w-4xl text-4xl leading-tight font-semibold tracking-tight text-ink-950 sm:text-[64px] sm:leading-[1.15]">
          {hero.title.lead}
          <span className="text-accent">{hero.title.highlight}</span>
        </h1>
        {/* `text-balance` 必须有：33 字在 `max-w-2xl` 下会被断成「…不只是 / 聊给你听。」——
            末行只剩五个字。交给浏览器均衡断行，两行长度才接近。 */}
        <p className="reveal mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-balance text-ink-900/65">
          {hero.subtitle}
        </p>
        {/* CTA 抄 deepseek.com/harness 的形状（2026-11-13 老大「下载按钮再去抄下他们的样式」）。
            实测参考站：41px 高、全胶囊（`border-radius: 100px`）、15px/500、左侧平台图标 + 15~18px 内边距。
            **只抄形状与度量，不抄配色** —— 参考站是深色底（`body` `rgb(10,10,10)`）配白胶囊，
            本站是浅色暖底，白胶囊会糊进背景，继续用 accent。
            也不抄右侧的「分割线 + 下拉箭头」：参考站那半截是换源菜单，本站首屏点进 `/download`
            再选，多一个入口反而啰嗦。光效（`.dl-current` / `.dl-shine`）同样不上 —— 参考站此按钮
            `box-shadow: none`，光环留给下载页的「当前可下」那颗。 */}
        <div className="reveal mt-9 flex flex-wrap items-center justify-center gap-4">
          <a
            href={hero.primaryCtaHref}
            data-converge-target
            className="inline-flex h-[41px] items-center gap-2 rounded-full bg-accent px-6 text-[15px] font-medium text-white transition-opacity hover:opacity-90"
          >
            <PlatformIcon id="windows" className="size-4 shrink-0" />
            {hero.primaryCta}
          </a>
        </div>
      </div>

      {/* 首屏主图（2026-11-12 加回，参照 deepseek.com/harness）。
          2026-11-12 二次修正：「不剪裁」 —— 这里**没有** maxHeight、没有 aspectRatio、没有 object-cover，
          图片按 1920×1482 原始比例完整显示（`h-auto w-full`），底部自然落到首屏外。
          想加回钳制前先读文件头注释里的实测数据；`relative` 也不能省 —— 父级 section 是 `isolate`，
          ConvergeStreams 的负 z-index 层会盖住它。 */}
      <div className={`reveal relative mt-12 sm:mt-16 ${container}`}>
        <div className="mx-auto w-full overflow-hidden rounded-[16px] bg-paper-soft ring-1 ring-ink-700 shadow-[0_24px_72px_-24px_rgba(16,18,32,0.38)]">
          <img
            src={assetSources[14]}
            alt="心相智能助手主界面：左侧是项目与会话列表，右侧对话区里助手正在执行任务"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="block h-auto w-full"
          />
        </div>
      </div>
    </section>
  )
}
