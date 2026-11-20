import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isValid, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { createColumnHelper, type FilterFn } from '@tanstack/react-table'
import { CalendarDays, CalendarX2, ChevronLeft, ChevronRight, KanbanSquare, List, Lock, Plus, X } from 'lucide-react'
import {
  CONTENT_CHANNELS,
  CONTENT_CHANNEL_LABEL,
  CONTENT_STATUSES,
  CONTENT_STATUS_LABEL,
  CONTENT_TYPES,
  CONTENT_TYPE_LABEL,
  type ContentItem,
  type ContentStatus,
} from '@/modules/marketing/creative/types'
import { useContentQuery, useContentStatus, useCreativeAccess, useRescheduleContent } from '@/modules/marketing/creative/hooks'
import { contentMoveProblem } from '@/modules/marketing/creative/rules'
import { CONTENT_CHIP, CONTENT_STATUS_TONE, ChannelChips, ContentStatusBadge } from '@/modules/marketing/creative/components/badges'
import { ContentDrawer } from '@/modules/marketing/creative/components/ContentDrawer'
import { ContentForm } from '@/modules/marketing/creative/components/ContentForm'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { useRegion } from '@/modules/tenancy/hooks'
import { companyDay } from '@/shared/lib/companyDay'
import type { Role } from '@/shared/types'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Segmented } from '@/shared/components/ui/Segmented'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { SearchInput } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'
import { KanbanBoard, KanbanCard } from '@/shared/components/kanban'

type View = 'calendar' | 'board' | 'list'
type CalView = 'month' | 'week'
const ISO = 'yyyy-MM-dd'
const MONTH_VISIBLE = 3
const UNPLANNED = 'unplanned'
const BOARD_COLUMNS: ContentStatus[] = ['idea', 'draft', 'in_review', 'approved', 'scheduled', 'published']

export default function ContentCalendarPage() {
  const { canView } = useCreativeAccess()
  if (!canView) return <NoMarketingAccess what="Content calendar" />
  return <ContentCalendar />
}

interface Filters {
  channel: string[]
  type: string[]
  status: string[]
  campaign: string[]
  owner: string[]
}
const NO_FILTERS: Filters = { channel: [], type: [], status: [], campaign: [], owner: [] }

function matches(c: ContentItem, f: Filters, search: string): boolean {
  if (f.channel.length && !c.channels.some((x) => f.channel.includes(x))) return false
  if (f.type.length && !f.type.includes(c.type)) return false
  if (f.status.length && !f.status.includes(c.status)) return false
  if (f.campaign.length && !f.campaign.includes(c.campaignId ?? '')) return false
  if (f.owner.length && !f.owner.includes(c.ownerId ?? '')) return false
  const q = search.trim().toLowerCase()
  return !q || [c.title, c.body, c.campaignName, c.ownerName].join(' ').toLowerCase().includes(q)
}

