import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarCheck, Clock, Download, FileUp, LogIn, LogOut, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { workingWeekLabel } from '@/shared/lib/companyDay'
import { downloadExcel, XL } from '@/modules/reports/lib/exportExcel'
import { fmtMinutes } from '../calc'
import {
  ATTENDANCE_SOURCE_LABEL,
  CORRECTION_STATUS_LABEL,
  DAY_STATUS_CODE,
  DAY_STATUS_LABEL,
  DAY_STATUSES,
  type AttendanceCorrection,
  type DayStatus,
  type MonthSheet,
  type MyAttendance,
  type Shift,
  type ShiftInput,
} from '../types'
import { hrTimeApi, useCorrections, useHrTimeMutation, useMonthSheet, useMyAttendance, useShifts, useTodayBoard } from '../api'
import { DAY_TONE, DayBadge, F, errorCode, errorMessage, Metric, monthLabel, shiftMonth, shortDate, Table, td, useHrScope } from '../components/shared'

type Tab = 'me' | 'today' | 'sheet' | 'corrections' | 'shifts' | 'import'

/** HR › Attendance: my attendance (everyone with an employee record), and for HR / department heads the today board, the monthly sheet, corrections, shifts and the punch import. */
export default function AttendancePage() {
  const { manage, full } = useHrScope()
  const [params, setParams] = useSearchParams()
  const items = [
    { id: 'me' as const, label: 'My attendance' },
    ...(manage ? [{ id: 'today' as const, label: 'Today' }, { id: 'sheet' as const, label: 'Monthly sheet' }] : []),
    { id: 'corrections' as const, label: 'Corrections' },
    ...(manage ? [{ id: 'shifts' as const, label: 'Shifts' }] : []),
    ...(full ? [{ id: 'import' as const, label: 'Import punches' }] : []),
  ]
  const requested = params.get('tab') as Tab | null
  const tab: Tab = items.some((i) => i.id === requested) ? requested! : 'me'
  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <Clock />
          </IconTile>
        }
        title="Attendance"
        description="Clock in and out, see your month, and (for HR and department heads) who’s in today, the monthly sheet and corrections. Times are in the company timezone."
      >
        <Tabs label="Attendance views" items={items} value={tab} onChange={(id) => setParams((p) => { p.set('tab', id); return p }, { replace: true })} />
      </PageHeader>
      <PageBody className="space-y-4">
        {tab === 'me' && <MyAttendanceView />}
        {tab === 'today' && <TodayView />}
        {tab === 'sheet' && <SheetView />}
        {tab === 'corrections' && <CorrectionsView />}
        {tab === 'shifts' && <ShiftsView canEdit={full} />}
        {tab === 'import' && <ImportView />}
      </PageBody>
    </>
  )
}

/* ---------------- My attendance ---------------- */

export function ClockCard({ data, compact = false }: { data: MyAttendance; compact?: boolean }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const clockIn = useHrTimeMutation(() => hrTimeApi.clockIn({ note, location: 'Web' }))
  const clockOut = useHrTimeMutation(() => hrTimeApi.clockOut({ note }))
  const open = !!data.openEntry
  const t = data.today
  const act = () =>
    (open ? clockOut : clockIn).mutate(undefined, {
      onSuccess: (r) => {
        setNote('')
        toast.success(open ? 'Clocked out' : 'Clocked in', r.today.status === 'late' && !open ? `${r.today.lateMinutes} min late` : undefined)
      },
      onError: (e) => toast.error(open ? 'Couldn’t clock out' : 'Couldn’t clock in', errorMessage(e)),
    })
  return (
    <section aria-label="Clock in and out" className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface p-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">
          Today · {shortDate(t.workDate)} · {data.shift.name} {data.shift.startTime}–{data.shift.endTime}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold text-ink">
          {open ? `Clocked in since ${t.checkInLocal}` : t.checkInLocal ? `Last out ${t.checkOutLocal ?? '—'}` : 'Not clocked in'}
          <DayBadge day={t} />
        </p>
        {!compact && t.minutesWorked > 0 && <p className="num mt-0.5 text-xs text-subtle">Worked {fmtMinutes(t.minutesWorked)} today</p>}
      </div>
      {!compact && (
        <div className="w-full sm:w-64">
          <TextInput aria-label="Note (optional)" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
      )}
      <Button onClick={act} disabled={clockIn.isPending || clockOut.isPending} variant={open ? 'secondary' : 'primary'}>
        {open ? <LogOut /> : <LogIn />}
        {open ? 'Clock out' : 'Clock in'}
      </Button>
    </section>
  )
}

