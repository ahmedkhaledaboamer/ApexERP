import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import {
  AlarmClock,
  AlertTriangle,
  Banknote,
  Briefcase,
  ChevronDown,
  CircleDollarSign,
  Download,
  FileSpreadsheet,
  FileText,
  Gauge,
  HandCoins,
  Landmark,
  Percent,
  Receipt,
  Target,
  Ticket,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useCurrentUser } from '@/store/hooks'
import { useBranding } from '@/modules/tenancy/hooks'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { getRegion } from '@/shared/lib/region'
import { cn, fmtCompactMoney } from '@/shared/lib/utils'
import { scopeOf } from '@/shared/lib/permissions'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { StatCard } from '@/shared/components/ui/StatCard'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/shared/components/ui/Menu'
import { useToast } from '@/shared/components/ui/Toast'
import { AXIS_TICK, C, CURSOR, Legend, LegendRow, TOOLTIP_STYLE, fmtInt } from '@/modules/reports/components/chartKit'
import { downloadExcel, XL, type ExportSheet } from '@/modules/reports/lib/exportExcel'
import { useTrackReportView } from '@/modules/reports/hub/api'
import { PeriodFilter, isPeriodChoice, resolvePeriod, type PeriodChoice } from '@/modules/finance/profitability/components/PeriodFilter'
import { fmtMoney } from '@/modules/finance/ledger/calc'
import { useCompanyPerformance } from './api'
import { PERIOD_LABEL } from './calc'
import type { CompanyPerformance, FinancialKpis, PerformanceAlert } from './types'

/**
 * `/reports/performance`: Company performance, the management view. Sections come from the API per role; a section the
 * role can't see is absent (financial tiles are hidden, never shown as zero). Period selector (company timezone), Excel
 * export and a print layout for PDF.
 */
export default function PerformancePage() {
  const user = useCurrentUser()
  if (!user) return null
  if (scopeOf(user.role, 'reports') === 'hidden') {
    return (
      <PageBody>
        <EmptyState title="Company performance isn’t part of your role" body={`As ${user.role}, you don’t have access to reports. Ask an administrator if you need them.`} />
      </PageBody>
    )
  }
  return <Performance />
}

const pct = (n: number | null) => (n === null ? '—' : `${n}%`)
const money = (cur: string, n: number) => (
  <span>
    <span className="me-1 text-xs font-medium text-muted">{cur}</span>
    {fmtCompactMoney(n)}
  </span>
)
const changeOf = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : undefined)
const short = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })

