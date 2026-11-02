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

/**
 * 逃生舱（S-293）：明知有污染风险、仍要用那份库调试时设 `1`，block 降级为 warn。
 * 不给这个开关，唯一的选择就是「去改代码」，那比显式放行更难查。
 */
export const WISHFULCLAW_ALLOW_SHARED_DATA_DIR_ENV = 'WISHFULCLAW_ALLOW_SHARED_DATA_DIR'

/** 目标数据目录的探测结果 —— 由主进程用 `fs` 探完传进来（shared 层不能碰 `node:fs`）。 */
export interface DataDirProbe {
  /** 目标目录是否已存在 */
  exists: boolean
  /** 目标目录里是否已有 `index.db` */
  hasDatabase: boolean
}

export type DataDirRiskLevel = 'ok' | 'warn' | 'block'

export interface DataDirRisk {
  level: DataDirRiskLevel
  /** 给日志 / 弹窗用的说明；`ok` 时为 `null`。 */
  reason: string | null
}

/** 取路径末段目录名，不引 `node:path`（本模块同时被 `tsconfig.web.json` 编译）。 */
function lastSegment(value: string): string {
  const parts = value.split(/[\\/]+/).filter((part) => part.length > 0)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/**
 * 非打包构建是否会污染一份已有的生产库（S-293）。
 *
 * 为什么只在「显式配置」时判：非打包构建的**默认**目录是 `.wishful-claw-dev`，
 * 那里有 `index.db` 是它自己写的，拦它等于拦掉正常开发。
 *
 * 两级：
 * - **block** —— 显式指向的目录末段就是生产目录名（`.wishful-claw`）且已有库。这是
 *   「拿生产库开发」，没有任何合理解释，直接拒绝启动。
 * - **warn** —— 显式指向其它已存在且带库的目录。可能是用户自己的第二份库，放行但记日志。
 */
export function assessDataDirRisk(
  decision: DataDirDecision,
  isPackaged: boolean,
  probe: DataDirProbe
): DataDirRisk {
  if (isPackaged) return { level: 'ok', reason: null }
  if (!decision.fromEnv) return { level: 'ok', reason: null }
  if (!probe.exists || !probe.hasDatabase) return { level: 'ok', reason: null }

  const target = lastSegment(decision.value)
  if (target === WISHFUL_CLAW_DATA_DIR_NAME) {
    return {
      level: 'block',
      reason:
        `非打包构建把数据目录指向了生产库「${decision.value}」。` +
        `启动会按开发版的 DDL 改这份库的 schema。` +
        `如确需如此，设 ${WISHFULCLAW_ALLOW_SHARED_DATA_DIR_ENV}=1 放行。`
    }
  }

  return {
    level: 'warn',
    reason: `非打包构建的数据目录「${decision.value}」里已有一份 index.db，确认它不是你不想动的那份库。`
  }
}
