import { useMemo } from 'react'
import { addDays, format, isBefore, parseISO, startOfDay } from 'date-fns'
import { GanttChart } from 'lucide-react'
import { TASK_STATUSES, type TaskView } from '@/modules/tasks/types'
import { addWorkingDays, isoDate, isWorkingDay, nextWorkingDay } from '@/modules/won/plan'
import { getRegion } from '@/shared/lib/region'
import { weekStartIso, workingWeekLabel } from '@/shared/lib/companyDay'
import { currentDay } from '@/modules/tasks/components/taskMeta'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { TASK_STATUS_COLOR, useOpenTask, type ProjectDetail } from './projectUi'

/** Width of one working day, in rem. */
const DAY = 1.75
/** Width of the sticky task-name column, in rem. */
const LABEL = 11

interface Bar {
  task: TaskView
  start: number
  end: number
  estimated: boolean
}

/** Working days from `from` to `to` inclusive (both moved onto working days). */
function workingDays(from: Date, to: Date): string[] {
  const out: string[] = []
  let cur = nextWorkingDay(from, getRegion().weekend)
  while (!isBefore(to, cur)) {
    out.push(isoDate(cur))
    cur = addDays(cur, 1)
    while (!isWorkingDay(cur, getRegion().weekend)) cur = addDays(cur, 1)
  }
  return out
}

/**
 * Project › Timeline: a Gantt-like bar per task across working days. A task starts at its template
 * offset from the project start (fallback: when it was created) and ends on its due date.
 */
