import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Briefcase, CalendarX, Coins, Flag, GraduationCap, Percent, TrendingDown, Users, UserMinus, UserPlus } from 'lucide-react'
import { AXIS_TICK, C, CURSOR, Legend, LegendRow, Meter, TOOLTIP_STYLE, fmtInt } from '@/modules/reports/components/chartKit'
import { employeePath } from '@/app/paths'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'
import { useSaveReportSettings } from '../api'
import {
  COMPLIANCE_KIND_LABEL,
  EXPIRY_BUCKET_LABEL,
  type AssetsReport,
  type AttendanceReport,
  type ComplianceReport,
  type ExpiryBucket,
  type HeadcountReport,
  type LeaveReport,
  type NationalisationReport,
  type OverviewReport,
  type PayrollCostReport,
  type RecruitmentReport,
  type TrainingReport,
  type TurnoverReport,
} from '../types'
import { BarList, Grid, KpiRow, MonthChart, Panel, SimpleTable, hours, monthLabel, pctText } from './kit'

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Try again in a moment.')

const EmployeeLink = ({ id, name }: { id: string; name: string }) => (
  <Link to={employeePath(id)} className="font-medium text-ink hover:underline">
    {name}
  </Link>
)

/* ---------------- Overview ---------------- */

export function OverviewView({ r }: { r: OverviewReport }) {
  return (
    <div className="space-y-6">
      <KpiRow>
        <StatCard label="Headcount" icon={<Users />} value={<span data-testid="kpi-headcount">{fmtInt(r.headcount)}</span>} hint={`On ${fmtDate(r.asOf)}`} spark={r.trend.map((t) => t.headcount)} />
        <StatCard label="Turnover" icon={<TrendingDown />} value={<span data-testid="kpi-turnover">{pctText(r.turnoverPct)}</span>} hint={`${r.leavers} left · ${r.joiners} joined`} />
        <StatCard label="Absence rate" icon={<CalendarX />} value={pctText(r.absenceRatePct)} hint="Absences ÷ expected working days" />
        <StatCard label="Open positions" icon={<Briefcase />} value={fmtInt(r.openPositions)} hint="Open and on-hold openings" />
        <StatCard label="Expiring documents" icon={<AlertTriangle />} value={fmtInt(r.expiringDocuments)} hint={`Within 60 days · ${r.expiredDocuments} expired`} alert={r.expiredDocuments > 0} />
        <StatCard
          label={r.nationalisationLabel}
          icon={<Flag />}
          value={pctText(r.nationalisationPct)}
          hint={r.nationalisationTargetPct === null ? 'No target set' : `Target ${r.nationalisationTargetPct}%`}
          progress={r.nationalisationTargetPct ? Math.min(100, ((r.nationalisationPct ?? 0) / r.nationalisationTargetPct) * 100) : undefined}
        />
      </KpiRow>
      <Grid>
        <Panel title="Headcount by month" description="Employees on the payroll at each month end (today for the current month).">
          <MonthChart data={r.trend} dataKey="headcount" name="Headcount" label="Headcount by month" />
        </Panel>
        <Panel title="At a glance" description="Training and pay.">
          <dl className="grid grid-cols-2 gap-4 text-[0.8125rem]">
            <div>
              <dt className="text-xs text-muted">Mandatory training compliance</dt>
              <dd className="num mt-1 text-lg font-semibold text-ink">{r.trainingCompliancePct}%</dd>
              <Meter value={r.trainingCompliancePct} className="mt-2" />
            </div>
            {r.monthlyPayrollCost !== null && (
              <div>
                <dt className="text-xs text-muted">Committed payroll this month</dt>
                <dd className="num mt-1 text-lg font-semibold text-ink" data-testid="kpi-payroll">
                  {fmtMoney(r.monthlyPayrollCost, r.currency)}
                </dd>
                <p className="mt-1 text-xs text-muted">From active contracts</p>
              </div>
            )}
          </dl>
        </Panel>
      </Grid>
    </div>
  )
}

/* ---------------- Headcount ---------------- */

