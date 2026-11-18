import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { cn } from '@/shared/lib/utils'
import { DataTable, useDataTable } from '@/shared/components/data-table'
import { Avatar } from '@/shared/components/ui/Avatar'
import { EmptyState } from '@/shared/components/ui/Feedback'
import type { SalesReport, TargetCell, TargetRow } from '@/modules/reports/types'
import { ReportCard } from './ReportCard'
import { SubHeading } from './chartKit'
import { isTracked } from '@/modules/targets/lib'
import { TargetNotTracked } from '@/modules/targets/components/TargetProgress'

/** Green at target, brand while on pace, amber when behind the month's pace. */
function tone(pct: number, elapsed: number) {
  if (pct >= 100) return 'bg-success-500'
  if (pct >= elapsed * 0.9) return 'bg-brand-500'
  return 'bg-warning-500'
}

/** A target of 0 means "no target": the kind is left out of the overall figure. */
const hasTarget = (cell: TargetCell | undefined) => !!cell && cell.target > 0

/** Counts toward completion: has a target and is tracked (events are n/a until EVENTS_ENABLED). */
const isCounted = (cell: TargetCell | undefined) => hasTarget(cell) && isTracked(cell!.key)

/** Average completion across counted kinds, each capped at 100; null when there are none. */
function overallOf(cells: TargetCell[]): number | null {
  const set = cells.filter(isCounted)
  if (!set.length) return null
  return Math.round(set.reduce((s, c) => s + Math.min(100, c.pct), 0) / set.length)
}

function ProgressCell({ cell, elapsed }: { cell: TargetCell; elapsed: number }) {
  if (!isTracked(cell.key)) {
    return (
      <div className="min-w-24">
        <TargetNotTracked />
        <div aria-hidden className="mt-1 h-1.5 rounded-full border border-dashed border-line" />
      </div>
    )
  }
  if (!hasTarget(cell)) {
    return (
      <div className="min-w-24" title={`${cell.label}: no target set`}>
        <p className="text-xs text-subtle">{cell.actual > 0 ? `${cell.actual} · No target` : 'No target'}</p>
        <div aria-hidden className="mt-1 h-1.5 rounded-full border border-dashed border-line-strong" />
      </div>
    )
  }
  return (
    <div className="min-w-24" title={`${cell.label}: ${cell.actual} of ${cell.target} (${cell.pct}%)`}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="num">
          <span className="font-medium text-ink">{cell.actual}</span>
          <span className="text-muted">/{cell.target}</span>
        </span>
        <span className={cn('num', cell.pct >= 100 ? 'text-success-600' : 'text-muted')}>{cell.pct}%</span>
      </div>
      <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div className={cn('h-full rounded-full', tone(cell.pct, elapsed))} style={{ width: `${Math.min(100, cell.pct)}%` }} />
      </div>
    </div>
  )
}

type Row = Omit<TargetRow, 'overall'> & { overall: number | null }

export function TargetsReport({ data }: { data: SalesReport }) {
  const t = data.targets
  const kinds = t.rows[0]?.cells ?? []
  // Recomputed here so kinds without a target never drag the overall figure down.
  const rows = useMemo<Row[]>(
    () => t.rows.map((r) => ({ ...r, overall: overallOf(r.cells) })).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1)),
    [t.rows],
  )
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Agent',
        meta: { width: 190 },
        cell: ({ getValue }) => (
          <span className="flex items-center gap-2">
            <Avatar name={getValue<string>()} size="xs" />
            <span className="truncate font-medium">{getValue<string>()}</span>
          </span>
        ),
      },
      ...kinds.map<ColumnDef<Row>>((k, i) => ({
        id: k.key,
        header: k.label,
        accessorFn: (r) => (isCounted(r.cells[i]) ? r.cells[i].pct : -1),
        enableSorting: isTracked(k.key),
        cell: ({ row }) => <ProgressCell cell={row.original.cells[i]} elapsed={t.elapsed} />,
      })),
      {
        id: 'overall',
        header: 'Overall',
        meta: { align: 'end' },
        accessorFn: (r) => r.overall ?? -1,
        cell: ({ row }) => {
          const v = row.original.overall
          return v === null ? <span className="text-xs text-subtle">No targets</span> : <span className="num text-[0.875rem] font-semibold">{v}%</span>
        },
      },
    ],
    [t, kinds],
  )
  const table = useDataTable({ id: 'reports-targets', data: rows, columns, defaultPageSize: 25, defaultSorting: [{ id: 'overall', desc: true }] })

  return (
    <ReportCard
      id="targets"
      chart={
        t.rows.length === 0 ? (
          <EmptyState title="No agents with targets" body="Targets apply to sales agents in your scope." />
        ) : (
          <>
            <SubHeading
              hint={`${t.elapsed}% of the month elapsed${kinds.some((k) => !isTracked(k.key)) ? ' · events attended excluded (n/a until Events is enabled)' : ''}`}
            >
              {t.monthLabel} · overall completion
            </SubHeading>
            <ul className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
              {rows.map((r) => (
                <li key={r.userId} className="flex items-center gap-3">
                  <Avatar name={r.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-[0.8125rem]">
                      <span className="truncate text-ink-2">{r.name}</span>
                      {r.overall === null ? <span className="text-xs text-subtle">No targets</span> : <span className="num font-medium">{r.overall}%</span>}
                    </div>
                    <div className="relative mt-1.5 h-2 overflow-visible rounded-full bg-sunken">
                      <div className={cn('h-full rounded-full', tone(r.overall ?? 0, t.elapsed))} style={{ width: `${Math.min(100, r.overall ?? 0)}%` }} />
                      {t.elapsed < 100 && (
                        <span
                          className="absolute -top-1 h-4 w-px bg-ink/40"
                          style={{ insetInlineStart: `${t.elapsed}%` }}
                          title="Where the month should be by today"
                          aria-hidden
                        />
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-success-500" aria-hidden />At target</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-brand-500" aria-hidden />On pace</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-warning-500" aria-hidden />Behind pace</span>
              {t.elapsed < 100 && <span className="flex items-center gap-1.5"><span className="h-3 w-px bg-ink/40" aria-hidden />Today’s pace</span>}
            </div>
          </>
        )
      }
    >
      <DataTable table={table} minWidth={1100} />
    </ReportCard>
  )
}
