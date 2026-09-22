/**
 * 流式事件批处理的阈值（iter-34 S-135）。
 *
 * 背景：工具执行快 + 模型快的时候，C# Worker 逐条推 delta，main 原样转发，
 * 渲染层单位时间要处理的事件量爆炸 —— 整页像截图一样静止，连「停止」按钮
 * 的事件都排不进去。这里把可加事件攒起来按帧推，控制类事件仍然立即直通。
 */

export interface AdaptiveEventBatcherConfig {
  /**
   * 刷新间隔（毫秒）。33ms ≈ 30fps：肉眼看着仍然连续，同时把主线程从
   * 「每条事件跑一轮渲染」里解放出来。
   */
  flushMs: number
  /**
   * 单个 run 允许累积的「体积」上限（字符数 + 工具参数条数）。超了不等
   * 定时器，立即 flush —— 避免一次性往渲染层推太大的一坨。
   */
  maxBufferSize: number
}

export const DEFAULT_BATCHER_CONFIG: AdaptiveEventBatcherConfig = {
  flushMs: 33,
  maxBufferSize: 200
}
