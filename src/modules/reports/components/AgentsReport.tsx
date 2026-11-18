import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ColumnDef } from '@tanstack/react-table'
import { ACTIVITY_LABELS, ACTIVITY_TYPES } from '@/shared/lib/constants'
import { fmtCompactMoney, fmtMoney } from '@/shared/lib/utils'
import { DataTable, ColumnPicker, useDataTable } from '@/shared/components/data-table'
import { Avatar } from '@/shared/components/ui/Avatar'
import { EmptyState } from '@/shared/components/ui/Feedback'
import type { AgentRow, SalesReport } from '@/modules/reports/types'
import { ReportCard } from './ReportCard'
import { AXIS_TICK, C, CURSOR, fmtHours, fmtPct, SubHeading, TOOLTIP_STYLE } from './chartKit'

const num = (v: number) => <span className="num">{v}</span>

export function AgentsReport({ data }: { data: SalesReport }) {
  const rows = data.agents
  const columns = useMemo<ColumnDef<AgentRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Agent',
        enableHiding: false,
        meta: { width: 200 },
        cell: ({ getValue }) => (
          <span className="flex items-center gap-2">
            <Avatar name={getValue<string>()} size="xs" />
            <span className="truncate font-medium">{getValue<string>()}</span>
          </span>
        ),
      },
      { accessorKey: 'leads', header: 'Leads', meta: { align: 'end' }, cell: ({ getValue }) => num(getValue<number>()) },
      ...ACTIVITY_TYPES.filter((t) => t !== 'meeting').map<ColumnDef<AgentRow>>((t) => ({
        id: t,
        accessorFn: (r) => r.activities[t],
        header: `${ACTIVITY_LABELS[t]}s`,
        meta: { align: 'end', label: `${ACTIVITY_LABELS[t]}s` },
        cell: ({ getValue }) => <span className="num text-ink-2">{getValue<number>()}</span>,
      })),
      { accessorKey: 'meetings', header: 'Meetings', meta: { align: 'end' }, cell: ({ getValue }) => num(getValue<number>()) },
      { accessorKey: 'totalActivities', header: 'Activities', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num font-medium">{getValue<number>()}</span> },
      { accessorKey: 'proposals', header: 'Proposals', meta: { align: 'end' }, cell: ({ getValue }) => num(getValue<number>()) },
      { accessorKey: 'won', header: 'Won', meta: { align: 'end' }, cell: ({ getValue }) => num(getValue<number>()) },
      { accessorKey: 'wonValue', header: 'Won value', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num font-medium">{fmtMoney(getValue<number>())}</span> },
      {
        accessorKey: 'conversion',
        header: 'Conversion',
        meta: { align: 'end' },
        cell: ({ row }) => (
          <span className="num" title={`${row.original.won} won of ${row.original.closed} closed`}>
            {row.original.closed ? fmtPct(row.original.conversion) : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'avgResponseHours',
        header: 'Avg response',
        meta: { align: 'end', label: 'Avg response' },
        sortUndefined: 'last',
        cell: ({ getValue }) => <span className="num text-ink-2">{fmtHours(getValue<number | null>())}</span>,
      },
    ],
    [],
  )
  const table = useDataTable({
    id: 'reports-agents',
    data: rows,
    columns,
    defaultPageSize: 25,
    defaultSorting: [{ id: 'wonValue', desc: true }],
    defaultHidden: ['email', 'whatsapp'],
  })

  return (
    <ReportCard
      id="agents"
      chart={
        rows.length === 0 ? (
          <EmptyState title="No agents in your scope" body="Agent results show up here once leads are assigned." />
        ) : (
          <>
            <SubHeading hint="Deals won in the period">Won value per agent</SubHeading>
            <div dir="ltr" style={{ height: Math.max(160, rows.length * 40 + 30) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                  <XAxis type="number" tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={(v: number) => fmtCompactMoney(v)} />
                  <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} tick={{ ...AXIS_TICK, fill: 'var(--color-ink-2)' }} />
                  <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [fmtMoney(v), 'Won value']} />
                  <Bar dataKey="wonValue" name="Won value" fill={C.brand} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )
      }
    >
      <DataTable
        table={table}
        minWidth={1040}
        toolbar={
          <div className="flex w-full items-center justify-between gap-2">
            <p className="text-xs text-muted">Click a column to sort. Avg response: lead created → first activity.</p>
            <span className="print:hidden">
              <ColumnPicker table={table} />
            </span>
          </div>
        }
      />
    </ReportCard>
  )
}
