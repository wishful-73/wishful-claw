import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import {
  normalizeReleaseNotesUrl,
  safeReleaseNotesLinkProps,
  RELEASE_NOTES_COMPONENTS,
  RELEASE_NOTES_REHYPE_PLUGINS,
  RELEASE_NOTES_REMARK_PLUGINS,
  RELEASE_NOTES_SANITIZE_SCHEMA,
  RELEASE_NOTES_LINK_REL,
  RELEASE_NOTES_LINK_TARGET
} from '../../src/renderer/src/components/updater/release-notes-sanitizer'
import {
  AUTO_LINK_FIXTURE,
  EMPTY_NOTES,
  MALICIOUS_FIXTURES,
  MUST_SURVIVE_TEXT,
  PLAIN_TEXT_NOTES,
  URL_CASES,
  V0225_ATOM_HTML,
  V0225_MARKDOWN
} from './fixtures'

let checks = 0

function check(description: string, run: () => void): void {
  run()
  checks++
}

function renderNotes(notes: string): string {
  return renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: RELEASE_NOTES_REMARK_PLUGINS,
        rehypePlugins: RELEASE_NOTES_REHYPE_PLUGINS,
        components: RELEASE_NOTES_COMPONENTS
      },
      notes
    )
  )
}

const FORBIDDEN_TAGS = [
  'script',
  'style',
  'svg',
  'math',
  'iframe',
  'frame',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'img',
  'video',
  'audio',
  'source',
  'link',
  'meta',
  'base',
  'div',
  'table',
  'del',
  'ins',
  'q',
  'section',
  'summary',
  'details',
  'my-widget'
]

const FORBIDDEN_PROTOCOLS = ['javascript:', 'data:', 'blob:', 'vbscript:', 'file:', 'about:']

/** Attributes that could carry a URL; none of them may survive except a[href]. */
const URL_BEARING_ATTRIBUTES = [
  'src',
  'action',
  'formaction',
  'xlink:href',
  'data',
  'poster',
  'cite',
  'longdesc',
  'background',
  'srcset'
]

function anchorTags(markup: string): string[] {
  return [...markup.matchAll(/<a\b[^>]*>/g)].map((match) => match[0])
}

function tagAttributes(markup: string): Array<{ tag: string; name: string; value: string }> {
  const collected: Array<{ tag: string; name: string; value: string }> = []
  for (const tagMatch of markup.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
    for (const attrMatch of tagMatch[2].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g)) {
      collected.push({
        tag: tagMatch[1],
        name: attrMatch[1].toLowerCase(),
        value: attrMatch[2]
      })
    }
  }
  return collected
}

// ── Schema shape ──────────────────────────────────────────────────────────────

check('schema only allows the documented tags', () => {
  assert.deepEqual(RELEASE_NOTES_SANITIZE_SCHEMA.tagNames, [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'ul', 'ol', 'li',
    'strong', 'em', 'code', 'pre', 'blockquote', 'a'
  ])
})

check('schema only allows a[href]', () => {
  assert.deepEqual(RELEASE_NOTES_SANITIZE_SCHEMA.attributes, { a: ['href'] })
})

check('schema only allows absolute http/https', () => {
  assert.deepEqual(RELEASE_NOTES_SANITIZE_SCHEMA.protocols, { href: ['http', 'https'] })
})

check('schema strips dangerous subtrees instead of keeping their text', () => {
  for (const tag of ['script', 'style', 'svg', 'math', 'iframe', 'object', 'embed', 'form', 'img']) {
    assert.ok(RELEASE_NOTES_SANITIZE_SCHEMA.strip?.includes(tag), `${tag} must be stripped`)
  }
})

// ── URL normalization ─────────────────────────────────────────────────────────

for (const testCase of URL_CASES) {
  check(`normalizeReleaseNotesUrl: ${testCase.name}`, () => {
    assert.equal(normalizeReleaseNotesUrl(testCase.input), testCase.expected)
  })
}

check('safeReleaseNotesLinkProps forces target/rel on a safe href', () => {
  assert.deepEqual(safeReleaseNotesLinkProps('https://example.com/x'), {
    href: 'https://example.com/x',
    target: RELEASE_NOTES_LINK_TARGET,
    rel: RELEASE_NOTES_LINK_REL
  })
  assert.equal(RELEASE_NOTES_LINK_TARGET, '_blank')
  assert.equal(RELEASE_NOTES_LINK_REL, 'noopener noreferrer')
})

check('safeReleaseNotesLinkProps returns null for an unsafe href', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.example.com', '/rel', '']) {
    assert.equal(safeReleaseNotesLinkProps(href), null, href)
  }
})

// ── Malicious fixtures ────────────────────────────────────────────────────────