export function HeadcountView({ r }: { r: HeadcountReport }) {
  return (
    <div className="space-y-6">
      <KpiRow>
        <StatCard label="Headcount" icon={<Users />} value={<span data-testid="headcount-total">{fmtInt(r.total)}</span>} hint={`On ${fmtDate(r.asOf)}`} />
        <StatCard label="Departments" value={fmtInt(r.byDepartment.length)} />
        <StatCard label="Nationalities" value={fmtInt(r.byNationality.length)} />
      </KpiRow>
      <Panel title="Monthly headcount" description="Employees on the payroll at each month end.">
        <MonthChart data={r.trend} dataKey="headcount" name="Headcount" label="Monthly headcount" />
      </Panel>
      <Grid>
        <Panel title="By department">
          <BarList rows={r.byDepartment} label="Headcount by department" />
        </Panel>
        <Panel title="By nationality">
          <BarList rows={r.byNationality} label="Headcount by nationality" />
        </Panel>
        <Panel title="By gender">
          <BarList rows={r.byGender} label="Headcount by gender" />
        </Panel>
        <Panel title="By employment type">
          <BarList rows={r.byEmploymentType} label="Headcount by employment type" />
        </Panel>
      </Grid>
    </div>
  )
}

/* ---------------- Turnover ---------------- */

export function TurnoverView({ r }: { r: TurnoverReport }) {
  return (
    <div className="space-y-6">
      <KpiRow>
        <StatCard label="Joiners" icon={<UserPlus />} value={fmtInt(r.joiners)} />
        <StatCard label="Leavers" icon={<UserMinus />} value={fmtInt(r.leavers)} />
        <StatCard label="Turnover" icon={<TrendingDown />} value={pctText(r.turnoverPct)} hint={`Leavers ÷ average headcount (${r.averageHeadcount})`} />
        <StatCard label="Average tenure" value={r.averageTenureYears === null ? '—' : `${r.averageTenureYears} yrs`} />
        <StatCard label="Passed probation" value={fmtInt(r.probation.passed)} hint={`${r.probation.leftInProbation} left during probation`} />
        <StatCard label="In probation now" value={fmtInt(r.probation.inProbationNow)} />
      </KpiRow>
      <Grid>
        <Panel title="Joiners per month">
          <MonthChart data={r.months} dataKey="joiners" name="Joiners" color={C.green} label="Joiners per month" />
        </Panel>
        <Panel title="Leavers per month">
          <MonthChart data={r.months} dataKey="leavers" name="Leavers" color={C.red} label="Leavers per month" />
        </Panel>
      </Grid>
      <Panel title="Monthly turnover" description="Leavers ÷ average headcount, average = (opening + closing) ÷ 2.">
        <SimpleTable
          label="Monthly turnover"
          rows={r.months}
          rowKey={(m) => m.month}
          empty="No months yet."
          columns={[
            { header: 'Month', cell: (m) => monthLabel(m.month) },
            { header: 'Joiners', cell: (m) => m.joiners, align: 'end' },
            { header: 'Leavers', cell: (m) => m.leavers, align: 'end' },
            { header: 'Opening', cell: (m) => m.opening, align: 'end' },
            { header: 'Closing', cell: (m) => m.closing, align: 'end' },
            { header: 'Turnover', cell: (m) => pctText(m.turnoverPct), align: 'end' },
          ]}
        />
      </Panel>
      <Grid>
        <Panel title="Leavers">
          <SimpleTable
            label="Leavers"
            rows={r.leaverList}
            rowKey={(x) => x.employeeId}
            empty="Nobody left in this period."
            columns={[
              { header: 'Employee', cell: (x) => <EmployeeLink id={x.employeeId} name={x.employeeName} /> },
              { header: 'Department', cell: (x) => x.departmentName ?? '—' },
              { header: 'Last day', cell: (x) => fmtDate(x.exitDate) },
              { header: 'Tenure', cell: (x) => `${x.tenureYears} yrs`, align: 'end' },
            ]}
          />
        </Panel>
        <Panel title="Joiners">
          <SimpleTable
            label="Joiners"
            rows={r.joinerList}
            rowKey={(x) => x.employeeId}
            empty="Nobody joined in this period."
            columns={[
              { header: 'Employee', cell: (x) => <EmployeeLink id={x.employeeId} name={x.employeeName} /> },
              { header: 'Department', cell: (x) => x.departmentName ?? '—' },
              { header: 'Hire date', cell: (x) => fmtDate(x.hireDate) },
            ]}
          />
        </Panel>
      </Grid>
    </div>
  )
}

