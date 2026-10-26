import { WISHFUL_CLAW_DATA_DIR_NAME } from '@shared/data-dir'

/**
 * 项目级数据目录名（S-223）：打包版 `.wishful-claw`，dev 实例 `.wishful-claw-dev`。
 *
 * 值来自主进程，经 BrowserWindow.additionalArguments → preload → window.api。
 * renderer 不自己判定 dev/prod —— `npm start` 跑的是构建产物但未打包，
 * 自行判定会与 main 分叉，反向污染生产目录。
 *
 * 兜底只在这一处：三个辅助窗口（快速启动 / 剪贴板增强）不带该参数，读到的是
 * undefined，落回生产目录名。声明为 string 是为了下游 `joinFsPath(…, PROJECT_DATA_DIR_NAME)`
 * 不必逐个判空。
 */
export const PROJECT_DATA_DIR_NAME: string =
  window.api?.projectDirName ?? WISHFUL_CLAW_DATA_DIR_NAME
