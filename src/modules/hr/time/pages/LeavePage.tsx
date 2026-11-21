import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, Plane, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { addDaysIso, weekdayOfIso } from '@/shared/lib/companyDay'
import { cn } from '@/shared/lib/utils'
import { monthDates } from '../calc'
import { ACCRUAL_LABEL, LEAVE_CODES, type HalfDay, type LeaveRequest, type LeaveRequestInput, type LeaveType, type LeaveTypeInput } from '../types'
import { hrTimeApi, hrTimeKeys, useBalances, useHolidays, useHrTimeMutation, useLeaveCalendar, useLeaveRequests, useLeaveTypes, useMyLeave } from '../api'
import { errorCode, errorMessage, F, LeaveStatusBadge, monthLabel, rangeLabel, shiftMonth, shortDate, Table, td, useHrScope } from '../components/shared'

type Tab = 'me' | 'approvals' | 'requests' | 'calendar' | 'balances' | 'types' | 'holidays'

/**
 * HR › Leave: my balances and requests (every employee, self-service), approvals (managers / heads
 * for step 1, HR for step 2), all requests, the team calendar, balances, leave types and holidays.
 */
export default function LeavePage() {
  const { manage, full } = useHrScope()
  const [params, setParams] = useSearchParams()
  const inbox = useLeaveRequests({ view: 'approvals' })
  const waiting = inbox.data?.length ?? 0
  const items = [
    { id: 'me' as const, label: 'My leave' },
    ...(manage || waiting ? [{ id: 'approvals' as const, label: waiting ? `Approvals (${waiting})` : 'Approvals' }] : []),
    ...(manage ? [{ id: 'requests' as const, label: 'All requests' }] : []),
    { id: 'calendar' as const, label: 'Calendar' },
    ...(manage ? [{ id: 'balances' as const, label: 'Balances' }] : []),
    ...(full ? [{ id: 'types' as const, label: 'Leave types' }] : []),
    { id: 'holidays' as const, label: 'Public holidays' },
  ]
  const requested = params.get('tab') as Tab | null
  const tab: Tab = items.some((i) => i.id === requested) ? requested! : 'me'
  const reqParam = params.get('request')
  const [formOpen, setFormOpen] = useState(reqParam === '1' || reqParam === 'new')
  const detailId = reqParam && reqParam !== '1' && reqParam !== 'new' ? reqParam : null
  const setTab = (id: Tab) =>
    setParams(
      (p) => {
        p.set('tab', id)
        p.delete('request')
        return p
      },
      { replace: true },
    )
  const closeDetail = () =>
    setParams(
      (p) => {
        p.delete('request')
        return p
      },
      { replace: true },
    )
  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <Plane />
          </IconTile>
        }
        title="Leave"
        description="Balances, requests and approvals: the manager or department head first, then HR. Working days exclude the weekend and public holidays."
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus />
            Request leave
          </Button>
        }
      >
        <Tabs label="Leave views" items={items} value={tab} onChange={setTab} />
      </PageHeader>
      <PageBody className="space-y-4">
        {tab === 'me' && <MyLeaveView />}
        {tab === 'approvals' && <RequestsView view="approvals" />}
        {tab === 'requests' && <RequestsView view="all" />}
        {tab === 'calendar' && <CalendarView />}
        {tab === 'balances' && <BalancesView />}
        {tab === 'types' && <TypesView />}
        {tab === 'holidays' && <HolidaysView canEdit={full} />}
      </PageBody>
      {formOpen && (
        <RequestForm
          onClose={() => {
            setFormOpen(false)
            if (reqParam) closeDetail()
          }}
        />
      )}
      {detailId && <RequestDrawer id={detailId} onClose={closeDetail} />}
    </>
  )
}

/* ---------------- My leave ---------------- */