/* ---------------- Nationalisation ---------------- */

function TargetEditor({ current }: { current: number | null }) {
  const toast = useToast()
  const save = useSaveReportSettings()
  const [value, setValue] = useState(current === null ? '' : String(current))
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(
          { nationalisationTargetPct: value.trim() === '' ? null : Number(value) },
          { onSuccess: () => toast.success('Target saved'), onError: (err) => toast.error('Couldn’t save the target', errorText(err)) },
        )
      }}
    >
      <label className="text-[0.8125rem]">
        <span className="mb-1 block text-xs text-muted">Company target %</span>
        <TextInput type="number" min={0} max={100} step={0.1} className="w-28" aria-label="Company target %" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <Button type="submit" variant="secondary" loading={save.isPending} write>
        Save target
      </Button>
    </form>
  )
}

export function NationalisationView({ r }: { r: NationalisationReport }) {
  const gapTone: Tone = r.gapToTarget === null ? 'neutral' : r.gapToTarget === 0 ? 'green' : 'amber'
  return (
    <div className="space-y-6">
      <p className="rounded-lg border border-line bg-sunken px-3 py-2 text-xs text-muted" role="note">
        {r.disclaimer}
      </p>
      <KpiRow>
        <StatCard label={r.label} icon={<Flag />} value={<span data-testid="nationalisation-pct">{pctText(r.pct)}</span>} hint={`${r.nationals} of ${r.total} employees`} />
        <StatCard label="Company target" icon={<Percent />} value={r.targetPct === null ? '—' : `${r.targetPct}%`} hint={r.targetPct === null ? 'Not set yet' : undefined} />
        <StatCard label="Gap to target" value={r.gapToTarget === null ? '—' : <Badge tone={gapTone}>{r.gapToTarget === 0 ? 'Reached' : `${r.gapToTarget} pts`}</Badge>} />
      </KpiRow>
      {r.canEditTarget && (
        <Panel title="Target" description="Your company’s own goal for this tracker (HR only).">
          <TargetEditor key={String(r.targetPct)} current={r.targetPct} />
        </Panel>
      )}
      <Panel title={`${r.label} by month`} description="Share of nationals in the headcount at each month end.">
        <MonthChart data={r.trend} dataKey="pct" name={r.label} kind="line" unit="%" target={r.targetPct} label={`${r.label} by month`} />
      </Panel>
      <Panel title="By department">
        <SimpleTable
          label={`${r.label} by department`}
          rows={r.byDepartment}
          rowKey={(d) => d.key || 'none'}
          empty="No employees."
          columns={[
            { header: 'Department', cell: (d) => d.label },
            { header: 'Nationals', cell: (d) => d.nationals, align: 'end' },
            { header: 'Headcount', cell: (d) => d.total, align: 'end' },
            { header: 'Share', cell: (d) => pctText(d.pct), align: 'end' },
          ]}
        />
      </Panel>
    </div>
  )
}

/* ---------------- Attendance ---------------- */