function MyAttendanceView() {
  const [month, setMonth] = useState<string | undefined>(undefined)
  const q = useMyAttendance(month)
  const [fixing, setFixing] = useState<{ date: string; entryId: string | null; checkIn: string; checkOut: string } | null>(null)
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.error) {
    if (errorCode(q.error) === 'no_employee_record') return <EmptyState title="No employee record" body="Ask HR to add you as an employee to clock in and request leave." icon={<Clock />} />
    return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  }
  const d = q.data
  const s = d.summary
  const days = d.days.filter((x) => x.workDate <= d.today.workDate).reverse()
  return (
    <>
      <ClockCard data={d} />
      <MonthNav month={d.month} onChange={setMonth} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Metric label="Present" value={s.present} hint={`of ${s.workingDays} working days`} />
        <Metric label="Late" value={s.late} hint={`${fmtMinutes(s.lateMinutes)} in total`} tone={s.late ? 'warning' : undefined} />
        <Metric label="Absent" value={s.absent} tone={s.absent ? 'danger' : undefined} />
        <Metric label="On leave" value={s.onLeave + s.halfDays / 2} />
        <Metric label="Worked" value={fmtMinutes(s.minutesWorked)} hint={`Overtime ${fmtMinutes(s.overtimeMinutes)}`} />
        <Metric label="Missing clock-outs" value={s.missingCheckOuts} tone={s.missingCheckOuts ? 'danger' : undefined} />
      </div>
      <Table label="My days" head={['Date', 'Status', 'In', 'Out', 'Worked', 'Late', 'Overtime', '']}>
        {days.map((x) => (
          <tr key={x.workDate}>
            <td className={td}>{shortDate(x.workDate)}</td>
            <td className={td}>
              <DayBadge day={x} />
              {(x.holidayName || x.leaveTypeName) && <span className="ms-1 text-xs text-muted">{x.holidayName ?? x.leaveTypeName}</span>}
            </td>
            <td className={`${td} num`}>{x.checkInLocal ?? '—'}</td>
            <td className={`${td} num`}>{x.checkOutLocal ?? '—'}</td>
            <td className={`${td} num`}>{x.minutesWorked ? fmtMinutes(x.minutesWorked) : '—'}</td>
            <td className={`${td} num`}>{x.lateMinutes ? `${x.lateMinutes} min` : '—'}</td>
            <td className={`${td} num`}>{x.overtimeMinutes ? fmtMinutes(x.overtimeMinutes) : '—'}</td>
            <td className={`${td} text-end`}>
              {(x.status === 'absent' || x.status === 'late' || x.missingCheckOut || x.status === 'present') && !x.open && !x.inProgress && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setFixing({ date: x.workDate, entryId: x.entryIds[0] ?? null, checkIn: x.checkInLocal ?? d.shift.startTime, checkOut: x.checkOutLocal ?? d.shift.endTime })}
                >
                  <Pencil />
                  Request correction
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {fixing && <CorrectionModal initial={fixing} onClose={() => setFixing(null)} />}
    </>
  )
}

function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">
        ‹
      </Button>
      <span className="min-w-36 text-center text-[0.875rem] font-semibold text-ink">{monthLabel(month)}</span>
      <Button size="sm" variant="secondary" onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month">
        ›
      </Button>
    </div>
  )
}

