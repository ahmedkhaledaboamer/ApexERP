import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { CalendarDays, CalendarX2, ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import type { TaskView } from '@/modules/tasks/types'
import { useMoveTask, useTasksQuery } from '@/modules/tasks/hooks/useTasks'
import { useRegion } from '@/modules/tenancy/hooks'
import { companyDay } from '@/shared/lib/companyDay'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Segmented } from '@/shared/components/ui/Segmented'
import { useToast } from '@/shared/components/ui/Toast'
import { Switch } from '@/shared/components/form/Field'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { StatusIcon } from '@/modules/tasks/components/TaskBadges'
import { TaskPageFrame } from '@/modules/tasks/components/TaskPageFrame'
import { ISO, PRIORITY_CHIP, PRIORITY_RANK } from '@/modules/tasks/components/taskMeta'
import { UndoToast, type UndoState } from '@/modules/tasks/components/UndoToast'
import { useOpenTask, useTaskPermissions } from '@/modules/tasks/components/useTaskActions'

type View = 'month' | 'week'
const MONTH_VISIBLE = 3
const NO_DATE = 'none'

/** Calendar of due dates: drag a chip to another day to reschedule (with undo). */
export default function TaskCalendarPage() {
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'week' ? 'week' : 'month'
  const anchorParam = params.get('d')
  // "Today" and the week start are the company's (regional timezone + weekStartsOn), not the browser's.
  const region = useRegion()
  const day = companyDay({ timezone: region.timezone, weekStartsOn: region.weekStartsOn })
  const WEEK = { weekStartsOn: day.weekStartsOn }
  const anchor = anchorParam && isValid(parseISO(anchorParam)) ? parseISO(anchorParam) : parseISO(day.today)
  const mine = params.get('mine') === '1'

  const { range, days } = useMemo(() => {
    const start = view === 'month' ? startOfWeek(startOfMonth(anchor), WEEK) : startOfWeek(anchor, WEEK)
    const end = view === 'month' ? endOfWeek(endOfMonth(anchor), WEEK) : endOfWeek(anchor, WEEK)
    return { range: { from: format(start, ISO), to: format(end, ISO) }, days: eachDayOfInterval({ start, end }) }
  }, [view, format(anchor, ISO), day.weekStartsOn])

  const { canView, blockReason, editBlock } = useTaskPermissions()
  const dated = useTasksQuery({ dueFrom: range.from, dueTo: range.to, includeDone: true, mine: mine || undefined })
  const all = useTasksQuery({ mine: mine || undefined })
  const move = useMoveTask()
  const toast = useToast()
  const openTask = useOpenTask()
  const [undo, setUndo] = useState<UndoState | null>(null)
  const [dragging, setDragging] = useState<TaskView | null>(null)
  const dismissUndo = useCallback(() => setUndo(null), [])

  function setParam(updates: Record<string, string | null>) {
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
    )
  }
  const go = (d: Date) => setParam({ d: format(d, ISO) })
  const step = (dir: 1 | -1) => go(view === 'month' ? addMonths(anchor, dir) : addWeeks(anchor, dir))

  // Tasks keyed by day (moves are optimistic in the query cache: useMoveTask).
  const { byDay, noDate } = useMemo(() => {
    const seen = new Map<string, TaskView>()
    for (const t of [...(dated.data ?? []), ...(all.data ?? [])]) seen.set(t.id, t)
    const map = new Map<string, TaskView[]>()
    const none: TaskView[] = []
    for (const t of seen.values()) {
      if (!t.dueDate) {
        if (t.status !== 'Done') none.push(t)
        continue
      }
      if (t.dueDate < range.from || t.dueDate > range.to) continue
      const list = map.get(t.dueDate) ?? []
      list.push(t)
      map.set(t.dueDate, list)
    }
    for (const list of map.values()) list.sort((a, b) => Number(a.status === 'Done') - Number(b.status === 'Done') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    none.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    return { byDay: map, noDate: none }
  }, [dated.data, all.data, range.from, range.to])

  const reschedule = useCallback(
    async (t: TaskView, to: string | null, isUndo = false) => {
      const from = t.dueDate
      if (from === to) return
      const refused = editBlock(t)
      if (refused) {
        toast.error(`“${t.title}” wasn’t rescheduled`, refused)
        return
      }
      try {
        await move.mutateAsync({ id: t.id, dueDate: to })
        if (!isUndo) {
          setUndo({
            id: Date.now(),
            title: to ? `Moved to ${format(parseISO(to), 'EEE d MMM')}` : 'Due date cleared',
            body: t.title,
            undo: () => void reschedule({ ...t, dueDate: to }, from, true),
          })
        } else toast.info('Change undone', t.title)
      } catch (e) {
        // useMoveTask already put the chip back on its old day.
        toast.error(`“${t.title}” wasn’t rescheduled`, (e as Error).message)
      }
    },
    [move.mutateAsync, toast, editBlock],
  )

  // Mouse: a small distance keeps clicks working. Touch: press and hold, so the page still scrolls.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )

  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const t = (e.active.data.current as { task: TaskView } | undefined)?.task
    const over = e.over?.id ? String(e.over.id) : null
    if (!t || !over) return
    void reschedule(t, over === NO_DATE ? null : over)
  }

  function onChipKey(e: KeyboardEvent, t: TaskView) {
    if (e.key === 'Enter') {
      e.preventDefault()
      openTask(t.id)
      return
    }
    if (!e.altKey) return
    const inline = (document.documentElement.dir === 'rtl' ? -1 : 1) // the grid mirrors in RTL
    const delta = e.key === 'ArrowRight' ? inline : e.key === 'ArrowLeft' ? -inline : e.key === 'ArrowDown' ? 7 : e.key === 'ArrowUp' ? -7 : 0
    if (!delta) return
    e.preventDefault()
    const base = parseISO(t.dueDate ?? day.today)
    void reschedule(t, format(addDays(base, t.dueDate ? delta : 0), ISO))
  }

  const today = day.today
  const title = view === 'month' ? format(anchor, 'MMMM yyyy') : `${format(days[0], 'd MMM')} – ${format(days[days.length - 1], 'd MMM yyyy')}`
  const loading = dated.isPending || all.isPending
  const error = dated.error ?? all.error
  const nothingDue = !loading && !error && byDay.size === 0 && noDate.length === 0

  const chip = (t: TaskView, compact = false) => (
    <CalendarChip key={t.id} task={t} compact={compact} canDrag={canView} locked={!!editBlock(t)} onOpen={openTask} onKeyDown={onChipKey} />
  )

  return (
    <TaskPageFrame title="Task calendar" icon={<CalendarDays />} description="Due dates by day">
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Navigate">
            <Button variant="secondary" size="sm" iconOnly aria-label={view === 'month' ? 'Previous month' : 'Previous week'} onClick={() => step(-1)}>
              <ChevronLeft className="rtl:-scale-x-100" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => go(parseISO(day.today))}>
              Today
            </Button>
            <Button variant="secondary" size="sm" iconOnly aria-label={view === 'month' ? 'Next month' : 'Next week'} onClick={() => step(1)}>
              <ChevronRight className="rtl:-scale-x-100" />
            </Button>
          </div>
          <h2 className="ms-1 text-base font-semibold" aria-live="polite">
            {title}
          </h2>
          <div className="ms-auto flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[0.8125rem] text-muted">
              <Switch checked={mine} onChange={(v) => setParam({ mine: v ? '1' : null })} label="Only my tasks" />
              Only mine
            </label>
            <Segmented<View>
              label="Calendar view"
              size="sm"
              value={view}
              onChange={(v) => setParam({ view: v === 'month' ? null : v })}
              options={[
                { value: 'month', label: 'Month' },
                { value: 'week', label: 'Week' },
              ]}
            />
          </div>
        </div>
        <p className="sr-only">
          Focus a task and press Enter to open it. Alt plus left or right arrow moves it a day, Alt plus up or down a week.
        </p>
        <p id="calendar-hint" data-can-move={blockReason === null} className="text-xs text-muted">
          {blockReason === null ? (
            'Drag a task to another day to reschedule it (you can undo), or drop it on No date to clear its date.'
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3.5" aria-hidden /> View only: {blockReason}
            </span>
          )}
        </p>
        {nothingDue && (
          <p role="status" className="rounded-md border border-dashed border-line-strong px-3 py-2 text-[0.8125rem] text-muted">
            {mine ? 'Nothing of yours' : 'Nothing'} is due this {view}, and every open task has a date. Pick another {view}, or add a task from My tasks.
          </p>
        )}

        {error ? (
          <ErrorState
            message={error.message}
            onRetry={() => {
              void dated.refetch()
              void all.refetch()
            }}
          />
        ) : (
          <DndContext
            sensors={sensors}
            onDragStart={(e) => setDragging((e.active.data.current as { task: TaskView } | undefined)?.task ?? null)}
            onDragCancel={() => setDragging(null)}
            onDragEnd={onDragEnd}
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
              <Card className="overflow-hidden">
                <div className={cn('grid-cols-7 border-b border-line bg-sunken/70', view === 'month' ? 'grid' : 'hidden sm:grid')} aria-hidden>
                  {days.slice(0, 7).map((d) => (
                    <div key={d.toISOString()} className="px-2 py-1.5 text-xs font-medium text-muted">
                      {format(d, 'EEE')}
                    </div>
                  ))}
                </div>
                {loading ? (
                  <div aria-busy="true" className="grid grid-cols-7 gap-0.5 p-0.5">
                    {days.map((d) => (
                      <Skeleton key={d.toISOString()} className={view === 'month' ? 'h-24' : 'h-64'} />
                    ))}
                  </div>
                ) : view === 'month' ? (
                  <div className="grid grid-cols-7">
                    {days.map((d) => {
                      const iso = format(d, ISO)
                      const items = byDay.get(iso) ?? []
                      return (
                        <DayCell key={iso} iso={iso} today={iso === today} muted={!isSameMonth(d, anchor)} className="min-h-16 sm:min-h-28">
                          <DayNumber date={d} today={iso === today} onClick={() => setParam({ view: 'week', d: iso })} count={items.length} />
                          {/* Phones: counts only; tap the day for the week view. */}
                          {items.length > 0 && (
                            <span className="num mt-0.5 block text-center text-[0.6875rem] text-muted sm:hidden">{items.length}</span>
                          )}
                          <div className="hidden space-y-1 sm:block">
                            {items.slice(0, MONTH_VISIBLE).map((t) => chip(t, true))}
                            {items.length > MONTH_VISIBLE && (
                              <button
                                type="button"
                                onClick={() => setParam({ view: 'week', d: iso })}
                                className="w-full rounded px-1 text-start text-[0.6875rem] font-medium text-muted hover:bg-hover hover:text-ink"
                              >
                                +{items.length - MONTH_VISIBLE} more
                              </button>
                            )}
                          </div>
                        </DayCell>
                      )
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-7">
                    {days.map((d) => {
                      const iso = format(d, ISO)
                      const items = byDay.get(iso) ?? []
                      return (
                        <DayCell key={iso} iso={iso} today={iso === today} className="min-h-20 sm:min-h-[26rem]">
                          <p className="mb-1.5 flex items-center gap-1.5 text-xs">
                            <span className={cn('font-medium sm:hidden', iso === today ? 'text-brand-700 dark:text-brand-300' : 'text-muted')}>{format(d, 'EEE')}</span>
                            <DayNumber date={d} today={iso === today} count={items.length} />
                          </p>
                          <div className="space-y-1">
                            {items.map((t) => chip(t))}
                            {items.length === 0 && <p className="text-[0.6875rem] text-subtle sm:hidden">Nothing due</p>}
                          </div>
                        </DayCell>
                      )
                    })}
                  </div>
                )}
              </Card>

              <NoDateList loading={loading} count={noDate.length}>
                {noDate.map((t) => chip(t))}
              </NoDateList>
            </div>
            <DragOverlay dropAnimation={null}>{dragging ? <ChipFace task={dragging} compact={view === 'month'} lifted /> : null}</DragOverlay>
          </DndContext>
        )}
      </PageBody>
      <UndoToast state={undo} onDismiss={dismissUndo} />
    </TaskPageFrame>
  )
}

function DayNumber({ date, today, onClick, count }: { date: Date; today: boolean; onClick?: () => void; count: number }) {
  const label = `${format(date, 'EEEE d MMMM')}${today ? ', today' : ''}, ${count} task${count === 1 ? '' : 's'}`
  const cls = cn(
    'num inline-flex size-6 items-center justify-center rounded-full text-xs',
    today ? 'bg-brand-600 font-semibold text-white dark:bg-brand-500' : 'text-ink-2',
  )
  if (!onClick) return <span className={cls} aria-label={label}>{format(date, 'd')}</span>
  return (
    <button type="button" onClick={onClick} aria-label={`${label}. Open week`} className={cn(cls, !today && 'hover:bg-hover')}>
      {format(date, 'd')}
    </button>
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

function NoDateList({ loading, count, children }: { loading: boolean; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: NO_DATE })
  return (
    <Card className={cn('h-fit p-3 transition-colors', isOver && 'ring-2 ring-brand-400')}>
      <h3 className="mb-2 flex items-center gap-2 text-[0.8125rem] font-semibold">
        <CalendarX2 className="size-4 text-muted" aria-hidden />
        No date
        <span className="num rounded-full border border-line-strong bg-surface px-2 text-xs leading-5 font-normal text-muted">{count}</span>
      </h3>
      <div ref={setNodeRef} className="min-h-16 space-y-1">
        {loading ? (
          <>
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
          </>
        ) : count === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-xs text-subtle">
            Every open task has a date. Drop one here to clear its date.
          </p>
        ) : (
          children
        )}
      </div>
    </Card>
  )
}

function ChipFace({ task, compact, lifted }: { task: TaskView; compact?: boolean; lifted?: boolean }) {
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-md px-1.5 ring-1 ring-inset',
        compact ? 'h-6 text-[0.6875rem]' : 'h-7 text-xs',
        PRIORITY_CHIP[task.priority],
        task.status === 'Done' && 'opacity-60',
        lifted && 'shadow-pop',
      )}
    >
      <StatusIcon status={task.status} className="size-3" />
      <span className={cn('truncate font-medium', task.status === 'Done' && 'line-through')}>{task.title}</span>
      {task.overdue && <span className="sr-only">(overdue)</span>}
    </span>
  )
}

function CalendarChip({
  task,
  compact,
  canDrag,
  locked,
  onOpen,
  onKeyDown,
}: {
  task: TaskView
  compact?: boolean
  canDrag: boolean
  /** The caller can't change this task: a drop is refused with the reason. */
  locked: boolean
  onOpen: (id: string) => void
  onKeyDown: (e: KeyboardEvent, t: TaskView) => void
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: task.id, data: { task }, disabled: !canDrag })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`${task.title}, ${task.priority} priority, ${task.status}${task.overdue ? ', overdue' : ''}${locked ? ', view only' : ''}`}
      title={`${task.title} · ${task.priority} · ${task.ownerName}`}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => onKeyDown(e, task)}
      className={cn(
        'block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        canDrag && (locked ? 'cursor-not-allowed' : 'cursor-grab touch-manipulation'),
        isDragging && 'opacity-30',
      )}
    >
      <ChipFace task={task} compact={compact} />
    </div>
  )
}
