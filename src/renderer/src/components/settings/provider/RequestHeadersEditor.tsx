import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

/**
 * Headers the HTTP stack owns. Overriding any of these would break auth,
 * content negotiation or message framing, so they are rejected in the editor
 * instead of being accepted here and silently dropped downstream.
 */
const RESERVED_HEADERS = [
  'authorization',
  'content-type',
  'content-length',
  'host',
  'accept-encoding',
  'transfer-encoding',
  'connection'
]

/** RFC 7230 token (1*tchar) — no whitespace and no separators. */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

interface HeaderRow {
  id: string
  name: string
  value: string
}

const toRows = (headers: Record<string, string> | undefined): HeaderRow[] =>
  Object.entries(headers ?? {}).map(([name, value], index) => ({
    id: `h${index}`,
    name,
    value
  }))

/** Rows that pass validation, as the object the store persists. */
const toHeaders = (rows: HeaderRow[], errors: Record<string, string>): Record<string, string> => {
  const headers: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (name && !errors[row.id]) headers[name] = row.value
  }
  return headers
}

const sameHeaders = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => b[key] === a[key])
}

/** 名称与值都空着的新增行 —— 保存时丢掉，免得留一行永远显示不出来的空壳。 */
const isEmptyRow = (row: HeaderRow): boolean => !row.name.trim() && !row.value.trim()

export interface RequestHeadersEditorProps {
  headers: Record<string, string> | undefined
  onChange: (headers: Record<string, string>) => void
}

/**
 * Key/value editor for extra provider request headers.
 *
 * Two states, unlike every other field in the provider panel (S-317): this is a
 * *group* of structured entries, and a half-applied group is worse than a
 * delayed one — one wrong `User-Agent` is enough to get 403 from a provider.
 * So edits stay in a local draft and only reach the store on 保存.
 *
 * Invalid rows block the save as a whole instead of being skipped while the rest
 * are committed, which is what the previous one-keystroke-per-save version did:
 * the user saw a red row and assumed nothing was persisted.
 *
 * 2026-11-05（老大口径）：每行**默认是纯文字**，不再是常驻输入框 —— 双击这一行、
 * 或点行尾的铅笔按钮才变输入框，保存/取消后整组回到纯文字。「编辑形态」与「已保存
 * 形态」在视觉上必须能一眼分开，否则用户不知道刚才那下到底存没存。
 *
 * Remount it with `key={provider.id}` when the edited provider changes — the
 * draft is intentionally discarded then.
 */
