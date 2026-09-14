import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
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

export interface RequestHeadersEditorProps {
  headers: Record<string, string> | undefined
  onChange: (headers: Record<string, string>) => void
}

/**
 * Key/value editor for extra provider request headers.
 *
 * The parent owns the committed object; this component keeps a local draft so a
 * row can sit half-typed (blank name) without being dropped mid-edit. Only rows
 * that pass validation are committed — invalid ones stay visible with an inline
 * error. Remount it with `key={provider.id}` when the edited provider changes.
 */
export function RequestHeadersEditor({
  headers,
  onChange
}: RequestHeadersEditorProps): React.JSX.Element {
  const { t: ts } = useTranslation('settings')
  const [rows, setRows] = useState<HeaderRow[]>(() => toRows(headers))
  const [errors, setErrors] = useState<Record<string, string>>({})
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

  const commit = (next: HeaderRow[]): void => {
    setRows(next)
    const nextErrors: Record<string, string> = {}
    const committed: Record<string, string> = {}
    for (const row of next) {
      const error = validate(row, next)
      if (error) {
        nextErrors[row.id] = error
        continue
      }
      const name = row.name.trim()
      if (name) committed[name] = row.value
    }
    setErrors(nextErrors)
    onChange(committed)
  }

  const patchRow = (id: string, patch: Partial<HeaderRow>): void => {
    commit(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const addRow = (): void => {
    nextId.current += 1
    commit([...rows, { id: `h${nextId.current}`, name: '', value: '' }])
  }

  const removeRow = (id: string): void => {
    commit(rows.filter((row) => row.id !== id))
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

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addRow}>
          <Plus className="mr-1 size-3" />
          {ts('provider.config.requestHeaders.add', { defaultValue: '添加请求头' })}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          {ts('provider.config.requestHeaders.hint', {
            // Passed through literally: i18next would otherwise treat these as
            // missing interpolations and warn on every render.
            sessionId: '{{sessionId}}',
            model: '{{model}}',
            defaultValue: '值支持 {{sessionId}} 与 {{model}} 占位符，发送时自动替换为真实值'
          })}
        </p>
      </div>
    </div>
  )
}
