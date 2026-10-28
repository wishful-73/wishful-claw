// renderable-chat-items 套件入口：按原顺序执行用例，输出 PASS 行与总数。
// 拆分自原单文件 program.ts（S-252，2026-10-28）。

import { loadBuildRenderableChatItems } from './fixtures'
import {
  testNoArtifacts,
  testArrayMiddleSplit,
  testFragmentTimestamps,
  testRelocatedArtifactCutTime,
  testArrayEdgeSplits,
  testStringSingleBlockSemantics,
  testBetweenMessagesAndTail,
  testLegacyStatusFiltering,
  testMultipleArtifactsAndReloadStability
} from './compaction-tests'
import {
  testNoLiveState,
  testLiveStateWithDraft,
  testLiveStateAppendedAfterArtifact,
  testLiveStateInlinesAfterAssistant,
  testLiveDraftAppendsCoalesce,
  testInvertedTimestampPairStillRenders
} from './live-state-tests'
import {
  testAnchorSplitKeepsToolResultPair,
  testAnchorFallsBackWhenToolUseGone,
  testLiveAnchorInlinesLikeCompletedDivider
} from './anchor-tests'

const tests: Array<[string, () => void | Promise<void>]> = [
  ['no artifacts', testNoArtifacts],
  ['array middle split', testArrayMiddleSplit],
  ['fragment timestamps chain and total elapsed', testFragmentTimestamps],
  ['relocated artifact cut time uses meta cutAt', testRelocatedArtifactCutTime],
  ['array edge splits', testArrayEdgeSplits],
  ['string single-block semantics', testStringSingleBlockSemantics],
  ['between messages and transcript tail', testBetweenMessagesAndTail],
  ['legacy compression status filtering', testLegacyStatusFiltering],
  ['multiple artifacts and reload stability', testMultipleArtifactsAndReloadStability],
  ['no live state renders no live item', testNoLiveState],
  ['live state with draft produces live item', testLiveStateWithDraft],
  ['live state appends after artifact pair', testLiveStateInlinesAfterAssistant],
  ['live state coexists with completed artifact pair', testLiveStateAppendedAfterArtifact],
  ['anchor split keeps tool_use with its inline result', testAnchorSplitKeepsToolResultPair],
  ['anchor falls back to block count when tool use is gone', testAnchorFallsBackWhenToolUseGone],
  ['live anchor inlines like completed divider', testLiveAnchorInlinesLikeCompletedDivider],
  ['live draft chunks coalesce into one notification', testLiveDraftAppendsCoalesce],
  ['inverted timestamp pair still renders', testInvertedTimestampPairStillRenders]
]

async function main(): Promise<void> {
  ;(globalThis as typeof globalThis & { window: unknown }).window = {
    electron: {
      ipcRenderer: {
        invoke: async () => undefined,
        send: () => undefined,
        on: () => undefined,
        removeListener: () => undefined
      }
    }
  }

  await loadBuildRenderableChatItems()

  for (const [name, run] of tests) {
    await run()
    console.log(`PASS: ${name}`)
  }

  console.log(`Renderable chat item tests passed: ${tests.length}`)
}

void main()
