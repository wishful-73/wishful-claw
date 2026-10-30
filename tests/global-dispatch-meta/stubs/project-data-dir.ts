/**
 * `@renderer/lib/project-data-dir` 的测试替身（v3-iter-5 S-278）。
 *
 * 真模块读 `window.api.projectDirName` —— node 下没有 `window`，一 import 就
 * ReferenceError。这里只提供一个稳定值，让 wire 文本里的笔记目录可断言。
 * 真值随打包态 / dev 实例变化，但「文本里必须指明笔记目录」这条判据与具体目录名无关。
 */
export const PROJECT_DATA_DIR_NAME = '.wishful-claw'
