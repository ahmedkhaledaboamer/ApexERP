import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, Download, Lock } from 'lucide-react'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Tabs } from '@/shared/components/ui/Tabs'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { downloadCsv } from '@/modules/platform/csv'
import { useCurrentUser } from '@/store/hooks'
import { fmtDate } from '@/shared/lib/utils'
import { hrReportsApi, useReport, useReportOptions, useReportsScope, type ReportData } from './api'
import { toCsv } from './calc'
import { REPORT_LABEL, type ReportKey, type ReportOptions, type ReportQuery } from './types'
// HR › Engagement (separate module) adds one tab here: ?tab=engagement, outside ReportKey / the reports API.
import { ENGAGEMENT_TAB, EngagementReportTab } from '@/modules/hr/engagement/components/EngagementReportTab'
import {
  AssetsView,
  AttendanceView,
  ComplianceView,
  HeadcountView,
  LeaveView,
  NationalisationView,
  OverviewView,
  PayrollCostView,
  RecruitmentView,
  TrainingView,
  TurnoverView,
} from './components/ReportViews'

/**
 * HR › Reports: one page, a tab per report (?tab=), a period (default: this year in the company timezone)
 * and a department filter. HR full sees the company; a Department Head their departments, never pay (no
 * Payroll cost tab; the API answers 403 anyway). Every tab exports its CSV from the server's rows.
 */
export default function HrReportsPage() {
  const scope = useReportsScope()
  const user = useCurrentUser()
  if (!scope) {
    return (
      <PageBody>
        <EmptyState icon={<Lock aria-hidden />} title="HR reports aren’t part of your role" body={`${user?.role ?? 'Your role'} has no access to HR reports. They’re for HR and department heads.`} />
      </PageBody>
    )
  }
  return <Reports />
}

type Preset = 'this_year' | 'last_year' | 'last_12' | 'custom'
const PRESET_LABEL: Record<Preset, string> = { this_year: 'This year', last_year: 'Last year', last_12: 'Last 12 months', custom: 'Custom' }

function rangeOf(preset: Preset, today: string, custom: { from: string; to: string }): { from: string; to: string } {
  const y = Number(today.slice(0, 4))
  if (preset === 'last_year') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
  if (preset === 'last_12') {
    const m = Number(today.slice(5, 7))
    const start = m === 12 ? `${y}-01-01` : `${y - 1}-${String(m + 1).padStart(2, '0')}-01`
    return { from: start, to: today }
  }
  if (preset === 'custom') return custom
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}

function Reports() {
  const options = useReportOptions()
  const [params, setParams] = useSearchParams()
  if (options.isPending) return <PageBody><Skeleton className="h-96 rounded-card" /></PageBody>
  if (options.isError || !options.data) return <PageBody><ErrorState message={options.error?.message ?? 'Couldn’t load the reports.'} onRetry={() => options.refetch()} /></PageBody>
  const o = options.data
  const requested = params.get('tab') as ReportKey | null
  const tab: ReportKey = requested && o.reports.includes(requested) ? requested : 'overview'
  const engagement = params.get('tab') === ENGAGEMENT_TAB
  return <ReportsBody o={o} tab={tab} engagement={engagement} setTab={(t) => setParams((p) => { p.set('tab', t); return p }, { replace: true })} />
}

