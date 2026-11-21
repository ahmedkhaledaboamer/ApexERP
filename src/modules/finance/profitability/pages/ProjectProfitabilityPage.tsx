import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FolderKanban, Info } from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { StatCard } from '@/shared/components/ui/StatCard'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Amount, EntryLink, SimpleTable, SourceBadge, errMsg, fmtDate, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { fmtMoney } from '@/modules/finance/ledger/calc'
import { AXIS_TICK, C, CURSOR, Legend, LegendRow, TOOLTIP_STYLE } from '@/modules/reports/components/chartKit'
import { PATHS, projectPath } from '@/app/paths'
import { useProjectProfit } from '../api'

const short = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })

/** `/finance/profitability/projects/:id?from=&to=`: one project's revenue, costs, labour and margin by month, with the ledger lines behind it. */
export default function ProjectProfitabilityPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const q = { from: params.get('from') ?? undefined, to: params.get('to') ?? undefined }
  const r = useProjectProfit(id, q)
  const back = (
    <Link to={PATHS.financeProfitability} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
      <ArrowLeft className="size-3.5" aria-hidden /> Profitability
    </Link>
  )
  if (r.isPending) return <PageBody><Skeleton className="h-96 rounded-card" /></PageBody>
  if (r.isError || !r.data) return <PageBody>{back}<ErrorState message={errMsg(r.error)} onRetry={() => void r.refetch()} /></PageBody>
  const d = r.data
  const p = d.project
  const cur = d.meta.currency
  const chart = d.months.map((m) => ({ label: short(m.month), revenue: m.revenue, cost: m.directCosts + (m.labourCost ?? 0), margin: m.margin }))
  return (
    <>
      <PageHeader
        title={p.name}
        icon={<IconTile><FolderKanban aria-hidden /></IconTile>}
        description={
          <span>
            {p.customerName} · {p.departmentName} · {fmtDate(d.meta.from)} – {fmtDate(d.meta.to)} ·{' '}
            <Link to={projectPath(p.projectId)} className="text-brand-700 hover:underline dark:text-brand-300">Open project</Link>
          </span>
        }
      />
      <PageBody className="space-y-5">
        {back}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Revenue" value={<Amount value={p.revenue} currency={cur} />} hint={p.budget ? `Budget ${cur} ${fmtMoney(p.budget)} · ${p.budgetBilledPct ?? 0}% billed (all time)` : 'No project value on record'} />
          <StatCard label="Direct costs" value={<Amount value={p.directCosts} currency={cur} />} hint="Bills, expenses and claims tagged to the project" />
          <StatCard
            label={d.meta.labourVisible ? 'Labour (allocated)' : 'Labour hours'}
            value={d.meta.labourVisible ? <Amount value={p.labourCost ?? 0} currency={cur} /> : `${p.labourHours} h`}
            hint={`${p.labourHours} h logged of ${p.estimatedHours} h estimated${p.unratedHours ? ` · ${p.unratedHours} h unrated` : ''}`}
          />
          <StatCard label="Margin" value={<Amount value={p.margin} currency={cur} />} hint={p.marginPct === null ? 'No revenue in the period' : `${p.marginPct}% of revenue`} alert={p.margin < 0} />
        </div>

        <Card>
          <CardHeader title="Monthly trend" description={d.meta.labourVisible ? 'Revenue vs direct costs + allocated labour, and the margin.' : 'Revenue vs direct costs, and the margin before labour.'} />
          <CardBody>
            <LegendRow className="mb-3">
              <Legend color={C.green} label="Revenue" />
              <Legend color={C.red} label="Costs" />
              <Legend color={C.brand} label="Margin" line />
            </LegendRow>
            <div dir="ltr" className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => fmtMoney(v)} />
                  <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${cur} ${fmtMoney(v)}`} />
                  <Bar dataKey="revenue" name="Revenue" fill={C.green} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="cost" name="Costs" fill={C.red} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Line dataKey="margin" name="Margin" stroke={C.brand} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <SimpleTable
          label="Ledger lines of the project"
          head={
            <tr>
              <th className={th}>Date</th>
              <th className={th}>Entry</th>
              <th className={th}>Source</th>
              <th className={th}>Account</th>
              <th className={th}>Description</th>
              <th className={thEnd}>Revenue</th>
              <th className={thEnd}>Cost</th>
            </tr>
          }
        >
          {d.lines.length === 0 ? (
            <tr>
              <td className={td} colSpan={7}>
                <span className="text-muted">No journal lines tagged to this project in the period.</span>
              </td>
            </tr>
          ) : (
            d.lines.map((l, i) => (
              <tr key={`${l.entryId}-${i}`}>
                <td className={td}>{fmtDate(l.date)}</td>
                <td className={td}><EntryLink id={l.entryId} number={l.entryNumber} /></td>
                <td className={td}><SourceBadge type={l.sourceType} /></td>
                <td className={td}>{l.accountName}</td>
                <td className={td}>{l.description}</td>
                <td className={tdEnd}>{l.kind === 'revenue' ? <Amount value={l.amount} /> : null}</td>
                <td className={tdEnd}>{l.kind === 'cost' ? <Amount value={l.amount} /> : null}</td>
              </tr>
            ))
          )}
        </SimpleTable>
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {d.note}
        </p>
      </PageBody>
    </>
  )
}
