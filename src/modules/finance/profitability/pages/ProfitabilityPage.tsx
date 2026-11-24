import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ChevronDown, Download, FileSpreadsheet, FileText, Info, Lock, PieChart, Save } from 'lucide-react'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Tabs } from '@/shared/components/ui/Tabs'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { StatCard } from '@/shared/components/ui/StatCard'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem, MenuLabel } from '@/shared/components/ui/Menu'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { downloadCsv } from '@/modules/platform/csv'
import { toCsv } from '@/modules/hr/reports/calc'
import { downloadExcel, XL, type ExportColumn } from '@/modules/reports/lib/exportExcel'
import { useTrackReportView } from '@/modules/reports/hub/api'
import { Amount, SimpleTable, errMsg, fmtDate, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { fmtMoney } from '@/modules/finance/ledger/calc'
import { cn } from '@/shared/lib/utils'
import { financeProfitabilityProjectPath } from '@/app/paths'
import { profitabilityApi, useProfitOptions, useProfitReport, useSaveProfitSettings } from '../api'
import { PeriodFilter, isPeriodChoice, resolvePeriod, type PeriodChoice } from '../components/PeriodFilter'
import {
  PROFIT_REPORT_LABEL,
  type CustomerProfitability,
  type DepartmentPnl,
  type EventProfitability,
  type ProfitMeta,
  type ProfitOptions,
  type ProfitQuery,
  type ProfitReport,
  type ProjectProfitability,
} from '../types'

/**
 * `/finance/profitability` (?tab=projects|events|customers|departments|settings, ?period=, ?from=&to=, ?dept=):
 * project, event and customer profitability and the department P&L. Accounting full sees the labour allocation;
 * accounting view (Sales Manager) sees revenue and direct costs only. CSV and Excel exports come from the server's rows.
 */

type Tab = ProfitReport | 'settings'
const TABS: Tab[] = ['projects', 'events', 'customers', 'departments', 'settings']
const HUB_ID: Record<ProfitReport, string> = {
  projects: 'finance-profitability-projects',
  events: 'finance-profitability-events',
  customers: 'finance-profitability-customers',
  departments: 'finance-profitability-departments',
}

export default function ProfitabilityPage() {
  const options = useProfitOptions()
  if (options.isPending) return <PageBody><Skeleton className="h-96 rounded-card" /></PageBody>
  if (options.isError || !options.data) return <PageBody><ErrorState message={errMsg(options.error)} onRetry={() => void options.refetch()} /></PageBody>
  return <Profitability o={options.data} />
}

function Profitability({ o }: { o: ProfitOptions }) {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [exporting, setExporting] = useState(false)
  const requested = params.get('tab') as Tab | null
  const tab: Tab = requested && TABS.includes(requested) && (requested !== 'settings' || o.canEditSettings) ? requested : 'projects'
  const choice: PeriodChoice = isPeriodChoice(params.get('period')) ? (params.get('period') as PeriodChoice) : 'ytd'
  const range = resolvePeriod(choice, o.meta.today, { from: params.get('from'), to: params.get('to') })
  const departmentId = params.get('dept') ?? ''
  const q: ProfitQuery = useMemo(() => ({ from: range.from, to: range.to, departmentId: departmentId || undefined }), [range.from, range.to, departmentId])
  useTrackReportView(tab === 'settings' ? null : HUB_ID[tab])

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

  async function exportAs(kind: 'csv' | 'excel') {
    if (tab === 'settings') return
    setExporting(true)
    try {
      const x = await profitabilityApi.exportRows(tab, q)
      if (kind === 'csv') downloadCsv(x.fileName, toCsv(x.headers, x.rows))
      else {
        const columns: ExportColumn[] = x.headers.map((h) => ({ header: h, format: /%/.test(h) ? XL.pct : /hours|days|DSO|Attendees|Leads|Projects/i.test(h) ? '0.0' : XL.money }))
        await downloadExcel(x.fileName.replace(/\.csv$/, ''), [{ name: PROFIT_REPORT_LABEL[tab], title: `${PROFIT_REPORT_LABEL[tab]} · ${o.meta.currency}`, columns, rows: x.rows }], `${fmtDate(range.from)} – ${fmtDate(range.to)} · Generated ${format(new Date(), 'd MMM yyyy HH:mm')}`)
      }
      toast.success(kind === 'csv' ? 'CSV downloaded' : 'Excel file downloaded', `${x.rows.length} row${x.rows.length === 1 ? '' : 's'} · ${PROFIT_REPORT_LABEL[tab]}`)
    } catch (e) {
      toast.error('Couldn’t export the report', errMsg(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Profitability"
        icon={<IconTile><PieChart aria-hidden /></IconTile>}
        description={`Projects, events, customers and departments in ${o.meta.currency}, from the ledger${o.meta.labourVisible ? ' plus allocated labour' : ''}.`}
        actions={
          tab !== 'settings' ? (
            <Menu
              className="w-56"
              trigger={(props) => (
                <Button {...props} variant="secondary" loading={exporting}>
                  <Download />
                  Export
                  <ChevronDown />
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuLabel>{PROFIT_REPORT_LABEL[tab]}</MenuLabel>
                  <MenuItem icon={<FileText />} onSelect={() => { close(); void exportAs('csv') }}>CSV</MenuItem>
                  <MenuItem icon={<FileSpreadsheet />} onSelect={() => { close(); void exportAs('excel') }}>Excel</MenuItem>
                </>
              )}
            </Menu>
          ) : undefined
        }
      />
      <PageBody className="space-y-5">
        <Tabs<Tab>
          label="Profitability reports"
          value={tab}
          onChange={(t) => update({ tab: t === 'projects' ? null : t })}
          items={TABS.filter((t) => t !== 'settings' || o.canEditSettings).map((t) => ({ id: t, label: t === 'settings' ? 'Settings' : PROFIT_REPORT_LABEL[t] }))}
        />
        {tab === 'settings' ? (
          <SettingsCard o={o} />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
              <PeriodFilter
                choice={choice}
                range={range}
                onChoice={(c) => update({ period: c === 'ytd' ? null : c, ...(c === 'custom' ? { from: range.from, to: range.to } : { from: null, to: null }) })}
                onCustom={(r) => update({ period: 'custom', from: r.from, to: r.to })}
              />
              <label className="text-[0.8125rem]">
                <span className="mb-1 block text-xs text-muted">Department</span>
                <SelectInput aria-label="Department" value={departmentId} onChange={(e) => update({ dept: e.target.value || null })} className="w-56">
                  <option value="">All departments</option>
                  {o.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </SelectInput>
              </label>
              {!o.meta.labourVisible && (
                <p className="flex items-center gap-1.5 pb-2 text-xs text-muted">
                  <Lock className="size-3.5" aria-hidden /> Labour cost is visible to Company Admins, Management and Accountants; margins here are before labour.
                </p>
              )}
            </div>
            {tab === 'projects' && <ProjectsTab q={q} />}
            {tab === 'events' && <EventsTab q={q} />}
            {tab === 'customers' && <CustomersTab q={q} />}
            {tab === 'departments' && <DepartmentsTab q={q} />}
          </>
        )}
      </PageBody>
    </>
  )
}

/* ---------------- shared bits ---------------- */

function Pct({ value }: { value: number | null }) {
  if (value === null) return <span className="text-subtle">—</span>
  return <span className={cn('num', value < 0 && 'text-danger-600')}>{value.toFixed(1)}%</span>
}

function Loading<T>({ q, children }: { q: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown; isPlaceholderData?: boolean }; children: (d: T) => ReactNode }) {
  if (q.isPending) return <Skeleton className="h-80 rounded-card" />
  if (q.isError || !q.data) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
  return <div className={cn('space-y-5 transition-opacity', q.isPlaceholderData && 'opacity-60')}>{children(q.data)}</div>
}

const money = (m: ProfitMeta, n: number) => <Amount value={n} currency={m.currency} />

/* ---------------- projects ---------------- */

function ProjectsTab({ q }: { q: ProfitQuery }) {
  const r = useProfitReport('projects', q)
  return (
    <Loading q={r}>
      {(d: ProjectProfitability) => (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Revenue" value={money(d.meta, d.totals.revenue)} hint={`${d.rows.length} project${d.rows.length === 1 ? '' : 's'}`} />
            <StatCard label="Direct costs" value={money(d.meta, d.totals.directCosts)} hint="Bills, expenses and claims tagged to projects" />
            <StatCard
              label={d.meta.labourVisible ? 'Labour (allocated)' : 'Labour hours'}
              value={d.meta.labourVisible ? money(d.meta, d.totals.labourCost ?? 0) : `${d.totals.labourHours} h`}
              hint={d.meta.labourVisible ? `${d.totals.labourHours} h × hourly cost (${d.meta.standardHoursPerMonth} h / month)` : 'Cost hidden for your role'}
            />
            <StatCard label="Margin" value={money(d.meta, d.totals.margin)} hint={d.totals.marginPct === null ? 'No revenue yet' : `${d.totals.marginPct}% of revenue`} alert={d.totals.margin < 0} />
          </div>
          {d.rows.length === 0 ? (
            <Card><EmptyState title="No projects" body="No delivery project in this department." /></Card>
          ) : (
            <SimpleTable
              label="Project profitability"
              head={
                <tr>
                  <th className={th}>Project</th>
                  <th className={th}>Department</th>
                  <th className={thEnd}>Revenue</th>
                  <th className={thEnd}>Direct costs</th>
                  <th className={thEnd}>Labour h</th>
                  {d.meta.labourVisible && <th className={thEnd}>Labour cost</th>}
                  <th className={thEnd}>Margin</th>
                  <th className={thEnd}>Margin %</th>
                  <th className={thEnd}>Budget</th>
                  <th className={thEnd}>Billed of budget</th>
                </tr>
              }
            >
              {d.rows.map((p) => (
                <tr key={p.projectId} className="hover:bg-hover/50">
                  <td className={td}>
                    <Link to={financeProfitabilityProjectPath(p.projectId, q.from, q.to)} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                      {p.name}
                    </Link>
                    <p className="text-xs text-muted">{p.customerName} · {p.managerName}</p>
                  </td>
                  <td className={td}>{p.departmentName}</td>
                  <td className={tdEnd}><Amount value={p.revenue} blankZero /></td>
                  <td className={tdEnd}><Amount value={p.directCosts} blankZero /></td>
                  <td className={cn(tdEnd, 'num')}>
                    {p.labourHours}
                    {p.unratedHours > 0 && <span className="block text-[0.6875rem] text-warning-700 dark:text-warning-500" title="Hours of people without a contract in force: no cost allocated">{p.unratedHours} h unrated</span>}
                  </td>
                  {d.meta.labourVisible && <td className={tdEnd}><Amount value={p.labourCost ?? 0} blankZero /></td>}
                  <td className={tdEnd}><Amount value={p.margin} strong /></td>
                  <td className={tdEnd}><Pct value={p.marginPct} /></td>
                  <td className={tdEnd}>
                    {p.budget === null ? <span className="text-subtle">—</span> : <Amount value={p.budget} />}
                    {p.budgetSource && <span className="block text-[0.6875rem] text-muted">{p.budgetSource === 'lead' ? 'won deal' : p.budgetSource}</span>}
                  </td>
                  <td className={tdEnd}><Pct value={p.budgetBilledPct} /></td>
                </tr>
              ))}
            </SimpleTable>
          )}
          {d.meta.labourVisible && (
            <p className="flex items-start gap-1.5 text-xs text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Labour is an allocation, not a ledger posting: hours logged on the project’s tasks × the employee’s hourly cost (monthly contract pay ÷ {d.meta.standardHoursPerMonth} standard hours). Payroll stays in the department P&L.
            </p>
          )}
        </>
      )}
    </Loading>
  )
}

/* ---------------- events ---------------- */

function EventsTab({ q }: { q: ProfitQuery }) {
  const r = useProfitReport('events', q)
  return (
    <Loading q={r}>
      {(d: EventProfitability) => (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Event revenue" value={money(d.meta, d.totals.revenue)} hint={`${d.rows.length} event${d.rows.length === 1 ? '' : 's'} starting in the period`} />
            <StatCard label="Event costs" value={money(d.meta, d.totals.totalCost)} hint="Ledger + budget lines not billed" />
            <StatCard label="Profit" value={money(d.meta, d.totals.profit)} alert={d.totals.profit < 0} />
            <StatCard label="ROI" value={d.totals.roiPct === null ? '—' : `${d.totals.roiPct}%`} hint="(revenue − cost) ÷ cost" alert={(d.totals.roiPct ?? 0) < 0} />
          </div>
          {d.rows.length === 0 ? (
            <Card><EmptyState title="No events in this period" body="Pick another period to compare events." /></Card>
          ) : (
            <SimpleTable
              label="Event profitability"
              head={
                <tr>
                  <th className={th}>Event</th>
                  <th className={thEnd}>Revenue</th>
                  <th className={thEnd}>Ledger costs</th>
                  <th className={thEnd}>Budget lines (not billed)</th>
                  <th className={thEnd}>Profit</th>
                  <th className={thEnd}>ROI</th>
                  <th className={thEnd}>Attendees</th>
                  <th className={thEnd}>Cost / attendee</th>
                  <th className={thEnd}>Cost / lead</th>
                </tr>
              }
            >
              {d.rows.map((e) => (
                <tr key={e.eventId}>
                  <td className={td}>
                    <Link to={`/events/${encodeURIComponent(e.eventId)}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{e.name}</Link>
                    <p className="text-xs text-muted">{fmtDate(e.startDate)} · {e.isOrganizer ? 'Organized' : 'Attended'}</p>
                  </td>
                  <td className={tdEnd}>
                    <Amount value={e.revenue} blankZero />
                    {e.sponsorshipNotInvoiced > 0 && <span className="block text-[0.6875rem] text-muted">{fmtMoney(e.sponsorshipNotInvoiced)} sponsorship not invoiced</span>}
                  </td>
                  <td className={tdEnd}><Amount value={e.ledgerCosts} blankZero /></td>
                  <td className={tdEnd}><Amount value={e.budgetLineCosts} blankZero /></td>
                  <td className={tdEnd}><Amount value={e.profit} strong /></td>
                  <td className={tdEnd}><Pct value={e.roiPct} /></td>
                  <td className={cn(tdEnd, 'num')}>{e.attendees}</td>
                  <td className={tdEnd}>{e.costPerAttendee === null ? <span className="text-subtle">—</span> : <Amount value={e.costPerAttendee} />}</td>
                  <td className={tdEnd}>{e.costPerLead === null ? <span className="text-subtle">—</span> : <Amount value={e.costPerLead} />}</td>
                </tr>
              ))}
            </SimpleTable>
          )}
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {d.note}
          </p>
        </>
      )}
    </Loading>
  )
}

/* ---------------- customers ---------------- */

function CustomersTab({ q }: { q: ProfitQuery }) {
  const r = useProfitReport('customers', q)
  return (
    <Loading q={r}>
      {(d: CustomerProfitability) => {
        const ranked = [...d.rows].filter((c) => c.revenue !== 0 || c.directCosts !== 0).sort((a, b) => b.grossMargin - a.grossMargin)
        return (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Revenue (net of credit notes)" value={money(d.meta, d.totals.revenue)} hint={`${d.rows.length} customers`} />
              <StatCard label="Gross margin" value={money(d.meta, d.totals.margin)} hint={d.totals.marginPct === null ? '' : `${d.totals.marginPct}%${d.meta.labourVisible ? ' after labour' : ' before labour'}`} />
              <StatCard label="Collected vs invoiced" value={money(d.meta, d.totals.collected)} hint={`of ${d.meta.currency} ${fmtMoney(d.totals.invoiced)} invoiced in the period`} />
              <StatCard label="Outstanding · DSO" value={money(d.meta, d.totals.outstanding)} hint={d.totals.dso === null ? 'No sales in the period' : `${d.totals.dso} days sales outstanding`} />
            </div>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <RankCard title="Top customers by margin" rows={ranked.slice(0, 5)} meta={d.meta} />
              <RankCard title="Bottom customers by margin" rows={ranked.slice(-5).reverse()} meta={d.meta} />
            </div>
            <SimpleTable
              label="Customer profitability"
              head={
                <tr>
                  <th className={th}>Customer</th>
                  <th className={thEnd}>Revenue</th>
                  <th className={thEnd}>Credit notes</th>
                  <th className={thEnd}>Direct costs</th>
                  {d.meta.labourVisible && <th className={thEnd}>Labour</th>}
                  <th className={thEnd}>Gross margin</th>
                  <th className={thEnd}>Collected</th>
                  <th className={thEnd}>Outstanding</th>
                  <th className={thEnd}>DSO</th>
                  <th className={thEnd}>Lifetime revenue</th>
                </tr>
              }
            >
              {d.rows.map((c) => (
                <tr key={c.customerId}>
                  <td className={td}>
                    <Link to={`/crm/customers/${encodeURIComponent(c.customerId)}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{c.name}</Link>
                    {c.projects > 0 && <p className="text-xs text-muted">{c.projects} project{c.projects === 1 ? '' : 's'}</p>}
                  </td>
                  <td className={tdEnd}><Amount value={c.revenue} blankZero /></td>
                  <td className={tdEnd}><Amount value={c.creditNotes} blankZero /></td>
                  <td className={tdEnd}><Amount value={c.directCosts} blankZero /></td>
                  {d.meta.labourVisible && <td className={tdEnd}><Amount value={c.labourCost ?? 0} blankZero /></td>}
                  <td className={tdEnd}><Amount value={c.grossMargin} strong /> <span className="block text-[0.6875rem]"><Pct value={c.marginPct} /></span></td>
                  <td className={tdEnd}><Amount value={c.collected} blankZero /></td>
                  <td className={tdEnd}>
                    <Amount value={c.outstanding} blankZero />
                    {c.overdue > 0 && <span className="block text-[0.6875rem] text-danger-600">{fmtMoney(c.overdue)} overdue</span>}
                  </td>
                  <td className={cn(tdEnd, 'num')}>{c.dso === null ? '—' : c.dso}</td>
                  <td className={tdEnd}><Amount value={c.lifetimeRevenue} blankZero /></td>
                </tr>
              ))}
            </SimpleTable>
          </>
        )
      }}
    </Loading>
  )
}

function RankCard({ title, rows, meta }: { title: string; rows: CustomerProfitability['rows']; meta: ProfitMeta }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-[0.8125rem] text-muted">No customer revenue or costs in this period.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((c) => (
              <li key={c.customerId} className="flex items-center justify-between gap-3 py-2 text-[0.8125rem]">
                <span className="min-w-0 truncate">{c.name}</span>
                <span className="shrink-0">
                  <Amount value={c.grossMargin} currency={meta.currency} strong />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/* ---------------- departments ---------------- */

function DepartmentsTab({ q }: { q: ProfitQuery }) {
  const r = useProfitReport('departments', q)
  return (
    <Loading q={r}>
      {(d: DepartmentPnl) => (
        <>
          <SimpleTable
            label="Department P&L"
            head={
              <tr>
                <th className={th}>Department</th>
                <th className={thEnd}>Revenue</th>
                <th className={thEnd}>Cost of sales</th>
                <th className={thEnd}>Operating expenses</th>
                <th className={thEnd}>of which payroll</th>
                <th className={thEnd}>Profit</th>
                <th className={thEnd}>Margin %</th>
              </tr>
            }
            foot={
              <tr>
                <td className={td}>Total</td>
                <td className={tdEnd}><Amount value={d.totals.revenue} /></td>
                <td className={tdEnd}><Amount value={d.totals.costOfSales} /></td>
                <td className={tdEnd}><Amount value={d.totals.operatingExpenses} /></td>
                <td className={tdEnd}><Amount value={d.totals.payroll} /></td>
                <td className={tdEnd}><Amount value={d.totals.profit} strong /></td>
                <td className={tdEnd}><Pct value={d.totals.marginPct} /></td>
              </tr>
            }
          >
            {d.rows.map((row) => (
              <tr key={row.departmentId ?? 'none'}>
                <td className={td}>{row.departmentId ? row.name : <Badge tone="neutral">Unassigned</Badge>}</td>
                <td className={tdEnd}><Amount value={row.revenue} blankZero /></td>
                <td className={tdEnd}><Amount value={row.costOfSales} blankZero /></td>
                <td className={tdEnd}><Amount value={row.operatingExpenses} blankZero /></td>
                <td className={tdEnd}><Amount value={row.payroll} blankZero /></td>
                <td className={tdEnd}><Amount value={row.profit} strong /></td>
                <td className={tdEnd}><Pct value={row.marginPct} /></td>
              </tr>
            ))}
          </SimpleTable>
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {d.note}
          </p>
        </>
      )}
    </Loading>
  )
}

/* ---------------- settings ---------------- */

function SettingsCard({ o }: { o: ProfitOptions }) {
  const toast = useToast()
  const save = useSaveProfitSettings()
  const [hours, setHours] = useState(String(o.settings.standardHoursPerMonth))
  const [cash, setCash] = useState(o.settings.cashAlertThreshold === null ? '' : String(o.settings.cashAlertThreshold))
  const [arPct, setArPct] = useState(String(o.settings.overdueReceivablesAlertPct))
  const [error, setError] = useState<string | null>(null)
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Profitability settings" description="Used by the labour allocation and the Company performance alerts." />
      <CardBody className="space-y-4">
        <Field id="prf-hours" label="Standard hours per month" hint="Hourly cost = monthly contract pay ÷ these hours (default 176).">
          <TextInput id="prf-hours" type="number" min={40} max={320} value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <Field id="prf-cash" label={`Cash alert below (${o.meta.currency})`} hint="Empty: 3 months’ average expenses.">
          <TextInput id="prf-cash" type="number" min={0} value={cash} onChange={(e) => setCash(e.target.value)} />
        </Field>
        <Field id="prf-ar" label="Overdue receivables alert above (%)" hint="Share of open receivables that are overdue.">
          <TextInput id="prf-ar" type="number" min={0} max={100} value={arPct} onChange={(e) => setArPct(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
        <div className="flex items-center gap-3">
          <Button
            write
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                { standardHoursPerMonth: Number(hours), cashAlertThreshold: cash.trim() === '' ? null : Number(cash), overdueReceivablesAlertPct: Number(arPct) },
                {
                  onSuccess: () => {
                    setError(null)
                    toast.success('Settings saved')
                  },
                  onError: (e) => setError(errMsg(e)),
                },
              )
            }
          >
            <Save />
            Save
          </Button>
          {o.settings.updatedAt && <span className="text-xs text-muted">Last changed {fmtDate(o.settings.updatedAt)}{o.settings.updatedByName ? ` by ${o.settings.updatedByName}` : ''}</span>}
        </div>
      </CardBody>
    </Card>
  )
}
