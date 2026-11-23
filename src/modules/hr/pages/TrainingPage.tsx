import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { GraduationCap, Plus } from 'lucide-react'
import { COURSE_CATEGORY_LABEL, COURSE_PROVIDER_LABEL } from '@/modules/hr/trainingTypes'
import { useBudget, useCertificates, useCourses, useHrScope, useMatrix, useMyTraining, useTrainingOptions, useUpdateEnrollment } from '@/modules/hr/hooks/useTalent'
import { CourseDrawer, CourseView } from '@/modules/hr/components/TrainingForms'
import { CELL_LABEL, CELL_TONE, CertificateBadge, EnrollmentBadge, ErrorText, SimpleTable, td } from '@/modules/hr/components/talentBits'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'
import { cn } from '@/shared/lib/utils'
import { useNewParam } from '@/shared/hooks/useNewParam'

type Tab = 'my' | 'courses' | 'certificates' | 'matrix' | 'budget'

/**
 * `/hr/training`: my training (everyone with HR access), the course catalogue with sessions and enrollments,
 * certificates with expiry, the mandatory training matrix and the budget (HR full). An employee sees only
 * their own training; a department head their team's.
 */
export default function TrainingPage() {
  const scope = useHrScope()
  const [params, setParams] = useSearchParams()
  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = [{ id: 'my', label: 'My training' }]
    if (scope === 'full' || scope === 'team') t.push({ id: 'courses', label: 'Courses' }, { id: 'certificates', label: 'Certificates' }, { id: 'matrix', label: 'Training matrix' })
    if (scope === 'full') t.push({ id: 'budget', label: 'Budget' })
    return t
  }, [scope])
  const tab = (tabs.find((t) => t.id === params.get('tab'))?.id ?? (scope === 'own' ? 'my' : tabs[1]?.id ?? 'my')) as Tab
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true })
  const [creating, setCreating] = useState(false)
  useNewParam(() => setCreating(true), { when: scope === 'full' })
  const [courseId, setCourseId] = useState<string | null>(null)

  return (
    <>
      <PageHeader
        icon={<IconTile><GraduationCap /></IconTile>}
        title="Training"
        description="Courses and sessions, certificates with expiry alerts 30 days ahead, and mandatory training compliance."
        actions={
          scope === 'full' && (
            <Button write onClick={() => setCreating(true)}>
              <Plus />
              New course
            </Button>
          )
        }
      />
      <PageBody>
        <Tabs items={tabs} value={tab} onChange={setTab} label="Training sections" className="mb-4" />
        {tab === 'my' && <MyTrainingTab />}
        {tab === 'courses' && <CoursesTab onOpen={setCourseId} />}
        {tab === 'certificates' && <CertificatesTab />}
        {tab === 'matrix' && <MatrixTab />}
        {tab === 'budget' && <BudgetTab />}
      </PageBody>
      <CourseDrawer open={creating} onClose={() => setCreating(false)} onSaved={(id) => { setTab('courses'); setCourseId(id) }} />
      <CourseView id={courseId} onClose={() => setCourseId(null)} />
    </>
  )
}

