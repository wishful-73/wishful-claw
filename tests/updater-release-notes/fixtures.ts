/**
 * Fixtures for the release-notes sanitizer.
 *
 * `v0225AtomHtml` is the shape electron-updater actually delivers: GitHub renders the
 * Release body to HTML for the Atom feed, which is why the old <pre> showed literal tags.
 */

export const V0225_ATOM_HTML = `<h2>v0.2.25 · 微信渠道全局会话闭环</h2>
<p>本版本完成微信渠道从扫码绑定到全局会话复用的基础闭环：</p>
<ul>
<li>扫码绑定成功后自动启用并启动微信渠道；应用重启后自动恢复已绑定且启用的渠道。</li>
<li>修复渠道路由首次创建未持久化的问题；同一渠道路由后续消息复用同一个全局会话。</li>
<li>增加渠道专用 Agent 提示词与工具可用性策略，并将 AskUser 降级为渠道内普通文本交互。</li>
</ul>
<h3>验证</h3>
<ul>
<li>TypeScript web/node/root 三套配置：通过</li>
<li>C# solution：0 警告、0 错误</li>
</ul>
<h3>已知边界</h3>
<p>渠道长期无人值守的权限边界仍记录在后续迭代中，详见 <code>docs/reviews/review-13-iter25-release-prep.md</code>。</p>`

export const V0225_MARKDOWN = `## v0.2.25 · 微信渠道全局会话闭环

本版本完成微信渠道从扫码绑定到全局会话复用的基础闭环：

- 扫码绑定成功后自动启用并启动微信渠道
- 修复渠道路由首次创建未持久化的问题

### 验证

1. TypeScript web/node/root 三套配置：通过
2. C# solution：0 警告、0 错误

详见 \`docs/reviews/review-13-iter25-release-prep.md\`。
完整说明见 [仓库 Release 页面](https://github.com/wishful-73/wishful-claw/releases/tag/v0.2.25)。`

export const PLAIN_TEXT_NOTES = `v0.2.25 修复了若干渠道会话问题。
第二行是普通文本，没有任何标记。`

export const EMPTY_NOTES = '   \n\t  '

/** Every entry must render without producing its dangerous node, attribute or protocol. */
export const MALICIOUS_FIXTURES: ReadonlyArray<{ name: string; input: string }> = [
  { name: 'script-subtree', input: '<script>alert(1)</script><p>safe</p>' },
  { name: 'style-subtree', input: '<style>body{display:none}</style><p>safe</p>' },
  { name: 'svg-script', input: '<svg><script>alert(1)</script></svg><p>safe</p>' },
  { name: 'math-script', input: '<math><mtext><script>alert(1)</script></mtext></math>' },
  { name: 'iframe', input: '<iframe src="https://evil.example.com"></iframe><p>safe</p>' },
  { name: 'object-embed', input: '<object data="x"></object><embed src="y"><p>safe</p>' },
  { name: 'form-input', input: '<form action="https://evil.example.com"><input name="x"></form>' },
  { name: 'img-onerror', input: '<img src="x" onerror="alert(1)"><p>safe</p>' },
  { name: 'markdown-image', input: '![x](https://evil.example.com/a.png)' },
  { name: 'p-event-handler', input: '<p onmouseover="alert(1)">hover me</p>' },
  { name: 'h2-onclick', input: '<h2 onclick="alert(1)">Title</h2>' },
  { name: 'div-inline-style', input: '<div style="background:url(javascript:alert(1))">text</div>' },
  { name: 'a-javascript', input: '<a href="javascript:alert(1)">click</a>' },
  { name: 'a-javascript-case', input: '<a href="JaVaScRiPt:alert(1)">click</a>' },
  { name: 'a-javascript-newline', input: '<a href="java\nscript:alert(1)">click</a>' },
  { name: 'a-javascript-tab', input: '<a href="java\tscript:alert(1)">click</a>' },
  { name: 'a-javascript-entity', input: '<a href="javascript&colon;alert(1)">click</a>' },
  { name: 'a-javascript-nul', input: '<a href="jav\u0000ascript:alert(1)">click</a>' },
  { name: 'a-data-html', input: '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>' },
  { name: 'a-blob', input: '<a href="blob:https://example.com/00000000-0000-0000-0000-000000000000">click</a>' },
  { name: 'a-vbscript', input: '<a href="vbscript:msgbox(1)">click</a>' },
  { name: 'a-file', input: '<a href="file:///C:/Windows/system32">click</a>' },
  { name: 'a-protocol-relative', input: '<a href="//evil.example.com/x">click</a>' },
  { name: 'a-relative', input: '<a href="/relative/path">click</a>' },
  { name: 'a-spoofed-target-rel', input: '<a href="https://ok.example.com" target="_self" rel="opener">click</a>' },
  { name: 'a-onclick', input: '<a href="https://ok.example.com" onclick="alert(1)">click</a>' },
  { name: 'markdown-link-javascript', input: '[click](javascript:alert(1))' },
  { name: 'markdown-link-data', input: '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)' },
  { name: 'li-outside-list', input: '<li>orphan</li>' },
  { name: 'unknown-element', input: '<my-widget data-x="1">unknown</my-widget>' }
]

