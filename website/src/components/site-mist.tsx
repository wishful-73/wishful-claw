// 站点背景「暖色雾」：一层极淡的琥珀色雾，钉在视口上，站内三张页面都挂（首页 / 下载页 / 指引页）。
//
// 2026-10-19（老大）：原来它只盖首屏（挂在 hero 里），老大要求「整个站点都要，不仅仅是首屏，也不仅仅是首页」，
// 于是从「hero 内的 absolute 层」提到「页面根上的 fixed 层」，收敛拖尾（ConvergeStreams）叠加在它上面。
// 它只负责底色，不负责动效叙事 —— 那部分归 converge-streams.tsx。
//
// 放在 DOM 最前面 + 负 z-index，紧挨 body 纸面之上（层序见 index.css 的 .site-mist）。
export function SiteMist() {
  return <div className="site-mist" aria-hidden="true" />
}
