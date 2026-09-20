import { composePastedText } from '@renderer/components/chat/InputArea/use-composer-interactions'

/**
 * S-100: composer Ctrl+V read only `text/plain` and bailed out (without preventDefault) when
 * it was empty, so a clipboard carrying only HTML looked like "Ctrl+V does nothing". These
 * checks pin the payload picker that replaced it.
 *
 * `htmlToText` is injected because node has no DOMParser — that is why the function under
 * test takes it as a parameter instead of reaching for the global.
 */

let passed = 0

function assert(condition: boolean, name: string): void {
  if (!condition) {
    console.error(`FAIL: ${name}`)
    process.exit(1)
  }
  passed += 1
  console.log(`PASS: ${name}`)
}

function assertEqual<T>(expected: T, actual: T, name: string): void {
  assert(
    Object.is(expected, actual),
    `${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
  )
}

const mustNotBeCalled = (): string => {
  throw new Error('htmlToText must not be consulted when plain text is present')
}

assertEqual('', composePastedText('', ''), 'empty plain + empty html yields empty')
assertEqual('', composePastedText(null, null), 'null flavours yield empty')
assertEqual('', composePastedText(undefined, ''), 'undefined plain + empty html yields empty')

assertEqual(
  'from plain',
  composePastedText('from plain', '<b>ignored</b>', mustNotBeCalled),
  'plain text wins over html and never consults the html flavour'
)
assertEqual(
  'from plain',
  composePastedText('from plain', ''),
  'plain text with no html is returned as-is'
)

const htmlFlavour = '<ul><li>alpha</li><li>beta</li></ul>'
assertEqual(
  `stub:${htmlFlavour}`,
  composePastedText('', htmlFlavour, (value) => `stub:${value}`),
  'html-only clipboard falls back to the html flavour'
)
assert(
  composePastedText('', htmlFlavour, (value) => `stub:${value}`).length > 0,
  'the html fallback yields insertable text (this is the S-100 fix)'
)

console.log(`Paste text checks passed: ${passed}`)
