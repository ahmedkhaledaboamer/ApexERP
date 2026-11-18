import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ColumnDef } from '@tanstack/react-table'
import type { MarketingReport, MarketingReportRow } from '@/modules/marketing/types'
import { fmtMoney } from '@/shared/lib/utils'
import { DataTable, useDataTable } from '@/shared/components/data-table'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { AXIS_TICK, C, CURSOR, TOOLTIP_STYLE } from './chartKit'

/** Cost per lead by campaign, plus lead source vs campaign attribution (GET /marketing/reports/cost-per-lead). */
export function CampaignCostReport({ data }: { data: MarketingReport }) {
  const money = (n: number | null) => (n === null ? '—' : fmtMoney(n, data.currency))
  const columns = useMemo<ColumnDef<MarketingReportRow>[]>(
    () => [
      { accessorKey: 'name', header: 'Campaign', cell: ({ row }) => <span className="font-medium text-ink">{row.original.name}</span> },
      { accessorKey: 'spend', header: 'Spend', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{money(getValue<number>())}</span> },
      { accessorKey: 'leads', header: 'Leads', meta: { align: 'end' } },
      { accessorKey: 'costPerLead', header: 'Cost per lead', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num font-medium">{money(getValue<number | null>())}</span> },
      { accessorKey: 'won', header: 'Won', meta: { align: 'end' } },
      { accessorKey: 'costPerWon', header: 'Cost per won', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{money(getValue<number | null>())}</span> },
      { accessorKey: 'sent', header: 'Emails sent', meta: { align: 'end' } },
      { accessorKey: 'opened', header: 'Opened', meta: { align: 'end' } },
      { accessorKey: 'replied', header: 'Replied', meta: { align: 'end' } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.currency],
  )
  const table = useDataTable({ id: 'reports-campaign-cpl', data: data.rows, columns, defaultPageSize: 25, getRowId: (r) => r.campaignId ?? 'none' })
  const chart = data.rows.filter((r) => r.costPerLead !== null).map((r) => ({ name: r.name, cpl: r.costPerLead }))

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Cost per lead by campaign" description="Spend in the period ÷ leads created in the period with that campaign." />
        <CardBody className="space-y-6">
          {chart.length > 0 && (
            <div dir="ltr" className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 4, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={AXIS_TICK} interval={0} />
                  <YAxis tickLine={false} axisLine={false} width={56} tick={AXIS_TICK} />
                  <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtMoney(Number(v), data.currency)} />
                  <Bar dataKey="cpl" name="Cost per lead" fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <DataTable table={table} empty={<EmptyState title="No campaign data" body="No campaign spend, leads or emails in this period." />} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Lead sources and campaign attribution" description="Leads created in the period by source, and how many name a campaign." />
        <CardBody>
          {data.sources.length === 0 ? (
            <EmptyState title="No leads in this period" body="Pick a longer period." />
          ) : (
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="text-start text-xs text-muted">
                  <th className="py-2 text-start font-medium">Source</th>
                  <th className="py-2 text-end font-medium">Leads</th>
                  <th className="py-2 text-end font-medium">From a campaign</th>
                  <th className="py-2 text-end font-medium">Won</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.sources.map((s) => (
                  <tr key={s.source}>
                    <td className="py-2 text-ink">{s.source}</td>
                    <td className="num py-2 text-end">{s.leads}</td>
                    <td className="num py-2 text-end">{s.attributed}</td>
                    <td className="num py-2 text-end">{s.won}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