function CorrectionModal({ initial, onClose }: { initial: { date: string; entryId: string | null; checkIn: string; checkOut: string }; onClose: () => void }) {
  const toast = useToast()
  const [checkIn, setIn] = useState(initial.checkIn)
  const [checkOut, setOut] = useState(initial.checkOut)
  const [reason, setReason] = useState('')
  const save = useHrTimeMutation(() => hrTimeApi.createCorrection({ workDate: initial.date, entryId: initial.entryId, checkIn, checkOut, reason }))
  return (
    <Modal
      open
      onClose={onClose}
      title={`Correct ${shortDate(initial.date)}`}
      description="Your manager or HR approves the change."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || reason.trim().length < 3}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  toast.success('Correction sent for approval')
                  onClose()
                },
                onError: (e) => toast.error('Couldn’t send the correction', errorMessage(e)),
              })
            }
          >
            Send for approval
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <F label="Clock in">
          <TextInput type="time" value={checkIn} onChange={(e) => setIn(e.target.value)} />
        </F>
        <F label="Clock out">
          <TextInput type="time" value={checkOut} onChange={(e) => setOut(e.target.value)} />
        </F>
      </div>
      <F label="Reason">
        <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </F>
    </Modal>
  )
}

/* ---------------- Today board ---------------- */

function TodayView() {
  const q = useTodayBoard()
  const [filter, setFilter] = useState<'all' | 'in' | 'late' | 'absent' | 'leave'>('all')
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  const b = q.data
  const rows = b.rows.filter(({ record: r }) =>
    filter === 'all'
      ? true
      : filter === 'in'
        ? r.status === 'present' || r.status === 'late'
        : filter === 'late'
          ? r.status === 'late'
          : filter === 'absent'
            ? r.status === 'absent'
            : r.status === 'on_leave' || r.status === 'half_day',
  )
  const pick = (f: typeof filter, label: string, value: number, tone?: 'danger' | 'warning' | 'success') => (
    <button type="button" onClick={() => setFilter(filter === f ? 'all' : f)} className={`text-start ${filter === f ? 'ring-2 ring-brand-600 rounded-xl' : ''}`} aria-pressed={filter === f}>
      <Metric label={label} value={value} tone={tone} />
    </button>
  )
  return (
    <section aria-label="Today board" className="space-y-4">
      <p className="text-xs text-muted">
        {shortDate(b.date)} · {b.timezone}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {pick('in', 'In', b.counts.in, 'success')}
        {pick('late', 'Late', b.counts.late, b.counts.late ? 'warning' : undefined)}
        {pick('absent', 'Not in / absent', b.counts.absent, b.counts.absent ? 'danger' : undefined)}
        {pick('leave', 'On leave', b.counts.onLeave)}
        <Metric label="Team" value={b.counts.total} hint={b.counts.notExpected ? `${b.counts.notExpected} not working today` : undefined} />
      </div>
      <Table label="Who's in today" head={['Employee', 'Department', 'Status', 'In', 'Out', 'Late']}>
        {rows.map(({ employee: e, record: r }) => (
          <tr key={e.id}>
            <td className={td}>
              <p className="font-medium text-ink">{e.fullName}</p>
              <p className="text-xs text-muted">{e.jobTitle}</p>
            </td>
            <td className={`${td} text-ink-2`}>{e.departmentName ?? '—'}</td>
            <td className={td}>
              <DayBadge day={r} />
            </td>
            <td className={`${td} num`}>{r.checkInLocal ?? '—'}</td>
            <td className={`${td} num`}>{r.checkOutLocal ?? '—'}</td>
            <td className={`${td} num`}>{r.lateMinutes ? `${r.lateMinutes} min` : '—'}</td>
          </tr>
        ))}
      </Table>
    </section>
  )
}

/* ---------------- Monthly sheet ---------------- */