function MyLeaveView() {
  const q = useMyLeave()
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.error) {
    if (errorCode(q.error) === 'no_employee_record') return <EmptyState title="No employee record" body="Ask HR to add you as an employee to request leave." icon={<Plane />} />
    return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  }
  const d = q.data
  const main = d.balances.filter((b) => ['annual', 'sick'].includes(b.code))
  return (
    <>
      <section aria-label="My balances" className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {main.map((b) => (
          <div key={b.leaveTypeId} className="rounded-xl border border-line bg-surface p-4" data-testid={`balance-${b.code}`}>
            <p className="text-xs font-medium text-muted">
              {b.leaveTypeName} · {d.year}
            </p>
            <p className="num mt-1 text-[1.5rem] font-semibold text-ink">
              <span data-testid="remaining">{b.remainingDays}</span> <span className="text-[0.875rem] font-normal text-muted">days left</span>
            </p>
            <p className="num mt-1 text-xs text-subtle">
              Entitled {b.entitledDays} · accrued {b.accruedDays} · carried {b.carriedDays} · taken <span data-testid="taken">{b.usedDays}</span> · pending {b.pendingDays}
            </p>
          </div>
        ))}
      </section>
      <Table label="Other balances" head={['Type', 'Accrued', 'Taken', 'Pending', 'Remaining']} minWidth={480}>
        {d.balances
          .filter((b) => !main.includes(b))
          .map((b) => (
            <tr key={b.leaveTypeId}>
              <td className={`${td} text-ink`}>{b.leaveTypeName}</td>
              <td className={`${td} num`}>{b.accruedDays}</td>
              <td className={`${td} num`}>{b.usedDays}</td>
              <td className={`${td} num`}>{b.pendingDays}</td>
              <td className={`${td} num`}>{b.allowNegative ? `${b.remainingDays} (unpaid allowed)` : b.remainingDays}</td>
            </tr>
          ))}
      </Table>
      <h2 className="text-[0.9375rem] font-semibold text-ink">My requests</h2>
      {d.requests.length ? <RequestTable rows={d.requests} showEmployee={false} /> : <EmptyState title="No leave requests yet" body="Use Request leave to ask for time off." icon={<Plane />} />}
    </>
  )
}

/* ---------------- Requests ---------------- */

