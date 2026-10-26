import { WISHFUL_CLAW_DATA_DIR_NAME } from './data-dir'

export const WISHFULCLAW_PROJECT_DIR_ENV = 'WISHFULCLAW_PROJECT_DIR'

/** 项目级数据目录名：dev 实例与生产各一份，全局目录不走这里。 */
export function projectDataDirName(isDev: boolean): string {
  return isDev ? `${WISHFUL_CLAW_DATA_DIR_NAME}-dev` : WISHFUL_CLAW_DATA_DIR_NAME
}

/** 判定逻辑本身（不碰 electron / process），供单测直接调。 */
export function pickProjectDirName(envValue: string | undefined, isPackaged: boolean): string {
  const configured = envValue?.trim()
  return configured ? configured : projectDataDirName(!isPackaged)
}
