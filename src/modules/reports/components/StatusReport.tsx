import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowRight } from 'lucide-react'
import { useLookups } from '@/shared/hooks/useLookups'
import { fmtMoney } from '@/shared/lib/utils'
import { DataTable, useDataTable } from '@/shared/components/data-table'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import { EmptyState } from '@/shared/components/ui/Feedback'
import type { SalesReport, StatusRow } from '@/modules/reports/types'
import { ReportCard } from './ReportCard'
import { AXIS_TICK, CURSOR, fmtInt, fmtPct, Meter, SubHeading, TOOLTIP_STYLE } from './chartKit'

export function StatusReport({ data }: { data: SalesReport }) {
  const total = data.byStatus.reduce((s, r) => s + r.count, 0)
  const lookups = useLookups()
  const hex = (key: string) => lookups.status(key).color
  const columns = useMemo<ColumnDef<StatusRow>[]>(
    () => [
      { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { accessorKey: 'count', header: 'Leads', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{fmtInt(getValue<number>())}</span> },
      {
        accessorKey: 'share',
        header: 'Share',
        meta: { width: 200 },
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Meter value={row.original.share} color={hex(row.original.status)} className="w-24" />
            <span className="num text-muted">{fmtPct(row.original.share)}</span>
          </div>
        ),
      },
      { accessorKey: 'value', header: 'Value', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{fmtMoney(getValue<number>())}</span> },
    ],
    [lookups],
  )
  const table = useDataTable({ id: 'reports-status', data: data.byStatus, columns, defaultPageSize: 10 })

  return (
    <ReportCard
      id="status"
      chart={
        total === 0 ? (
          <EmptyState title="No leads in this period" body="Pick a wider date range to see how leads are spread across stages." />
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div>
              <SubHeading hint={`${fmtInt(total)} leads created`}>Leads per status</SubHeading>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byStatus} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ ...AXIS_TICK, fontSize: '0.6875rem' }} interval={0} angle={-30} textAnchor="end" height={56} />
                    <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} tick={AXIS_TICK} />
                    <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [fmtInt(v), 'Leads']} />
                    <Bar dataKey="count" name="Leads" radius={[4, 4, 0, 0]} maxBarSize={34}>
                      {data.byStatus.map((r) => (
                        <Cell key={r.status} fill={hex(r.status)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <SubHeading hint="Reached this stage or beyond">Stage conversion</SubHeading>
              <ol className="space-y-2.5">
                {data.funnel.map((f, i) => (
                  <li key={f.stage}>
                    {i > 0 && (
                      <p className="mb-1.5 flex items-center gap-1 ps-1 text-[0.6875rem] text-muted">
                        <ArrowRight className="size-3" aria-hidden />
                        <span className="num font-medium text-ink-2">{fmtPct(f.fromPrevious)}</span> moved on
                      </p>
                    )}
                    <div className="flex items-center justify-between text-[0.8125rem]">
                      <span className="flex items-center gap-2 text-ink-2">
                        <span className="size-2 rounded-full" style={{ background: hex(f.stage) }} aria-hidden />
                        {f.label}
                      </span>
                      <span className="num text-muted">
                        <span className="font-medium text-ink">{f.reached}</span> · {fmtPct(f.fromStart)}
                      </span>
                    </div>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${f.fromStart}%`, background: hex(f.stage) }} />
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )
      }
    >
      <DataTable table={table} minWidth={520} />
    </ReportCard>
  )
}