function MyTrainingTab() {
  const q = useMyTraining()
  const rate = useUpdateEnrollment()
  const toast = useToast()
  if (q.error) return <ErrorText error={q.error} />
  if (q.isPending) return <Skeleton className="h-40" />
  const d = q.data
  if (!d.employeeId) return <EmptyState icon={<GraduationCap />} title="No employee record" body="Your account isn’t linked to an employee record yet." />
  return (
    <div className="space-y-6">
      {d.mandatory.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Mandatory training">
          {d.mandatory.map((m) => (
            <Card key={m.courseId} className="flex items-center gap-2 px-3 py-2">
              <span className="text-[0.8125rem] text-ink">{m.title}</span>
              <Badge tone={CELL_TONE[m.state]}>{CELL_LABEL[m.state]}</Badge>
            </Card>
          ))}
        </div>
      )}
      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">My certificates</h3>
        {d.certificates.length === 0 ? (
          <p className="text-xs text-muted">No certificates yet.</p>
        ) : (
          <SimpleTable label="My certificates" head={['Course', 'Number', 'Issued', 'Expires', 'Status']}>
            {d.certificates.map((c) => (
              <tr key={c.id}>
                <td className={td}>{c.courseTitle}</td>
                <td className={`${td} num`}>{c.number}</td>
                <td className={td}>{fmtDate(c.issueDate)}</td>
                <td className={td}>{c.expiryDate ? fmtDate(c.expiryDate) : 'Never'}</td>
                <td className={td}><CertificateBadge state={c.state} /></td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">My sessions</h3>
        {d.enrollments.length === 0 ? (
          <p className="text-xs text-muted">You aren’t enrolled in any training.</p>
        ) : (
          <SimpleTable label="My sessions" head={['Course', 'Dates', 'Status', 'Score', 'My rating']}>
            {d.enrollments.map((e) => (
              <tr key={e.id}>
                <td className={td}>{e.courseTitle}</td>
                <td className={td}>{fmtDate(e.sessionStart)}{e.sessionEnd !== e.sessionStart ? ` – ${fmtDate(e.sessionEnd)}` : ''}</td>
                <td className={td}><EnrollmentBadge status={e.status} /></td>
                <td className={`${td} num`}>{e.score ?? '—'}</td>
                <td className={td}>
                  {['attended', 'completed', 'failed'].includes(e.status) ? (
                    <select
                      aria-label={`Rate ${e.courseTitle}`}
                      value={e.feedbackRating ?? ''}
                      onChange={(ev) => rate.mutate({ id: e.id, input: { feedbackRating: Number(ev.target.value) } }, { onSuccess: () => toast.success('Thanks for the feedback') })}
                      className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-xs"
                    >
                      <option value="" disabled>Rate…</option>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
                    </select>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </div>
    </div>
  )
}

function CoursesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useCourses()
  if (q.error) return <ErrorText error={q.error} />
  if (q.isPending) return <Skeleton className="h-40" />
  if (!q.data.length) return <EmptyState icon={<GraduationCap />} title="No courses yet" body="Create the courses your teams need." />
  return (
    <SimpleTable label="Courses" head={['Course', 'Category', 'Provider', 'Hours', 'Cost', 'Validity', 'Sessions', 'Completed']}>
      {q.data.map((c) => (
        <tr key={c.id} className="cursor-pointer hover:bg-hover" onClick={() => onOpen(c.id)}>
          <td className={td}>
            <button type="button" className="text-start font-medium text-ink hover:underline" onClick={() => onOpen(c.id)}>{c.title}</button>
            {c.mandatory && <Badge tone="red" className="ms-2">Mandatory</Badge>}
          </td>
          <td className={td}>{COURSE_CATEGORY_LABEL[c.category]}</td>
          <td className={td}>{COURSE_PROVIDER_LABEL[c.provider]}{c.providerName ? ` · ${c.providerName}` : ''}</td>
          <td className={`${td} num`}>{c.durationHours}</td>
          <td className={`${td} num`}>{fmtMoney(c.cost, c.currency)}</td>
          <td className={td}>{c.validityMonths === null ? 'No expiry' : c.validityMonths === 0 ? 'No certificate' : `${c.validityMonths} months`}</td>
          <td className={`${td} num`}>{c.sessionCount}</td>
          <td className={`${td} num`}>{c.completedCount}</td>
        </tr>
      ))}
    </SimpleTable>
  )
}

function CertificatesTab() {
  const q = useCertificates()
  if (q.error) return <ErrorText error={q.error} />
  if (q.isPending) return <Skeleton className="h-40" />
  return (
    <SimpleTable label="Certificates" head={['Employee', 'Course', 'Number', 'Issued', 'Expires', 'Status']}>
      {q.data.map((c) => (
        <tr key={c.id}>
          <td className={td}>{c.employeeName}</td>
          <td className={td}>{c.courseTitle}</td>
          <td className={`${td} num`}>{c.number}</td>
          <td className={td}>{fmtDate(c.issueDate)}</td>
          <td className={td}>
            {c.expiryDate ? fmtDate(c.expiryDate) : 'Never'}
            {c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= 30 && <span className="ms-1 text-xs text-warning-600">({c.daysLeft} days)</span>}
          </td>
          <td className={td}><CertificateBadge state={c.state} /></td>
        </tr>
      ))}
    </SimpleTable>
  )
}

function MatrixTab() {
  const q = useMatrix()
  if (q.error) return <ErrorText error={q.error} />
  if (q.isPending) return <Skeleton className="h-40" />
  const m = q.data
  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-ink-2">
        Compliance <span className="num font-semibold text-ink">{m.compliancePct}%</span> · <span className={cn(m.overdueCount > 0 && 'font-medium text-danger-600')}>{m.overdueCount} overdue</span>
      </p>
      <SimpleTable label="Training matrix" head={['Employee', ...m.courses.map((c) => c.title), 'Compliance']}>
        {m.rows.map((r) => (
          <tr key={r.employeeId}>
            <td className={td}>{r.employeeName}</td>
            {m.courses.map((c) => {
              const cell = r.cells[c.id]
              return (
                <td key={c.id} className={cn(td, (cell === 'overdue' || cell === 'expired') && 'bg-danger-50 dark:bg-danger-500/10')}>
                  <Badge tone={CELL_TONE[cell]}>{CELL_LABEL[cell]}</Badge>
                </td>
              )
            })}
            <td className={`${td} num`}>{r.compliancePct}%</td>
          </tr>
        ))}
      </SimpleTable>
    </div>
  )
}

function BudgetTab() {
  const options = useTrainingOptions()
  const [year, setYear] = useState(() => new Date().getFullYear())
  const q = useBudget(year)
  const cur = q.data?.currency ?? options.data?.currency
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
        Year
        <select aria-label="Budget year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[0.8125rem]">
          {[0, 1, 2].map((n) => new Date().getFullYear() - n).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      {q.error ? (
        <ErrorText error={q.error} />
      ) : q.isPending ? (
        <Skeleton className="h-40" />
      ) : (
        <SimpleTable label="Training budget" head={['Department', 'Participants', 'Course fees', 'Session costs', 'Total']}>
          {q.data.rows.map((r) => (
            <tr key={r.departmentId ?? 'none'}>
              <td className={td}>{r.departmentName}</td>
              <td className={`${td} num`}>{r.participants}</td>
              <td className={`${td} num`}>{fmtMoney(r.courseCost, cur)}</td>
              <td className={`${td} num`}>{fmtMoney(r.sessionCost, cur)}</td>
              <td className={`${td} num font-medium text-ink`}>{fmtMoney(r.total, cur)}</td>
            </tr>
          ))}
          <tr>
            <td className={`${td} font-semibold text-ink`} colSpan={4}>Total</td>
            <td className={`${td} num font-semibold text-ink`}>{fmtMoney(q.data.total, cur)}</td>
          </tr>
        </SimpleTable>
      )}
    </div>
  )
}