function ContentCalendar() {
  const { canEdit, user } = useCreativeAccess()
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'board' ? 'board' : params.get('view') === 'list' ? 'list' : 'calendar'
  const openId = params.get('item')
  const query = useContentQuery()
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState<{ date?: string } | null>(null)

  const setParam = useCallback(
    (updates: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(updates)) {
            if (v) next.set(k, v)
            else next.delete(k)
          }
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  const open = useCallback((id: string) => setParam({ item: id }), [setParam])

  const all = useMemo(() => query.data ?? [], [query.data])
  const items = useMemo(() => all.filter((c) => matches(c, filters, search)), [all, filters, search])
  const filtered = search !== '' || Object.values(filters).some((v) => v.length > 0)
  const facet = (key: keyof Filters, title: string, options: { value: string; label: string }[]) => (
    <FacetFilter title={title} options={options} selected={filters[key]} onChange={(v) => setFilters((f) => ({ ...f, [key]: v }))} />
  )
  const campaigns = [...new Map(all.filter((c) => c.campaignId).map((c) => [c.campaignId!, c.campaignName])).entries()]
  const owners = [...new Map(all.filter((c) => c.ownerId).map((c) => [c.ownerId!, c.ownerName])).entries()]

  return (
    <>
      <PageHeader
        title="Content calendar"
        description="Plan, review, approve and schedule posts, articles and newsletters across channels."
        actions={
          canEdit && (
            <Button write onClick={() => setCreating({})}>
              <Plus />
              New content
            </Button>
          )
        }
      />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs<View>
            label="Content views"
            variant="pill"
            value={view}
            onChange={(v) => setParam({ view: v === 'calendar' ? null : v })}
            items={[
              { id: 'calendar', label: 'Calendar', icon: <CalendarDays /> },
              { id: 'board', label: 'Board', icon: <KanbanSquare /> },
              { id: 'list', label: 'List', icon: <List /> },
            ]}
          />
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden />
          <SearchInput aria-label="Search content" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search content…" className="w-full sm:w-56" />
          {facet('channel', 'Channel', CONTENT_CHANNELS.map((c) => ({ value: c, label: CONTENT_CHANNEL_LABEL[c] })))}
          {facet('type', 'Type', CONTENT_TYPES.map((t) => ({ value: t, label: CONTENT_TYPE_LABEL[t] })))}
          {facet('status', 'Status', CONTENT_STATUSES.map((s) => ({ value: s, label: CONTENT_STATUS_LABEL[s] })))}
          {facet('campaign', 'Campaign', campaigns.map(([value, label]) => ({ value, label })))}
          {facet('owner', 'Owner', owners.map(([value, label]) => ({ value, label })))}
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters(NO_FILTERS)
                setSearch('')
              }}
            >
              Reset
              <X />
            </Button>
          )}
        </div>

        {query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : view === 'calendar' ? (
          <CalendarView items={items} loading={query.isPending} canEdit={canEdit} onOpen={open} onCreate={(date) => setCreating({ date })} params={params} setParam={setParam} />
        ) : view === 'board' ? (
          <BoardView items={items} loading={query.isPending} canEdit={canEdit} user={user} onOpen={open} />
        ) : (
          <ListView items={items} loading={query.isPending} onOpen={open} empty={all.length === 0} />
        )}
      </PageBody>
      <ContentDrawer id={openId} onClose={() => setParam({ item: null })} />
      <ContentForm open={!!creating} onClose={() => setCreating(null)} item={null} currentUserId={user.id} defaultDate={creating?.date} onSaved={(c) => open(c.id)} />
    </>
  )
}

/* ---------------- Calendar ---------------- */

