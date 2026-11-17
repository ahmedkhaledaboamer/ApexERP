import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import {
  AlarmClock,
  Building2,
  CalendarClock,
  ChevronDown,
  Crosshair,
  Download,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Megaphone,
  SlidersHorizontal,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { User } from '@/shared/types'
import { scopeOf, SCOPE_LABELS } from '@/shared/lib/permissions'
import { cn, fmtCompactMoney } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/shared/components/ui/Menu'
import { useToast } from '@/shared/components/ui/Toast'
import { useSalesReport } from '@/modules/reports/hooks/useReports'
import { PRESETS, presetRange, rangeLabel, type DateRange, type RangePreset } from '@/modules/reports/lib/dateRange'
import { REPORT_IDS, REPORT_TITLES } from '@/modules/reports/lib/reportCatalog'
import { downloadExcel } from '@/modules/reports/lib/exportExcel'
import { sheetsFor } from '@/modules/reports/lib/reportSheets'
import type { ReportId, ReportScope, SalesReport } from '@/modules/reports/types'
import { DateRangeMenu, DepartmentFilter, OwnerFilter } from '@/modules/reports/components/ReportFilters'
import { KpiStrip } from '@/modules/reports/components/KpiStrip'
import { StatusReport } from '@/modules/reports/components/StatusReport'
import { IndustryReport } from '@/modules/reports/components/IndustryReport'
import { SourceReport } from '@/modules/reports/components/SourceReport'
import { FunnelReport } from '@/modules/reports/components/FunnelReport'
import { AgentsReport } from '@/modules/reports/components/AgentsReport'
import { TargetsReport } from '@/modules/reports/components/TargetsReport'
import { OverdueReport } from '@/modules/reports/components/OverdueReport'
import { ReportBuilderDrawer } from '@/modules/reports/components/ReportBuilderDrawer'
import { ScheduleModal } from '@/modules/reports/components/ScheduleModal'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'
import { fmtInt } from '@/modules/reports/components/chartKit'

const REPORT_ICONS: Record<ReportId, ReactNode> = {
  status: <ListChecks />,
  industry: <Building2 />,
  source: <Megaphone />,
  funnel: <TrendingUp />,
  agents: <Users />,
  targets: <Crosshair />,
  overdue: <AlarmClock />,
}

const REPORT_VIEWS: Record<ReportId, (p: { data: SalesReport }) => ReactNode> = {
  status: StatusReport,
  industry: IndustryReport,
  source: SourceReport,
  funnel: FunnelReport,
  agents: AgentsReport,
  targets: TargetsReport,
  overdue: OverdueReport,
}

/** Mirrors the server: the narrower of the role's Reports and Sales scopes; null = no access. */
function viewerScope(user: User): ReportScope | null {
  const sales = scopeOf(user.role, 'sales')
  const reports = scopeOf(user.role, 'reports')
  if (sales === 'hidden' || reports === 'hidden') return null
  if (sales === 'own' || reports === 'own') return 'own'
  if (sales === 'team' || reports === 'team') return 'team'
  return 'full'
}

const isPreset = (v: string | null): v is RangePreset => !!v && (v === 'custom' || (PRESETS as string[]).includes(v))
const isReport = (v: string | null): v is ReportId => !!v && (REPORT_IDS as string[]).includes(v)
const DAY = /^\d{4}-\d{2}-\d{2}$/

export default function SalesReportsPage() {
  const user = useCurrentUser()
  if (!user) return null
  const scope = viewerScope(user)
  if (!scope) {
    return (
      <>
        <PageHeader title="Sales reports" />
        <PageBody>
          <Card>
            <EmptyState title="Sales reports aren’t part of your role" body={`As ${user.role}, you don’t have access to sales figures. Ask an administrator if you need them.`} />
          </Card>
        </PageBody>
      </>
    )
  }
  return <SalesReportsWorkspace user={user} scope={scope} />
}

function SalesReportsWorkspace({ user, scope }: { user: User; scope: ReportScope }) {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [builderOpen, setBuilderOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Filters live in the URL so a report view can be bookmarked or shared.
  const preset: RangePreset = isPreset(params.get('range')) ? (params.get('range') as RangePreset) : 'thisMonth'
  const customFrom = params.get('from')
  const customTo = params.get('to')
  const range: DateRange =
    preset === 'custom' && customFrom && customTo && DAY.test(customFrom) && DAY.test(customTo)
      ? { from: customFrom, to: customTo }
      : presetRange(preset === 'custom' ? 'thisMonth' : preset)
  const ownerId = scope === 'own' ? '' : (params.get('owner') ?? '')
  const departmentId = scope === 'own' ? '' : (params.get('dept') ?? '')
  const current: ReportId = isReport(params.get('report')) ? (params.get('report') as ReportId) : 'status'

  function update(next: Record<string, string | null>) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(next)) {
          if (v) p.set(k, v)
          else p.delete(k)
        }
        return p
      },
      { replace: true },
    )
  }

  const report = useSalesReport({
    from: range.from,
    to: range.to,
    ...(ownerId ? { ownerId } : {}),
    ...(departmentId ? { departmentId } : {}),
  })
  const data = report.data
  const owners = data?.owners ?? []
  const departments = data?.departments ?? []
  const ownerName = owners.find((o) => o.id === ownerId)?.name
  const departmentName = departments.find((d) => d.id === departmentId)?.name
  const scopeLabel = SCOPE_LABELS[data?.scope ?? scope]
  const context = [rangeLabel(range), scopeLabel, departmentName && `Department: ${departmentName}`, ownerName && `Owner: ${ownerName}`]
    .filter(Boolean)
    .join(' · ')

  async function exportExcel(which: 'current' | 'all') {
    if (!data) return
    setExporting(true)
    try {
      const ids = which === 'all' ? REPORT_IDS : [current]
      const sheets = ids.flatMap((id) => sheetsFor(id, data))
      const name = which === 'all' ? 'sales-reports' : `sales-report-${current}`
      await downloadExcel(`${name}-${range.from}-to-${range.to}`, sheets, `${context} · Generated ${format(new Date(), 'd MMM yyyy HH:mm')}`)
      toast.success('Excel file downloaded', which === 'all' ? `${sheets.length} sheets, one per report table` : REPORT_TITLES[current])
    } catch {
      toast.error('Couldn’t create the Excel file', 'Try again in a moment.')
    } finally {
      setExporting(false)
    }
  }

  function exportPdf() {
    toast.info('Choose “Save as PDF” in the print dialog')
    // Let the toast render before the blocking print dialog opens.
    window.setTimeout(() => window.print(), 150)
  }

  const View = REPORT_VIEWS[current]

  return (
    <>
      <PrintStyles />
      <PageHeader
        className="print:hidden"
        title="Sales reports"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={scope === 'full' ? 'brand' : scope === 'team' ? 'blue' : 'neutral'} variant="soft">
              {scopeLabel}
            </Badge>
            <span className="text-[0.875rem]">
              {scope === 'full'
                ? 'Figures across every owner.'
                : scope === 'team'
                  ? 'Figures for your team: you, the people who report to you and the members of the departments you head.'
                  : 'Figures for leads you own.'}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setBuilderOpen(true)}>
              <SlidersHorizontal />
              <span className="hidden sm:inline">Report builder</span>
              <span className="sm:hidden">Builder</span>
            </Button>
            <Button variant="secondary" onClick={() => setScheduleOpen(true)}>
              <CalendarClock />
              Schedule
            </Button>
            <Menu
              className="w-64"
              trigger={(props) => (
                <Button {...props} loading={exporting} disabled={!data}>
                  <Download />
                  Export
                  <ChevronDown />
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuLabel>Excel</MenuLabel>
                  <MenuItem
                    icon={<FileSpreadsheet />}
                    onSelect={() => {
                      close()
                      void exportExcel('current')
                    }}
                  >
                    Current report
                  </MenuItem>
                  <MenuItem
                    icon={<FileSpreadsheet />}
                    hint={`${REPORT_IDS.length} reports`}
                    onSelect={() => {
                      close()
                      void exportExcel('all')
                    }}
                  >
                    All reports
                  </MenuItem>
                  <MenuSeparator />
                  <MenuLabel>PDF</MenuLabel>
                  <MenuItem
                    icon={<FileText />}
                    onSelect={() => {
                      close()
                      exportPdf()
                    }}
                  >
                    Print view of current report
                  </MenuItem>
                </>
              )}
            </Menu>
          </>
        }
      />

      <PageBody className="space-y-5">
        {/* Print-only title block */}
        <div className="hidden border-b border-line pb-3 print:block">
          <p className="text-xs text-muted">Apex Aora · Sales reports</p>
          <h1 className="mt-1 text-[1.375rem] font-semibold">{REPORT_TITLES[current]}</h1>
          <p className="mt-1 text-[0.8125rem] text-ink-2">
            {context} · Generated {format(new Date(), 'd MMM yyyy, HH:mm')} by {user.name}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <DateRangeMenu
            preset={preset}
            range={range}
            onPreset={(p) => update({ range: p === 'thisMonth' ? null : p, from: null, to: null })}
            onCustom={(r) => update({ range: 'custom', from: r.from, to: r.to })}
          />
          {scope !== 'own' && (departments.length > 0 || departmentId) && (
            <DepartmentFilter
              departments={departments}
              value={departmentId}
              // The owner list depends on the department, so a kept owner could fall outside it.
              onChange={(id) => update({ dept: id || null, owner: null })}
            />
          )}
          {scope !== 'own' && <OwnerFilter owners={owners} value={ownerId} onChange={(id) => update({ owner: id || null })} />}
          {report.isFetching && !report.isPending && (
            <span className="flex items-center gap-1.5 text-xs text-muted" role="status">
              <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
              Updating…
            </span>
          )}
          {data && (
            <span className="ms-auto text-xs text-muted">Updated {format(new Date(data.generatedAt), 'HH:mm')}</span>
          )}
        </div>

        {report.isPending ? (
          <WorkspaceSkeleton />
        ) : report.isError ? (
          <Card>
            <ErrorState
              message={report.error.message}
              // An owner or department kept in the URL can fall outside scope after a role switch
              // (403) or no longer match each other (422): drop them.
              onRetry={() => {
                const status = (report.error as { status?: number }).status
                if ((ownerId || departmentId) && (status === 403 || status === 404 || status === 422)) update({ owner: null, dept: null })
                else void report.refetch()
              }}
            />
          </Card>
        ) : (
          <>
            <div className="print:hidden">
              <KpiStrip kpis={report.data.kpis} />
            </div>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
              <ReportNav current={current} data={report.data} onPick={(id) => update({ report: id === 'status' ? null : id })} />
              <div className={cn('min-w-0 transition-opacity', report.isPlaceholderData && 'opacity-60')}>
                <View data={report.data} />
              </div>
            </div>
          </>
        )}
      </PageBody>

      <ReportBuilderDrawer open={builderOpen} onClose={() => setBuilderOpen(false)} range={range} ownerId={ownerId} departmentId={departmentId} context={context} />
      <ScheduleModal open={scheduleOpen} onClose={() => setScheduleOpen(false)} defaultReport={current} defaultEmail={user.email} />
    </>
  )
}

