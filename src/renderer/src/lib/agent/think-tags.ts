// think 标签的纯字符串工具（iter-v3-5 S-247）。
//
// 为什么单独一个文件：`stripThinkTagMarkers` 原先有两份实现，分别躺在
// `components/chat/AssistantMessage/utils.ts` 和 `lib/agent/session-runtime-utils.ts`，
// 而这两个文件的值 import 链都会把 zustand store 拖进来。`think-parser.ts` 因此
// 没法在 node 里单测 —— 而 `normalizeStructuredBlocks` 的流式分支正是「跳过清理后
// 结束态是否等价」这种必须钉死的东西（S-247 §18）。
//
// 抽到纯模块后：三处各自 re-export，对外 API 一个字没变，`think-parser` 变纯。

/** 只去掉 `<think>` / `</think>` 这类标记本身，不动被标记包住的正文。 */
export function stripThinkTagMarkers(text: string): string {
  return text.replace(/<\s*\/?\s*think\s*>/gi, '')
}

/** 去掉标记**和**标记包住的内容（`<think>…</think>` 整段消失）。 */
export function stripThinkTags(text: string): string {
  return text
    .replace(/<\s*think\s*>[\s\S]*?(<\s*\/\s*think\s*>|$)/gi, '')
    .replace(/<\s*\/?\s*think\s*>/gi, '')
    .trim()
}
