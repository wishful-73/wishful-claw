/**
 * S-155 —— 快捷启动「文件搜索」的 es.exe 取数层（纯函数）。
 *
 * 存在理由：S-151 只把关键词投给 Everything 自己的窗口，结果长什么样我们管不着（原生界面丑）。
 * S-155 改成**我们自己取数、自己渲染**，取数统一走官方命令行版 `es.exe` —— 挂到 Everything
 * 已经在跑的实例上，让它把结果导出成 JSON，我们解析成列表。
 *
 * 为什么是 es.exe，而不是自编 native addon / Everything HTTP server（三条路的取证见 S-155.md §0.2）：
 *   - 117 KB 单文件、官方分发，零 native 维护、不占端口；
 *   - 不改用户的 Anything 设置，复用用户自己的 Everything 与它已建好的索引 —— 我们不额外占磁盘。
 *
 * 本机实测钉死的五条（ES 1.1.0.38 × Everything 1.4.1.1032，2026-09-28）：
 *   ① `-date-format 1` 让 `date_modified` 直接出**本地时间 ISO 串**（`2023-06-08T18:01:25`，
 *      无时区、无毫秒）⇒ 不必去解 FILETIME ticks（那是 1.4e17 量级，超过 JS 安全整数会丢精度）；
 *   ② **空结果时输出文件只有 3 字节 BOM、连 `[]` 都没有**，且 exit code 仍是 0
 *      ⇒ 解析层必须把「剥 BOM 后为空」当成空结果，不能让 JSON.parse 抛出去；
 *   ③ **Everything 没在跑时 exit code = 8**（`Error 8: Everything IPC not found`），
 *      **并且输出文件照样会被创建**（内容为空）⇒ 失败分类必须吃退出码，不能只看文件在不在；
 *   ④ 目录项 `filename` **自带尾部反斜杠**、`size` / `extension` 为 `null` ⇒ 目录判定只看分隔符；
 *   ⑤ es.exe 的版本信息是 `ProductName=es` / `FileDescription=Everything Command Line Interface`
 *      ⇒ 版本校验不能只认 `Everything`（S-151 的 `isEverythingVersionInfoHit` 会误杀）。
 *
 * 分页 / 排序 / 总数五条（2026-09-29 实测，S-155 调整⑤ 文件搜索独立窗要用的能力）：
 *   ⑥ `-viewport-offset <n>` + `-viewport-count <k>` **真的在分页** —— offset 0 与 offset 5 拿回的
 *      是两批不重叠的结果，所以滚动续取不必把整份结果拉进内存；
 *   ⑦ `-sort <key>[-ascending|-descending]`，key ∈ name / path / size / extension /
 *      date-created / date-modified / date-accessed。实测 `name-ascending`、`size-descending`、
 *      `date-modified-descending` 均生效；
 *   ⑧ `-get-result-count` 把**裸数字**写 stdout（实测 2142298，无千分位逗号，带不带
 *      `-no-digit-grouping` 都一样）⇒ 解析仍要容忍逗号 —— 用户自己那份 es.exe 版本未必同款；
 *   ⑨ `/ad`（只要文件夹）**不能和 `ext:` 同用**：实测 `"/ad ext:pdf"` 恒为 0 条（是先按扩展名
 *      筛出文件、再要求它是目录，必然空集）⇒ 文件类的过滤与 `folder` 互斥，拼查询词时二选一；
 *   ⑩ **空查询等于全盘**（实测 `-get-result-count` 不带关键词 → 2142298）⇒ 取数层必须继续拦空
 *      查询，不能指望 es.exe 自己报错。
 *   ⑪ **空格在这台机器上不是 AND，是「整文件名精确匹配」**（2026-09-29 实测）：`we chat` /
 *      `package json` / `node modules` / `package ext:json` **恒 0 条**，而完整目录名 `WeChat Files`
 *      才有命中 ⇒ 「关键词 + 分类」这种带空格的标准写法在老大本机必然搜不到（这就是「选了文档分类
 *      反而 0 条」的根因）。官方文档说空格是 AND，属本机 Everything 设置偏离，所以**不赌用户环境**：
 *      拼查询词时全程不留空格，关键词按空白拆词、每个词各自 `<>` 分组后紧挨着拼（见 `buildEsQuery`）。
 *      实测 `<package><ext:json>` = 11920（同写法带空格 = 0）、`<WeChat><folder:>` = 47（带空格 = 0）。
 *
 * 本模块只做解析与判定，不碰文件系统、不开进程；存在性由调用方注入，便于回归套件钉死顺序。
 *
 * 文件组织（S-249 拆分，对外导出与前缀路径全部不变）：
 *   - `es-search/types.ts`     —— 类型与常量、分类白名单（同质数据）
 *   - `es-search/query.ts`     —— 查询词与命令行参数
 *   - `es-search/parse.ts`     —— 输出解析与失败分类
 *   - `es-search/discovery.ts` —— es.exe 的发现与挑选
 *   - `es-search/format.ts`    —— 展示格式化
 */

export * from './es-search/types'
export * from './es-search/query'
export * from './es-search/parse'
export * from './es-search/discovery'
export * from './es-search/format'
