import { useTranslation } from 'react-i18next'
import { MessageSquare, Search } from 'lucide-react'
import { CommandEmpty, CommandGroup, CommandItem } from '@renderer/components/ui/command'
import { formatRelativeTime } from '../workspace-sidebar-items'
import type { MessageSearchHit } from './types'

interface SearchResultsProps {
  query: string
  hits: MessageSearchHit[]
  searching: boolean
  onSelect: (sessionId: string) => void
}

export function SearchResults({
  query,
  hits,
  searching,
  onSelect
}: SearchResultsProps): React.JSX.Element {
  const { t } = useTranslation('layout')

  if (searching && hits.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground/60">
        <Search className="size-4 animate-spin" />
        {t('sidebar.searching', { defaultValue: 'Searching…' })}
      </div>
    )
  }

  if (hits.length === 0) {
    return (
      <CommandEmpty>
        {t('sidebar.noResultsFor', { defaultValue: 'No results for' })} "{query}"
      </CommandEmpty>
    )
  }

  return (
    <CommandGroup heading={t('sidebar.messages', { defaultValue: 'Messages' })}>
      {hits.map((hit) => (
        <CommandItem
          key={hit.messageId}
          value={`${hit.sessionTitle} ${hit.snippet}`}
          onSelect={() => onSelect(hit.sessionId)}
        >
          <MessageSquare className="size-4 shrink-0 text-muted-foreground/50" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground/90">
                {hit.sessionTitle || hit.sessionId}
              </span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/40">
                {formatRelativeTime(hit.createdAt)}
              </span>
            </div>
            {hit.snippet && (
              <p className="line-clamp-1 text-xs text-muted-foreground/70">{hit.snippet}</p>
            )}
          </div>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
