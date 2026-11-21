import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS_TICK, C, CURSOR, Meter, TOOLTIP_STYLE, fmtInt } from '@/modules/reports/components/chartKit'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { fmtDate } from '@/shared/lib/utils'

/** Building blocks of the HR report tabs (same chart kit and cards as Marketing / Event analytics). */

export const monthLabel = (month: string) => fmtDate(`${month}-01`, 'MMM yy')
export const pctText = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`)
export const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`

export function Panel({ title, description, children, action, className }: { title: string; description?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} action={action} />
      <CardBody>{children}</CardBody>
    </Card>
  )
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">{children}</div>
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <section aria-label="Key figures" className="grid grid-cols-1 gap-4 min-[26.25rem]:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">{children}</section>
}

/** Ranked horizontal meters (counts per group). */
export function BarList({ rows, label, value }: { rows: { key: string; label: string; count: number }[]; label: string; value?: (r: { count: number }) => string }) {
  if (!rows.length) return <EmptyState title="Nothing to show" body="No data for this period and department." />
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <ul className="space-y-3" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key || 'none'} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
            <span className="truncate text-ink">{r.label}</span>
            <span className="num text-ink-2">{value ? value(r) : fmtInt(r.count)}</span>
          </div>
          <Meter value={(r.count / max) * 100} />
        </li>
      ))}
    </ul>
  )
}

/** One series per month: bars (counts) or a line (rates / levels), optional target line. One y-axis. */
export function MonthChart<T extends { month: string }>({
  data,
  dataKey,
  name,
  kind = 'bar',
  color = C.brand,
  unit = '',
  target,
  label,
}: {
  data: T[]
  dataKey: keyof T & string
  name: string
  kind?: 'bar' | 'line'
  color?: string
  unit?: string
  target?: number | null
  label: string
}) {
  if (!data.length) return <EmptyState title="No months to show" body="The period hasn’t started yet." />
  const rows = data.map((d) => ({ ...d, label: monthLabel(d.month) }))
  const fmt = (v: unknown) => (v === null || v === undefined ? '—' : `${v}${unit}`)
  return (
    <div dir="ltr" className="h-56" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'bar' ? (
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} minTickGap={8} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={AXIS_TICK} />
            <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v) => [fmt(v), name]} />
            <Bar dataKey={dataKey} name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={26} />
          </BarChart>
        ) : (
          <LineChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} minTickGap={8} />
            <YAxis tickLine={false} axisLine={false} width={40} tick={AXIS_TICK} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [fmt(v), name]} />
            {target !== null && target !== undefined && <ReferenceLine y={target} stroke={C.amber} strokeDasharray="5 4" label={{ value: `Target ${target}${unit}`, fill: '#8e8e99', fontSize: 11, position: 'insideTopRight' }} />}
            <Line dataKey={dataKey} name={name} stroke={color} strokeWidth={2} dot={{ r: 3 }} type="monotone" connectNulls />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  align?: 'end'
}

/** A plain, accessible table (the reports' detail lists). */
export function SimpleTable<T>({ rows, columns, label, empty, rowKey }: { rows: T[]; columns: Column<T>[]; label: string; empty: string; rowKey: (row: T, i: number) => string }) {
  if (!rows.length) return <p className="py-4 text-center text-[0.8125rem] text-muted">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-[0.8125rem]" aria-label={label}>
        <thead>
          <tr className="border-b border-line text-start text-xs text-muted">
            {columns.map((c) => (
              <th key={c.header} scope="col" className={`px-2 py-2 font-medium ${c.align === 'end' ? 'text-end' : 'text-start'}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className="border-b border-line/60 last:border-0">
              {columns.map((c) => (
                <td key={c.header} className={`px-2 py-2 text-ink-2 ${c.align === 'end' ? 'num text-end' : ''}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