async function exportSheet(sheet: MonthSheet) {
  const header = [{ header: 'Employee', width: 26 }, { header: 'No.', width: 10 }, { header: 'Department', width: 18 }]
  const days = sheet.dates.map((d) => ({ header: d.slice(8), width: 4 }))
  const totals = [
    { header: 'Present', width: 9, format: XL.int },
    { header: 'Late', width: 7, format: XL.int },
    { header: 'Absent', width: 8, format: XL.int },
    { header: 'Leave', width: 7, format: XL.int },
    { header: 'Worked (h)', width: 11, format: XL.hours },
    { header: 'Overtime (h)', width: 12, format: XL.hours },
  ]
  await downloadExcel(
    `attendance-${sheet.month}`,
    [
      {
        name: monthLabel(sheet.month),
        title: `Attendance · ${monthLabel(sheet.month)}`,
        columns: [...header, ...days, ...totals],
        rows: sheet.rows.map((r) => [
          r.employee.fullName,
          r.employee.employeeNo,
          r.employee.departmentName ?? '',
          ...r.days.map((d) => (d.inProgress ? '' : DAY_STATUS_CODE[d.status])),
          r.summary.present,
          r.summary.late,
          r.summary.absent,
          r.summary.onLeave,
          Math.round(r.summary.minutesWorked / 6) / 10,
          Math.round(r.summary.overtimeMinutes / 6) / 10,
        ]),
      },
    ],
    `Times in ${sheet.timezone}. ${Object.entries(DAY_STATUS_CODE).map(([k, v]) => `${v} = ${DAY_STATUS_LABEL[k as DayStatus]}`).join(', ')}`,
  )
}

