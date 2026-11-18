import { useMemo } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ColumnDef } from '@tanstack/react-table'
import { fmtMoney } from '@/shared/lib/utils'
import { DataTable, useDataTable } from '@/shared/components/data-table'
import type { FunnelMonth, SalesReport } from '@/modules/reports/types'
import { ReportCard } from './ReportCard'
import { AXIS_TICK, C, CURSOR, fmtPct, Legend, LegendRow, SubHeading, TOOLTIP_STYLE } from './chartKit'

export function FunnelReport({ data }: { data: SalesReport }) {
  const months = data.funnelMonthly
  const columns = useMemo<ColumnDef<FunnelMonth>[]>(
    () => [
      { accessorKey: 'month', header: 'Month', cell: ({ row }) => <span className="font-medium">{row.original.label}</span> },
      { accessorKey: 'created', header: 'Created', meta: { align: 'end' } },
      { accessorKey: 'won', header: 'Won', meta: { align: 'end' } },
      { accessorKey: 'wonValue', header: 'Won value', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{fmtMoney(getValue<number>())}</span> },
      { accessorKey: 'conversion', header: 'Conversion', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{fmtPct(getValue<number>())}</span> },
    ],
    [],
  )
  const table = useDataTable({ id: 'reports-funnel', data: months, columns, defaultPageSize: 25, defaultSorting: [{ id: 'month', desc: true }] })

  return (
    <ReportCard
      id="funnel"
      chart={
        <div className="space-y-6">
          <div>
            <SubHeading hint={`${months[0]?.label ?? ''} – ${months[months.length - 1]?.label ?? ''}`}>Created vs. won</SubHeading>
            <LegendRow className="mb-2">
              <Legend color={C.brand} label="Created" />
              <Legend color={C.green} label="Won" />
            </LegendRow>
            <div dir="ltr" className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={months} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={3}>
                  <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
                  <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} tick={AXIS_TICK} />
                  <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="created" name="Created" fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="won" name="Won" fill={C.green} radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <SubHeading hint="Won ÷ created in the month">Conversion rate</SubHeading>
            <div dir="ltr" className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={months} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="report-conv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.blue} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={C.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
                  <YAxis tickLine={false} axisLine={false} width={40} tick={AXIS_TICK} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [fmtPct(v), 'Conversion']} />
                  <Area type="monotone" dataKey="conversion" name="Conversion" stroke={C.blue} strokeWidth={2} fill="url(#report-conv)" dot={{ r: 3, strokeWidth: 0, fill: C.blue }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted">Months before lead records began include imported monthly totals.</p>
          </div>
        </div>
      }
    >
      <DataTable table={table} minWidth={520} />
    </ReportCard>
  )
}
