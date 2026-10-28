/**
 * IPC 注册的注入线（S-249 拆分时新增）。
 *
 * 原文件里 `createLauncherWindow` / `createFileSearchWindow` 都直接调同文件的 `registerLauncherIpc()`，
 * 一室之内不构成问题。拆开之后方向反了：`ipc.ts` 需要 import 两个窗口模块的导出（取数、图标、隐藏），
 * 窗口模块又需要触发 IPC 注册 —— 直接互相 import 就成环。
 *
 * 所以把「注册动作」做成一次注入：桶（`quick-launcher.ts`）启动时把真正的 `registerLauncherIpc`
 * 塞进来，窗口模块只管 `ensureLauncherIpc()`。**注入前调用是无操作**，与原文件里「未注册就什么都不做」
 * 的幂等语义一致（原来 `ipcRegistered` 标志兜底，现在由 ipc.ts 自己继续兜）。
 */

let registrar: (() => void) | null = null

export function setLauncherIpcRegistrar(fn: () => void): void {
  registrar = fn
}

/** 幂等入口：真正的去重由 `registerLauncherIpc` 内部的 `ipcRegistered` 负责。 */
export function ensureLauncherIpc(): void {
  if (registrar) registrar()
}