function SheetView() {
  const toast = useToast()
  const [month, setMonth] = useState<string | undefined>(undefined)
  const [departmentId, setDept] = useState('')
  const [status, setStatus] = useState('')
  const q = useMonthSheet({ month, departmentId: departmentId || undefined, status: status || undefined })
  const all = useMonthSheet({ month })
  const depts = useMemo(() => [...new Map((all.data?.rows ?? []).filter((r) => r.employee.departmentId).map((r) => [r.employee.departmentId!, r.employee.departmentName ?? ''])).entries()], [all.data])
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  const s = q.data
  return (
    <section aria-label="Monthly sheet" className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <MonthNav month={s.month} onChange={setMonth} />
        <F label="Department">
          <SelectInput value={departmentId} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {depts.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </SelectInput>
        </F>
        <F label="Had a day">
          <SelectInput value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {DAY_STATUSES.map((x) => (
              <option key={x} value={x}>
                {DAY_STATUS_LABEL[x]}
              </option>
            ))}
          </SelectInput>
        </F>
        <Button
          variant="secondary"
          className="ms-auto"
          onClick={() => exportSheet(s).then(() => toast.success('Excel file downloaded')).catch(() => toast.error('Couldn’t create the Excel file'))}
        >
          <Download />
          Export Excel
        </Button>
      </div>
      <div className="relative overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="text-[0.75rem]" aria-label={`Attendance sheet ${monthLabel(s.month)}`}>
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="sticky start-0 bg-surface px-3 py-2 text-start font-medium">
                Employee
              </th>
              {s.dates.map((d) => (
                <th key={d} scope="col" className="num w-7 px-0.5 py-2 text-center font-medium">
                  {Number(d.slice(8))}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-end font-medium">P</th>
              <th scope="col" className="px-2 py-2 text-end font-medium">L</th>
              <th scope="col" className="px-2 py-2 text-end font-medium">A</th>
              <th scope="col" className="px-2 py-2 text-end font-medium">Worked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {s.rows.map((r) => (
              <tr key={r.employee.id}>
                <th scope="row" className="sticky start-0 min-w-44 bg-surface px-3 py-1.5 text-start font-medium text-ink">
                  {r.employee.fullName}
                  <span className="block text-[0.6875rem] font-normal text-muted">{r.employee.departmentName ?? ''}</span>
                </th>
                {r.days.map((d) => (
                  <td key={d.workDate} className="px-0.5 py-1.5 text-center" title={`${shortDate(d.workDate)}: ${DAY_STATUS_LABEL[d.status]}${d.checkInLocal ? ` ${d.checkInLocal}–${d.checkOutLocal ?? '?'}` : ''}`}>
                    {d.inProgress ? (
                      <span className="text-subtle">·</span>
                    ) : (
                      <Badge tone={DAY_TONE[d.status]} className="px-1">
                        {DAY_STATUS_CODE[d.status]}
                        {d.missingCheckOut ? '!' : ''}
                      </Badge>
                    )}
                  </td>
                ))}
                <td className="num px-2 text-end">{r.summary.present}</td>
                <td className="num px-2 text-end">{r.summary.late}</td>
                <td className="num px-2 text-end">{r.summary.absent}</td>
                <td className="num px-2 text-end">{fmtMinutes(r.summary.minutesWorked)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        {Object.entries(DAY_STATUS_CODE).map(([k, v]) => `${v} ${DAY_STATUS_LABEL[k as DayStatus]}`).join(' · ')} · ! missing clock-out · times in {s.timezone}
      </p>
    </section>
  )
}

/* ---------------- Corrections ---------------- */

function CorrectionsView() {
  const q = useCorrections()
  const [deciding, setDeciding] = useState<AttendanceCorrection | null>(null)
  if (q.isPending) return <Skeleton className="h-48" />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  if (!q.data.length) return <EmptyState title="No corrections" body="Ask for a correction from My attendance when a day is wrong." icon={<CalendarCheck />} />
  return (
    <>
      <Table label="Attendance corrections" head={['Employee', 'Date', 'Requested times', 'Reason', 'Status', '']}>
        {q.data.map((c) => (
          <tr key={c.id}>
            <td className={`${td} font-medium text-ink`}>{c.employeeName}</td>
            <td className={td}>{shortDate(c.workDate)}</td>
            <td className={`${td} num`}>
              {c.checkIn}–{c.checkOut ?? '—'}
            </td>
            <td className={`${td} max-w-72 text-ink-2`}>{c.reason}</td>
            <td className={td}>
              <Badge tone={c.status === 'approved' ? 'green' : c.status === 'rejected' ? 'red' : 'amber'}>{CORRECTION_STATUS_LABEL[c.status]}</Badge>
              {c.decidedByName && <span className="block text-xs text-muted">by {c.decidedByName}</span>}
            </td>
            <td className={`${td} text-end`}>
              {c.canDecide && (
                <Button size="xs" onClick={() => setDeciding(c)}>
                  Review
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {deciding && <DecideCorrection c={deciding} onClose={() => setDeciding(null)} />}
    </>
  )
}

function DecideCorrection({ c, onClose }: { c: AttendanceCorrection; onClose: () => void }) {
  const toast = useToast()
  const [comment, setComment] = useState('')
  const m = useHrTimeMutation((decision: 'approve' | 'reject') => hrTimeApi.decideCorrection(c.id, { decision, comment }))
  const go = (decision: 'approve' | 'reject') =>
    m.mutate(decision, {
      onSuccess: () => {
        toast.success(decision === 'approve' ? 'Correction approved' : 'Correction rejected')
        onClose()
      },
      onError: (e) => toast.error('Couldn’t save the decision', errorMessage(e)),
    })
  return (
    <Modal
      open
      onClose={onClose}
      title={`${c.employeeName} · ${shortDate(c.workDate)}`}
      description={`Set the day to ${c.checkIn}–${c.checkOut ?? '—'}. ${c.reason}`}
      footer={
        <>
          <Button variant="danger" disabled={m.isPending} onClick={() => go('reject')}>
            Reject
          </Button>
          <Button disabled={m.isPending} onClick={() => go('approve')}>
            Approve
          </Button>
        </>
      }
    >
      <F label="Comment (optional)">
        <TextArea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      </F>
    </Modal>
  )
}

/* ---------------- Shifts ---------------- */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ShiftsView({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const q = useShifts()
  const [editing, setEditing] = useState<Shift | 'new' | null>(null)
  const del = useHrTimeMutation((id: string) => hrTimeApi.deleteShift(id))
  const assign = useHrTimeMutation((a: { employeeId: string; shiftId: string }) => hrTimeApi.assignShift(a.employeeId, a.shiftId))
  if (q.isPending) return <Skeleton className="h-48" />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  const v = q.data
  return (
    <section className="space-y-4" aria-label="Shifts">
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted">
          Company working week: {workingWeekLabel(v.weekend)} · {v.timezone}
        </p>
        {canEdit && (
          <Button size="sm" className="ms-auto" onClick={() => setEditing('new')}>
            <Plus />
            New shift
          </Button>
        )}
      </div>
      <Table label="Shifts" head={['Shift', 'Hours', 'Break', 'Grace', 'Working days', 'Employees', '']}>
        {v.shifts.map((s) => (
          <tr key={s.id}>
            <td className={`${td} font-medium text-ink`}>
              {s.name} {s.isDefault && <Badge tone="brand">Default</Badge>} {!s.isActive && <Badge>Off</Badge>}
            </td>
            <td className={`${td} num`}>
              {s.startTime}–{s.endTime}
            </td>
            <td className={`${td} num`}>{s.breakMinutes} min</td>
            <td className={`${td} num`}>{s.graceMinutes} min</td>
            <td className={td}>{s.workingDays.map((d) => WEEKDAYS[d]).join(', ')}</td>
            <td className={`${td} num`}>{s.employeeCount ?? 0}</td>
            <td className={`${td} text-end`}>
              {canEdit && (
                <span className="inline-flex gap-1">
                  <Button size="xs" variant="ghost" iconOnly aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                    <Pencil />
                  </Button>
                  {!s.isDefault && (
                    <Button
                      size="xs"
                      variant="ghost"
                      iconOnly
                      aria-label={`Delete ${s.name}`}
                      onClick={() => del.mutate(s.id, { onSuccess: () => toast.success('Shift deleted'), onError: (e) => toast.error('Couldn’t delete', errorMessage(e)) })}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </span>
              )}
            </td>
          </tr>
        ))}
      </Table>
      <Table label="Shift assignments" head={['Employee', 'Shift']} minWidth={420}>
        {v.assignments.map((a) => (
          <tr key={a.employeeId}>
            <td className={`${td} text-ink`}>{a.employeeName}</td>
            <td className={td}>
              {canEdit ? (
                <SelectInput
                  aria-label={`Shift of ${a.employeeName}`}
                  value={a.shiftId}
                  onChange={(e) => assign.mutate({ employeeId: a.employeeId, shiftId: e.target.value }, { onError: (err) => toast.error('Couldn’t assign', errorMessage(err)) })}
                >
                  {v.shifts.filter((s) => s.isActive).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </SelectInput>
              ) : (
                <span className="text-ink-2">{v.shifts.find((s) => s.id === a.shiftId)?.name ?? '—'}</span>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {editing && <ShiftModal shift={editing === 'new' ? null : editing} weekend={v.weekend} onClose={() => setEditing(null)} />}
    </section>
  )
}

function ShiftModal({ shift, weekend, onClose }: { shift: Shift | null; weekend: number[]; onClose: () => void }) {
  const toast = useToast()
  const [f, setF] = useState<ShiftInput>(
    shift ?? { name: '', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 10, workingDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekend.includes(d)), isDefault: false, isActive: true },
  )
  const save = useHrTimeMutation(() => (shift ? hrTimeApi.updateShift(shift.id, f) : hrTimeApi.createShift(f)))
  const set = <K extends keyof ShiftInput>(k: K, v: ShiftInput[K]) => setF((x) => ({ ...x, [k]: v }))
  return (
    <Modal
      open
      onClose={onClose}
      title={shift ? `Edit ${shift.name}` : 'New shift'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: () => (toast.success('Shift saved'), onClose()), onError: (e) => toast.error('Couldn’t save the shift', errorMessage(e)) })}
          >
            Save
          </Button>
        </>
      }
    >
      <F label="Name">
        <TextInput value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} maxLength={80} />
      </F>
      <div className="grid grid-cols-2 gap-3">
        <F label="Starts">
          <TextInput type="time" value={f.startTime} onChange={(e) => set('startTime', e.target.value)} />
        </F>
        <F label="Ends">
          <TextInput type="time" value={f.endTime} onChange={(e) => set('endTime', e.target.value)} />
        </F>
        <F label="Break (minutes)">
          <TextInput type="number" min={0} value={f.breakMinutes} onChange={(e) => set('breakMinutes', Number(e.target.value))} />
        </F>
        <F label="Grace (minutes)">
          <TextInput type="number" min={0} value={f.graceMinutes} onChange={(e) => set('graceMinutes', Number(e.target.value))} />
        </F>
      </div>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-xs font-medium text-muted">Working days</legend>
        {WEEKDAYS.map((w, i) => (
          <label key={w} className="flex items-center gap-1.5 text-[0.8125rem]">
            <Checkbox
              checked={f.workingDays?.includes(i) ?? false}
              onChange={(e) => set('workingDays', e.target.checked ? [...(f.workingDays ?? []), i] : (f.workingDays ?? []).filter((d) => d !== i))}
            />
            {w}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-[0.8125rem]">
        <Checkbox checked={!!f.isDefault} onChange={(e) => set('isDefault', e.target.checked)} />
        Default shift (everyone without an assignment)
      </label>
    </Modal>
  )
}

/* ---------------- Import ---------------- */

function ImportView() {
  const toast = useToast()
  const [csv, setCsv] = useState('')
  const run = useHrTimeMutation((dryRun: boolean) => hrTimeApi.importPunches({ csv, dryRun }))
  const report = run.data
  const onFile = async (file: File | undefined) => {
    if (file) setCsv(await file.text())
  }
  return (
    <section className="space-y-3" aria-label="Import punches">
      <p className="text-[0.8125rem] text-ink-2">
        CSV with <code>employee_no,timestamp</code> per line (timestamp as <code>yyyy-MM-dd HH:mm</code> in company time, or ISO 8601 with an offset). Punches are paired in / out per
        employee and day.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line-strong px-3 py-1.5 text-[0.8125rem] hover:bg-hover">
          <FileUp className="size-4" aria-hidden />
          Choose a CSV file
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        <Button variant="secondary" disabled={!csv.trim() || run.isPending} onClick={() => run.mutate(true, { onError: (e) => toast.error('Couldn’t check the file', errorMessage(e)) })}>
          Validate
        </Button>
        <Button
          disabled={!csv.trim() || run.isPending}
          onClick={() => run.mutate(false, { onSuccess: (r) => toast.success(`Imported ${r.entriesCreated} entries`, r.invalid ? `${r.invalid} rows skipped` : undefined), onError: (e) => toast.error('Import failed', errorMessage(e)) })}
        >
          Import
        </Button>
      </div>
      <TextArea aria-label="CSV content" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'employee_no,timestamp\nAPX-0011,2026-11-18 08:58'} />
      {report && (
        <>
          <p className="text-[0.8125rem] text-ink">
            {report.valid} valid · {report.invalid} invalid {report.dryRun ? '(validation only, nothing saved)' : `· ${report.entriesCreated} entries created`}
          </p>
          <Table label="Validation report" head={['Line', 'Employee', 'Timestamp', 'Result']} minWidth={480}>
            {report.rows.map((r) => (
              <tr key={r.line}>
                <td className={`${td} num`}>{r.line}</td>
                <td className={td}>{r.employeeName ?? r.employeeNo}</td>
                <td className={`${td} num`}>{r.timestamp}</td>
                <td className={td}>{r.ok ? <Badge tone="green">OK · {r.workDate}</Badge> : <Badge tone="red">{r.error}</Badge>}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <p className="text-xs text-subtle">Sources: {Object.values(ATTENDANCE_SOURCE_LABEL).join(', ')}.</p>
    </section>
  )
}
