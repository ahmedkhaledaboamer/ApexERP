import { useMemo } from 'react'
import { FileText, Mail, MessageCircle, Plus, Star, type LucideIcon } from 'lucide-react'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Segmented } from '@/shared/components/ui/Segmented'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { SearchInput } from '@/shared/components/form/Field'
import {
  CHANNEL_LABELS,
  PURPOSES_BY_CHANNEL,
  TEMPLATE_CHANNELS,
  type MessageTemplate,
  type TemplateChannel,
} from '../types'

export const CHANNEL_ICONS: Record<TemplateChannel, LucideIcon> = {
  email: Mail,
  quotation: FileText,
  whatsapp: MessageCircle,
}

interface TemplateListProps {
  rows: MessageTemplate[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
  channel: TemplateChannel
  onChannelChange: (c: TemplateChannel) => void
  search: string
  onSearchChange: (q: string) => void
  selectedId: string | null
  onSelect: (t: MessageTemplate) => void
  onNew: (() => void) | null
}

const byRank = (a: MessageTemplate, b: MessageTemplate) =>
  Number(b.active) - Number(a.active) || Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)

/**
 * Templates for one channel, grouped by purpose. A search looks across every channel and
 * groups the matches by channel instead.
 */
export function TemplateList(props: TemplateListProps) {
  const { rows, isLoading, error, onRetry, channel, onChannelChange, search, onSearchChange, selectedId, onSelect, onNew } = props
  const q = search.trim().toLowerCase()

  const groups = useMemo(() => {
    if (q) {
      const hits = rows.filter((t) => [t.name, t.purpose, t.subject, t.body].some((f) => f.toLowerCase().includes(q)))
      return TEMPLATE_CHANNELS.map((c) => ({ key: c, label: CHANNEL_LABELS[c], rows: hits.filter((t) => t.channel === c).sort(byRank) })).filter(
        (g) => g.rows.length > 0,
      )
    }
    const inChannel = rows.filter((t) => t.channel === channel)
    return PURPOSES_BY_CHANNEL[channel]
      .map((p) => ({ key: p, label: p, rows: inChannel.filter((t) => t.purpose === p).sort(byRank) }))
      .filter((g) => g.rows.length > 0)
  }, [rows, channel, q])

  return (
    <Card className="overflow-hidden">
      <div className="space-y-2.5 border-b border-line p-3">
        <Segmented
          label="Channel"
          size="sm"
          value={channel}
          onChange={onChannelChange}
          options={TEMPLATE_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }))}
          className="flex w-full [&>button]:flex-1"
        />
        <div className="flex items-center gap-2">
          <SearchInput
            className="min-w-0 flex-1"
            placeholder="Search all templates"
            aria-label="Search templates"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {onNew && (
            <Button write size="sm" onClick={onNew}>
              <Plus aria-hidden />
              New
            </Button>
          )}
        </div>
      </div>

      <div className="xl:max-h-[calc(100dvh-16rem)] xl:overflow-y-auto">
        {isLoading ? (
          <div className="space-y-3 p-3" aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-1.5 px-1">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : groups.length === 0 ? (
          q ? (
            <EmptyState title="No matches" body={`No template mentions “${search.trim()}”.`} className="py-10" />
          ) : (
            <EmptyState
              title={`No ${CHANNEL_LABELS[channel]} templates yet`}
              body="Templates keep messages consistent and fill in the lead’s details for you."
              action={
                onNew && (
                  <Button write size="sm" variant="secondary" onClick={onNew}>
                    <Plus aria-hidden />
                    New template
                  </Button>
                )
              }
              className="py-10"
            />
          )
        ) : (
          <nav aria-label="Templates" className="p-1.5">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label} className="mb-1">
                <h3 className="flex items-center justify-between px-2.5 pt-2.5 pb-1 text-[0.6875rem] font-medium text-subtle">
                  <span>{g.label}</span>
                  <span className="tabular-nums">{g.rows.length}</span>
                </h3>
                <ul>
                  {g.rows.map((t) => (
                    <li key={t.id}>
                      <TemplateRow template={t} selected={t.id === selectedId} showChannel={!!q} onSelect={onSelect} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
        )}
      </div>
    </Card>
  )
}

function TemplateRow({
  template: t,
  selected,
  showChannel,
  onSelect,
}: {
  template: MessageTemplate
  selected: boolean
  showChannel: boolean
  onSelect: (t: MessageTemplate) => void
}) {
  const Icon = CHANNEL_ICONS[t.channel]
  const firstLine = (t.channel === 'email' ? t.subject : t.body).split('\n').find((l) => l.trim()) ?? ''
  return (
    <button
      type="button"
      onClick={() => onSelect(t)}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-start transition-colors',
        selected ? 'bg-brand-500/10 ring-1 ring-brand-500/25 ring-inset' : 'hover:bg-hover',
      )}
    >
      <Icon
        aria-hidden
        className={cn('mt-0.5 size-4 shrink-0', selected ? 'text-brand-600 dark:text-brand-300' : 'text-subtle', !t.active && 'opacity-60')}
      />
      <span className={cn('min-w-0 flex-1', !t.active && 'opacity-60')}>
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate text-[0.8125rem] text-ink', selected ? 'font-semibold' : 'font-medium')}>{t.name}</span>
          {t.isDefault && (
            <Tooltip label={`Default for ${t.purpose}`}>
              <Star aria-label="Default" className="size-3 shrink-0 fill-warning-500 text-warning-500" />
            </Tooltip>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {showChannel ? `${t.purpose} · ` : ''}
          {firstLine.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, '[$1]') || 'Empty'}
        </span>
      </span>
      {!t.active ? (
        <Badge variant="outline" className="mt-0.5 shrink-0">
          Inactive
        </Badge>
      ) : (
        <span className="mt-0.5 hidden shrink-0 text-[0.6875rem] text-subtle sm:block">{fmtDate(t.updatedAt, 'd MMM')}</span>
      )}
    </button>
  )
}