function Performance() {
  const toast = useToast()
  const user = useCurrentUser()!
  const branding = useBranding()
  const [params, setParams] = useSearchParams()
  const [exporting, setExporting] = useState(false)
  const today = todayIsoIn(getRegion().timezone)
  const choice: PeriodChoice = isPeriodChoice(params.get('period')) ? (params.get('period') as PeriodChoice) : 'ytd'
  const range = resolvePeriod(choice, today, { from: params.get('from'), to: params.get('to') })
  const q = useCompanyPerformance(range)
  useTrackReportView('company-performance')
  const label = choice === 'custom' ? `${range.from} – ${range.to}` : PERIOD_LABEL[choice]

  function update(next: Record<string, string | null>) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(next)) if (v) p.set(k, v)
        else p.delete(k)
        return p
      },
      { replace: true },
    )
  }

  async function exportExcel(d: CompanyPerformance) {
    setExporting(true)
    try {
      await downloadExcel(`company-performance-${d.from}-to-${d.to}`, sheetsOf(d), `${label} (${d.from} – ${d.to}) · Generated ${format(new Date(), 'd MMM yyyy HH:mm')} by ${user.name}`)
      toast.success('Excel file downloaded', 'KPIs, monthly trend and department scorecard')
    } catch {
      toast.error('Couldn’t create the Excel file', 'Try again in a moment.')
    } finally {
      setExporting(false)
    }
  }

  const d = q.data
  return (
    <>
      <PrintStyles />
      <PageHeader
        className="print:hidden"
        title="Company performance"
        icon={<IconTile><TrendingUp aria-hidden /></IconTile>}
        description="Sales, delivery, people and — for finance roles — revenue, margin, cash and receivables in one view."
        actions={
          <Menu
            className="w-56"
            trigger={(props) => (
              <Button {...props} loading={exporting} disabled={!d}>
                <Download />
                Export
                <ChevronDown />
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>Excel</MenuLabel>
                <MenuItem icon={<FileSpreadsheet />} onSelect={() => { close(); if (d) void exportExcel(d) }}>KPIs and scorecard</MenuItem>
                <MenuSeparator />
                <MenuLabel>PDF</MenuLabel>
                <MenuItem
                  icon={<FileText />}
                  onSelect={() => {
                    close()
                    toast.info('Choose “Save as PDF” in the print dialog')
                    window.setTimeout(() => window.print(), 150)
                  }}
                >
                  Print view
                </MenuItem>
              </>
            )}
          </Menu>
        }
      />
      <PageBody className="space-y-6">
        <div className="hidden border-b border-line pb-3 print:block">
          <p className="text-xs text-muted">{branding.displayName} · Company performance</p>
          <h1 className="mt-1 text-[1.375rem] font-semibold">Company performance · {label}</h1>
          <p className="mt-1 text-[0.8125rem] text-ink-2">{d ? `${d.from} – ${d.to}` : ''} · Generated {format(new Date(), 'd MMM yyyy, HH:mm')} by {user.name}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3 print:hidden" role="group" aria-label="Filters">
          <PeriodFilter
            choice={choice}
            range={range}
            onChoice={(c) => update({ period: c === 'ytd' ? null : c, ...(c === 'custom' ? { from: range.from, to: range.to } : { from: null, to: null }) })}
            onCustom={(r) => update({ period: 'custom', from: r.from, to: r.to })}
          />
          {d && <span className="ms-auto pb-2 text-xs text-muted">As of {d.asOf} ({d.timezone})</span>}
        </div>
        {q.isPending ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-32 rounded-card" />)}</div>
        ) : q.isError || !d ? (
          <ErrorState message={q.error instanceof Error ? q.error.message : 'Couldn’t load the figures.'} onRetry={() => void q.refetch()} />
        ) : (
          <div className={cn('space-y-6 transition-opacity', q.isPlaceholderData && 'opacity-60')}>
            {d.alerts.length > 0 && <Alerts alerts={d.alerts} />}
            {d.financial && <FinancialSection f={d.financial} />}
            <OperationalSection d={d} />
            <Charts d={d} />
            {d.departments && <ScorecardSection d={d} />}
          </div>
        )}
      </PageBody>
    </>
  )
}

/* ---------------- sections ---------------- */

