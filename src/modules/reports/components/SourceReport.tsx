import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ColumnDef } from '@tanstack/react-table'
import type { SourceType } from '@/shared/types'
import { cn, fmtCompactMoney, fmtMoney } from '@/shared/lib/utils'
import { DataTable, useDataTable } from '@/shared/components/data-table'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState } from '@/shared/components/ui/Feedback'
import type { SalesReport, SourceRow } from '@/modules/reports/types'
import { ReportCard } from './ReportCard'
import { AXIS_TICK, C, CURSOR, fmtInt, fmtPct, Legend, LegendRow, Meter, SubHeading, TOOLTIP_STYLE } from './chartKit'

export function SourceReport({ data }: { data: SalesReport }) {
  const rows = data.bySource
  const withLeads = rows.filter((r) => r.leads > 0)
  const [picked, setPicked] = useState<SourceType | null>(null)
  const selected = rows.find((r) => r.source === picked) ?? withLeads[0] ?? null

  const columns = useMemo<ColumnDef<SourceRow>[]>(
    () => [
      { accessorKey: 'label', header: 'Source', cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { accessorKey: 'leads', header: 'Leads', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{fmtInt(getValue<number>())}</span> },
      { accessorKey: 'won', header: 'Won', meta: { align: 'end' } },
      { accessorKey: 'lost', header: 'Lost', meta: { align: 'end' } },
      {
        accessorKey: 'winRate',
        header: 'Win rate',
        meta: { width: 160 },
        cell: ({ getValue }) => (
          <div className="flex items-center gap-2">
            <Meter value={getValue<number>()} color={C.green} className="w-16" />
            <span className="num text-muted">{fmtPct(getValue<number>())}</span>
          </div>
        ),
      },
      { accessorKey: 'value', header: 'Value', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{fmtMoney(getValue<number>())}</span> },
      { accessorKey: 'wonValue', header: 'Won value', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{fmtMoney(getValue<number>())}</span> },
    ],
    [],
  )
  const table = useDataTable({ id: 'reports-source', data: rows, columns, defaultPageSize: 10 })

  return (
    <ReportCard
      id="source"
      chart={
        withLeads.length === 0 ? (
          <EmptyState title="No leads in this period" body="Pick a wider date range to compare sources." />
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div>
              <SubHeading>Leads, won and lost per source</SubHeading>
              <LegendRow className="mb-2">
                <Legend color={C.brand} label="Leads" />
                <Legend color={C.green} label="Won" />
                <Legend color={C.grey} label="Lost" />
              </LegendRow>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
                    <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ ...AXIS_TICK, fontSize: '0.6875rem' }} interval={0} angle={-25} textAnchor="end" height={52} />
                    <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} tick={AXIS_TICK} />
                    <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="leads" name="Leads" fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={20} />
                    <Bar dataKey="won" name="Won" fill={C.green} radius={[4, 4, 0, 0]} maxBarSize={20} />
                    <Bar dataKey="lost" name="Lost" fill={C.grey} radius={[4, 4, 0, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <SubHeading hint="Won ÷ (won + lost)">Win rate per source</SubHeading>
              <ul className="space-y-3">
                {rows.map((r) => (
                  <li key={r.source}>
                    <div className="flex items-center justify-between text-[0.8125rem]">
                      <span className="text-ink-2">{r.label}</span>
                      <span className="num text-muted">
                        <span className="font-medium text-ink">{fmtPct(r.winRate)}</span> · {r.won}/{r.won + r.lost}
                      </span>
                    </div>
                    <Meter value={r.winRate} color={C.green} className="mt-1.5" />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )
      }
    >
      <DataTable table={table} minWidth={720} onRowClick={(r) => setPicked(r.source)} />
      {selected && (
        <Card className="p-5 print:break-inside-avoid">
          <SubHeading hint="Click a source row above to switch">Source detail · {selected.label}</SubHeading>
          {selected.details.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">No leads from this source in the period.</p>
          ) : (
            <ul className="divide-y divide-line">
              {selected.details.map((d) => (
                <li key={d.detail} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
                  <span className="truncate text-[0.8125rem] font-medium">{d.detail}</span>
                  <Meter value={(d.leads / Math.max(1, selected.leads)) * 100} className="col-span-2 sm:col-span-1" />
                  <span className={cn('num row-start-1 text-end text-[0.8125rem] text-muted sm:row-auto', 'col-start-2 sm:col-start-auto')}>
                    <span className="font-medium text-ink">{d.leads}</span> leads · {d.won} won · {fmtCompactMoney(d.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </ReportCard>
  )
}