export function RequestHeadersEditor({
  headers,
  onChange
}: RequestHeadersEditorProps): React.JSX.Element {
  const { t: ts } = useTranslation('settings')
  const [rows, setRows] = useState<HeaderRow[]>(() => toRows(headers))
  const [saved, setSaved] = useState<Record<string, string>>(() => ({ ...(headers ?? {}) }))
  /** 正在编辑的那些行。空集合 = 整组都是纯文字（默认形态）。 */
  const [editingIds, setEditingIds] = useState<Set<string>>(() => new Set<string>())
  const nextId = useRef(rows.length)
  const isEditingAny = editingIds.size > 0

  const validate = (row: HeaderRow, all: HeaderRow[]): string | null => {
    const name = row.name.trim()
    if (!name) {
      // 完全空的新行不报错（刚点「添加」就是这个状态）；有值没名称才拦。
      if (!row.value.trim()) return null
      return ts('provider.config.requestHeaders.nameRequired', {
        defaultValue: '请填写请求头名称'
      })
    }
    if (!HEADER_NAME_PATTERN.test(name)) {
      return ts('provider.config.requestHeaders.invalidName', {
        defaultValue: '请求头名称只能包含字母、数字与 ! # $ % & \' * + . ^ _ ` | ~ -'
      })
    }
    if (RESERVED_HEADERS.includes(name.toLowerCase())) {
      return ts('provider.config.requestHeaders.reserved', {
        name,
        defaultValue: '{{name}} 由客户端托管，不能覆盖'
      })
    }
    if (all.some((other) => other.id !== row.id && other.name.trim().toLowerCase() === name.toLowerCase())) {
      return ts('provider.config.requestHeaders.duplicate', { defaultValue: '请求头名称重复' })
    }
    return null
  }

  // Derived rather than stored: a row can be fixed without an extra commit, and
  // there is no window where the error map lags behind the rows.
  const errors: Record<string, string> = {}
  for (const row of rows) {
    const error = validate(row, rows)
    if (error) errors[row.id] = error
  }

  const draft = toHeaders(rows, errors)
  const hasErrors = Object.keys(errors).length > 0
  const dirty = !sameHeaders(draft, saved)

  const patchRow = (id: string, patch: Partial<HeaderRow>): void => {
    setRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const startEdit = (id: string): void => {
    setEditingIds((current) => new Set(current).add(id))
  }

  const stopEditingAll = (): void => {
    setEditingIds(new Set<string>())
  }

  const addRow = (): void => {
    nextId.current += 1
    const id = `h${nextId.current}`
    setRows([...rows, { id, name: '', value: '' }])
    // 新行没有内容，纯文字形态什么也显示不出来 ⇒ 直接给输入框。
    startEdit(id)
  }

  const removeRow = (id: string): void => {
    setRows(rows.filter((row) => row.id !== id))
    setEditingIds((current) => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  const handleSave = (): void => {
    if (hasErrors || !dirty) return
    onChange(draft)
    setSaved(draft)
    setRows(rows.filter((row) => !isEmptyRow(row)))
    stopEditingAll()
    toast.success(
      ts('provider.config.requestHeaders.saved', { defaultValue: '请求头已保存' })
    )
  }

  const handleCancel = (): void => {
    setRows(toRows(saved))
    stopEditingAll()
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {ts('provider.config.requestHeaders.empty', { defaultValue: '尚未添加额外请求头' })}
        </p>
      ) : null}

      <div className="space-y-1.5">
        {rows.map((row) => {
          const editing = editingIds.has(row.id)
          return (
            <div key={row.id}>
              <div className="flex items-center gap-1.5">
                {editing ? (
                  <>
                    <Input
                      value={row.name}
                      onChange={(e) => patchRow(row.id, { name: e.target.value })}
                      placeholder={ts('provider.config.requestHeaders.namePlaceholder', {
                        defaultValue: '请求头名称'
                      })}
                      className="h-7 w-2/5 text-xs"
                      aria-invalid={errors[row.id] ? true : undefined}
                      autoFocus
                    />
                    <Input
                      value={row.value}
                      onChange={(e) => patchRow(row.id, { value: e.target.value })}
                      placeholder={ts('provider.config.requestHeaders.valuePlaceholder', {
                        defaultValue: '值'
                      })}
                      className="h-7 flex-1 text-xs"
                    />
                  </>
                ) : (
                  // 已保存形态：纯文字。双击整行或点右侧铅笔才进编辑。
                  <div
                    role="button"
                    tabIndex={0}
                    title={ts('provider.config.requestHeaders.editHint', {
                      defaultValue: '双击编辑'
                    })}
                    onDoubleClick={() => startEdit(row.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      startEdit(row.id)
                    }}
                    className="flex h-7 min-w-0 flex-1 cursor-text items-center gap-2 rounded px-1.5 text-xs hover:bg-muted/50"
                  >
                    <span className="shrink-0 font-medium">{row.name}</span>
                    <span className="truncate text-muted-foreground">
                      {row.value ||
                        ts('provider.config.requestHeaders.emptyValue', { defaultValue: '（空）' })}
                    </span>
                  </div>
                )}
                {editing ? (
                  // 占位，让删除按钮在两种形态之间不横移。
                  <span className="size-7 shrink-0" aria-hidden />
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground"
                    onClick={() => startEdit(row.id)}
                    title={ts('provider.config.requestHeaders.edit', { defaultValue: '编辑' })}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRow(row.id)}
                  title={ts('common.remove', { defaultValue: '移除' })}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              {errors[row.id] ? (
                <p className="mt-1 text-[11px] text-destructive">{errors[row.id]}</p>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addRow}>
          <Plus className="mr-1 size-3" />
          {ts('provider.config.requestHeaders.add', { defaultValue: '添加请求头' })}
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={handleSave}
          disabled={!dirty || hasErrors}
        >
          {ts('provider.config.requestHeaders.save', { defaultValue: '保存' })}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={handleCancel}
          // 只切进编辑、没改内容时 dirty 仍是 false —— 这时也得能退出编辑形态。
          disabled={!dirty && !isEditingAny}
        >
          {ts('provider.config.requestHeaders.cancel', { defaultValue: '取消' })}
        </Button>
        {dirty ? (
          <span className="text-[11px] text-amber-600 dark:text-amber-500">
            {ts('provider.config.requestHeaders.unsaved', { defaultValue: '未保存' })}
          </span>
        ) : null}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {ts('provider.config.requestHeaders.hint', {
          // Passed through literally: i18next would otherwise treat these as
          // missing interpolations and warn on every render.
          sessionId: '{{sessionId}}',
          model: '{{model}}',
          organization: '{{organization}}',
          project: '{{project}}',
          defaultValue:
            '值支持 {{sessionId}} / {{model}} / {{organization}} / {{project}} 占位符；变量为空时该请求头不发送'
        })}
      </p>
    </div>
  )
}
