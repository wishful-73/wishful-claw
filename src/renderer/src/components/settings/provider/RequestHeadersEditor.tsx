import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
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
  const nextId = useRef(rows.length)

  const validate = (row: HeaderRow, all: HeaderRow[]): string | null => {
    const name = row.name.trim()
    if (!name) return null
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

  const addRow = (): void => {
    nextId.current += 1
    setRows([...rows, { id: `h${nextId.current}`, name: '', value: '' }])
  }

  const removeRow = (id: string): void => {
    setRows(rows.filter((row) => row.id !== id))
  }

  const handleSave = (): void => {
    if (hasErrors || !dirty) return
    onChange(draft)
    setSaved(draft)
    toast.success(
      ts('provider.config.requestHeaders.saved', { defaultValue: '请求头已保存' })
    )
  }

  const handleCancel = (): void => {
    setRows(toRows(saved))
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {ts('provider.config.requestHeaders.empty', { defaultValue: '尚未添加额外请求头' })}
        </p>
      ) : null}

      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.id}>
            <div className="flex items-center gap-1.5">
              <Input
                value={row.name}
                onChange={(e) => patchRow(row.id, { name: e.target.value })}
                placeholder={ts('provider.config.requestHeaders.namePlaceholder', {
                  defaultValue: '请求头名称'
                })}
                className="h-7 w-2/5 text-xs"
                aria-invalid={errors[row.id] ? true : undefined}
              />
              <Input
                value={row.value}
                onChange={(e) => patchRow(row.id, { value: e.target.value })}
                placeholder={ts('provider.config.requestHeaders.valuePlaceholder', {
                  defaultValue: '值'
                })}
                className="h-7 flex-1 text-xs"
              />
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
        ))}
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
          disabled={!dirty}
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
