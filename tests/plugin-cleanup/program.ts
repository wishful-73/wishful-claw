/*
 * S-244 回归：插件 id → 分区名 / 分区目录名。
 *
 * 这两条字符串决定「卸载时删什么」，所以断言的重点不在「对不对」，而在
 * **什么情况下必须拒绝**：路径穿越、绝对路径、长度越界、非法字符，一律 null。
 * 拒绝就等于不删 —— 宁可留下垃圾，也不能删到主程序的默认分区。
 */

import {
  PLUGIN_PARTITION_DIR_PREFIX,
  PLUGIN_PARTITION_PREFIX,
  isValidExtensionId,
  pluginPartitionDirName,
  pluginPartitionName
} from '../../src/main/plugins/plugin-cleanup-rules'

let assertions = 0
function assert(condition: boolean, message: string): void {
  assertions += 1
  if (!condition) throw new Error(message)
}

function checkAcceptedIds(): void {
  assert(PLUGIN_PARTITION_PREFIX === 'persist:plugin-', 'partition prefix must match the window creator')
  assert(PLUGIN_PARTITION_DIR_PREFIX === 'plugin-', 'dir prefix is the persist-less form')

  assert(pluginPartitionName('asr-helper') === 'persist:plugin-asr-helper', 'dash ids are accepted')
  assert(pluginPartitionName('demo_plugin') === 'persist:plugin-demo_plugin', 'underscore ids are accepted')
  assert(pluginPartitionName('a1') === 'persist:plugin-a1', 'two-char ids are accepted')
  assert(pluginPartitionName('  asr-helper  ') === 'persist:plugin-asr-helper', 'whitespace is trimmed')
  assert(pluginPartitionName('ASR-Helper') === 'persist:plugin-asr-helper', 'ids are lowercased like the backend')

  const longest = `a${'b'.repeat(63)}`
  assert(isValidExtensionId(longest), '64-char ids are the upper bound')
  assert(pluginPartitionName(longest) === `${PLUGIN_PARTITION_PREFIX}${longest}`, '64-char id keeps its partition')

  assert(pluginPartitionDirName('asr-helper') === 'plugin-asr-helper', 'dir name is the persist-less form')
  assert(pluginPartitionDirName('ASR-Helper') === 'plugin-asr-helper', 'dir name is lowercased too')
}

function checkRejections(): void {
  const rejected = [
    '',
    '   ',
    'a',
    'a'.repeat(65),
    '../evil',
    '..',
    '.',
    'nested/id',
    'nested\\id',
    '/absolute',
    'C:\\temp',
    'has space',
    'has.dot',
    '-leading-dash',
    '_leading-underscore',
    'ünïcode',
    'semi;colon',
    'plugin-../../x'
  ]
  for (const id of rejected) {
    assert(!isValidExtensionId(id), `id must be rejected: ${JSON.stringify(id)}`)
    assert(pluginPartitionName(id) === null, `partition name must be null for: ${JSON.stringify(id)}`)
    assert(pluginPartitionDirName(id) === null, `dir name must be null for: ${JSON.stringify(id)}`)
  }

  assert(pluginPartitionName(null) === null, 'null id yields null')
  assert(pluginPartitionName(undefined) === null, 'undefined id yields null')
  assert(pluginPartitionDirName(null) === null, 'null id yields no dir')
}

function checkNoTraversalInOutput(): void {
  // 只要被接受，产物里就绝不允许出现分隔符或上跳 —— 这是「删除目标」的最后一道门
  for (const id of ['asr-helper', 'demo_plugin', 'a1', 'x'.repeat(64)]) {
    const partition = pluginPartitionName(id)
    const dir = pluginPartitionDirName(id)
    assert(partition !== null && dir !== null, `accepted id must produce both names: ${id}`)
    for (const value of [partition as string, dir as string]) {
      assert(!value.includes('..'), `no parent traversal in output: ${value}`)
      assert(!value.includes('/'), `no forward slash in output: ${value}`)
      assert(!value.includes('\\'), `no backslash in output: ${value}`)
    }
  }
}

checkAcceptedIds()
checkRejections()
checkNoTraversalInOutput()
console.log(`plugin-cleanup assertions passed: ${assertions}`)