for (const fixture of MALICIOUS_FIXTURES) {
  check(`malicious fixture renders safe: ${fixture.name}`, () => {
    const markup = renderNotes(fixture.input)
    const lower = markup.toLowerCase()

    for (const tag of FORBIDDEN_TAGS) {
      assert.ok(!lower.includes(`<${tag}`), `${fixture.name}: <${tag}> must not render\n${markup}`)
    }
    assert.ok(!/\son[a-z]+\s*=/i.test(markup), `${fixture.name}: event attribute must not appear\n${markup}`)
    assert.ok(!lower.includes('style='), `${fixture.name}: style attribute must not appear\n${markup}`)
    assert.ok(!lower.includes('alert('), `${fixture.name}: script source must not leak as text\n${markup}`)

    // An unsafe href degrades to inert text, so the URL string may stay readable. The
    // security property lives in the attributes: no URL-bearing attribute survives at all,
    // and every href that does survive is an absolute http(s) address.
    for (const attribute of tagAttributes(markup)) {
      assert.ok(
        !URL_BEARING_ATTRIBUTES.includes(attribute.name),
        `${fixture.name}: ${attribute.name}= must not render\n${markup}`
      )
      const value = attribute.value.toLowerCase()
      for (const protocol of FORBIDDEN_PROTOCOLS) {
        assert.ok(
          !value.includes(protocol),
          `${fixture.name}: ${attribute.name}= must not carry ${protocol}\n${markup}`
        )
      }
      if (attribute.name === 'href') {
        assert.match(attribute.value, /^https?:\/\//, `${fixture.name}: ${markup}`)
      }
    }
  })
}

check('a script-URL autolink degrades to inert text, never an anchor', () => {
  const markup = renderNotes(AUTO_LINK_FIXTURE.input)
  assert.equal(anchorTags(markup).length, 0, markup)
  assert.ok(!markup.toLowerCase().includes('<a'), markup)
  assert.ok(markup.includes(AUTO_LINK_FIXTURE.text), markup)
  assert.ok(markup.includes('<span'), markup)
})

check('every rendered anchor carries our target/rel and a safe href', () => {
  const inputs = [
    ...MALICIOUS_FIXTURES.map((fixture) => fixture.input),
    V0225_ATOM_HTML,
    V0225_MARKDOWN,
    '<a href="https://ok.example.com">ok</a>',
    '<a href="https://ok.example.com" target="_self" rel="opener">spoofed</a>'
  ]

  let anchors = 0
  for (const input of inputs) {
    for (const anchor of anchorTags(renderNotes(input))) {
      anchors++
      assert.match(anchor, /target="_blank"/, anchor)
      assert.match(anchor, /rel="noopener noreferrer"/, anchor)
      assert.match(anchor, /href="https?:\/\//, anchor)
      assert.ok(!/\son[a-z]+\s*=/i.test(anchor), anchor)
    }
  }
  assert.ok(anchors >= 3, `expected several safe anchors, saw ${anchors}`)
})

check('readable text survives sanitizing', () => {
  for (const fixture of MUST_SURVIVE_TEXT) {
    const markup = renderNotes(fixture.input)
    assert.ok(markup.includes(fixture.text), `${fixture.name}: "${fixture.text}" lost\n${markup}`)
  }
})

// ── Real release notes ────────────────────────────────────────────────────────

check('v0.2.25 Atom HTML renders as elements, not as escaped tag text', () => {
  const markup = renderNotes(V0225_ATOM_HTML)
  assert.ok(markup.includes('<h2'), markup)
  assert.ok(markup.includes('<h3'), markup)
  assert.ok(markup.includes('<ul'), markup)
  assert.ok(markup.includes('<li'), markup)
  assert.ok(markup.includes('<code'), markup)
  assert.ok(!markup.includes('&lt;h2&gt;'), 'literal <h2> tag text must not be shown')
  assert.ok(!markup.includes('&lt;li&gt;'), 'literal <li> tag text must not be shown')
  assert.ok(markup.includes('微信渠道全局会话闭环'), markup)
  assert.ok(markup.includes('docs/reviews/review-13-iter25-release-prep.md'), markup)
})

check('v0.2.25 Markdown renders headings, both list kinds and a safe link', () => {
  const markup = renderNotes(V0225_MARKDOWN)
  assert.ok(markup.includes('<h2'), markup)
  assert.ok(markup.includes('<h3'), markup)
  assert.ok(markup.includes('<ul'), markup)
  assert.ok(markup.includes('<ol'), markup)
  assert.ok(markup.includes('<code'), markup)
  assert.equal(anchorTags(markup).length, 1, markup)
  assert.ok(markup.includes('href="https://github.com/wishful-73/wishful-claw/releases/tag/v0.2.25"'), markup)
})

check('plain text notes stay readable inside a paragraph', () => {
  const markup = renderNotes(PLAIN_TEXT_NOTES)
  assert.ok(markup.includes('<p'), markup)
  assert.ok(markup.includes('v0.2.25 修复了若干渠道会话问题。'), markup)
  assert.ok(markup.includes('第二行是普通文本，没有任何标记。'), markup)
})

check('empty notes hit the component empty-state guard', () => {
  assert.equal(EMPTY_NOTES.trim(), '')
  const markup = renderNotes(EMPTY_NOTES)
  assert.ok(!markup.includes('<h'), markup)
  assert.ok(!markup.includes('<ul'), markup)
})

check('an orphan <li> outside a list is dropped but its text kept', () => {
  const markup = renderNotes('<li>orphan</li>')
  assert.ok(!markup.includes('<li'), markup)
  assert.ok(markup.includes('orphan'), markup)
})

console.log(`updater release notes regression passed (${checks} checks)`)