export function AttendanceView({ r }: { r: AttendanceReport }) {
  const t = r.totals
  return (
    <div className="space-y-6">
      {r.trackedFrom ? (
        <p className="text-xs text-muted">Attendance recorded since {fmtDate(r.trackedFrom)}; earlier days have no data and don’t count as absences.</p>
      ) : (
        <EmptyState title="No attendance recorded yet" body="Clock-ins and imports show up here." />
      )}
      <KpiRow>
        <StatCard label="Late arrivals" value={fmtInt(t.lateArrivals)} hint={`${hours(t.lateMinutes)} late in total`} />
        <StatCard label="Absences" value={fmtInt(t.absences)} hint={`Of ${fmtInt(t.expectedDays)} expected days`} />
        <StatCard label="Absence rate" icon={<CalendarX />} value={pctText(t.absenceRatePct)} />
        <StatCard label="Overtime" value={hours(t.overtimeMinutes)} hint="Beyond the shift, weekends and holidays" />
      </KpiRow>
      <Grid>
        <Panel title="Late arrivals by month">
          <MonthChart data={r.byMonth} dataKey="lateArrivals" name="Late arrivals" color={C.amber} label="Late arrivals by month" />
        </Panel>
        <Panel title="Absences by month">
          <MonthChart data={r.byMonth} dataKey="absences" name="Absences" color={C.red} label="Absences by month" />
        </Panel>
      </Grid>
      <Panel title="By department">
        <SimpleTable
          label="Attendance by department"
          rows={r.byDepartment}
          rowKey={(d) => d.key || 'none'}
          empty="No attendance in this period."
          columns={[
            { header: 'Department', cell: (d) => d.label },
            { header: 'Expected days', cell: (d) => d.expectedDays, align: 'end' },
            { header: 'Late arrivals', cell: (d) => d.lateArrivals, align: 'end' },
            { header: 'Absences', cell: (d) => d.absences, align: 'end' },
            { header: 'Absence rate', cell: (d) => pctText(d.absenceRatePct), align: 'end' },
            { header: 'Overtime', cell: (d) => hours(d.overtimeMinutes), align: 'end' },
          ]}
        />
      </Panel>
      <Panel title="Most late arrivals" description="Top 10 in the period.">
        <SimpleTable
          label="Most late arrivals"
          rows={r.topLate}
          rowKey={(x) => x.employeeId}
          empty="Nobody was late."
          columns={[
            { header: 'Employee', cell: (x) => <EmployeeLink id={x.employeeId} name={x.employeeName} /> },
            { header: 'Department', cell: (x) => x.departmentName ?? '—' },
            { header: 'Late arrivals', cell: (x) => x.lateArrivals, align: 'end' },
            { header: 'Late time', cell: (x) => hours(x.lateMinutes), align: 'end' },
          ]}
        />
      </Panel>
    </div>
  )
}

/* ---------------- Leave ---------------- */