function CalendarView({
  items,
  loading,
  canEdit,
  onOpen,
  onCreate,
  params,
  setParam,
}: {
  items: ContentItem[]
  loading: boolean
  canEdit: boolean
  onOpen: (id: string) => void
  onCreate: (date: string) => void
  params: URLSearchParams
  setParam: (u: Record<string, string | null>) => void
}) {
  const region = useRegion()
  const day = companyDay({ timezone: region.timezone, weekStartsOn: region.weekStartsOn })
  const WEEK = { weekStartsOn: day.weekStartsOn }
  const cal: CalView = params.get('cal') === 'week' ? 'week' : 'month'
  const anchorParam = params.get('d')
  const anchor = anchorParam && isValid(parseISO(anchorParam)) ? parseISO(anchorParam) : parseISO(day.today)
  const reschedule = useRescheduleContent()
  const toast = useToast()
  const [dragging, setDragging] = useState<ContentItem | null>(null)

  const days = useMemo(() => {
    const start = cal === 'month' ? startOfWeek(startOfMonth(anchor), WEEK) : startOfWeek(anchor, WEEK)
    const end = cal === 'month' ? endOfWeek(endOfMonth(anchor), WEEK) : endOfWeek(anchor, WEEK)
    return eachDayOfInterval({ start, end })
  }, [cal, format(anchor, ISO), day.weekStartsOn]) // eslint-disable-line react-hooks/exhaustive-deps

  const { byDay, unplanned } = useMemo(() => {
    const map = new Map<string, ContentItem[]>()
    const none: ContentItem[] = []
    for (const c of items) {
      if (c.status === 'archived') continue
      if (!c.publishLocal) {
        none.push(c)
        continue
      }
      const d = c.publishLocal.slice(0, 10)
      map.set(d, [...(map.get(d) ?? []), c])
    }
    for (const list of map.values()) list.sort((a, b) => (a.publishLocal ?? '').localeCompare(b.publishLocal ?? ''))
    return { byDay: map, unplanned: none }
  }, [items])

  const go = (d: Date) => setParam({ d: format(d, ISO) })
  const step = (dir: 1 | -1) => go(cal === 'month' ? addMonths(anchor, dir) : addWeeks(anchor, dir))
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }))

  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const c = (e.active.data.current as { item: ContentItem } | undefined)?.item
    const over = e.over?.id ? String(e.over.id) : null
    if (!c || !over || over === UNPLANNED) return
    if (!canEdit) return toast.error('Not rescheduled', 'Your role can view marketing but not change it.')
    if (c.status === 'published') return toast.error('Not rescheduled', 'Published content stays on the day it went out.')
    const time = c.publishLocal?.slice(11) || '10:00'
    const local = `${over}T${time}`
    if (local === c.publishLocal) return
    reschedule.mutate(
      { id: c.id, local },
      {
        onSuccess: () => toast.success(`Moved to ${fmtDate(over, 'EEE d MMM')}`, c.title),
        // useRescheduleContent already put the chip back on its old day.
        onError: (err) => toast.error(`“${c.title}” wasn’t rescheduled`, err.message),
      },
    )
  }

  const title = cal === 'month' ? format(anchor, 'MMMM yyyy') : `${format(days[0], 'd MMM')} – ${format(days[days.length - 1], 'd MMM yyyy')}`
  const chip = (c: ContentItem, compact = false) => <Chip key={c.id} item={c} compact={compact} canDrag={canEdit && c.status !== 'published'} onOpen={onOpen} />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Navigate">
          <Button variant="secondary" size="sm" iconOnly aria-label={cal === 'month' ? 'Previous month' : 'Previous week'} onClick={() => step(-1)}>
            <ChevronLeft className="rtl:-scale-x-100" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => go(parseISO(day.today))}>
            Today
          </Button>
          <Button variant="secondary" size="sm" iconOnly aria-label={cal === 'month' ? 'Next month' : 'Next week'} onClick={() => step(1)}>
            <ChevronRight className="rtl:-scale-x-100" />
          </Button>
        </div>
        <h2 className="ms-1 text-base font-semibold" aria-live="polite">
          {title}
        </h2>
        <div className="ms-auto">
          <Segmented<CalView>
            label="Calendar range"
            size="sm"
            value={cal}
            onChange={(v) => setParam({ cal: v === 'month' ? null : v })}
            options={[
              { value: 'month', label: 'Month' },
              { value: 'week', label: 'Week' },
            ]}
          />
        </div>
      </div>
      <p className="text-xs text-muted">
        {canEdit ? (
          `Drag an item to another day to reschedule it (time is kept, ${region.timezone}). A scheduled item can’t move into the past.`
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden /> View only.
          </span>
        )}
      </p>
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setDragging((e.active.data.current as { item: ContentItem } | undefined)?.item ?? null)}
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <Card className="overflow-hidden">
            <div className={cn('grid-cols-7 border-b border-line bg-sunken/70', cal === 'month' ? 'grid' : 'hidden sm:grid')} aria-hidden>
              {days.slice(0, 7).map((d) => (
                <div key={d.toISOString()} className="px-2 py-1.5 text-xs font-medium text-muted">
                  {format(d, 'EEE')}
                </div>
              ))}
            </div>
            {loading ? (
              <div aria-busy="true" className="grid grid-cols-7 gap-0.5 p-0.5">
                {days.map((d) => (
                  <Skeleton key={d.toISOString()} className={cal === 'month' ? 'h-24' : 'h-64'} />
                ))}
              </div>
            ) : (
              <div className={cn('grid', cal === 'month' ? 'grid-cols-7' : 'grid-cols-1 sm:grid-cols-7')}>
                {days.map((d) => {
                  const iso = format(d, ISO)
                  const list = byDay.get(iso) ?? []
                  const isToday = iso === day.today
                  const visible = cal === 'month' ? list.slice(0, MONTH_VISIBLE) : list
                  return (
                    <DayCell key={iso} iso={iso} today={isToday} muted={cal === 'month' && !isSameMonth(d, anchor)} className={cal === 'month' ? 'min-h-16 sm:min-h-28' : 'min-h-20 sm:min-h-[26rem]'}>
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <button
                          type="button"
                          onClick={() => setParam({ cal: 'week', d: iso })}
                          aria-label={`${format(d, 'EEEE d MMMM')}${isToday ? ', today' : ''}, ${list.length} item${list.length === 1 ? '' : 's'}`}
                          className={cn('num inline-flex size-6 items-center justify-center rounded-full text-xs', isToday ? 'bg-brand-600 font-semibold text-white dark:bg-brand-500' : 'text-ink-2 hover:bg-hover')}
                        >
                          {format(d, 'd')}
                        </button>
                        {canEdit && (
                          <button type="button" aria-label={`New content on ${format(d, 'd MMMM')}`} onClick={() => onCreate(iso)} className="hidden rounded p-0.5 text-subtle hover:bg-hover hover:text-ink sm:block">
                            <Plus className="size-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="space-y-1">
                        {visible.map((c) => chip(c, cal === 'month'))}
                        {cal === 'month' && list.length > MONTH_VISIBLE && (
                          <button type="button" onClick={() => setParam({ cal: 'week', d: iso })} className="w-full rounded px-1 text-start text-[0.6875rem] font-medium text-muted hover:bg-hover hover:text-ink">
                            +{list.length - MONTH_VISIBLE} more
                          </button>
                        )}
                      </div>
                    </DayCell>
                  )
                })}
              </div>
            )}
          </Card>
          <Unplanned count={unplanned.length}>{unplanned.map((c) => chip(c))}</Unplanned>
        </div>
        <DragOverlay dropAnimation={null}>{dragging ? <ChipFace item={dragging} compact={cal === 'month'} lifted /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}

function DayCell({ iso, today, muted, className, children }: { iso: string; today: boolean; muted?: boolean; className?: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: iso })
  return (
    <div
      ref={setNodeRef}
      data-day={iso}
      className={cn(
        'min-w-0 border-e border-b border-line p-1 transition-colors sm:p-1.5 [&:nth-child(7n)]:border-e-0',
        muted && 'bg-sunken/40',
        today && 'bg-brand-50/50 dark:bg-brand-500/10',
        isOver && 'bg-brand-50 ring-2 ring-brand-400 ring-inset dark:bg-brand-500/15',
        className,
      )}
    >
      {children}
    </div>
  )
}

function Unplanned({ count, children }: { count: number; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: UNPLANNED })
  return (
    <Card className="h-fit p-3">
      <h3 className="mb-2 flex items-center gap-2 text-[0.8125rem] font-semibold">
        <CalendarX2 className="size-4 text-muted" aria-hidden />
        Not planned
        <span className="num rounded-full border border-line-strong bg-surface px-2 text-xs leading-5 font-normal text-muted">{count}</span>
      </h3>
      <div ref={setNodeRef} className="min-h-16 space-y-1">
        {count === 0 ? <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-xs text-subtle">Everything has a publish date.</p> : children}
      </div>
    </Card>
  )
}

function ChipFace({ item, compact, lifted }: { item: ContentItem; compact?: boolean; lifted?: boolean }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1 rounded-md px-1.5 ring-1 ring-inset', compact ? 'h-6 text-[0.6875rem]' : 'h-7 text-xs', CONTENT_CHIP[item.status], item.overdue && 'ring-danger-500', lifted && 'shadow-pop')}>
      {item.publishLocal && <span className="num shrink-0 opacity-70">{item.publishLocal.slice(11)}</span>}
      <span className="truncate font-medium">{item.title}</span>
    </span>
  )
}