function RequestsView({ view }: { view: 'approvals' | 'all' }) {
  const [status, setStatus] = useState('')
  const q = useLeaveRequests({ view, status: status || undefined })
  return (
    <section className="space-y-3" aria-label={view === 'approvals' ? 'Waiting for my approval' : 'Leave requests'}>
      {view === 'all' && (
        <F label="Status">
          <SelectInput value={status} onChange={(e) => setStatus(e.target.value)} className="w-52">
            <option value="">Any status</option>
            <option value="pending_head">Waiting for manager</option>
            <option value="pending_hr">Waiting for HR</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </SelectInput>
        </F>
      )}
      {q.isPending ? (
        <Skeleton className="h-48" />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.data.length ? (
        <RequestTable rows={q.data} showEmployee />
      ) : (
        <EmptyState title={view === 'approvals' ? 'Nothing waiting for you' : 'No requests'} body="Requests appear here as soon as they’re submitted." icon={<CalendarDays />} />
      )}
    </section>
  )
}

function RequestTable({ rows, showEmployee }: { rows: LeaveRequest[]; showEmployee: boolean }) {
  const [deciding, setDeciding] = useState<{ r: LeaveRequest; decision: 'approve' | 'reject' } | null>(null)
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null)
  return (
    <>
      <Table label="Leave requests" head={[...(showEmployee ? ['Employee'] : []), 'Type', 'Dates', 'Days', 'Status', 'Approvals', '']}>
        {rows.map((r) => (
          <tr key={r.id} data-testid={`leave-${r.id}`}>
            {showEmployee && <td className={`${td} font-medium text-ink`}>{r.employeeName}</td>}
            <td className={td}>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden />
                {r.leaveTypeName}
              </span>
            </td>
            <td className={td}>
              {rangeLabel(r.startDate, r.endDate)}
              {r.halfDay && <span className="text-xs text-muted"> ({r.halfDay === 'am' ? 'morning' : 'afternoon'})</span>}
            </td>
            <td className={`${td} num`}>{r.days}</td>
            <td className={td}>
              <LeaveStatusBadge status={r.status} />
            </td>
            <td className={`${td} text-xs text-muted`}>
              {r.approvals.map((a) => (
                <p key={a.step}>
                  {a.step === 'hr' ? 'HR' : 'Manager'}: {a.decision === 'pending' ? `waiting (${a.approverNames.slice(0, 2).join(', ') || '—'})` : `${a.decision} by ${a.decidedByName ?? '—'}`}
                  {a.comment ? ` · “${a.comment}”` : ''}
                </p>
              ))}
            </td>
            <td className={`${td} whitespace-nowrap text-end`}>
              {r.canDecide && (
                <span className="inline-flex gap-1">
                  <Button size="xs" variant="secondary" onClick={() => setDeciding({ r, decision: 'reject' })}>
                    Reject
                  </Button>
                  <Button size="xs" onClick={() => setDeciding({ r, decision: 'approve' })}>
                    Approve
                  </Button>
                </span>
              )}
              {r.canCancel && !r.canDecide && (
                <Button size="xs" variant="ghost" onClick={() => setCancelling(r)}>
                  Cancel
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {deciding && <DecideModal r={deciding.r} decision={deciding.decision} onClose={() => setDeciding(null)} />}
      {cancelling && <CancelModal r={cancelling} onClose={() => setCancelling(null)} />}
    </>
  )
}

function DecideModal({ r, decision, onClose }: { r: LeaveRequest; decision: 'approve' | 'reject'; onClose: () => void }) {
  const toast = useToast()
  const [comment, setComment] = useState('')
  const m = useHrTimeMutation(() => hrTimeApi.decideRequest(r.id, { decision, comment }))
  const step = r.status === 'pending_hr' ? 'HR' : 'manager'
  return (
    <Modal
      open
      onClose={onClose}
      title={`${decision === 'approve' ? 'Approve' : 'Reject'} ${r.employeeName}’s leave`}
      description={`${r.leaveTypeName}, ${rangeLabel(r.startDate, r.endDate)} (${r.days} days). Step: ${step}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button
            variant={decision === 'reject' ? 'danger' : 'primary'}
            disabled={m.isPending || (decision === 'reject' && !comment.trim())}
            onClick={() =>
              m.mutate(undefined, {
                onSuccess: (x) => {
                  toast.success(decision === 'approve' ? (x.status === 'approved' ? 'Leave approved' : 'Approved, now waiting for HR') : 'Leave rejected')
                  onClose()
                },
                onError: (e) => toast.error('Couldn’t save the decision', errorMessage(e)),
              })
            }
          >
            Confirm {decision === 'approve' ? 'approval' : 'rejection'}
          </Button>
        </>
      }
    >
      {r.reason && <p className="text-[0.8125rem] text-ink-2">“{r.reason}”</p>}
      <F label={decision === 'reject' ? 'Reason (required)' : 'Comment (optional)'}>
        <TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
      </F>
    </Modal>
  )
}

function CancelModal({ r, onClose }: { r: LeaveRequest; onClose: () => void }) {
  const toast = useToast()
  const m = useHrTimeMutation(() => hrTimeApi.cancelRequest(r.id))
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Cancel this leave?"
      description={`${r.leaveTypeName}, ${rangeLabel(r.startDate, r.endDate)}. The approvers are told.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            disabled={m.isPending}
            onClick={() => m.mutate(undefined, { onSuccess: () => (toast.success('Leave cancelled'), onClose()), onError: (e) => toast.error('Couldn’t cancel', errorMessage(e)) })}
          >
            Cancel leave
          </Button>
        </>
      }
    >
      <span />
    </Modal>
  )
}

function RequestDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: [...hrTimeKeys.root, 'leave', 'request', id], queryFn: () => hrTimeApi.request(id), retry: false })
  return (
    <Drawer open onClose={onClose} title="Leave request" width="md">
      {q.isPending ? <Skeleton className="h-32" /> : q.error ? <ErrorState message={errorMessage(q.error)} /> : <RequestTable rows={[q.data]} showEmployee />}
    </Drawer>
  )
}

/* ---------------- Request form ---------------- */

export function RequestForm({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const my = useMyLeave()
  const types = my.data?.types ?? []
  const today = my.data?.today ?? ''
  const [f, setF] = useState<LeaveRequestInput>({ leaveTypeId: '', startDate: '', endDate: '', halfDay: null, reason: '', documentName: null })
  useEffect(() => {
    if (!f.leaveTypeId && types.length) setF((x) => ({ ...x, leaveTypeId: types.find((t) => t.code === 'annual')?.id ?? types[0].id }))
  }, [types, f.leaveTypeId])
  const ready = !!f.leaveTypeId && !!f.startDate
  const input = { ...f, endDate: f.halfDay ? f.startDate : f.endDate || f.startDate }
  const preview = useQuery({ queryKey: [...hrTimeKeys.root, 'preview', input], queryFn: () => hrTimeApi.preview(input), enabled: ready, retry: false })
  const submit = useHrTimeMutation(() => hrTimeApi.createRequest(input))
  const set = <K extends keyof LeaveRequestInput>(k: K, v: LeaveRequestInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const p = preview.data
  const type = types.find((t) => t.id === f.leaveTypeId)
  return (
    <Modal
      open
      onClose={onClose}
      title="Request leave"
      description="Goes to your manager or department head first, then HR."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready || submit.isPending || !!p?.problem}
            onClick={() =>
              submit.mutate(undefined, {
                onSuccess: (r) => {
                  toast.success('Leave requested', `${r.days} working days · ${r.status === 'pending_hr' ? 'waiting for HR' : 'waiting for your manager'}`)
                  onClose()
                },
                onError: (e) => toast.error('Couldn’t submit the request', errorMessage(e)),
              })
            }
          >
            Submit request
          </Button>
        </>
      }
    >
      {my.error ? (
        <ErrorState message={errorMessage(my.error)} />
      ) : (
        <div className="space-y-3">
          <F label="Leave type">
            <SelectInput value={f.leaveTypeId} onChange={(e) => set('leaveTypeId', e.target.value)}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectInput>
          </F>
          <div className="grid grid-cols-2 gap-3">
            <F label="From">
              <TextInput type="date" min={type?.minNoticeDays ? addDaysIso(today, type.minNoticeDays) : undefined} value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </F>
            <F label="To">
              <TextInput type="date" disabled={!!f.halfDay} min={f.startDate} value={f.halfDay ? f.startDate : f.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </F>
          </div>
          <div className="flex items-center gap-3 text-[0.8125rem]">
            <label className="flex items-center gap-2">
              <Checkbox checked={!!f.halfDay} onChange={(e) => set('halfDay', e.target.checked ? 'am' : null)} />
              Half day
            </label>
            {f.halfDay && (
              <SelectInput aria-label="Which half" value={f.halfDay} onChange={(e) => set('halfDay', e.target.value as HalfDay)} className="w-40">
                <option value="am">Morning</option>
                <option value="pm">Afternoon</option>
              </SelectInput>
            )}
          </div>
          <F label="Reason (optional)">
            <TextArea rows={2} value={f.reason} onChange={(e) => set('reason', e.target.value)} maxLength={500} />
          </F>
          {(p?.documentRequired || type?.documentAfterDays === 0) && (
            <F label="Supporting document" hint="File name of the certificate (uploads come with the documents module).">
              <TextInput value={f.documentName ?? ''} onChange={(e) => set('documentName', e.target.value || null)} placeholder="medical-certificate.pdf" />
            </F>
          )}
          {p && (
            <div className={cn('rounded-lg border px-3 py-2 text-[0.8125rem]', p.problem ? 'border-danger-600/40 text-danger-600 dark:text-danger-300' : 'border-line text-ink-2')} role="status" data-testid="leave-preview">
              <p className="num font-medium">
                {p.days} working {p.days === 1 ? 'day' : 'days'}
                {p.balance && !p.balance.allowNegative ? ` · ${p.balance.remainingDays} left before this request` : ''}
              </p>
              {p.excludedHolidays.length > 0 && <p className="text-xs">Public holidays not counted: {p.excludedHolidays.map((h) => `${h.name} (${shortDate(h.date)})`).join(', ')}</p>}
              {p.problem && <p>{p.problem.message}</p>}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

/* ---------------- Calendar ---------------- */

function CalendarView() {
  const [month, setMonth] = useState<string | undefined>(undefined)
  const q = useLeaveCalendar(month)
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  const c = q.data
  const dates = monthDates(c.month)
  const lead = (weekdayOfIso(dates[0]) + 6) % 7 // Monday-first grid
  const holidays = new Map(c.holidays.map((h) => [h.date, h.name]))
  const conflictDates = new Map<string, string[]>()
  for (const x of c.conflicts) conflictDates.set(x.date, [...(conflictDates.get(x.date) ?? []), `${x.departmentName} ${x.off}/${x.size}`])
  return (
    <section className="space-y-3" aria-label="Team leave calendar">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" aria-label="Previous month" onClick={() => setMonth(shiftMonth(c.month, -1))}>
          ‹
        </Button>
        <span className="min-w-36 text-center text-[0.875rem] font-semibold text-ink">{monthLabel(c.month)}</span>
        <Button size="sm" variant="secondary" aria-label="Next month" onClick={() => setMonth(shiftMonth(c.month, 1))}>
          ›
        </Button>
        <span className="text-xs text-muted">
          {c.timezone} · warning when more than {c.thresholdPct}% of a department is off · dashed = waiting for approval
        </span>
      </div>
      {c.conflicts.length > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-warning-600/40 px-3 py-2 text-[0.8125rem] text-warning-600 dark:text-warning-300" role="alert">
          <AlertTriangle className="size-4" aria-hidden />
          {new Set(c.conflicts.map((x) => x.date)).size} days with more than {c.thresholdPct}% of a department off.
        </p>
      )}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line text-[0.75rem]">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
          <div key={w} className="bg-sunken px-2 py-1 font-medium text-muted">
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`pad-${i}`} className="bg-sunken" />
        ))}
        {dates.map((d) => {
          const off = c.entries.filter((e) => e.startDate <= d && e.endDate >= d)
          const weekend = c.weekend.includes(weekdayOfIso(d))
          const conflict = conflictDates.get(d)
          return (
            <div key={d} className={cn('min-h-24 bg-surface p-1.5', (weekend || holidays.has(d)) && 'bg-sunken', d === c.today && 'ring-2 ring-inset ring-brand-600')} data-date={d}>
              <div className="flex items-center justify-between">
                <span className="num text-xs font-medium text-ink-2">{Number(d.slice(8))}</span>
                {conflict && <AlertTriangle className="size-3.5 text-warning-600" aria-label={`Conflict: ${conflict.join(', ')}`} />}
              </div>
              {holidays.has(d) && <p className="truncate text-[0.6875rem] text-success-600 dark:text-success-300">{holidays.get(d)}</p>}
              {!weekend &&
                !holidays.has(d) &&
                off.map((e) => (
                  <p
                    key={e.requestId}
                    className={cn('mt-0.5 truncate rounded px-1 text-[0.6875rem] text-ink', e.status === 'approved' ? '' : 'border border-dashed')}
                    style={{ background: e.status === 'approved' ? `${e.color}26` : undefined, borderColor: e.color }}
                    title={`${e.employeeName}: ${e.leaveTypeName} (${e.status.replace('_', ' ')})`}
                  >
                    {e.employeeName}
                  </p>
                ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ---------------- Balances ---------------- */

function BalancesView() {
  const [year, setYear] = useState<number | undefined>(undefined)
  const q = useBalances(year)
  const typeNames = useMemo(() => [...new Map((q.data ?? []).flatMap((r) => r.balances.map((b) => [b.leaveTypeId, b.leaveTypeName] as const))).entries()].slice(0, 4), [q.data])
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  const y = year ?? q.data[0]?.balances[0]?.year ?? new Date().getFullYear()
  return (
    <section className="space-y-3" aria-label="Leave balances">
      <F label="Year">
        <SelectInput className="w-32" value={y} onChange={(e) => setYear(Number(e.target.value))}>
          {[y - 1, y, y + 1].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </SelectInput>
      </F>
      <Table label="Balances" head={['Employee', ...typeNames.map(([, n]) => `${n} (left / accrued)`)]}>
        {q.data.map((r) => (
          <tr key={r.employee.id}>
            <td className={td}>
              <p className="font-medium text-ink">{r.employee.fullName}</p>
              <p className="text-xs text-muted">{r.employee.departmentName ?? ''}</p>
            </td>
            {typeNames.map(([id]) => {
              const b = r.balances.find((x) => x.leaveTypeId === id)
              return (
                <td key={id} className={`${td} num`}>
                  {b ? (
                    <>
                      <span className={b.remainingDays < 0 ? 'text-danger-600' : 'text-ink'}>{b.remainingDays}</span>
                      <span className="text-muted"> / {r2(b.accruedDays + b.carriedDays)}</span>
                      {b.pendingDays > 0 && <span className="block text-xs text-warning-600">{b.pendingDays} pending</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </Table>
    </section>
  )
}
const r2 = (n: number) => Math.round(n * 100) / 100

/* ---------------- Leave types (HR full) ---------------- */

function TypesView() {
  const toast = useToast()
  const q = useLeaveTypes()
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const settings = useHrTimeMutation((v: number) => hrTimeApi.updateLeaveSettings(v))
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  const v = q.data
  return (
    <section className="space-y-3" aria-label="Leave types">
      <div className="flex flex-wrap items-end gap-3">
        <p className="text-[0.8125rem] text-ink-2">
          <Badge tone="amber">Defaults, review with HR</Badge> Synthetic {v.country === 'SA' ? 'KSA' : 'UAE'}-like values, not legal advice.
        </p>
        <F label="Calendar warning (% of a department off)">
          <span className="flex gap-2">
            <TextInput type="number" min={1} max={100} className="w-24" value={pct ?? v.settings.conflictThresholdPct} onChange={(e) => setPct(Number(e.target.value))} />
            <Button
              variant="secondary"
              disabled={pct === null || settings.isPending}
              onClick={() => pct !== null && settings.mutate(pct, { onSuccess: () => (toast.success('Saved'), setPct(null)), onError: (e) => toast.error('Couldn’t save', errorMessage(e)) })}
            >
              Save
            </Button>
          </span>
        </F>
        <Button className="ms-auto" onClick={() => setEditing('new')}>
          <Plus />
          New leave type
        </Button>
      </div>
      <Table label="Leave types" head={['Type', 'Paid', 'Days / year', 'Accrual', 'Carry-over', 'Notice', 'Document after', 'Restriction', '']} minWidth={860}>
        {v.types.map((t) => (
          <tr key={t.id} className={t.isActive ? '' : 'opacity-60'}>
            <td className={`${td} font-medium text-ink`}>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: t.color }} aria-hidden />
                {t.name}
              </span>
            </td>
            <td className={td}>{t.isPaid ? 'Paid' : 'Unpaid'}</td>
            <td className={`${td} num`}>{t.daysPerYear}</td>
            <td className={td}>{ACCRUAL_LABEL[t.accrual]}</td>
            <td className={`${td} num`}>{t.carryOverMax || '—'}</td>
            <td className={`${td} num`}>{t.minNoticeDays ? `${t.minNoticeDays} d` : '—'}</td>
            <td className={`${td} num`}>{t.documentAfterDays === null ? '—' : `${t.documentAfterDays} d`}</td>
            <td className={td}>{t.gender ? `${t.gender} only` : t.allowNegative ? 'May exceed balance' : '—'}</td>
            <td className={`${td} text-end`}>
              <Button size="xs" variant="ghost" onClick={() => setEditing(t)}>
                Edit
              </Button>
            </td>
          </tr>
        ))}
      </Table>
      {editing && <TypeModal type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function TypeModal({ type, onClose }: { type: LeaveType | null; onClose: () => void }) {
  const toast = useToast()
  const [f, setF] = useState<LeaveTypeInput>(type ?? { code: 'other', name: '', isPaid: true, daysPerYear: 0, accrual: 'yearly', carryOverMax: 0, documentAfterDays: null, minNoticeDays: 0, gender: null, allowNegative: false, isActive: true, color: '#71717a' })
  const save = useHrTimeMutation(() => (type ? hrTimeApi.updateLeaveType(type.id, f) : hrTimeApi.createLeaveType(f)))
  const set = <K extends keyof LeaveTypeInput>(k: K, v: LeaveTypeInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const num = (k: 'daysPerYear' | 'carryOverMax' | 'minNoticeDays', label: string) => (
    <F label={label}>
      <TextInput type="number" min={0} step={k === 'minNoticeDays' ? 1 : 0.5} value={f[k] ?? 0} onChange={(e) => set(k, Number(e.target.value))} />
    </F>
  )
  return (
    <Modal
      open
      onClose={onClose}
      title={type ? `Edit ${type.name}` : 'New leave type'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => (toast.success('Leave type saved'), onClose()), onError: (e) => toast.error('Couldn’t save', errorMessage(e)) })}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <F label="Name">
          <TextInput value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} maxLength={100} />
        </F>
        <F label="Category">
          <SelectInput value={f.code} onChange={(e) => set('code', e.target.value as LeaveType['code'])}>
            {LEAVE_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectInput>
        </F>
        {num('daysPerYear', 'Days per year')}
        <F label="Accrual">
          <SelectInput value={f.accrual} onChange={(e) => set('accrual', e.target.value as LeaveType['accrual'])}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly, upfront</option>
          </SelectInput>
        </F>
        {num('carryOverMax', 'Carry-over (max days)')}
        {num('minNoticeDays', 'Minimum notice (days)')}
        <F label="Document required after (days)" hint="Empty: never">
          <TextInput type="number" min={0} value={f.documentAfterDays ?? ''} onChange={(e) => set('documentAfterDays', e.target.value === '' ? null : Number(e.target.value))} />
        </F>
        <F label="Only for">
          <SelectInput value={f.gender ?? ''} onChange={(e) => set('gender', (e.target.value || null) as LeaveType['gender'])}>
            <option value="">Everyone</option>
            <option value="female">Women</option>
            <option value="male">Men</option>
          </SelectInput>
        </F>
      </div>
      <div className="flex flex-wrap gap-4 text-[0.8125rem]">
        <label className="flex items-center gap-2">
          <Checkbox checked={!!f.isPaid} onChange={(e) => set('isPaid', e.target.checked)} /> Paid
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={!!f.allowNegative} onChange={(e) => set('allowNegative', e.target.checked)} /> May exceed the balance
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={!!f.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Active
        </label>
      </div>
    </Modal>
  )
}

/* ---------------- Public holidays ---------------- */

function HolidaysView({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const q = useHolidays()
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const add = useHrTimeMutation(() => hrTimeApi.createHoliday({ date, name }))
  const del = useHrTimeMutation((id: string) => hrTimeApi.deleteHoliday(id))
  if (q.isPending) return <Skeleton className="h-48" />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  return (
    <section className="space-y-3" aria-label="Public holidays">
      <p className="text-[0.8125rem] text-ink-2">
        <Badge tone="amber">Defaults, review with HR</Badge> Islamic holidays follow the moon sighting: adjust the dates when they’re announced.
      </p>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <F label="Date">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </F>
          <F label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </F>
          <Button
            disabled={!date || !name.trim() || add.isPending}
            onClick={() => add.mutate(undefined, { onSuccess: () => (toast.success('Holiday added'), setDate(''), setName('')), onError: (e) => toast.error('Couldn’t add', errorMessage(e)) })}
          >
            <Plus />
            Add holiday
          </Button>
        </div>
      )}
      <Table label="Public holidays" head={['Date', 'Holiday', '']} minWidth={420}>
        {q.data.map((h) => (
          <tr key={h.id}>
            <td className={`${td} num`}>
              {shortDate(h.date)} {h.date.slice(0, 4)}
            </td>
            <td className={`${td} text-ink`}>
              {h.name} {h.isDefault && <Badge>Default</Badge>}
            </td>
            <td className={`${td} text-end`}>
              {canEdit && (
                <Button size="xs" variant="ghost" iconOnly aria-label={`Remove ${h.name}`} onClick={() => del.mutate(h.id, { onError: (e) => toast.error('Couldn’t remove', errorMessage(e)) })}>
                  <Trash2 />
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </section>
  )
}