/** One-line figure next to each report in the list. */
function navHint(id: ReportId, d: SalesReport): { text: string; alert?: boolean } {
  switch (id) {
    case 'status':
      return { text: `${fmtInt(d.kpis.leadsCreated)} leads` }
    case 'industry':
      return { text: `${d.byIndustry.length} industries` }
    case 'source':
      return { text: `${d.bySource.filter((s) => s.leads > 0).length} sources` }
    case 'funnel':
      return { text: `${d.funnelMonthly.length} months` }
    case 'agents':
      return { text: fmtCompactMoney(d.kpis.wonValue) }
    case 'targets': {
      const avg = d.targets.rows.length ? Math.round(d.targets.rows.reduce((s, r) => s + r.overall, 0) / d.targets.rows.length) : 0
      return { text: `${avg}%` }
    }
    case 'overdue': {
      const n = d.overdueFollowUps.length + d.overdueTasks.length
      return { text: String(n), alert: n > 0 }
    }
  }
}

function ReportNav({ current, data, onPick }: { current: ReportId; data: SalesReport; onPick: (id: ReportId) => void }) {
  return (
    <nav aria-label="Reports" className="print:hidden lg:sticky lg:top-4 lg:self-start">
      <p className="mb-2 hidden px-2 text-[0.6875rem] font-medium tracking-wide text-subtle uppercase lg:block">Ready-made reports</p>
      <ul className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
        {REPORT_IDS.map((id) => {
          const active = id === current
          const hint = navHint(id, data)
          return (
            <li key={id} className="shrink-0">
              <button
                type="button"
                onClick={() => onPick(id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-[0.8125rem] whitespace-nowrap transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
                  'border lg:border-0',
                  active
                    ? 'border-line-strong bg-surface font-medium text-ink shadow-xs'
                    : 'border-line text-ink-2 hover:bg-hover hover:text-ink',
                )}
              >
                <span className={active ? 'text-brand-600 dark:text-brand-300' : 'text-muted'}>{REPORT_ICONS[id]}</span>
                <span className="flex-1 truncate">{REPORT_TITLES[id]}</span>
                <span
                  className={cn(
                    'num hidden rounded px-1.5 text-[0.6875rem] lg:inline',
                    hint.alert ? 'bg-danger-50 font-medium text-danger-700 dark:bg-danger-500/15 dark:text-danger-500' : 'text-muted',
                  )}
                >
                  {hint.text}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function WorkspaceSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading reports" className="space-y-5">
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="hidden space-y-1.5 lg:block">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
        <Skeleton className="h-[28rem] rounded-card" />
      </div>
    </div>
  )
}