function ReportsBody({ o, tab, engagement, setTab }: { o: ReportOptions; tab: ReportKey; engagement: boolean; setTab: (t: ReportKey | typeof ENGAGEMENT_TAB) => void }) {
  const toast = useToast()
  const [preset, setPreset] = useState<Preset>('this_year')
  const [custom, setCustom] = useState({ from: o.defaultFrom, to: o.today })
  const [departmentId, setDepartmentId] = useState('')
  const [exporting, setExporting] = useState(false)
  const range = rangeOf(preset, o.today, custom)
  const ready = !!range.from && !!range.to && range.from <= range.to
  const q: ReportQuery = useMemo(() => ({ from: range.from, to: range.to, departmentId: departmentId || undefined }), [range.from, range.to, departmentId])
  const report = useReport(tab, q, ready && !engagement)
  const label = (k: ReportKey) => (k === 'nationalisation' ? o.nationalisationLabel : REPORT_LABEL[k])

  async function exportCsv() {
    setExporting(true)
    try {
      const x = await hrReportsApi.exportRows(tab, q)
      downloadCsv(x.fileName, toCsv(x.headers, x.rows))
      toast.success('CSV downloaded', `${x.rows.length} row${x.rows.length === 1 ? '' : 's'} · ${label(tab)}`)
    } catch (e) {
      toast.error('Couldn’t export the report', e instanceof Error ? e.message : 'Try again in a moment.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="HR Reports"
        description={o.scope === 'full' ? 'Headcount, turnover, attendance, leave, compliance, assets, recruitment, training and payroll cost.' : 'Reports for the departments you head.'}
        icon={<IconTile><BarChart3 aria-hidden /></IconTile>}
        actions={
          <Button variant="secondary" onClick={exportCsv} loading={exporting} disabled={!ready || engagement}>
            <Download />
            Export CSV
          </Button>
        }
      />
      <PageBody className="space-y-5">
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
          <label className="text-[0.8125rem]">
            <span className="mb-1 block text-xs text-muted">Period</span>
            <SelectInput aria-label="Period" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className="w-44">
              {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABEL[p]}
                </option>
              ))}
            </SelectInput>
          </label>
          {preset === 'custom' && (
            <>
              <label className="text-[0.8125rem]">
                <span className="mb-1 block text-xs text-muted">From</span>
                <TextInput type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              </label>
              <label className="text-[0.8125rem]">
                <span className="mb-1 block text-xs text-muted">To</span>
                <TextInput type="date" aria-label="To" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </label>
            </>
          )}
          <label className="text-[0.8125rem]">
            <span className="mb-1 block text-xs text-muted">Department</span>
            <SelectInput aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="w-56">
              <option value="">{o.scope === 'full' ? 'All departments' : 'All my departments'}</option>
              {o.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectInput>
          </label>
          {ready && (
            <p className="ms-auto pb-2 text-xs text-muted" data-testid="reports-range">
              {fmtDate(range.from)} – {fmtDate(range.to)} ({o.timezone})
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <Tabs label="Reports" items={[...o.reports.map((k) => ({ id: k as string, label: label(k) })), { id: ENGAGEMENT_TAB, label: 'Engagement' }]} value={engagement ? ENGAGEMENT_TAB : tab} onChange={(t) => setTab(t as ReportKey | typeof ENGAGEMENT_TAB)} />
        </div>
        <section id={`tab-panel-${engagement ? ENGAGEMENT_TAB : tab}`} role="tabpanel" aria-labelledby={`tab-${engagement ? ENGAGEMENT_TAB : tab}`}>
          {engagement ? (
            <EngagementReportTab />
          ) : !ready ? (
            <EmptyState title="Pick a date range" body="Choose the first and last day (the first on or before the last)." />
          ) : report.isPending ? (
            <Skeleton className="h-96 rounded-card" />
          ) : report.isError ? (
            <ErrorState message={report.error.message} onRetry={() => report.refetch()} />
          ) : (
            <View tab={tab} data={report.data} />
          )}
        </section>
      </PageBody>
    </>
  )
}

function View({ tab, data }: { tab: ReportKey; data: ReportData[ReportKey] }): ReactNode {
  // keepPreviousData may hand the previous tab's answer for a moment: render only a matching shape.
  switch (tab) {
    case 'overview':
      return 'headcount' in data && 'trend' in data && 'openPositions' in data ? <OverviewView r={data as ReportData['overview']} /> : null
    case 'headcount':
      return 'byNationality' in data ? <HeadcountView r={data as ReportData['headcount']} /> : null
    case 'turnover':
      return 'leaverList' in data ? <TurnoverView r={data as ReportData['turnover']} /> : null
    case 'nationalisation':
      return 'disclaimer' in data ? <NationalisationView r={data as ReportData['nationalisation']} /> : null
    case 'attendance':
      return 'topLate' in data ? <AttendanceView r={data as ReportData['attendance']} /> : null
    case 'leave':
      return 'balances' in data ? <LeaveView r={data as ReportData['leave']} /> : null
    case 'compliance':
      return 'summary' in data ? <ComplianceView r={data as ReportData['compliance']} /> : null
    case 'assets':
      return 'warranties' in data ? <AssetsView r={data as ReportData['assets']} /> : null
    case 'recruitment':
      return 'funnel' in data ? <RecruitmentView r={data as ReportData['recruitment']} /> : null
    case 'training':
      return 'byCourse' in data ? <TrainingView r={data as ReportData['training']} /> : null
    case 'payroll-cost':
      return 'source' in data ? <PayrollCostView r={data as ReportData['payroll-cost']} /> : null
  }
}