function Chip({ item, compact, canDrag, onOpen }: { item: ContentItem; compact?: boolean; canDrag: boolean; onOpen: (id: string) => void }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: item.id, data: { item }, disabled: !canDrag })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      role="button"
      tabIndex={0}
      data-content-id={item.id}
      aria-label={`${item.title}, ${CONTENT_STATUS_LABEL[item.status]}${item.overdue ? ', overdue' : ''}`}
      title={`${item.title} · ${CONTENT_STATUS_LABEL[item.status]} · ${item.ownerName}`}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(item.id)
      }}
      className={cn('block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-500', canDrag && 'cursor-grab touch-manipulation', isDragging && 'opacity-30')}
    >
      <ChipFace item={item} compact={compact} />
    </div>
  )
}

/* ---------------- Board ---------------- */

function BoardView({ items, loading, canEdit, user, onOpen }: { items: ContentItem[]; loading: boolean; canEdit: boolean; user: { id: string; role: Role }; onOpen: (id: string) => void }) {
  const status = useContentStatus()
  const toast = useToast()
  if (loading) return <Skeleton className="h-96 rounded-card" />
  const refuse = (c: ContentItem, to: ContentStatus) => {
    const why = contentMoveProblem(c, to, user) ?? (to === 'published' ? 'Open the item and use Mark published to add the live link.' : null)
    if (why) toast.error(`“${c.title}” can’t move to ${CONTENT_STATUS_LABEL[to]}`, why)
    return why
  }
  return (
    <div className="overflow-x-auto pb-2">
      <KanbanBoard<ContentItem, ContentStatus>
        columns={BOARD_COLUMNS.map((s) => ({ id: s, label: CONTENT_STATUS_LABEL[s], tone: CONTENT_STATUS_TONE[s] }))}
        items={items.filter((c) => c.status !== 'archived')}
        getId={(c) => c.id}
        getColumn={(c) => c.status}
        canMove={canEdit}
        onBlockedMove={(c, to) => refuse(c, to)}
        onMove={(c, to) => {
          if (refuse(c, to)) return
          status.mutate({ id: c.id, input: { status: to } }, { onError: (e) => toast.error(`“${c.title}” wasn’t moved`, e.message) })
        }}
        emptyLabel="Nothing here"
        renderCard={(c) => (
          <button type="button" onClick={() => onOpen(c.id)} className="block w-full text-start">
            <KanbanCard className="space-y-2">
              <p className="text-[0.8125rem] font-medium text-ink">{c.title}</p>
              <ChannelChips channels={c.channels} />
              <p className="flex items-center justify-between gap-2 text-xs text-muted">
                <span>{c.publishLocal ? fmtDate(c.publishLocal, 'd MMM, HH:mm') : 'Not planned'}</span>
                {c.overdue && <span className="font-medium text-danger-600">Overdue</span>}
                {c.ownerName && <Avatar name={c.ownerName} size="xs" />}
              </p>
            </KanbanCard>
          </button>
        )}
      />
    </div>
  )
}

