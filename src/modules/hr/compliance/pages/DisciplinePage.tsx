import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Gavel, Plus, Undo2 } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { fmtDate } from '@/shared/lib/utils'
import type { HrFile } from '@/modules/hr/peopleTypes'
import { FileInput } from '@/modules/hr/components/PeopleBits'
import { useEmployeesQuery } from '@/modules/hr/hooks/useHrPeople'
import { errorMessage, F, Table, td, useHrScope } from '@/modules/hr/time/components/shared'
import { monthLabel } from '@/modules/hr/payroll/calc'
import { fmt2 } from '@/modules/hr/payroll/components/bits'
import { LETTER_LANGUAGES, LETTER_LANGUAGE_LABEL } from '@/modules/hr/selfservice/types'
import { complianceApi, useComplianceMutation, useDiscipline, useDisciplineRecord } from '../api'
import { defaultExpiryMonths, escalationHint } from '../rules'
import {
  DISCIPLINARY_CATEGORIES,
  DISCIPLINARY_CATEGORY_LABEL,
  DISCIPLINARY_STATUS_LABEL,
  DISCIPLINARY_TYPES,
  DISCIPLINARY_TYPE_LABEL,
  EXPIRY_MONTH_OPTIONS,
  type DisciplinaryCategory,
  type DisciplinaryStatus,
  type DisciplinaryType,
} from '../types'
import { AckBadge, EscalationNote, FileLink, RecordStatusBadge, TypeBadge, warningLetterPath } from '../components/bits'

/**
 * `/hr/discipline`: warnings and disciplinary actions. HR full issues, withdraws and sees the company; a department
 * head reads their team's records (no deduction amounts); each employee's own records live in My HR.
 */