export function ProjectTimeline({ project: p }: { project: ProjectDetail }) {
  const openTask = useOpenTask()

  const model = useMemo(() => {
    const projectStart = parseISO(p.startDate)
    const raw = p.tasks.map((t) => {
      const created = startOfDay(parseISO(t.createdAt))
      const start = t.dayOffset != null ? addWorkingDays(projectStart, t.dayOffset, getRegion().weekend) : t.dueDate && isBefore(parseISO(t.dueDate), created) ? parseISO(t.dueDate) : created
      const end = t.dueDate ? parseISO(t.dueDate) : start
      return { task: t, start: nextWorkingDay(start, getRegion().weekend), end: isBefore(end, start) ? start : end, estimated: t.dayOffset == null }
    })
    const all = [projectStart, parseISO(p.endDate), ...raw.flatMap((r) => [r.start, r.end])]
    const min = all.reduce((m, d) => (isBefore(d, m) ? d : m))
    const max = all.reduce((m, d) => (isBefore(m, d) ? d : m))
    const days = workingDays(min, max)
    const index = new Map(days.map((d, i) => [d, i]))
    /** Column of a date; weekends snap to the next working day. */
    const col = (d: Date) => index.get(isoDate(nextWorkingDay(d, getRegion().weekend))) ?? (isBefore(d, min) ? 0 : days.length - 1)
    const bars: Bar[] = raw
      .map((r) => ({ task: r.task, start: col(r.start), end: Math.max(col(r.start), col(r.end)), estimated: r.estimated }))
      .sort((a, b) => a.start - b.start || a.end - b.end)
    // The company's today (regional timezone), as the task screens use.
    const today = parseISO(currentDay().today)
    const todayCol = isBefore(today, min) || isBefore(max, today) ? null : col(today)
    return { days, bars, startCol: col(projectStart), endCol: col(parseISO(p.endDate)), todayCol }
  }, [p.tasks, p.startDate, p.endDate])

  if (!p.tasks.length) {
    return (
      <Card>
        <EmptyState icon={<GanttChart aria-hidden />} title="Nothing to plot yet" body="Tasks appear here as bars from their start to their due date." />
      </Card>
    )
  }

  const { days, bars, startCol, endCol, todayCol } = model
  const width = days.length * DAY
  const months = days.map((d, i) => ({ d, i })).filter(({ d, i }) => i === 0 || d.slice(0, 7) !== days[i - 1].slice(0, 7))
  // Week ticks on the company's first day of the week (regional weekStartsOn).
  const weekStartsOn = getRegion().weekStartsOn
  const weeks = days.map((d, i) => ({ d, i })).filter(({ d, i }) => i > 0 && weekStartIso(d, weekStartsOn) !== weekStartIso(days[i - 1], weekStartsOn))
  const marker = (colIndex: number, edge: 'start' | 'end') => `${(edge === 'start' ? colIndex : colIndex + 1) * DAY}rem`

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line px-4 py-2.5 text-xs text-muted">
        {TASK_STATUSES.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm" style={{ background: TASK_STATUS_COLOR[s] }} aria-hidden />
            {s}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-danger-500" aria-hidden />
          Today
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-0 border-s border-dashed border-ink-2" aria-hidden />
          Project start / end
        </span>
        <span className="ms-auto">Working days ({workingWeekLabel(getRegion().weekend)}) · {fmtDate(p.startDate)} → {fmtDate(p.endDate)}</span>
      </div>

      <div className="overflow-x-auto" role="region" aria-label="Project timeline" tabIndex={0}>
        <div style={{ width: `${width + LABEL}rem` }} className="relative">
          {/* Axis: months and week starts */}
          <div className="flex border-b border-line">
            <div className="sticky start-0 z-20 shrink-0 border-e border-line bg-surface px-4 py-1.5 text-xs font-medium text-muted" style={{ width: `${LABEL}rem` }}>
              Task
            </div>
            <div className="relative h-10" style={{ width: `${width}rem` }}>
              {months.map(({ d, i }) => (
                <span key={d} className="absolute top-1 border-s border-line-strong ps-1 text-xs font-medium whitespace-nowrap text-ink-2" style={{ insetInlineStart: `${i * DAY}rem` }}>
                  {format(parseISO(d), 'MMM yyyy')}
                </span>
              ))}
              {weeks.map(({ d, i }) => (
                <span key={d} className="num absolute bottom-1 ps-1 text-[0.6875rem] whitespace-nowrap text-subtle" style={{ insetInlineStart: `${i * DAY}rem` }}>
                  {format(parseISO(d), 'd')}
                </span>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div className="relative">
            {bars.map((b) => {
              const t = b.task
              return (
                <div key={t.id} className="flex border-b border-line last:border-b-0">
                  <button
                    type="button"
                    onClick={() => openTask(t.id)}
                    className="sticky start-0 z-20 flex shrink-0 items-center border-e border-line bg-surface px-4 py-2 text-start text-xs text-ink hover:text-brand-600 focus-visible:underline focus-visible:outline-none"
                    style={{ width: `${LABEL}rem` }}
                    title={t.title}
                  >
                    <span className="truncate">{t.title}</span>
                  </button>
                  <div className="relative h-9" style={{ width: `${width}rem` }}>
                    {weeks.map(({ d, i }) => (
                      <span key={d} className="absolute inset-y-0 border-s border-line/60" style={{ insetInlineStart: `${i * DAY}rem` }} aria-hidden />
                    ))}
                    <button
                      type="button"
                      onClick={() => openTask(t.id)}
                      className={cn(
                        'absolute top-2 h-5 rounded-md shadow-xs ring-1 ring-black/5 transition-[filter] hover:brightness-110 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none',
                        b.estimated && 'opacity-70',
                        t.overdue && 'ring-2 ring-danger-500',
                      )}
                      style={{
                        insetInlineStart: `${b.start * DAY + 0.125}rem`,
                        width: `${(b.end - b.start + 1) * DAY - 0.25}rem`,
                        background: TASK_STATUS_COLOR[t.status],
                      }}
                      aria-label={`${t.title}: ${t.status}, ${days[b.start]} to ${t.dueDate ?? 'no due date'}${t.overdue ? ', overdue' : ''}`}
                      title={`${t.title}\n${t.ownerName} · ${t.status}\n${fmtDate(days[b.start])} → ${t.dueDate ? fmtDate(t.dueDate) : 'no due date'}${b.estimated ? ' (start estimated)' : ''}`}
                    />
                  </div>
                </div>
              )
            })}

            {/* Markers over the track */}
            <div className="pointer-events-none absolute inset-y-0 z-10" style={{ insetInlineStart: `${LABEL}rem`, width: `${width}rem` }} aria-hidden>
              <span className="absolute inset-y-0 border-s border-dashed border-ink-2/60" style={{ insetInlineStart: marker(startCol, 'start') }} />
              <span className="absolute inset-y-0 border-s border-dashed border-ink-2/60" style={{ insetInlineStart: marker(endCol, 'end') }} />
              {todayCol !== null && <span className="absolute inset-y-0 w-0.5 bg-danger-500" style={{ insetInlineStart: `${todayCol * DAY + DAY / 2}rem` }} />}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