/**
 * A Markdown autolink whose destination is a script URL. Sanitizing degrades it to inert
 * text, so the URL string legitimately stays readable — asserted separately as "never an
 * <a>" rather than as a forbidden-string case.
 */
export const AUTO_LINK_FIXTURE = {
  name: 'markdown-autolink-javascript',
  input: '<javascript:alert(1)>',
  text: 'javascript:alert(1)'
}

/** Fragments that must survive sanitizing — the notes still have to be readable. */
export const MUST_SURVIVE_TEXT: ReadonlyArray<{ name: string; input: string; text: string }> = [
  { name: 'p-event-handler', input: '<p onmouseover="alert(1)">hover me</p>', text: 'hover me' },
  { name: 'h2-onclick', input: '<h2 onclick="alert(1)">Title</h2>', text: 'Title' },
  { name: 'unsafe-link-text', input: '<a href="javascript:alert(1)">click</a>', text: 'click' },
  { name: 'div-inline-style', input: '<div style="color:red">text</div>', text: 'text' }
]

export const URL_CASES: ReadonlyArray<{ name: string; input: unknown; expected: string | null }> = [
  { name: 'https', input: 'https://example.com/a?b=1#c', expected: 'https://example.com/a?b=1#c' },
  { name: 'http', input: 'http://example.com', expected: 'http://example.com/' },
  { name: 'uppercase-scheme', input: 'HTTPS://Example.COM/Path', expected: 'https://example.com/Path' },
  { name: 'surrounding-whitespace', input: '  \n https://example.com/x \t ', expected: 'https://example.com/x' },
  { name: 'port-and-query', input: 'https://example.com:8443/p?q=1', expected: 'https://example.com:8443/p?q=1' },
  { name: 'javascript', input: 'javascript:alert(1)', expected: null },
  { name: 'javascript-case', input: 'JaVaScRiPt:alert(1)', expected: null },
  { name: 'javascript-newline', input: 'java\nscript:alert(1)', expected: null },
  { name: 'javascript-tab', input: 'java\tscript:alert(1)', expected: null },
  { name: 'javascript-carriage-return', input: 'java\rscript:alert(1)', expected: null },
  { name: 'javascript-nul', input: 'jav\u0000ascript:alert(1)', expected: null },
  { name: 'javascript-del', input: 'jav\u007Fascript:alert(1)', expected: null },
  { name: 'data-html', input: 'data:text/html,<script>alert(1)</script>', expected: null },
  { name: 'data-image', input: 'data:image/png;base64,iVBORw0KGgo=', expected: null },
  { name: 'blob', input: 'blob:https://example.com/abc', expected: null },
  { name: 'vbscript', input: 'vbscript:msgbox(1)', expected: null },
  { name: 'file', input: 'file:///C:/Windows/system32', expected: null },
  { name: 'protocol-relative', input: '//evil.example.com/x', expected: null },
  { name: 'absolute-path', input: '/relative/path', expected: null },
  { name: 'bare-host', input: 'example.com/x', expected: null },
  { name: 'empty', input: '', expected: null },
  { name: 'whitespace-only', input: '   \n\t ', expected: null },
  { name: 'control-chars-only', input: '\u0000\u0001\u007F', expected: null },
  { name: 'undefined', input: undefined, expected: null },
  { name: 'null', input: null, expected: null },
  { name: 'number', input: 12345, expected: null },
  { name: 'object', input: { toString: () => 'https://example.com' }, expected: null }
]