function Section({ title, label, children }: { title: string; label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="space-y-3 print:break-inside-avoid">
      <h2 className="text-[0.9375rem] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  )
}

const GRID = 'grid grid-cols-1 gap-4 min-[26.25rem]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 print:grid-cols-3'

function Alerts({ alerts }: { alerts: PerformanceAlert[] }) {
  const tone = { danger: 'border-danger-500/40 bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-500', warning: 'border-warning-500/40 bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500', info: 'border-line bg-sunken/60 text-ink-2' }
  return (
    <section aria-label="Alerts" className="space-y-2">
      {alerts.map((a) => (
        <div key={a.id} className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-[0.8125rem]', tone[a.severity])}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{a.title}</p>
            <p className="mt-0.5">{a.detail}</p>
          </div>
          {a.link && (
            <Link to={a.link} className="shrink-0 font-medium underline print:hidden">
              Open
            </Link>
          )}
        </div>
      ))}
    </section>
  )
}

function FinancialSection({ f }: { f: FinancialKpis }) {
  const c = f.currency
  return (
    <Section title="Financials" label="Financial KPIs">
      <div className={GRID}>
        <StatCard label="Revenue (period)" icon={<CircleDollarSign />} value={money(c, f.revenue)} delta={changeOf(f.revenue, f.revenueLy)} deltaLabel="vs same period last year" hint={f.revenueLy ? undefined : 'No revenue last year'} spark={f.months.map((m) => m.revenue)} sparkColor={C.green} />
        <StatCard label="Revenue month to date" icon={<TrendingUp />} value={money(c, f.revenueMtd)} delta={changeOf(f.revenueMtd, f.revenueMtdLy)} deltaLabel="vs last year" hint={`Last year ${c} ${fmtMoney(f.revenueMtdLy)}`} />
        <StatCard label="Revenue year to date" icon={<TrendingUp />} value={money(c, f.revenueYtd)} delta={changeOf(f.revenueYtd, f.revenueYtdLy)} deltaLabel="vs last year" hint={`Last year ${c} ${fmtMoney(f.revenueYtdLy)}`} />
        <StatCard label="Gross margin" icon={<Percent />} value={pct(f.grossMarginPct)} hint={`Cost of sales ${c} ${fmtMoney(f.costOfSales)}`} />
        <StatCard label="Net profit year to date" icon={<Gauge />} value={money(c, f.netProfitYtd)} alert={f.netProfitYtd < 0} hint={`Period: ${c} ${fmtMoney(f.netProfit)}`} />
        <StatCard label="Cash and bank" icon={<Landmark />} value={money(c, f.cashBalance)} spark={f.months.map((m) => m.cash)} to="/finance/banking" />
        <StatCard label="Receivables overdue" icon={<Receipt />} value={money(c, f.arOverdue)} alert={f.arOverdue > 0} hint={`${pct(f.arOverduePct)} of ${c} ${fmtMoney(f.arOutstanding)} open · DSO ${f.dso ?? '—'} days`} to="/finance/receivables" />
        <StatCard label="Payables" icon={<HandCoins />} value={money(c, f.apOpen)} hint={`${c} ${fmtMoney(f.apOverdue)} overdue · ${c} ${fmtMoney(f.apDueThisWeek)} due this week`} to="/finance/bills?tab=payables" />
        <StatCard label="Payroll cost" icon={<Banknote />} value={pct(f.payrollCostPct)} hint={`${c} ${fmtMoney(f.payrollCost)} of revenue`} lowerIsBetter />
        <StatCard label="Events ROI" icon={<Ticket />} value={pct(f.eventsRoiPct)} hint={`Revenue ${c} ${fmtMoney(f.eventsRevenue)} · cost ${c} ${fmtMoney(f.eventsCost)}`} to="/finance/profitability?tab=events" />
      </div>
    </Section>
  )
}

function OperationalSection({ d }: { d: CompanyPerformance }) {
  const s = d.sales
  const t = d.delivery
  const p = d.people
  if (!s && !t && !p) return null
  return (
    <Section title="Sales, delivery and people" label="Operational KPIs">
      <div className={GRID}>
        {s && (
          <>
            <StatCard label="Pipeline value" icon={<Briefcase />} value={fmtCompactMoney(s.pipelineValue)} hint={`${s.openLeads} open lead${s.openLeads === 1 ? '' : 's'}`} to="/leads/pipeline" />
            <StatCard label="Win rate" icon={<Target />} value={pct(s.winRate)} hint={`${s.won} won · ${s.lost} lost in the period`} />
            <StatCard label="Leads this month" icon={<UserPlus />} value={fmtInt(s.leadsThisMonth)} delta={changeOf(s.leadsThisMonth, s.leadsLastMonth)} deltaLabel="vs last month" />
          </>
        )}
        {t && (
          <>
            <StatCard label="Active projects" icon={<Briefcase />} value={fmtInt(t.activeProjects)} hint={`${t.openTasks} open tasks`} to="/projects" />
            <StatCard label="Overdue tasks" icon={<AlarmClock />} value={fmtInt(t.overdueTasks)} alert={t.overdueTasks > 0} hint={`Completion ${pct(t.completionRatePct)} of tasks due in the period`} to="/tasks/list" />
          </>
        )}
        {p && (
          <>
            <StatCard label="Headcount" icon={<Users />} value={fmtInt(p.headcount)} hint={`${p.joiners} joined · ${p.leavers} left · turnover ${pct(p.turnoverPct)}`} to="/hr/reports" />
            <StatCard label="Open positions" icon={<UserPlus />} value={fmtInt(p.openPositions)} to="/hr/recruitment" />
          </>
        )}
      </div>
    </Section>
  )
}

function ChartCard({ title, description, legend, children }: { title: string; description: string; legend?: ReactNode; children: ReactNode }) {
  return (
    <Card className="print:break-inside-avoid print:shadow-none">
      <CardHeader title={title} description={description} />
      <CardBody>
        {legend && <LegendRow className="mb-3">{legend}</LegendRow>}
        <div dir="ltr" className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            {children as never}
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  )
}

function Charts({ d }: { d: CompanyPerformance }) {
  const f = d.financial
  const months = f?.months.map((m) => ({ ...m, label: short(m.month) })) ?? []
  const stages = d.sales?.byStage ?? []
  const tasks = d.delivery?.months.map((m) => ({ ...m, label: short(m.month) })) ?? []
  const charts: ReactNode[] = []
  if (f) {
    charts.push(
      <ChartCard key="rev" title="Revenue vs expenses" description="Last 12 months, from the ledger." legend={<><Legend color={C.green} label="Revenue" /><Legend color={C.red} label="Expenses" /></>}>
        <ComposedChart data={months} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmtCompactMoney(v)} />
          <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${f.currency} ${fmtMoney(v)}`} />
          <Bar dataKey="revenue" name="Revenue" fill={C.green} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line dataKey="expenses" name="Expenses" stroke={C.red} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ChartCard>,
      <ChartCard key="cash" title="Cash and bank" description="Balance at each month end." legend={<Legend color={C.blue} label="Cash" />}>
        <AreaChart data={months} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmtCompactMoney(v)} />
          <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${f.currency} ${fmtMoney(v)}`} />
          <Area dataKey="cash" name="Cash" stroke={C.blue} fill={C.blue} fillOpacity={0.12} strokeWidth={2} />
        </AreaChart>
      </ChartCard>,
    )
  }
  if (stages.length) {
    charts.push(
      <ChartCard key="stages" title="Pipeline by stage" description="Open leads and their value today." legend={<Legend color={C.brand} label="Value" />}>
        <BarChart data={stages} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmtCompactMoney(v)} />
          <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v: number, _n, item) => [`${fmtMoney(v)} · ${(item?.payload as { count?: number })?.count ?? 0} leads`, 'Value']} />
          <Bar dataKey="value" name="Value" fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ChartCard>,
    )
  }
  if (tasks.length) {
    charts.push(
      <ChartCard key="tasks" title="Task completion" description="Tasks created and completed per month, in your scope." legend={<><Legend color={C.grey} label="Created" /><Legend color={C.green} label="Completed" /></>}>
        <BarChart data={tasks} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="created" name="Created" fill={C.grey} radius={[4, 4, 0, 0]} maxBarSize={18} />
          <Bar dataKey="completed" name="Completed" fill={C.green} radius={[4, 4, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ChartCard>,
    )
  }
  if (!charts.length) return null
  return (
    <Section title="Trends" label="Trends">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 print:grid-cols-2">{charts}</div>
    </Section>
  )
}

function ScorecardSection({ d }: { d: CompanyPerformance }) {
  const s = d.departments!
  const cur = d.financial?.currency ?? ''
  const cell = 'px-3 py-2 text-end num'
  return (
    <Section title="Department scorecard" label="Department scorecard">
      {s.rows.length === 0 ? (
        <Card><EmptyState title="No departments in your scope" body="The scorecard lists the departments you head." /></Card>
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-[0.8125rem]" aria-label="Department scorecard">
            <thead className="border-b border-line bg-sunken/60 text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">Department</th>
                {s.financialColumns && (
                  <>
                    <th className="px-3 py-2 text-end font-medium">Revenue{cur ? ` (${cur})` : ''}</th>
                    <th className="px-3 py-2 text-end font-medium">Cost</th>
                    <th className="px-3 py-2 text-end font-medium">Margin</th>
                    <th className="px-3 py-2 text-end font-medium">Margin %</th>
                  </>
                )}
                {s.budgetColumn && <th className="px-3 py-2 text-end font-medium">Budget variance</th>}
                <th className="px-3 py-2 text-end font-medium">Headcount</th>
                <th className="px-3 py-2 text-end font-medium">Overdue tasks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.rows.map((r) => (
                <tr key={r.departmentId}>
                  <td className="px-3 py-2">
                    <Link to={`/departments/${encodeURIComponent(r.departmentId)}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{r.name}</Link>
                  </td>
                  {s.financialColumns && (
                    <>
                      <td className={cell}>{fmtMoney(r.revenue ?? 0)}</td>
                      <td className={cell}>{fmtMoney(r.cost ?? 0)}</td>
                      <td className={cn(cell, (r.margin ?? 0) < 0 && 'text-danger-600')}>{fmtMoney(r.margin ?? 0)}</td>
                      <td className={cell}>{pct(r.marginPct)}</td>
                    </>
                  )}
                  {s.budgetColumn && <td className={cn(cell, (r.budgetVariance ?? 0) > 0 && 'text-danger-600')}>{r.budgetVariance === null ? '—' : fmtMoney(r.budgetVariance)}</td>}
                  <td className={cell}>{r.headcount}</td>
                  <td className={cn(cell, r.overdueTasks > 0 && 'text-danger-600')}>{r.overdueTasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

/* ---------------- Excel ---------------- */

function sheetsOf(d: CompanyPerformance): ExportSheet[] {
  const sheets: ExportSheet[] = []
  const kpis: (string | number | null)[][] = []
  const f = d.financial
  if (f) {
    kpis.push(
      ['Revenue (period)', f.revenue, f.revenueLy],
      ['Revenue month to date', f.revenueMtd, f.revenueMtdLy],
      ['Revenue year to date', f.revenueYtd, f.revenueYtdLy],
      ['Gross margin %', f.grossMarginPct, null],
      ['Net profit (period)', f.netProfit, null],
      ['Net profit year to date', f.netProfitYtd, null],
      ['Cash and bank', f.cashBalance, null],
      ['Receivables open', f.arOutstanding, null],
      ['Receivables overdue', f.arOverdue, null],
      ['DSO (days)', f.dso, null],
      ['Payables open', f.apOpen, null],
      ['Payroll cost % of revenue', f.payrollCostPct, null],
      ['Events ROI %', f.eventsRoiPct, null],
    )
  }
  if (d.sales) kpis.push(['Pipeline value', d.sales.pipelineValue, null], ['Win rate %', d.sales.winRate, null], ['Leads this month', d.sales.leadsThisMonth, d.sales.leadsLastMonth])
  if (d.delivery) kpis.push(['Active projects', d.delivery.activeProjects, null], ['Overdue tasks', d.delivery.overdueTasks, null], ['Task completion %', d.delivery.completionRatePct, null])
  if (d.people) kpis.push(['Headcount', d.people.headcount, null], ['Turnover %', d.people.turnoverPct, null], ['Open positions', d.people.openPositions, null])
  sheets.push({ name: 'KPIs', title: 'Company performance — KPIs', columns: [{ header: 'KPI', width: 32 }, { header: 'Value', format: '#,##0.0' }, { header: 'Comparison (last year / last month)', format: '#,##0.0', width: 34 }], rows: kpis })
  if (f) {
    sheets.push({
      name: 'Monthly',
      title: `Revenue, expenses and cash by month (${f.currency})`,
      columns: [{ header: 'Month' }, { header: 'Revenue', format: XL.money }, { header: 'Expenses', format: XL.money }, { header: 'Cash at month end', format: XL.money }],
      rows: f.months.map((m) => [m.month, m.revenue, m.expenses, m.cash]),
    })
  }
  if (d.departments) {
    const fin = d.departments.financialColumns
    sheets.push({
      name: 'Departments',
      title: 'Department scorecard',
      columns: [{ header: 'Department', width: 24 }, ...(fin ? [{ header: 'Revenue', format: XL.money }, { header: 'Cost', format: XL.money }, { header: 'Margin', format: XL.money }, { header: 'Margin %', format: XL.pct }] : []), { header: 'Headcount' }, { header: 'Overdue tasks' }],
      rows: d.departments.rows.map((r) => [r.name, ...(fin ? [r.revenue, r.cost, r.margin, r.marginPct] : []), r.headcount, r.overdueTasks]),
    })
  }
  return sheets
}
