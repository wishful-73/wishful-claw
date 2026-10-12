import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Filter } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@renderer/components/ui/command'
import { cn } from '@renderer/lib/utils'

/**
 * 「请求明细」表的筛选（S-190）：类型、键编码、三个控件。筛选**只作用于明细表**，
 * 上方概览 / 折线 / 柱状 / 按模型汇总一律保持全局口径（只受时间窗口 range 影响）。
 *
 * 与纯表格渲染分开一个文件，见 `dev-workflow.md` 阶段四「大文件拆分」。
 */

export interface UsageFilters {
  /** 元素 = `providerId<US>modelId`（见 modelFilterKey）；空数组 = 不筛模型。 */
  models: string[]
  /** `'success'` / `'error'`；空数组 = 不筛状态。 */
  status: string[]
  /** 单行文本，进请求前按逗号 / 空白切分；空串 = 不筛状态码。 */
  httpStatusCodes: string
}

/** 模型选项：`value` 是筛选键，`label` 是展示文案（`服务商 · 模型`）。 */
export interface UsageModelOption {
  value: string
  label: string
}

/**
 * 模型筛选键用 US（`\u001F`）连接 providerId 与 modelId：两者都可能含 `-` `_` `.`
 * `/` `:`，用 US 零歧义、后端无需 JSON 解析。与后端 `db/usage-logs` 的 `models`
 * 参数编码完全一致。
 */
export const MODEL_FILTER_SEP = '\u001F'

/**
 * `db/usage-by-model` 把 `provider_id` / `model_id` 的 NULL 显示化成这个字面量
 * （见 `DbUsageLogQueryTools.ByModel` 的 `COALESCE(..., '(unknown)')`）。
 */
export const UNKNOWN_MODEL_LABEL = '(unknown)'

/**
 * NULL 哨兵。筛选键必须保住「这一列是 NULL 还是空串」的区别：用空串代替 NULL 会被
 * 后端拼成 `provider_id = ''`，对 DB 中 `provider_id IS NULL` 的行永不命中 ——
 * 选项可点却恒得 0 条。后端 `BuildDetailWhere` 见哨兵生成 `IS NULL`。
 */
export const NULL_FILTER_TOKEN = '\u0000'

function normalizeModelToken(value?: string | null): string {
  return value == null || value === UNKNOWN_MODEL_LABEL ? NULL_FILTER_TOKEN : value
}

export function modelFilterKey(providerId?: string | null, modelId?: string | null): string {
  return `${normalizeModelToken(providerId)}${MODEL_FILTER_SEP}${normalizeModelToken(modelId)}`
}

/**
 * HTTP 状态码是单行文本：按逗号**或空白**切分、去空；空串 ⇒ 不发该参数。
 * 空白也算分隔符，否则 `"4 29"` 会被整块送去后端、`int.TryParse` 丢弃，
 * 界面显示「已筛选」而实际没筛（静默无过滤）。
 */
export function parseHttpStatusCodes(text: string): string[] {
  return text.split(/[\s,]+/).filter((part) => part.length > 0)
}

/**
 * 模型筛选项来源 = 当前窗口 `db/usage-by-model` 的行（零额外查询、与图表口径一致），
 * 按筛选键去重；展示为 `服务商 · 模型`。
 */
export function buildModelOptions(
  rows: Array<{ providerId?: string | null; modelId?: string | null; providerType?: string | null }>,
  providerLabel: (providerId?: string | null, providerType?: string | null) => string
): UsageModelOption[] {
  const options: UsageModelOption[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const value = modelFilterKey(row.providerId, row.modelId)
    if (seen.has(value)) continue
    seen.add(value)
    options.push({
      value,
      label: `${providerLabel(row.providerId, row.providerType)} · ${row.modelId ?? UNKNOWN_MODEL_LABEL}`
    })
  }
  return options
}

/**
 * 模型筛选：搜索式多选（组合数可能几十个）。选中项展示为 `服务商 · 模型`，值是
 * `providerId<US>modelId`。空选 = 不筛。
 */
export function ModelFilter({
  options,
  selected,
  onChange
}: {
  options: UsageModelOption[]
  selected: string[]
  onChange: (next: string[]) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const toggle = (value: string): void => {
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value]
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-7 gap-1.5 px-2 text-[11px]',
            selected.length > 0 ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          <Filter className="size-3.5" />
          {selected.length > 0
            ? t('usage.detail.filters.modelCount', {
                defaultValue: '模型 · {{count}}',
                count: selected.length
              })
            : t('usage.detail.filters.model', { defaultValue: '模型' })}
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput
            placeholder={t('usage.detail.filters.modelSearch', { defaultValue: '搜索模型…' })}
          />
          <CommandList className="max-h-60">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              {t('usage.detail.filters.modelEmpty', { defaultValue: '无匹配模型' })}
            </CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={option.label}
                onSelect={() => toggle(option.value)}
                className="text-xs"
              >
                <span className="mr-1.5 flex size-3.5 shrink-0 items-center justify-center">
                  {selected.includes(option.value) ? <Check className="size-3.5" /> : null}
                </span>
                <span className="truncate">{option.label}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * 状态筛选：成功 / 失败多选，附「只看失败」快捷入口（本条最常用的动作）。
 */
export function StatusFilter({
  selected,
  onChange
}: {
  selected: string[]
  onChange: (next: string[]) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const toggle = (value: string): void => {
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value]
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-7 gap-1.5 px-2 text-[11px]',
            selected.length > 0 ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          <Filter className="size-3.5" />
          {selected.length > 0
            ? t('usage.detail.filters.statusCount', {
                defaultValue: '状态 · {{count}}',
                count: selected.length
              })
            : t('usage.detail.filters.status', { defaultValue: '状态' })}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36">
        <DropdownMenuLabel className="px-2 py-1 text-xs">
          {t('usage.detail.filters.status', { defaultValue: '状态' })}
        </DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={selected.includes('success')}
          onCheckedChange={() => toggle('success')}
          onSelect={(event) => event.preventDefault()}
          className="text-xs"
        >
          {t('usage.detail.filters.statusSuccess', { defaultValue: '成功' })}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={selected.includes('error')}
          onCheckedChange={() => toggle('error')}
          onSelect={(event) => event.preventDefault()}
          className="text-xs"
        >
          {t('usage.detail.filters.statusError', { defaultValue: '失败' })}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onChange(['error'])} className="text-xs">
          <AlertTriangle className="size-3.5" />
          {t('usage.detail.filters.onlyFailed', { defaultValue: '只看失败' })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** HTTP 状态码输入框：只允许数字 / 逗号 / 空白进 state，切分交给 parseHttpStatusCodes。 */
export function HttpStatusInput({
  value,
  onChange
}: {
  value: string
  onChange: (next: string) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/[^\d,\s]/g, ''))}
      placeholder={t('usage.detail.filters.httpStatusPlaceholder', {
        defaultValue: '状态码，如 429,503'
      })}
      title={t('usage.detail.filters.httpStatusHint', {
        defaultValue: '按 HTTP 状态码精确匹配，多个用逗号分隔'
      })}
      className="h-7 w-36 rounded-md border bg-background px-2 text-[11px] outline-none focus:border-primary"
    />
  )
}