export function LeaveView({ r }: { r: LeaveReport }) {
  const data = r.byMonth.map((m) => ({ label: monthLabel(m.month), ...Object.fromEntries(m.byType.map((t) => [t.leaveTypeId, t.days])) }))
  return (
    <div className="space-y-6">
      <KpiRow>
        <StatCard label="Leave days taken" value={fmtInt(r.totalDays)} hint="Approved working days in the period" />
        <StatCard label="Pending requests" value={fmtInt(r.pendingRequests)} />
        <StatCard label="Upcoming (30 days)" value={fmtInt(r.upcoming.length)} hint="Approved leave starting soon" />
      </KpiRow>
      <Panel title="Days taken by month and type">
        {r.byType.length === 0 ? (
          <EmptyState title="No approved leave in this period" body="Pick a longer period." />
        ) : (
          <>
            <LegendRow className="mb-3">
              {r.byType.map((t) => (
                <Legend key={t.leaveTypeId} color={t.color} label={`${t.name} (${t.days})`} />
              ))}
            </LegendRow>
            <div dir="ltr" className="h-56" role="img" aria-label="Leave days by month and type">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} minTickGap={8} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={AXIS_TICK} />
                  <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
                  {r.byType.map((t) => (
                    <Bar key={t.leaveTypeId} dataKey={t.leaveTypeId} name={t.name} stackId="leave" fill={t.color} stroke="var(--color-surface)" strokeWidth={1} maxBarSize={26} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Panel>
      <Grid>
        <Panel title={`Balances ${r.year}`} description="Paid leave types, employees on the payroll today.">
          <SimpleTable
            label="Leave balances"
            rows={r.balances}
            rowKey={(b) => b.leaveTypeId}
            empty="No leave types."
            columns={[
              { header: 'Type', cell: (b) => b.name },
              { header: 'Accrued', cell: (b) => b.accruedDays, align: 'end' },
              { header: 'Used', cell: (b) => b.usedDays, align: 'end' },
              { header: 'Pending', cell: (b) => b.pendingDays, align: 'end' },
              { header: 'Remaining', cell: (b) => b.remainingDays, align: 'end' },
            ]}
          />
        </Panel>
        <Panel title="Upcoming approved leave" description="Next 30 days.">
          <SimpleTable
            label="Upcoming approved leave"
            rows={r.upcoming}
            rowKey={(x, i) => `${x.employeeId}-${i}`}
            empty="No approved leave in the next 30 days."
            columns={[
              { header: 'Employee', cell: (x) => <EmployeeLink id={x.employeeId} name={x.employeeName} /> },
              { header: 'Type', cell: (x) => x.leaveTypeName },
              { header: 'Dates', cell: (x) => `${fmtDate(x.startDate)} – ${fmtDate(x.endDate)}` },
              { header: 'Days', cell: (x) => x.days, align: 'end' },
            ]}
          />
        </Panel>
      </Grid>
    </div>
  )
}

/* ---------------- Compliance ---------------- */

const BUCKET_TONE: Record<ExpiryBucket, Tone> = { expired: 'red', d30: 'amber', d60: 'sky', d90: 'neutral' }

export function ComplianceView({ r }: { r: ComplianceReport }) {
  const [bucket, setBucket] = useState<ExpiryBucket | 'all'>('all')
  const rows = bucket === 'all' ? r.rows : r.rows.filter((x) => x.bucket === bucket)
  return (
    <div className="space-y-6">
      <p className="text-xs text-muted">As of today ({fmtDate(r.today)}), whatever the period.</p>
      <Panel title="Summary">
        <SimpleTable
          label="Expiries summary"
          rows={r.summary}
          rowKey={(s) => s.kind}
          empty="Nothing."
          columns={[
            { header: 'What', cell: (s) => COMPLIANCE_KIND_LABEL[s.kind] },
            { header: 'Expired', cell: (s) => s.expired, align: 'end' },
            { header: '≤ 30 days', cell: (s) => s.d30, align: 'end' },
            { header: '31–60 days', cell: (s) => s.d60, align: 'end' },
            { header: '61–90 days', cell: (s) => s.d90, align: 'end' },
          ]}
        />
      </Panel>
      <Panel
        title="Expiring and expired"
        description="Documents, contract ends and probation ends. Open the employee to act."
        action={
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by when">
            {(['all', 'expired', 'd30', 'd60', 'd90'] as const).map((b) => (
              <Button key={b} size="sm" variant={bucket === b ? 'primary' : 'ghost'} onClick={() => setBucket(b)} aria-pressed={bucket === b}>
                {b === 'all' ? 'All' : EXPIRY_BUCKET_LABEL[b]}
              </Button>
            ))}
          </div>
        }
      >
        <SimpleTable
          label="Expiries"
          rows={rows}
          rowKey={(x) => x.id}
          empty="Nothing expires in the next 90 days."
          columns={[
            { header: 'Employee', cell: (x) => <EmployeeLink id={x.employeeId} name={x.employeeName} /> },
            { header: 'What', cell: (x) => `${COMPLIANCE_KIND_LABEL[x.kind]} · ${x.label}` },
            { header: 'Date', cell: (x) => fmtDate(x.date) },
            { header: 'Status', cell: (x) => <Badge tone={BUCKET_TONE[x.bucket]}>{x.bucket === 'expired' ? `Expired ${-x.daysLeft} d ago` : `${x.daysLeft} days left`}</Badge> },
          ]}
        />
      </Panel>
    </div>
  )
}

/* ---------------- Assets ---------------- */

export function AssetsView({ r }: { r: AssetsReport }) {
  const money = (n: number) => fmtMoney(n, r.currency)
  return (
    <div className="space-y-6">
      <KpiRow>
        <StatCard label="Assets" value={fmtInt(r.count)} />
        <StatCard label="Value" icon={<Coins />} value={money(r.value)} hint="Purchase cost" />
        <StatCard label="Assigned" value={fmtInt(r.assigned)} />
        <StatCard label="Available" value={fmtInt(r.available)} hint="In stock" />
      </KpiRow>
      <Grid>
        <Panel title="By status">
          <SimpleTable label="Assets by status" rows={r.byStatus} rowKey={(x) => x.key} empty="No assets." columns={[{ header: 'Status', cell: (x) => x.label }, { header: 'Count', cell: (x) => x.count, align: 'end' }, { header: 'Value', cell: (x) => money(x.value), align: 'end' }]} />
        </Panel>
        <Panel title="By category">
          <SimpleTable label="Assets by category" rows={r.byCategory} rowKey={(x) => x.key} empty="No assets." columns={[{ header: 'Category', cell: (x) => x.label }, { header: 'Count', cell: (x) => x.count, align: 'end' }, { header: 'Value', cell: (x) => money(x.value), align: 'end' }]} />
        </Panel>
      </Grid>
      <Panel title="Warranties ending" description="Next 90 days.">
        <SimpleTable
          label="Warranties ending"
          rows={r.warranties}
          rowKey={(x) => x.id}
          empty="No warranty ends in the next 90 days."
          columns={[
            { header: 'Tag', cell: (x) => x.tag },
            { header: 'Asset', cell: (x) => x.name },
            { header: 'Held by', cell: (x) => x.assignedToName ?? 'In stock' },
            { header: 'Warranty end', cell: (x) => `${fmtDate(x.warrantyEnd)} (${x.daysLeft} d)` },
          ]}
        />
      </Panel>
    </div>
  )
}

/* ---------------- Recruitment ---------------- */

export function RecruitmentView({ r }: { r: RecruitmentReport }) {
  const top = r.funnel[0]?.reached || 0
  return (
    <div className="space-y-6">
      <KpiRow>
        <StatCard label="Applications" value={fmtInt(r.applications)} hint="Received in the period" />
        <StatCard label="Hires" icon={<UserPlus />} value={fmtInt(r.hires)} />
        <StatCard label="Time to hire" value={r.averageTimeToHireDays === null ? '—' : `${r.averageTimeToHireDays} d`} hint="Application → offer accepted" />
        <StatCard label="Open positions" icon={<Briefcase />} value={fmtInt(r.openPositions)} />
        <StatCard label="Offers accepted" value={`${r.offers.accepted} / ${r.offers.accepted + r.offers.declined}`} hint={`${pctText(r.offers.acceptanceRatePct)} · ${r.offers.pending} awaiting an answer`} />
      </KpiRow>
      <Grid>
        <Panel title="Funnel" description="Applications that reached each stage; % = from the previous stage.">
          <ol className="space-y-2.5" aria-label="Recruitment funnel">
            {r.funnel.map((s) => (
              <li key={s.stage} className="grid grid-cols-[6.5rem_1fr_5.5rem] items-center gap-3 text-[0.8125rem]">
                <span className="text-ink">{s.label}</span>
                <div className="h-6 overflow-hidden rounded-md bg-sunken">
                  <div className="h-full rounded-md bg-brand-500/80" style={{ width: `${top ? Math.max(2, (s.reached / top) * 100) : 0}%` }} />
                </div>
                <span className="num text-end text-ink-2">
                  {s.reached} <span className="text-muted">{s.conversionPct === null ? '' : `· ${s.conversionPct}%`}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted">
            {r.rejected} rejected · {r.withdrawn} withdrawn
          </p>
        </Panel>
        <Panel title="By source">
          <BarList rows={r.bySource} label="Applications by source" />
        </Panel>
      </Grid>
      <Panel title="Open positions">
        <SimpleTable
          label="Open positions"
          rows={r.openings}
          rowKey={(o) => o.id}
          empty="No open positions."
          columns={[
            { header: 'Opening', cell: (o) => o.title },
            { header: 'Department', cell: (o) => o.departmentName },
            { header: 'Status', cell: (o) => o.status },
            { header: 'Applications', cell: (o) => o.applications, align: 'end' },
            { header: 'Hired', cell: (o) => `${o.hired} / ${o.headcount}`, align: 'end' },
          ]}
        />
      </Panel>
    </div>
  )
}

/* ---------------- Training ---------------- */

function BudgetEditor({ year, current }: { year: number; current: number | null }) {
  const toast = useToast()
  const save = useSaveReportSettings()
  const [value, setValue] = useState(current === null ? '' : String(current))
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(
          { trainingBudget: { year, amount: value.trim() === '' ? null : Number(value) } },
          { onSuccess: () => toast.success('Budget saved'), onError: (err) => toast.error('Couldn’t save the budget', errorText(err)) },
        )
      }}
    >
      <label className="text-[0.8125rem]">
        <span className="mb-1 block text-xs text-muted">Budget {year}</span>
        <TextInput type="number" min={0} className="w-36" aria-label={`Training budget ${year}`} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <Button type="submit" variant="secondary" loading={save.isPending} write>
        Save budget
      </Button>
    </form>
  )
}

export function TrainingView({ r }: { r: TrainingReport }) {
  return (
    <div className="space-y-6">
      <KpiRow>
        <StatCard label="Training compliance" icon={<GraduationCap />} value={`${r.compliancePct}%`} hint={`${r.mandatoryCourses} mandatory course${r.mandatoryCourses === 1 ? '' : 's'}`} progress={r.compliancePct} />
        <StatCard label="Overdue" value={fmtInt(r.overdue)} hint="Missing past the grace period, or expired" alert={r.overdue > 0} />
        <StatCard label="Certificates expiring" value={fmtInt(r.certificatesExpiring.length)} hint={`${r.certificatesExpired} expired`} />
        <StatCard label="Completions" value={fmtInt(r.completions)} hint="In the period" />
        {r.spend !== null && <StatCard label="Spend" icon={<Coins />} value={fmtMoney(r.spend, r.currency)} hint="Sessions starting in the period" />}
        {r.yearSpend !== null && (
          <StatCard label={`Spend vs budget ${r.budgetYear}`} value={r.budget === null ? '—' : pctText(r.budgetUsedPct)} hint={`${fmtMoney(r.yearSpend, r.currency)} of ${r.budget === null ? 'no budget' : fmtMoney(r.budget, r.currency)}`} progress={r.budgetUsedPct ?? undefined} />
        )}
      </KpiRow>
      {r.canEditBudget && (
        <Panel title="Training budget" description="Per calendar year (HR only).">
          <BudgetEditor key={`${r.budgetYear}-${r.budget}`} year={r.budgetYear} current={r.budget} />
        </Panel>
      )}
      <Grid>
        <Panel title="Compliance by department">
          <BarList rows={r.byDepartment.map((d) => ({ key: d.key, label: d.label, count: d.compliancePct }))} label="Compliance by department" value={(x) => `${x.count}%`} />
        </Panel>
        <Panel title="Compliance by course">
          <SimpleTable label="Compliance by course" rows={r.byCourse} rowKey={(c) => c.courseId} empty="No mandatory courses." columns={[{ header: 'Course', cell: (c) => c.title }, { header: 'Compliant', cell: (c) => `${c.compliant} / ${c.cells}`, align: 'end' }, { header: 'Share', cell: (c) => `${c.compliancePct}%`, align: 'end' }]} />
        </Panel>
      </Grid>
      <Panel title="Certificates expiring" description="Within 30 days.">
        <SimpleTable
          label="Certificates expiring"
          rows={r.certificatesExpiring}
          rowKey={(c) => c.certificateId}
          empty="No certificate expires in the next 30 days."
          columns={[
            { header: 'Employee', cell: (c) => <EmployeeLink id={c.employeeId} name={c.employeeName} /> },
            { header: 'Course', cell: (c) => c.courseTitle },
            { header: 'Expires', cell: (c) => `${fmtDate(c.expiryDate)} (${c.daysLeft} d)` },
          ]}
        />
      </Panel>
    </div>
  )
}

/* ---------------- Payroll cost ---------------- */

export function PayrollCostView({ r }: { r: PayrollCostReport }) {
  const money = (n: number) => fmtMoney(n, r.currency)
  return (
    <div className="space-y-6">
      <p className="text-xs text-muted">{r.note}</p>
      <KpiRow>
        <StatCard label="This month" icon={<Coins />} value={<span data-testid="payroll-current">{money(r.currentMonthly)}</span>} hint="Committed" />
        <StatCard label="Period total" value={money(r.total)} />
      </KpiRow>
      <Panel title="Committed cost by month">
        <div dir="ltr" className="h-56" role="img" aria-label="Committed cost by month">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={r.months.map((m) => ({ ...m, label: monthLabel(m.month) }))} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} minTickGap={8} />
              <YAxis tickLine={false} axisLine={false} width={64} tick={AXIS_TICK} tickFormatter={(v: number) => new Intl.NumberFormat('en', { notation: 'compact' }).format(v)} />
              <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v) => [money(Number(v)), 'Committed cost']} />
              <Bar dataKey="amount" name="Committed cost" fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel title="By department">
        <SimpleTable
          label="Committed cost by department"
          rows={r.byDepartment}
          rowKey={(d) => d.key || 'none'}
          empty="No contracts."
          columns={[
            { header: 'Department', cell: (d) => d.label },
            { header: 'Employees', cell: (d) => d.employees, align: 'end' },
            { header: 'This month', cell: (d) => money(d.monthly), align: 'end' },
            { header: 'Period total', cell: (d) => money(d.total), align: 'end' },
          ]}
        />
      </Panel>
    </div>
  )
}
