import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ColumnDef } from '@tanstack/react-table'
import { ChevronRight } from 'lucide-react'
import { fmtCompactMoney, fmtMoney } from '@/shared/lib/utils'
import { DataTable, useDataTable } from '@/shared/components/data-table'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState } from '@/shared/components/ui/Feedback'
import type { IndustryRow, SalesReport, SubIndustryRow } from '@/modules/reports/types'
import { ReportCard } from './ReportCard'
import { AXIS_TICK, C, CURSOR, fmtInt, fmtPct, Legend, LegendRow, Meter, SubHeading, TOOLTIP_STYLE } from './chartKit'

export function IndustryReport({ data }: { data: SalesReport }) {
  const [open, setOpen] = useState<IndustryRow | null>(null)
  const rows = data.byIndustry
  const columns = useMemo<ColumnDef<IndustryRow>[]>(
    () => [
      { accessorKey: 'label', header: 'Industry', cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { accessorKey: 'leads', header: 'Leads', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{fmtInt(getValue<number>())}</span> },
      { accessorKey: 'value', header: 'Value', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{fmtMoney(getValue<number>())}</span> },
      { accessorKey: 'won', header: 'Won', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{getValue<number>()}</span> },
      { accessorKey: 'wonValue', header: 'Won value', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{fmtMoney(getValue<number>())}</span> },
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
      {
        id: 'open',
        header: '',
        enableSorting: false,
        meta: { width: 120, align: 'end' },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted">
            {row.original.subIndustries.filter((s) => s.leads > 0).length} sub-industries
            <ChevronRight className="size-3.5" aria-hidden />
          </span>
        ),
      },
    ],
    [],
  )
  const table = useDataTable({ id: 'reports-industry', data: rows, columns, defaultPageSize: 10 })
  const height = Math.max(200, rows.length * 34 + 30)

  return (
    <ReportCard
      id="industry"
      chart={
        rows.length === 0 ? (
          <EmptyState title="No leads in this period" body="Pick a wider date range to compare industries." />
        ) : (
          <>
            <SubHeading hint="Click a row below for sub-industries">Leads and wins per industry</SubHeading>
            <LegendRow className="mb-2">
              <Legend color={C.brand} label="Leads" />
              <Legend color={C.green} label="Won" />
            </LegendRow>
            <div style={{ height }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} />
                  <YAxis type="category" dataKey="label" width={140} tickLine={false} axisLine={false} tick={{ ...AXIS_TICK, fill: 'var(--color-ink-2)' }} />
                  <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="leads" name="Leads" fill={C.brand} radius={[0, 4, 4, 0]} maxBarSize={12} />
                  <Bar dataKey="won" name="Won" fill={C.green} radius={[0, 4, 4, 0]} maxBarSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )
      }
    >
      <DataTable table={table} minWidth={760} onRowClick={setOpen} />
      <SubIndustryDrawer row={open} onClose={() => setOpen(null)} />
    </ReportCard>
  )
}

function SubIndustryDrawer({ row, onClose }: { row: IndustryRow | null; onClose: () => void }) {
  const subs = row?.subIndustries ?? []
  const max = Math.max(1, ...subs.map((s) => s.leads))
  const columns = useMemo<ColumnDef<SubIndustryRow>[]>(
    () => [
      { accessorKey: 'label', header: 'Sub-industry' },
      { accessorKey: 'leads', header: 'Leads', meta: { align: 'end' } },
      { accessorKey: 'value', header: 'Value', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{fmtMoney(getValue<number>())}</span> },
      { accessorKey: 'won', header: 'Won', meta: { align: 'end' } },
      { accessorKey: 'winRate', header: 'Win rate', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{fmtPct(getValue<number>())}</span> },
    ],
    [],
  )
  const table = useDataTable({ id: 'reports-subindustry', data: subs, columns, defaultPageSize: 25 })

  return (
    <Drawer
      open={!!row}
      onClose={onClose}
      title={row ? `${row.label} · sub-industries` : ''}
      description={row ? `${row.leads} leads · ${fmtCompactMoney(row.value)} pipeline · ${fmtPct(row.winRate)} win rate` : undefined}
    >
      <ul className="mb-6 space-y-3.5">
        {subs.map((s) => (
          <li key={s.subIndustry}>
            <div className="flex items-center justify-between text-[0.8125rem]">
              <span className="text-ink-2">{s.label}</span>
              <span className="num text-muted">
                <span className="font-medium text-ink">{s.leads}</span>
                {s.value > 0 && ` · ${fmtCompactMoney(s.value)}`}
              </span>
            </div>
            <Meter value={(s.leads / max) * 100} className="mt-1.5 h-2" />
          </li>
        ))}
      </ul>
      <DataTable table={table} minWidth={480} />
    </Drawer>
  )
}
