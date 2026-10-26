/**
 * 聊天图片落盘（S-224）。
 *
 * 发送前把图片块里的 base64 交给主进程写到 `{dataRoot}/images/{yyyy-MM}/`，
 * 拿到磁盘路径后补进块里。**base64 保留**——发给模型的请求体仍要它，
 * 剥离只发生在落库序列化那一步（`image-payload.ts`）。
 *
 * 落盘函数由调用方注入：主进程 IPC 走真实实现，单测传假函数。
 */

import type { ContentBlock, ImageBlock } from './api/types'

export type PersistChatImageFn = (args: { data: string; mediaType?: string }) => Promise<{
  filePath?: string
  error?: string
}>

function isImageBlock(block: ContentBlock | null | undefined): block is ImageBlock {
  return !!block && typeof block === 'object' && block.type === 'image'
}

/**
 * 给图片块补 `filePath`。任一块落盘失败就原样返回该块（降级为内联 base64），
 * 绝不让写盘问题挡住发送。
 */
export async function attachChatImagePaths(
  blocks: ContentBlock[],
  persist: PersistChatImageFn
): Promise<ContentBlock[]> {
  return Promise.all(
    blocks.map(async (block) => {
      // 守卫放进 try：块结构畸形（source 为 null / 非对象）时绝不能抛到发送主路径。
      try {
        if (!isImageBlock(block)) return block
        const source = block.source
        if (!source || typeof source !== 'object') return block

        // 已经落过盘的块（编辑重发、渠道重发）直接信任既有路径，
        // 不再把最多 20 MB 的 base64 过一趟 IPC 换回同一个路径。
        if (typeof source.filePath === 'string' && source.filePath.trim().length > 0) {
          return block
        }

        const data = source.data
        if (typeof data !== 'string' || !data) return block

        const persisted = await persist({ data, mediaType: source.mediaType })
        if (!persisted?.filePath) return block
        return { ...block, source: { ...source, filePath: persisted.filePath } }
      } catch (error) {
        console.warn('[image-persist-chat] 落盘失败，保留内联 base64', error)
        return block
      }
    })
  )
}
