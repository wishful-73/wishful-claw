/*
 * es.exe 取数与解析（iter-36 S-155）。
 *
 * 存在理由：S-155 让文件搜索从「投递给 Everything」变成「我们自己取数、自己渲染」，取数走官方
 * 命令行版 es.exe。这一层全是纯逻辑（拼参数、解析导出文件、挑候选、分类失败），错一处用户看到的
 * 就是「搜不到」「乱码」「明明装了却报错」。
 *
 * 这一套钉死八件事：
 *   ① es.exe 的**参数配方**（`-export-json` + `-utf8-bom` + `-date-format 1` + `-sort` +
 *      `-viewport-offset/-count`），顺序与取值都不能飘 —— 少 `-no-digit-grouping` 数字就带千分位
 *      逗号，JSON 直接废；
 *   ② **空结果是 3 字节纯 BOM、连 `[]` 都没有**（本机实测）⇒ 剥 BOM 后为空必须返回 `[]`，
 *      不能抛异常把「没搜到」误判成故障；
 *   ③ **Everything 没在跑时 exit 8**（`Error 8: Everything IPC not found`）且输出文件照样被建
 *      ⇒ 失败分类必须吃退出码，不能只看文件在不在；
 *   ④ 目录项 `filename` 自带尾部反斜杠、`size`/`extension` 为 null ⇒ 目录判定只看分隔符，
 *      名称/目录拆列在 JS 里做（es.exe 的 `-name -path-column` 实测不拆）；
 *   ⑤ **版本信息是 `ProductName=es`**（实测），只认 `Everything` 会误杀自家 exe；
 *   ⑥ 探测优先级顺序本身，以及「第三方私有副本（uTools / WPS）必须剔」；
 *   ⑦ 展示层格式化（字节数、本地时间）的边界值；
 *   ⑧ 分页 / 排序 / 分类过滤 / 结果总数四项的拼装规则（调整⑤ 加的），尤其「文件夹分类绝不能带
 *      `ext:`」（实测 `"/ad ext:pdf"` 恒 0 条）与「总数要容忍千分位」。
 *
 * 只测纯函数：不碰文件系统、不开进程，`exists` 由这里注入。
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  ES_CATEGORY_EXTENSIONS,
  ES_CATEGORY_ORDER,
  ES_DEFAULT_SORT,
  ES_EXE_BASENAME,
  ES_MAX_PAGE_SIZE,
  ES_PAGE_SIZE,
  ES_SORT_KEYS,
  ES_SOURCE_PRIORITY,
  buildEsArgs,
  buildEsCountArgs,
  buildEsQuery,
  buildEsSortArg,
  classifyEsFailure,
  formatHitSize,
  formatHitTime,
  getEsAlongsideCandidates,
  getEsBuiltinPath,
  getEsKnownDirCandidates,
  isEsCategory,
  isEsExecutableName,
  isEsSortKey,
  isEsVersionInfoHit,
  parseEsJson,
  parseEsPathLines,
  parseEsResultCount,
  pickEsCandidate
} from '../../src/main/lib/es-search'

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

// ── ① 什么算 es.exe ─────────────────────────────────────────────────────────

check(isEsExecutableName('es.exe'), '官方命名')
check(isEsExecutableName('ES.EXE'), '大小写无关')
check(isEsExecutableName('  es.exe  '), '剥掉两侧空白再判')
check(!isEsExecutableName('Everything.exe'), '本体不是命令行版')
check(!isEsExecutableName('es.exe.bak'), '备份文件不算')
check(!isEsExecutableName('nes.exe'), '前缀不同的不算')
check(!isEsExecutableName(''), '空文件名不算')
eq(ES_EXE_BASENAME, 'es.exe', '文件名常量固定')
eq(ES_PAGE_SIZE, 100, '单页条数固定')
eq(ES_MAX_PAGE_SIZE, 500, '单页上限固定')

// ── ② 版本信息判定（实测 ProductName 就是 es）────────────────────────────────

check(isEsVersionInfoHit('es|Everything Command Line Interface'), '实测本机样本必须命中')
check(isEsVersionInfoHit('ES|'), 'ProductName 单独等于 es 就算')
check(isEsVersionInfoHit('Everything|Everything'), '含 Everything 也算（兜住 FileDescription 缺失的场景）')
check(isEsVersionInfoHit(''), '读不到版本信息 ⇒ 放行（fail-open，精简 exe 不能误杀）')
check(isEsVersionInfoHit('   '), '空白同样按读不到处理')
check(!isEsVersionInfoHit('Windows Explorer|File Explorer'), '带 es 后缀的杂鱼不能被放进来')
check(!isEsVersionInfoHit('node.exe|Node.js'), '无关 exe 拦掉')

// ── ③ 探测候选与优先级 ─────────────────────────────────────────────────────

const everythingExe = 'D:\\tools\\Everything-1.4.1.1032.x64\\Everything.exe'
deepEq(
  getEsAlongsideCandidates(everythingExe),
  [join('D:\\tools\\Everything-1.4.1.1032.x64', 'es.exe')],
  'Everything 同目录是首选落点'
)
deepEq(getEsAlongsideCandidates(null), [], '没有本体路径时不给候选')
deepEq(getEsAlongsideCandidates(''), [], '空串同理')
deepEq(getEsAlongsideCandidates('es.exe'), [], '只有文件名（无目录）时不猜')

const fakeEnv = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }
const knownDirs = getEsKnownDirCandidates(fakeEnv, 'win32')
check(knownDirs.includes(join('C:\\Program Files', 'Everything', 'es.exe')), '标准安装位推导正确')
check(
  knownDirs.every((candidate) => candidate.toLowerCase().endsWith('es.exe')),
  '推导出来的候选必须都指向 es.exe（不能混进 Everything.exe）'
)
deepEq(getEsKnownDirCandidates(fakeEnv, 'darwin'), [], '非 Windows 无候选')

const present = new Set(['C:\\tools\\es.exe', 'C:\\scan\\es.exe'])
const exists = (path: string): boolean => present.has(path)
eq(
  pickEsCandidate(
    { scan: ['C:\\scan\\es.exe'], path: ['C:\\tools\\es.exe'], manual: ['C:\\gone\\es.exe'] },
    exists
  )?.source,
  'path',
  '手动指定不存在时，PATH 要排在扫盘前面'
)
eq(
  pickEsCandidate({ manual: ['C:\\tools\\es.exe'], path: ['C:\\scan\\es.exe'] }, exists)?.path,
  'C:\\tools\\es.exe',
  '手动指定永远最高优先级'
)
eq(
  pickEsCandidate({ builtin: ['C:\\tools\\es.exe'], alongside: ['C:\\scan\\es.exe'] }, exists)?.source,
  'builtin',
  '内置件压过 Everything 同目录'
)
eq(
  pickEsCandidate({ builtin: ['C:\\app\\es.exe'], path: ['C:\\tools\\es.exe'] }, exists)?.source,
  'path',
  '内置件缺失时回落到 PATH（内置坏掉不能把整条链掐死）'
)
eq(pickEsCandidate({ scan: ['C:\\nope\\es.exe'] }, exists), null, '一个都不存在时返回 null')
deepEq(
  ES_SOURCE_PRIORITY,
  ['manual', 'builtin', 'alongside', 'program-files', 'path', 'scan'],
  '档位顺序固定（builtin 排第二：用户手选优先，其余默认走内置件）'
)

// 内置件的落点推导（S-155 调整①：es.exe 打进包里，不再引导用户下载它）。
eq(
  getEsBuiltinPath('C:\\app\\resources'),
  join('C:\\app\\resources', 'es', 'es.exe'),
  '内置路径固定为 <resourcesRoot>/es/es.exe'
)
eq(getEsBuiltinPath(''), null, '空 root 不给路径')
eq(getEsBuiltinPath('   '), null, '纯空白同理')
eq(getEsBuiltinPath(null), null, 'null root 同理')
eq(getEsBuiltinPath(undefined), null, 'undefined root 同理')

// ── ④ where 输出的解析 ─────────────────────────────────────────────────────

deepEq(
  parseEsPathLines('C:\\tools\\es.exe\r\nC:\\Program Files\\Everything\\es.exe\r\n'),
  ['C:\\tools\\es.exe', 'C:\\Program Files\\Everything\\es.exe'],
  '一行一个路径'
)
deepEq(parseEsPathLines('D:\\a\\ES.EXE'), ['D:\\a\\ES.EXE'], '大小写无关')
deepEq(parseEsPathLines('C:\\Program Files\\Everything\\Everything.exe'), [], '本体不能当命令行版')
deepEq(parseEsPathLines('C:\\a\\es.exe\r\nC:\\a\\es.exe'), ['C:\\a\\es.exe'], '去重')
deepEq(
  parseEsPathLines('C:\\Users\\u\\AppData\\Local\\Programs\\uTools\\resources\\es.exe'),
  [],
  '第三方私有副本（uTools）必须剔除'
)
deepEq(parseEsPathLines('\r\n   \r\n'), [], '空行跳过')

// ── ⑤ 参数配方 ─────────────────────────────────────────────────────────────

deepEq(
  buildEsArgs('龚翼', 'C:\\out.json'),
  [
    '-export-json',
    'C:\\out.json',
    '-utf8-bom',
    '-no-digit-grouping',
    '-size',
    '-date-modified',
    '-extension',
    '-date-format',
    '1',
    '-timeout',
    '1000',
    '-sort',
    'date-modified-descending',
    '-viewport-offset',
    '0',
    '-viewport-count',
    '100',
    '<龚翼>'
  ],
  '配方逐项固定（含 -no-digit-grouping / -date-format 1 / 默认排序 / 第一页）'
)
eq(buildEsArgs('', 'C:\\out.json'), null, '空关键词 + 全部分类 ⇒ 不启动（空查询在 es.exe 那边等于全盘）')
eq(buildEsArgs('   ', 'C:\\out.json'), null, '纯空白同理')
eq(buildEsArgs('a', ''), null, '没有落盘路径没法取数')
check(!buildEsArgs('a', 'f')?.includes('-n'), '-n 已退场（与 -viewport-count 语义重叠，同时给会误解成「先取 N 再切片」）')

const paged = buildEsArgs('a', 'f', { offset: 200, pageSize: 50, timeoutMs: 2500 })
eq(paged?.[13], '-viewport-offset', '分页参数位固定')
eq(paged?.[14], '200', 'offset 原样透传')
eq(paged?.[16], '50', 'pageSize 原样透传')
eq(paged?.[17], '<a>', '完整查询词永远是最后一个位置参数（拼完分类、分过组的那个）')
eq(paged?.[10], '2500', '内部超时可控')
eq(buildEsArgs('a', 'f', { pageSize: 0 })?.[16], '100', '非法 pageSize 回落默认页大小')
eq(buildEsArgs('a', 'f', { pageSize: 9999 })?.[16], '500', 'pageSize 上限夹紧（防一次拉爆）')
eq(buildEsArgs('a', 'f', { offset: -5 })?.[14], '0', '负偏移夹到 0')
eq(buildEsArgs('a', 'f', { offset: Number.NaN })?.[14], '0', 'NaN 偏移同 0')
eq(buildEsArgs('a', 'f', { timeoutMs: 0 })?.[10], '0', '内部超时可置 0')
eq(buildEsArgs('a', 'f', { timeoutMs: Number.NaN })?.[10], '1000', '非法超时回落默认')

// ── ⑤.1 排序 ───────────────────────────────────────────────────────────────

deepEq(
  ES_SORT_KEYS,
  ['name', 'path', 'size', 'extension', 'date-created', 'date-modified', 'date-accessed'],
  '可选排序键固定（实测 es.exe 认的七个）'
)
deepEq(ES_DEFAULT_SORT, { key: 'date-modified', order: 'descending' }, '默认排序：修改时间倒序')
eq(buildEsSortArg(undefined), 'date-modified-descending', '不传就用默认')
eq(buildEsSortArg(null), 'date-modified-descending', 'null 同理')
eq(buildEsSortArg({ key: 'name', order: 'ascending' }), 'name-ascending', '键 + 方向拼成 es.exe 的写法')
eq(buildEsSortArg({ key: 'size', order: 'descending' }), 'size-descending', '实测通过的组合')
eq(
  buildEsSortArg({ key: 'bogus' as never, order: 'ascending' }),
  'date-modified-ascending',
  '非法键回落默认键，但方向照用（脏数据不能把整条查询弄失败）'
)
eq(buildEsSortArg({ key: 'name', order: 'sideways' as never }), 'name-descending', '非法方向回落默认方向')
check(isEsSortKey('size'), '合法键认得出来')
check(!isEsSortKey('run-count'), '不在白名单里的键不认')
check(!isEsSortKey(7), '非字符串不认')

// ── ⑤.2 分类（拼进查询词，不做本地过滤）────────────────────────────────────

deepEq(ES_CATEGORY_ORDER, ['all', 'folder', 'document', 'image', 'video', 'audio', 'archive'], '分类清单固定')
check(ES_CATEGORY_ORDER[0] === 'all' && ES_CATEGORY_ORDER[1] === 'folder', '全部与文件夹排最前（左栏次序）')
check(isEsCategory('video'), '合法分类认得出来')
check(!isEsCategory('excel'), 'uTools 那种 excel/word 细分我们不做')
check(!isEsCategory(undefined), 'undefined 不认')
check(
  ES_CATEGORY_EXTENSIONS.document.includes('pdf') &&
    ES_CATEGORY_EXTENSIONS.archive.includes('7z') &&
    ES_CATEGORY_EXTENSIONS.image.includes('png'),
  '白名单里必须有常见后缀'
)

// 拼查询词：**全程不留空格**（头注 ⑪ —— 本机 Everything 把空格当「整文件名精确匹配」，
// `package ext:json` 恒 0 条），关键词按空白拆词、每词各自 `<>` 分组后紧挨着拼。
eq(buildEsQuery('报告'), '<报告>', '全部：查询词分组')
eq(buildEsQuery('报告', 'folder'), '<报告><folder:>', '文件夹走 <folder:>')
eq(buildEsQuery('报告', null), '<报告>', '没给分类当全部')
eq(buildEsQuery('报告', 'nope' as never), '<报告>', '非法分类当全部（脏数据不能把整条查询弄失败）')
eq(
  buildEsQuery('cats', 'image'),
  `<cats><ext:${ES_CATEGORY_EXTENSIONS.image.join(';')}>`,
  '图片类拼 <ext:> 白名单'
)
eq(buildEsQuery('we chat'), '<we><chat>', '多词拆开逐词分组（实测 360 条；带空格写法 0 条）')
eq(buildEsQuery('  a   b  '), '<a><b>', '多空白折叠、首尾空白丢掉')
eq(buildEsQuery('package ext:json'), '<package><ext:json>', '用户自写函数词也一并分组')
eq(buildEsQuery('big size:>10mb'), '<big>size:>10mb', '自带尖括号的词原样放行（包起来会破坏函数语法）')
check(!buildEsQuery('报告', 'folder').includes('ext:'), '文件夹分类绝不能带 ext:（实测带 ext: 恒 0 条）')
check(!buildEsQuery('报告', 'image').includes(' '), '拼出来的查询词里绝不能有空格（头注 ⑪）')
check(!buildEsQuery('we chat', 'document').includes(' '), '多词 + 分类同样不留空格')
check(buildEsQuery('', 'image').includes('<ext:'), '空关键词 + 分类 ⇒ 过滤词自己成立')
eq(buildEsQuery('', 'folder'), '<folder:>', '空关键词 + 文件夹 ⇒ 只剩 <folder:>')
eq(buildEsQuery('', 'all'), '', '空关键词 + 全部 ⇒ 空（由 buildEsArgs 拦住）')

eq(
  buildEsArgs('', 'f', { category: 'video' })?.[17],
  `<ext:${ES_CATEGORY_EXTENSIONS.video.join(';')}>`,
  '空关键词 + 视频类照样搜（分类让空查询变成有意义查询）'
)
eq(buildEsArgs('', 'f', { category: 'all' }), null, '空关键词 + 全部仍是空查询 ⇒ 拦住')

// ── ⑤.3 结果总数 ───────────────────────────────────────────────────────────

deepEq(
  buildEsCountArgs('报告'),
  ['-get-result-count', '-no-digit-grouping', '<报告>'],
  '计数参数配方固定'
)
deepEq(
  buildEsCountArgs('', 'folder'),
  ['-get-result-count', '-no-digit-grouping', '<folder:>'],
  '总数也吃分类（总数是整条查询命中多少）'
)
eq(buildEsCountArgs(''), null, '空查询不报数')
eq(buildEsCountArgs('   '), null, '纯空白同理')

eq(parseEsResultCount('2142298'), 2142298, '实测本机输出（裸数字、无千分位）')
eq(parseEsResultCount('  10382\r\n'), 10382, '带空白与 CRLF')
eq(parseEsResultCount('2,142,298'), 2142298, '别的 es.exe 版本带千分位也要吃（否则 214 万会显示成 214）')
eq(parseEsResultCount('\uFEFF0'), 0, '零结果合法')
eq(parseEsResultCount('noise\r\n42'), 42, '多行里挑出那行纯数字')
eq(parseEsResultCount(''), null, '空输出 ⇒ null（底栏就不显示，而不是显示假数）')
eq(parseEsResultCount('   '), null, '纯空白同理')
eq(parseEsResultCount('Error 8: Everything IPC not found.'), null, '失败文案不能当数字')
eq(parseEsResultCount('结果 12 条'), null, '带非数字字符的整行不认')

// ── ⑥ 导出文件解析（样本取自本机实测输出）──────────────────────────────────

const realSample = [
  '{"filename":"C:\\\\Users\\\\龚翼\\\\.nuget\\\\packages\\\\spire.pdf\\\\","size":null,"date_modified":"2023-06-08T18:01:25","extension":null}',
  '{"filename":"C:\\\\ProgramData\\\\txtav\\\\1View\\\\libraries\\\\ml-c-ser\\\\d7493\\\\images\\\\01-01.pdf","size":443024,"date_modified":"2004-03-22T21:10:58","extension":"pdf"}'
].join(',')

const hits = parseEsJson(`\uFEFF[${realSample}]`)
eq(hits.length, 2, '实测样本两条都要解析出来')

eq(hits[0].isDir, true, '尾部反斜杠 ⇒ 目录项')
eq(hits[0].name, 'spire.pdf', '目录名从全路径里切出来')
eq(hits[0].dir, 'C:\\Users\\龚翼\\.nuget\\packages', '目录项的上层目录')
eq(hits[0].size, null, '目录项的 size 是 null')
eq(hits[0].ext, '', '目录不给扩展名')
eq(hits[0].mtime, Date.parse('2023-06-08T18:01:25'), '-date-format 1 的 ISO 直接吃')
check(hits[0].fullPath.endsWith('\\'), 'fullPath 保留原始形态（含尾反斜杠）')

eq(hits[1].isDir, false, '普通文件')
eq(hits[1].name, '01-01.pdf', '文件名')
eq(hits[1].dir, 'C:\\ProgramData\\txtav\\1View\\libraries\\ml-c-ser\\d7493\\images', '所在目录')
eq(hits[1].size, 443024, '字节数')
eq(hits[1].ext, 'pdf', '扩展名')
eq(hits[1].mtime, Date.parse('2004-03-22T21:10:58'), '时间解析')

deepEq(parseEsJson('\uFEFF'), [], '空结果是 3 字节纯 BOM（实测）⇒ 必须当成空列表，不能抛')
deepEq(parseEsJson(''), [], '空文件同理')
deepEq(parseEsJson('\uFEFF[]'), [], '真的空数组也认')
deepEq(parseEsJson('\uFEFF[{"size":123}]'), [], '缺 filename 的残条丢掉，不打断整份结果')

assert.throws(() => parseEsJson('\uFEFF{"filename":"a.txt"}'), /array/, '非数组 ⇒ 抛（由调用方归 bad-output）')
assert.throws(() => parseEsJson('\uFEFF[{"filename":'), '截断的 JSON ⇒ 抛')
checks += 2

const rootHit = parseEsJson('\uFEFF[{"filename":"C:\\\\","size":null,"date_modified":null,"extension":null}]')[0]
eq(rootHit.isDir, true, '盘根算目录')
eq(rootHit.name, 'C:\\', '盘根的名字不能被切成 `C:`')
eq(rootHit.dir, '', '盘根没有上层目录')

const filetimeHit = parseEsJson('\uFEFF[{"filename":"a.txt","date_modified":134295897306531411}]')[0]
check(
  filetimeHit.mtime !== null &&
    filetimeHit.mtime > Date.parse('2020-01-01') &&
    filetimeHit.mtime < Date.parse('2030-01-01'),
  'FALLBACK：没带 -date-format 1 时的 FILETIME ticks 也要能兜到合理区间'
)

// ── ⑦ 失败分类 ─────────────────────────────────────────────────────────────

eq(classifyEsFailure(0, ''), null, '正常退出不是失败')
eq(classifyEsFailure(null, ''), 'spawn-failed', '进程没起来（spawn error）')
eq(
  classifyEsFailure(8, 'Error 8: Everything IPC not found. Please make sure Everything is running.'),
  'not-running',
  '实测的 exit 8 ⇒ Everything 没在跑'
)
eq(classifyEsFailure(1, 'Error 8: Everything IPC not found.'), 'not-running', 'stderr 同文案也能认出来')
eq(classifyEsFailure(2, 'The system cannot find the file specified.'), 'spawn-failed', '路径失效')
eq(classifyEsFailure(1, 'some other failure'), 'search-failed', '其它非零 ⇒ 通用失败')

// ── ⑧ 展示层格式化 ─────────────────────────────────────────────────────────

eq(formatHitSize(null), '', '目录（无大小）返回空串')
eq(formatHitSize(0), '0 B', '零字节')
eq(formatHitSize(512), '512 B', '小于 1 KB 不打小数')
eq(formatHitSize(1024), '1.0 KB', '1 KB')
eq(formatHitSize(443024), '433 KB', '实测样本的大小变成整数 KB')
eq(formatHitSize(1048576), '1.0 MB', '1 MB')
eq(formatHitSize(150 * 1024), '150 KB', '上百之后不再留小数')
eq(formatHitSize(5 * 1024 * 1024 * 1024), '5.0 GB', 'GB 档')

eq(formatHitTime(null), '', '没有时间返回空串')
eq(formatHitTime(Date.parse('2023-06-08T18:01:25')), '2023-06-08 18:01', '本地时间到分钟')
eq(
  formatHitTime(new Date(2023, 0, 5, 9, 7, 30).getTime()),
  '2023-01-05 09:07',
  '个位数月/日/时/分要补零'
)

console.log(`es-search checks passed (${checks} assertions).`)
