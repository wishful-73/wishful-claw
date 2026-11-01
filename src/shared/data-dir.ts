export const WISHFUL_CLAW_DATA_DIR_NAME = '.wishful-claw'
export const WISHFULCLAW_DATA_DIR_ENV = 'WISHFULCLAW_DATA_DIR'
export const WISHFUL_CLAW_DISPLAY_NAME = 'Wishful Claw'
export const WISHFUL_CLAW_DEV_DISPLAY_NAME = 'Wishful Claw (开发版)'

/** 默认全局数据目录名：打包版 `.wishful-claw`，dev 实例 `.wishful-claw-dev`。 */
export function dataDirName(isPackaged: boolean): string {
  return isPackaged ? WISHFUL_CLAW_DATA_DIR_NAME : `${WISHFUL_CLAW_DATA_DIR_NAME}-dev`
}

/**
 * 全局数据根的决定（S-282）。
 *
 * 只做「选谁」这一步，**不做路径拼接** —— 这个模块同时被 `tsconfig.web.json` 编译，
 * 引 `node:path` 会挂；而且「解析」本来就该和「落盘」分开（见 `src/main/lib/data-dir.ts`）。
 *
 * 返回 `fromEnv` 而不是一个朴素字符串，是因为两种来源的语义**根本不同**：
 * 环境变量给的是**完整路径**（相对路径也要按 cwd 转绝对），默认值只是**目录名**
 * （必须拼到用户主目录下）。把它们压成一个字符串，主进程就只能靠 `isAbsolute()` 猜，
 * `WISHFULCLAW_DATA_DIR=.\data` 这种相对路径会被错误地拼到 home 下面。
 */
export interface DataDirDecision {
  /** true = 来自环境变量（完整路径语义）；false = 默认目录名（需拼到 home 下）。 */
  fromEnv: boolean
  /** 环境变量原值（已去首尾空白），或默认目录名。 */
  value: string
}

export function pickDataDir(envValue: string | undefined, isPackaged: boolean): DataDirDecision {
  const configured = envValue?.trim()
  if (configured) return { fromEnv: true, value: configured }
  return { fromEnv: false, value: dataDirName(isPackaged) }
}
