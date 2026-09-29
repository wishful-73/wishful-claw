/*
 * Everything 探测与调用（iter-36 S-151）。
 *
 * 存在理由：文件搜索走「接管式」—— 我们**不接结果**，只做两件事：找到用户的 Everything.exe、
 * 把关键词用 `-search` 投进去。这两件事全是纯逻辑（解析注册表输出、拼候选路径、按优先级挑、
 * 拼参数），错一处用户就是「明明装了却搜不了」，或者在别的机器上把任意软件的 exe 当 Everything 起。
 *
 * 这一套钉死八件事：
 *   ① 什么算 Everything 本体（`Everything.exe` / `Everything64.exe`，大小写无关，其余一律不算）；
 *   ② 注册表输出怎么切块、`DisplayIcon` 的 `,0` 尾巴怎么剥（**不留尾巴就会拿一个不存在的路径去
 *      existsSync**，然后静默回落到「未安装」）；
 *   ③ 候选生成只认 `DisplayName` 含 Everything 的卸载项 —— 不认的话会把同一把注册表里任意软件的
 *      自带 exe 抓进来；
 *   ④ 优先级**顺序**本身：手动指定必须排第一（便携版探不到，那是主流用法）；
 *   ⑤ 参数是长名 `-search` 而不是 `-s`（`es.exe` 里 `-s` 是「按路径排序」，写错语义就变了），
 *      且关键词作为**单个参数**传递（含空格 / 引号 / 中文都不炸）；
 *   ⑥ 二轮新增的三档解析：服务 `BINARY_PATH_NAME`（要剥引号与 `-svc`）、进程 / 扫盘那种
 *      「一行一个路径」的输出、以及**第三方私有副本必须被剔掉**（uTools / WPS 那份）；
 *   ⑦ 扫盘的跳过列表与深度常量 —— 深浅错一层就白扫，跳错目录就把 `Windows` 也爬一遍；
 *   ⑧ 版本信息检测是 **fail-open**：读不到就放行（老版本 / 精简 exe 不带 `ProductName`），
 *      有值但不含 Everything 才拦。
 *
 * 只测纯函数：文件系统与进程都不碰，`exists` 由这里注入。
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  EVERYTHING_DOWNLOAD_URL,
  EVERYTHING_EXE_BASENAMES,
  EVERYTHING_SCAN_MAX_DEPTH,
  EVERYTHING_SOURCE_PRIORITY,
  SCAN_SKIP_DIR_NAMES,
  buildEverythingSearchArgs,
  extractEverythingRegistryCandidates,
  getKnownInstallCandidates,
  isEverythingExecutableName,
  isEverythingVersionInfoHit,
  isThirdPartyPrivateEverythingPath,
  normalizeRegistryPath,
  parseEverythingServiceImagePath,
  parseExecutablePathLines,
  parseRegistryUninstallBlocks,
  pickEverythingExePath,
  sanitizeEverythingCandidates,
  shouldScanIntoDirectory
} from '../../src/main/lib/everything-search'

let checks = 0

function check(condition: unknown, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

function eq(actual: unknown, expected: unknown, description: string): void {
  checks += 1
  assert.strictEqual(actual, expected, description)
}

function deepEq(actual: unknown, expected: unknown, description: string): void {
  checks += 1
  assert.deepStrictEqual(actual, expected, description)
}

// ── ① 什么算 Everything 本体 ────────────────────────────────────────────────

check(isEverythingExecutableName('Everything.exe'), '1.4 系主程序名')
check(isEverythingExecutableName('Everything64.exe'), '1.5 alpha 主程序名')
check(isEverythingExecutableName('everything.EXE'), '大小写无关')
check(isEverythingExecutableName('  Everything.exe  '), '剥掉两侧空白再判')
check(!isEverythingExecutableName('unins000.exe'), '卸载程序不是本体')
check(!isEverythingExecutableName('Everything.exe.bak'), '备份文件不是本体')
check(!isEverythingExecutableName('es.exe'), '命令行版 es.exe 不是 GUI 本体')
check(!isEverythingExecutableName(''), '空文件名不算')
eq(EVERYTHING_EXE_BASENAMES.length, 2, '只认两种官方命名')
eq(EVERYTHING_DOWNLOAD_URL, 'https://www.voidtools.com/downloads/', '外链落点固定')

// ── ② `DisplayIcon` 尾巴与引号 ──────────────────────────────────────────────

eq(
  normalizeRegistryPath('C:\\Program Files\\Everything\\Everything.exe,0'),
  'C:\\Program Files\\Everything\\Everything.exe',
  '剥掉图标索引尾巴'
)
eq(
  normalizeRegistryPath('"C:\\Program Files\\Everything\\Everything.exe",0'),
  'C:\\Program Files\\Everything\\Everything.exe',
  '带引号时按引号切，尾巴一起丢'
)
eq(
  normalizeRegistryPath('"C:\\Tools, Portable\\Everything\\Everything.exe",-1'),
  'C:\\Tools, Portable\\Everything\\Everything.exe',
  '带引号时路径里的逗号不能被当成分隔符'
)
eq(
  normalizeRegistryPath('C:\\Everything\\Everything.exe'),
  'C:\\Everything\\Everything.exe',
  '没有尾巴时原样返回'
)
eq(normalizeRegistryPath('   '), '', '空白归一成空串（调用方据此跳过）')
eq(normalizeRegistryPath('"'), '"', '只有一个引号时不硬切')

// ── ③ 注册表输出 → 卸载项 → Everything 候选 ─────────────────────────────────

const registrySample = [
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{1111}',
  '    DisplayName    REG_SZ    Some Other App',
  '    DisplayIcon    REG_SZ    C:\\Other\\other.exe,0',
  '    InstallLocation    REG_SZ    C:\\Other',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Everything',
  '    DisplayName    REG_SZ    Everything 1.4.1 (x64)',
  '    DisplayIcon    REG_SZ    "C:\\Program Files\\Everything\\Everything.exe",0',
  '    InstallLocation    REG_SZ    C:\\Program Files\\Everything',
  '    UninstallString    REG_SZ    C:\\Program Files\\Everything\\uninstall.exe',
  '    EstimatedSize    REG_DWORD    0x2a1c',
  '',
  'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Everything 1.5a',
  '    DisplayName    REG_SZ    Everything 1.5.0.1357a (x64)',
  '    DisplayIcon    REG_SZ    C:\\Tools\\Everything 1.5a\\Everything64.exe,0'
].join('\r\n')

const blocks = parseRegistryUninstallBlocks(registrySample)
eq(blocks.length, 3, '三段卸载项各成一块')
eq(blocks[0].displayName, 'Some Other App', '第一块 DisplayName')
eq(blocks[1].displayName, 'Everything 1.4.1 (x64)', '第二块 DisplayName')
eq(blocks[1].installLocation, 'C:\\Program Files\\Everything', '第二块 InstallLocation')
eq(blocks[1].displayIcon, '"C:\\Program Files\\Everything\\Everything.exe",0', '取原始值，剥尾巴留给下游')
eq(blocks[2].displayIcon, 'C:\\Tools\\Everything 1.5a\\Everything64.exe,0', '第三块 DisplayIcon')
check(
  parseRegistryUninstallBlocks(registrySample).every((block) => block.displayName !== 'Everything 1.5a'),
  '标题行（键名）不会被当成 DisplayName'
)
eq(parseRegistryUninstallBlocks('').length, 0, '空输出没有块')

const registryCandidates = extractEverythingRegistryCandidates(blocks)
deepEq(
  registryCandidates,
  [
    // DisplayIcon 与 InstallLocation + Everything.exe 指向同一路径，只留一份。
    'C:\\Program Files\\Everything\\Everything.exe',
    join('C:\\Program Files\\Everything', 'Everything64.exe'),
    'C:\\Tools\\Everything 1.5a\\Everything64.exe'
  ],
  '只取 Everything 卸载项：DisplayIcon 优先，InstallLocation 补两种命名，同路径去重，非 Everything 条目一律不取'
)
check(
  !registryCandidates.some((candidate) => candidate.includes('other.exe')),
  'DisplayName 不含 Everything 的条目完全不参与（否则会抓到任意软件的 exe）'
)
check(
  !registryCandidates.some((candidate) => candidate.includes('uninstall.exe')),
  'UninstallString 不作为候选'
)
deepEq(
  extractEverythingRegistryCandidates([
    {
      displayName: 'Everything',
      displayIcon: 'C:\\a\\Everything.exe,0',
      installLocation: ''
    },
    {
      displayName: 'Everything 1.4',
      displayIcon: 'C:\\a\\Everything.exe,1',
      installLocation: ''
    }
  ]),
  ['C:\\a\\Everything.exe'],
  '同一路径只留一份（同一台机器常见多条 Everything 卸载项）'
)

// ── 常见安装位 / PATH ──────────────────────────────────────────────────────

const knownInstall = getKnownInstallCandidates(
  { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
  'win32'
)
check(
  knownInstall.includes(join('C:\\Program Files', 'Everything', 'Everything.exe')),
  '标准安装位'
)
check(
  knownInstall.includes(join('C:\\Program Files', 'Everything 1.5a', 'Everything64.exe')),
  '1.5 alpha 单独目录'
)
check(
  knownInstall.includes(join('C:\\Program Files (x86)', 'Everything', 'Everything.exe')),
  '32 位安装位也算'
)
eq(getKnownInstallCandidates({ ProgramFiles: 'C:\\Program Files' }, 'darwin').length, 0, '非 Windows 没有常见安装位')
check(
  getKnownInstallCandidates({ ProgramFiles: '   ' }, 'win32').length === 0,
  '环境变量是空白时不生成垃圾候选'
)

// 二轮补的包管理器 / 用户级落点：winget、scoop、chocolatey 都不写官方卸载键，必须显式列。
const packageManagerInstall = getKnownInstallCandidates(
  {
    ProgramFiles: 'C:\\Program Files',
    LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\u',
    ProgramData: 'C:\\ProgramData'
  },
  'win32'
)
check(
  packageManagerInstall.includes(
    join('C:\\Users\\u\\AppData\\Local', 'Programs', 'Everything', 'Everything.exe')
  ),
  'winget 用户级安装位'
)
check(
  packageManagerInstall.includes(
    join('C:\\Users\\u\\AppData\\Local', 'Microsoft', 'WinGet', 'Links', 'Everything.exe')
  ),
  'winget 的 Links 目录（shim）'
)
check(
  packageManagerInstall.includes(
    join('C:\\Users\\u', 'scoop', 'apps', 'everything', 'current', 'Everything64.exe')
  ),
  'scoop 的 current 目录'
)
check(
  packageManagerInstall.includes(join('C:\\Users\\u', 'scoop', 'shims', 'Everything.exe')),
  'scoop 的 shim'
)
check(
  packageManagerInstall.includes(join('C:\\ProgramData', 'chocolatey', 'bin', 'Everything.exe')),
  'chocolatey 的 bin'
)
check(
  !getKnownInstallCandidates({ ProgramFiles: 'C:\\Program Files' }, 'win32').some((candidate) =>
    candidate.includes('scoop')
  ),
  '环境变量缺失时不会拼出半截路径（宁可少一个候选，也不能拼出垃圾）'
)

deepEq(
  parseExecutablePathLines(
    ['C:\\Tools\\Everything\\Everything.exe', '', 'C:\\Other\\other.exe', 'C:\\a\\Everything.exe'].join('\r\n')
  ),
  ['C:\\Tools\\Everything\\Everything.exe', 'C:\\a\\Everything.exe'],
  '「一行一个路径」的输出（where / 进程查询 / 扫盘）只留本体，空行与非本体行丢掉'
)
deepEq(
  parseExecutablePathLines('C:\\a\\Everything.exe\r\nc:\\A\\everything.exe'),
  ['C:\\a\\Everything.exe', 'c:\\A\\everything.exe'],
  '按字符串去重（大小写不同算两条，交给 exists 与实际文件判定）'
)

// ── ⑥ 服务 ImagePath / 第三方私有副本 ──────────────────────────────────────

eq(
  parseEverythingServiceImagePath('SERVICE_NAME: Everything\r\n        BINARY_PATH_NAME   : "C:\\Program Files\\Everything\\Everything.exe" -svc\r\n'),
  'C:\\Program Files\\Everything\\Everything.exe',
  '服务模式的 ImagePath：剥引号、丢掉 -svc'
)
eq(
  parseEverythingServiceImagePath('        BINARY_PATH_NAME   : C:\\Tools\\Everything\\Everything.exe -svc'),
  'C:\\Tools\\Everything\\Everything.exe',
  '不带引号时切掉第一个 - 开头的参数'
)
eq(
  parseEverythingServiceImagePath('        BINARY_PATH_NAME   : "C:\\a b\\Everything64.exe" /svc'),
  'C:\\a b\\Everything64.exe',
  '带空格的路径靠引号保住'
)
eq(parseEverythingServiceImagePath('[SC] OpenService FAILED 1060'), '', '服务不存在 ⇒ 空串')
eq(
  parseEverythingServiceImagePath('        BINARY_PATH_NAME   : C:\\Other\\other.exe -svc'),
  '',
  '服务名撞车但 exe 不是 Everything ⇒ 空串（不当成命中）'
)

check(
  isThirdPartyPrivateEverythingPath('C:\\Users\\u\\AppData\\Roaming\\uTools\\plugins\\x\\preload\\everything\\Everything.exe'),
  'uTools 私有副本要剔（它是宿主私有的，索引还可能被裁）'
)
check(
  isThirdPartyPrivateEverythingPath('C:\\Users\\u\\AppData\\Local\\Kingsoft\\WPS Office\\12\\office6\\everythingsearch\\everythingbinary\\Everything.exe'),
  'WPS 自带那份要剔（其 ini 里 exclude_files=…*.exe，接上去搜 exe 一个都搜不出）'
)
check(
  isThirdPartyPrivateEverythingPath('c:/users/u/appdata/roaming/utools/plugins/a/Everything.exe'),
  '大小写与正反斜杠都要认出来'
)
check(
  !isThirdPartyPrivateEverythingPath('C:\\Program Files\\Everything\\Everything.exe'),
  '正常安装位不能被误剔'
)

deepEq(
  sanitizeEverythingCandidates([
    'C:\\Tools\\Everything\\Everything.exe',
    'C:\\Tools\\Everything\\Everything.exe',
    'C:\\Tools\\Everything\\unins000.exe',
    'C:\\Users\\u\\AppData\\Roaming\\uTools\\plugins\\p\\Everything.exe',
    '   ',
    'C:\\Tools\\Everything\\Everything64.exe'
  ]),
  ['C:\\Tools\\Everything\\Everything.exe', 'C:\\Tools\\Everything\\Everything64.exe'],
  '去重 + 只留本体 + 剔私有副本 + 丢空串'
)

// ── ⑦ 扫盘：深度与跳过列表 ────────────────────────────────────────────────

eq(EVERYTHING_SCAN_MAX_DEPTH, 3, '扫盘深度写死：根 + 两层（D:\\software\\Everything\\ 才够）')
check(SCAN_SKIP_DIR_NAMES.includes('windows'), '跳过 Windows')
check(!shouldScanIntoDirectory('Windows'), 'Windows 目录名不分大小写都跳过')
check(!shouldScanIntoDirectory('AppData'), 'AppData 跳过（常见安装位已显式覆盖它的 Programs）')
check(!shouldScanIntoDirectory('$Recycle.Bin'), '回收站跳过')
check(!shouldScanIntoDirectory('System Volume Information'), '系统卷信息跳过')
check(!shouldScanIntoDirectory('node_modules'), '开发机把 Everything 解到工程目录时不爬 node_modules')
check(!shouldScanIntoDirectory(''), '空目录名不进去')
check(shouldScanIntoDirectory('software'), '普通目录照进')
check(shouldScanIntoDirectory('Tools'), '普通目录照进（大小写无关）')

// ── ⑧ 版本信息检测（fail-open） ────────────────────────────────────────────

check(isEverythingVersionInfoHit(''), '读不到版本信息 ⇒ 放行')
check(isEverythingVersionInfoHit('|'), '两个字段都空（只有一个分隔符）⇒ 放行')
check(isEverythingVersionInfoHit('Everything|Everything'), 'ProductName / FileDescription 都是 Everything')
check(isEverythingVersionInfoHit('|Everything'), '只有 FileDescription 有值也算')
check(isEverythingVersionInfoHit('Everything 1.5.0.1357a|Everything'), '带版本号也算')
check(!isEverythingVersionInfoHit('Some Other App|someapp.exe'), '明确是别的软件 ⇒ 拦掉')

// ── ④ 优先级顺序 ──────────────────────────────────────────────────────────

deepEq(
  EVERYTHING_SOURCE_PRIORITY,
  ['manual', 'registry', 'service', 'process', 'shortcut', 'program-files', 'path', 'scan'],
  '优先级写死：手动指定排第一（便携版在注册表里探不到），扫盘永远垫底（它是唯一的猜测档）'
)

const everythingExists = (path: string): boolean =>
  path === 'C:\\manual\\Everything.exe' ||
  path === 'C:\\reg\\Everything.exe' ||
  path === 'C:\\service\\Everything.exe' ||
  path === 'C:\\running\\Everything.exe' ||
  path === 'C:\\lnk\\Everything.exe' ||
  path === 'C:\\pf\\Everything.exe' ||
  path === 'C:\\pathdir\\Everything.exe' ||
  path === 'C:\\scanned\\Everything.exe'

deepEq(
  pickEverythingExePath(
    {
      manual: ['C:\\manual\\Everything.exe'],
      registry: ['C:\\reg\\Everything.exe'],
      service: ['C:\\service\\Everything.exe'],
      process: ['C:\\running\\Everything.exe'],
      shortcut: ['C:\\lnk\\Everything.exe'],
      'program-files': ['C:\\pf\\Everything.exe'],
      path: ['C:\\pathdir\\Everything.exe'],
      scan: ['C:\\scanned\\Everything.exe']
    },
    everythingExists
  ),
  { path: 'C:\\manual\\Everything.exe', source: 'manual' },
  '全都有时取手动指定'
)
deepEq(
  pickEverythingExePath(
    {
      service: ['C:\\service\\Everything.exe'],
      process: ['C:\\running\\Everything.exe'],
      'program-files': ['C:\\pf\\Everything.exe']
    },
    everythingExists
  ),
  { path: 'C:\\service\\Everything.exe', source: 'service' },
  '服务优先于「正在运行的进程」（服务是安装痕迹，进程可能只是随手跑的一份）'
)
deepEq(
  pickEverythingExePath(
    { process: ['C:\\running\\Everything.exe'], shortcut: ['C:\\lnk\\Everything.exe'], scan: ['C:\\scanned\\Everything.exe'] },
    everythingExists
  ),
  { path: 'C:\\running\\Everything.exe', source: 'process' },
  '没有安装痕迹时，「用户此刻在用的那份」优先于快捷方式与扫盘'
)
deepEq(
  pickEverythingExePath({ shortcut: ['C:\\lnk\\Everything.exe'], scan: ['C:\\scanned\\Everything.exe'] }, everythingExists),
  { path: 'C:\\lnk\\Everything.exe', source: 'shortcut' },
  '快捷方式优先于扫盘命中（前者是用户自己建的入口，后者是猜的）'
)
deepEq(
  pickEverythingExePath({ scan: ['C:\\scanned\\Everything.exe'] }, everythingExists),
  { path: 'C:\\scanned\\Everything.exe', source: 'scan' },
  '只剩扫盘结果时也认 —— 「本机检测」就是靠它兜底'
)
deepEq(
  pickEverythingExePath(
    {
      manual: ['C:\\manual-missing\\Everything.exe'],
      registry: ['C:\\reg\\Everything.exe'],
      'program-files': ['C:\\pf\\Everything.exe']
    },
    everythingExists
  ),
  { path: 'C:\\reg\\Everything.exe', source: 'registry' },
  '手动指定的路径不存在时往下走注册表（用户删了便携版不能卡死）'
)
deepEq(
  pickEverythingExePath(
    { registry: ['C:\\reg-missing\\Everything.exe'], 'program-files': ['C:\\pf\\Everything.exe'] },
    everythingExists
  ),
  { path: 'C:\\pf\\Everything.exe', source: 'program-files' },
  '注册表落空时走常见安装位'
)
deepEq(
  pickEverythingExePath({ 'program-files': ['C:\\pf-missing\\Everything.exe'], path: ['C:\\pathdir\\Everything.exe'] }, everythingExists),
  { path: 'C:\\pathdir\\Everything.exe', source: 'path' },
  '安装位落空时走 PATH'
)
eq(
  pickEverythingExePath({ manual: ['C:\\nope\\Everything.exe'], registry: [], path: [] }, everythingExists),
  null,
  '全不存在 ⇒ null（调用方据此走引导，不是随便起一个）'
)
eq(pickEverythingExePath({}, everythingExists), null, '没有任何候选 ⇒ null')
deepEq(
  pickEverythingExePath(
    { registry: ['C:\\a-missing\\Everything.exe', 'C:\\reg\\Everything.exe'] },
    everythingExists
  ),
  { path: 'C:\\reg\\Everything.exe', source: 'registry' },
  '同一档内按列出顺序取第一个存在的'
)
eq(
  pickEverythingExePath({ manual: [''], registry: [] }, everythingExists),
  null,
  '空串候选不会被当成命中（未指定路径就是未指定）'
)
deepEq(
  pickEverythingExePath({ manual: [''], registry: ['C:\\reg\\Everything.exe'] }, everythingExists),
  { path: 'C:\\reg\\Everything.exe', source: 'registry' },
  '空串被跳过后继续往下一档找，不会被它卡住'
)

// ── ⑤ 参数 ────────────────────────────────────────────────────────────────

deepEq(buildEverythingSearchArgs('invoice'), ['-search', 'invoice'], '用长名 -search，不用 es.exe 的 -s')
deepEq(
  buildEverythingSearchArgs('  季度 报告  '),
  ['-search', '季度 报告'],
  '关键词作为单个参数传递：首尾去空白，内部空格原样保留'
)
deepEq(buildEverythingSearchArgs('a"b'), ['-search', 'a"b'], '引号不做转义处理（不走命令行字符串拼接）')
eq(buildEverythingSearchArgs(''), null, '空关键词不启动 Everything')
eq(buildEverythingSearchArgs('     '), null, '纯空白同理')
eq(buildEverythingSearchArgs(null as unknown as string), null, 'null 入参也不炸')

// ── 汇总 ──────────────────────────────────────────────────────────────────

console.log(`everything-search: ${checks} checks passed`)