/* ---------------- List ---------------- */

const col = createColumnHelper<ContentItem>()
const byPublish: FilterFn<ContentItem> = () => true

function ListView({ items, loading, onOpen, empty }: { items: ContentItem[]; loading: boolean; onOpen: (id: string) => void; empty: boolean }) {
  const columns = useMemo(
    () => [
      col.accessor('title', {
        header: 'Content',
        enableHiding: false,
        meta: { width: 320 },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.title}</p>
            <p className="truncate text-xs text-muted">{CONTENT_TYPE_LABEL[row.original.type]}</p>
          </div>
        ),
      }),
      col.accessor('status', { header: 'Status', cell: ({ getValue }) => <ContentStatusBadge status={getValue()} /> }),
      col.accessor((c) => c.channels.join(','), { id: 'channels', header: 'Channels', cell: ({ row }) => <ChannelChips channels={row.original.channels} /> }),
      col.accessor((c) => c.publishLocal ?? '', {
        id: 'publish',
        header: 'Publish',
        filterFn: byPublish,
        cell: ({ row }) => (
          <span className={cn('num whitespace-nowrap', row.original.overdue ? 'font-medium text-danger-600' : 'text-ink-2')}>
            {row.original.publishLocal ? fmtDate(row.original.publishLocal, 'd MMM yyyy, HH:mm') : '—'}
          </span>
        ),
      }),
      col.accessor('campaignName', { header: 'Campaign', cell: ({ getValue }) => <span className="text-ink-2">{getValue() || '—'}</span> }),
      col.accessor('ownerName', { header: 'Owner', cell: ({ getValue }) => <span className="whitespace-nowrap text-ink-2">{getValue() || '—'}</span> }),
    ],
    [],
  )
  const table = useDataTable({ id: 'marketing-content', data: items, columns, defaultSorting: [{ id: 'publish', desc: false }], getRowId: (r) => r.id })
  return (
    <DataTable
      table={table}
      loading={loading}
      onRowClick={(row) => onOpen(row.id)}
      empty={<EmptyState icon={<CalendarDays aria-hidden />} title={empty ? 'No content yet' : 'No content matches'} body={empty ? 'Plan your first post, article or newsletter.' : 'Try another search or clear the filters.'} />}
    />
  )
}