export default function DisciplinePage() {
  const { full } = useHrScope()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState<DisciplinaryStatus | ''>('')
  const [type, setType] = useState<DisciplinaryType | ''>('')
  const [creating, setCreating] = useState(false)
  const q = useDiscipline({ status: status || undefined, type: type || undefined })
  const open = params.get('record')
  const setOpen = (id: string | null) =>
    setParams(
      (p) => {
        if (id) p.set('record', id)
        else p.delete('record')
        return p
      },
      { replace: true },
    )
  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <Gavel />
          </IconTile>
        }
        title="Discipline"
        description="Warnings and disciplinary actions: verbal, written and final warnings, suspensions and salary deductions, with the employee’s acknowledgement, expiry and escalation."
        actions={
          full ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              New record
            </Button>
          ) : undefined
        }
      />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <div className="w-48">
            <F label="Status">
              <SelectInput value={status} onChange={(e) => setStatus(e.target.value as DisciplinaryStatus | '')}>
                <option value="">All</option>
                {(['active', 'expired', 'withdrawn'] as const).map((s) => (
                  <option key={s} value={s}>
                    {DISCIPLINARY_STATUS_LABEL[s]}
                  </option>
                ))}
              </SelectInput>
            </F>
          </div>
          <div className="w-56">
            <F label="Type">
              <SelectInput value={type} onChange={(e) => setType(e.target.value as DisciplinaryType | '')}>
                <option value="">All types</option>
                {DISCIPLINARY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DISCIPLINARY_TYPE_LABEL[t]}
                  </option>
                ))}
              </SelectInput>
            </F>
          </div>
        </div>
        {q.isPending ? (
          <Skeleton className="h-64" />
        ) : q.error ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !q.data.length ? (
          <EmptyState title="No disciplinary records" body={full ? 'Issue a warning or another action with New record.' : 'Nothing on file for your team.'} icon={<Gavel />} />
        ) : (
          <Table label="Disciplinary records" head={['Employee', 'Action', 'Category', 'Issued', 'Status', 'Employee’s answer', '']} minWidth={960}>
            {q.data.map((r) => (
              <tr key={r.id}>
                <td className={`${td} text-ink`}>
                  {r.employeeName}
                  <span className="block text-xs text-muted">
                    {r.employeeNo}
                    {r.departmentName ? ` · ${r.departmentName}` : ''}
                  </span>
                </td>
                <td className={td}>
                  <TypeBadge type={r.type} />
                  <span className="num block text-xs text-muted">{r.caseNo}</span>
                </td>
                <td className={td}>{DISCIPLINARY_CATEGORY_LABEL[r.category]}</td>
                <td className={td}>
                  {fmtDate(r.issueDate)}
                  <span className="block text-xs text-muted">incident {fmtDate(r.incidentDate)}</span>
                </td>
                <td className={td}>
                  <RecordStatusBadge status={r.status} />
                  <span className="block text-xs text-muted">{r.expiresOn ? `until ${fmtDate(r.expiresOn)}` : 'no expiry'}</span>
                </td>
                <td className={td}>
                  <AckBadge status={r.ackStatus} />
                </td>
                <td className={`${td} text-end`}>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(r.id)}>
                    Open
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </PageBody>
      <RecordDrawer id={open} onClose={() => setOpen(null)} />
      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={(id) => setOpen(id)} />}
    </>
  )
}

function RecordDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useDisciplineRecord(id)
  const [withdrawing, setWithdrawing] = useState(false)
  const r = q.data
  return (
    <Drawer open={!!id} onClose={onClose} title={r ? `${DISCIPLINARY_TYPE_LABEL[r.type]} · ${r.caseNo}` : 'Disciplinary record'} description={r ? `${r.employeeName} (${r.employeeNo})` : undefined}>
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : q.error || !r ? (
        <ErrorState message={errorMessage(q.error)} />
      ) : (
        <div className="space-y-4 text-[0.8125rem]">
          <div className="flex flex-wrap gap-2">
            <TypeBadge type={r.type} />
            <RecordStatusBadge status={r.status} />
            <AckBadge status={r.ackStatus} />
          </div>
          <EscalationNote hint={r.escalation} />
          <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-muted">Category</dt>
            <dd>{DISCIPLINARY_CATEGORY_LABEL[r.category]}</dd>
            <dt className="text-muted">Incident date</dt>
            <dd>{fmtDate(r.incidentDate)}</dd>
            <dt className="text-muted">Issued</dt>
            <dd>
              {fmtDate(r.issueDate)} by {r.issuedByName}
            </dd>
            <dt className="text-muted">Lapses</dt>
            <dd>{r.expiresOn ? `${fmtDate(r.expiresOn)} (${r.expiryMonths} months)` : 'Never'}</dd>
            {r.suspensionDays !== null && (
              <>
                <dt className="text-muted">Suspension</dt>
                <dd>
                  {r.suspensionDays} day{r.suspensionDays === 1 ? '' : 's'} from {fmtDate(r.suspensionStart ?? '')}
                </dd>
              </>
            )}
            {r.type === 'deduction' && (
              <>
                <dt className="text-muted">Deduction</dt>
                <dd>
                  {r.deductionAmount !== null ? `${r.currency} ${fmt2(r.deductionAmount)}` : '•••'} in {monthLabel(r.deductionMonth ?? '')} payroll
                  {r.adjustmentId && <span className="block text-xs text-muted">Payroll adjustment {r.adjustmentId}</span>}
                </dd>
              </>
            )}
          </dl>
          <div>
            <p className="text-xs font-medium text-muted">What happened</p>
            <p className="mt-1 whitespace-pre-line text-ink">{r.description}</p>
            {r.descriptionAr && (
              <p className="mt-2 whitespace-pre-line text-ink" dir="rtl" lang="ar">
                {r.descriptionAr}
              </p>
            )}
          </div>
          {r.attachments.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted">Attachments</p>
              <ul className="mt-1 space-y-1">
                {r.attachments.map((a) => (
                  <li key={a.id}>
                    <FileLink file={a} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.canManage && r.status !== 'withdrawn' && <AttachMore id={r.id} />}
          {(r.ackStatus !== 'pending' || r.employeeComment) && (
            <div className="rounded-lg bg-sunken p-3">
              <p className="text-xs font-medium text-muted">
                {r.ackStatus === 'appealed' ? 'Appeal' : 'Employee’s comment'}
                {r.ackAt ? ` · ${fmtDate(r.ackAt)}` : ''}
              </p>
              <p className="mt-1 text-ink">{r.employeeComment || 'Acknowledged without a comment.'}</p>
            </div>
          )}
          {r.withdrawnAt && (
            <p className="rounded-lg bg-sunken p-3">
              Withdrawn {fmtDate(r.withdrawnAt)} by {r.withdrawnByName}: {r.withdrawReason}
            </p>
          )}
          {r.canManage && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="text-xs text-muted">Warning letter:</span>
              {LETTER_LANGUAGES.map((l) => (
                <Link key={l} to={warningLetterPath(r.id, l)} className="text-[0.8125rem] font-medium text-accent-700 hover:underline dark:text-accent-300">
                  {LETTER_LANGUAGE_LABEL[l]}
                </Link>
              ))}
              {r.canWithdraw && (
                <Button size="sm" variant="secondary" className="ms-auto" onClick={() => setWithdrawing(true)}>
                  <Undo2 />
                  Withdraw
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {withdrawing && r && <WithdrawModal id={r.id} onClose={() => setWithdrawing(false)} />}
    </Drawer>
  )
}

function AttachMore({ id }: { id: string }) {
  const toast = useToast()
  const [file, setFile] = useState<HrFile | null>(null)
  const m = useComplianceMutation(complianceApi.addAttachments)
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <F label="Add a file" hint="Counts against the plan’s storage.">
          <FileInput id="" value={file} onChange={setFile} />
        </F>
      </div>
      <Button size="sm" disabled={!file} loading={m.isPending} onClick={() => file && m.mutate({ id, attachments: [file] }, { onSuccess: () => (setFile(null), toast.success('File attached')), onError: (e) => toast.error('Not attached', errorMessage(e)) })}>
        Attach
      </Button>
    </div>
  )
}

function WithdrawModal({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const m = useComplianceMutation(complianceApi.withdraw)
  return (
    <Modal
      open
      onClose={onClose}
      title="Withdraw the record"
      description="It stays on file as withdrawn and no longer counts for escalation. An unpaid payroll deduction is removed. The employee is told. Audited."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!reason.trim()} loading={m.isPending} onClick={() => m.mutate({ id, reason }, { onSuccess: () => (toast.success('Record withdrawn'), onClose()) })}>
            Withdraw
          </Button>
        </>
      }
    >
      <F label="Reason">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </F>
      {m.error && <p className="mt-3 text-[0.8125rem] text-danger-700 dark:text-danger-300" role="alert">{errorMessage(m.error)}</p>}
    </Modal>
  )
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast()
  const employees = useEmployeesQuery()
  const today = new Date().toISOString().slice(0, 10)
  const [employeeId, setEmployeeId] = useState('')
  const [type, setType] = useState<DisciplinaryType>('written_warning')
  const [category, setCategory] = useState<DisciplinaryCategory>('attendance')
  const [incidentDate, setIncidentDate] = useState(today)
  const [description, setDescription] = useState('')
  const [descriptionAr, setDescriptionAr] = useState('')
  const [expiry, setExpiry] = useState<number | ''>('')
  const [days, setDays] = useState('1')
  const [start, setStart] = useState(today)
  const [amount, setAmount] = useState('')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [file, setFile] = useState<HrFile | null>(null)
  const history = useDiscipline({ employeeId: employeeId || '__none__', status: 'active' })
  const hint = useMemo(() => (employeeId && history.data ? escalationHint(history.data) : null), [employeeId, history.data])
  const m = useComplianceMutation(complianceApi.createRecord)
  const suspension = type === 'suspension_paid' || type === 'suspension_unpaid'
  function send() {
    m.mutate(
      {
        employeeId,
        type,
        category,
        incidentDate,
        description,
        descriptionAr,
        expiryMonths: expiry === '' ? defaultExpiryMonths(type) : expiry,
        ...(suspension ? { suspensionDays: Number(days), suspensionStart: start } : {}),
        ...(type === 'deduction' ? { deductionAmount: Number(amount), deductionMonth: month } : {}),
        attachments: file ? [file] : [],
      },
      {
        onSuccess: (r) => {
          toast.success(`${DISCIPLINARY_TYPE_LABEL[r.type]} issued`, `${r.caseNo} · the employee is asked to acknowledge it in My HR.`)
          onClose()
          onCreated(r.id)
        },
      },
    )
  }
  return (
    <Modal
      open

      onClose={onClose}
      title="New disciplinary record"
      description="The employee sees it in My HR and acknowledges it or appeals. A deduction goes into payroll as an adjustment."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={send} loading={m.isPending} disabled={!employeeId || description.trim().length < 5}>
            Issue
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <F label="Employee">
            <SelectInput value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Pick an employee…</option>
              {(employees.data ?? [])
                .filter((e) => e.status !== 'terminated')
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} ({e.employeeNo})
                  </option>
                ))}
            </SelectInput>
          </F>
        </div>
        {hint?.message && (
          <div className="sm:col-span-2">
            <EscalationNote hint={hint} />
          </div>
        )}
        <F label="Action">
          <SelectInput value={type} onChange={(e) => setType(e.target.value as DisciplinaryType)}>
            {DISCIPLINARY_TYPES.map((t) => (
              <option key={t} value={t}>
                {DISCIPLINARY_TYPE_LABEL[t]}
              </option>
            ))}
          </SelectInput>
        </F>
        <F label="Reason category">
          <SelectInput value={category} onChange={(e) => setCategory(e.target.value as DisciplinaryCategory)}>
            {DISCIPLINARY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {DISCIPLINARY_CATEGORY_LABEL[c]}
              </option>
            ))}
          </SelectInput>
        </F>
        <F label="Incident date">
          <TextInput type="date" value={incidentDate} max={today} onChange={(e) => setIncidentDate(e.target.value)} />
        </F>
        <F label="Lapses after" hint={`Default for this action: ${defaultExpiryMonths(type) || 'never'}${defaultExpiryMonths(type) ? ' months' : ''}`}>
          <SelectInput value={expiry} onChange={(e) => setExpiry(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Default</option>
            {EXPIRY_MONTH_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n ? `${n} months` : 'Never'}
              </option>
            ))}
          </SelectInput>
        </F>
        {suspension && (
          <>
            <F label="Suspension days">
              <TextInput type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} />
            </F>
            <F label="First day">
              <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </F>
          </>
        )}
        {type === 'deduction' && (
          <>
            <F label="Amount to deduct">
              <TextInput type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </F>
            <F label="Payroll month">
              <TextInput type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </F>
          </>
        )}
        <div className="sm:col-span-2">
          <F label="Description">
            <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </F>
        </div>
        <div className="sm:col-span-2">
          <F label="Description in Arabic" hint="Optional: the Arabic warning letter uses it (otherwise the English one).">
            <TextArea dir="rtl" lang="ar" value={descriptionAr} onChange={(e) => setDescriptionAr(e.target.value)} rows={3} />
          </F>
        </div>
        <div className="sm:col-span-2">
          <F label="Attachment" hint="Optional; counts against the plan’s storage.">
            <FileInput id="" value={file} onChange={setFile} />
          </F>
        </div>
      </div>
      {m.error && <p className="mt-3 text-[0.8125rem] text-danger-700 dark:text-danger-300" role="alert">{errorMessage(m.error)}</p>}
    </Modal>
  )
}
