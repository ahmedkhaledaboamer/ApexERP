import { useState } from 'react'
import { HandCoins, Pencil, Plus, Trash2, Users } from 'lucide-react'
import type { AdjustmentInput, AdjustmentKind, LoanInput, PayAdjustment, PayLoan, PayMethod, PayrollProfile } from '@/modules/hr/payroll/types'
import { ADJUSTMENT_KINDS, ADJUSTMENT_KIND_LABEL, LOAN_STATUS_LABEL, PAY_METHODS, PAY_METHOD_LABEL } from '@/modules/hr/payroll/types'
import { addMonths, monthLabel } from '@/modules/hr/payroll/calc'
import { payrollApi, useAdjustments, useLoans, usePayrollMutation, usePayrollProfiles } from '@/modules/hr/payroll/api'
import { useEmployeesQuery } from '@/modules/hr/hooks/useHrPeople'
import { HrError, MaskedValue } from '@/modules/hr/components/PeopleBits'
import { Amount, SimpleTable, td, tdEnd, th, thEnd } from './bits'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

const thisMonth = () => new Date().toISOString().slice(0, 7)

function EmployeeSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const emps = useEmployeesQuery()
  return (
    <SelectInput id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Pick an employee…</option>
      {(emps.data ?? [])
        .filter((e) => e.status !== 'terminated')
        .map((e) => (
          <option key={e.id} value={e.id}>
            {e.fullName} ({e.employeeNo})
          </option>
        ))}
    </SelectInput>
  )
}

/* ---------------- Adjustments ---------------- */

export function AdjustmentsTab() {
  const q = useAdjustments()
  const [editing, setEditing] = useState<PayAdjustment | 'new' | null>(null)
  const toast = useToast()
  const del = usePayrollMutation((id: string) => payrollApi.deleteAdjustment(id))
  if (q.error) return <HrError error={q.error} onRetry={() => q.refetch()} />
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-muted">Allowances, bonuses and deductions per employee: one-off in their month, or every month until an end month.</p>
        <Button write onClick={() => setEditing('new')}><Plus />New adjustment</Button>
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : !q.data?.length ? (
        <EmptyState icon={<HandCoins />} title="No adjustments" body="Add an allowance, a bonus or a deduction." />
      ) : (
        <SimpleTable
          label="Adjustments"
          head={
            <tr>
              <th className={th}>Employee</th>
              <th className={th}>Adjustment</th>
              <th className={th}>When</th>
              <th className={thEnd}>Amount</th>
              <th className={th}><span className="sr-only">Actions</span></th>
            </tr>
          }
        >
          {q.data.map((a) => (
            <tr key={a.id}>
              <td className={td}>{a.employeeName}</td>
              <td className={td}>
                <span className="block font-medium text-ink">{a.label}</span>
                <Badge tone={a.kind === 'deduction' ? 'red' : a.kind === 'bonus' ? 'green' : 'blue'}>{ADJUSTMENT_KIND_LABEL[a.kind]}</Badge>
                {a.locked && <Badge tone="neutral" className="ms-1">Paid</Badge>}
              </td>
              <td className={td}>{a.recurrence === 'once' ? monthLabel(a.month) : `Monthly from ${monthLabel(a.month)}${a.endMonth ? ` to ${monthLabel(a.endMonth)}` : ''}`}</td>
              <td className={tdEnd}><Amount value={a.kind === 'deduction' ? -a.amount : a.amount} /></td>
              <td className={tdEnd}>
                {!a.locked && (
                  <span className="inline-flex gap-1">
                    <Button write size="xs" variant="ghost" aria-label={`Edit ${a.label}`} onClick={() => setEditing(a)}><Pencil /></Button>
                    {!a.paidRunIds.length && (
                      <Button write size="xs" variant="ghost" aria-label={`Delete ${a.label}`} onClick={() => del.mutate(a.id, { onSuccess: () => toast.success('Adjustment deleted'), onError: (e) => toast.error('Not deleted', e.message) })}><Trash2 /></Button>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </SimpleTable>
      )}
      {editing && <AdjustmentModal adj={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function AdjustmentModal({ adj, onClose }: { adj: PayAdjustment | null; onClose: () => void }) {
  const toast = useToast()
  const [v, setV] = useState<AdjustmentInput>(adj ? { kind: adj.kind, label: adj.label, amount: adj.amount, recurrence: adj.recurrence, month: adj.month, endMonth: adj.endMonth, notes: adj.notes } : { kind: 'allowance', label: '', amount: 0, recurrence: 'once', month: addMonths(thisMonth(), 0), endMonth: null, employeeId: '' })
  const save = usePayrollMutation((input: AdjustmentInput) => payrollApi.saveAdjustment(input, adj?.id))
  const set = (p: Partial<AdjustmentInput>) => setV((x) => ({ ...x, ...p }))
  const paidRecurring = !!adj && adj.paidRunIds.length > 0
  return (
    <Modal
      open
      onClose={onClose}
      title={adj ? 'Edit adjustment' : 'New adjustment'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={() => save.mutate(paidRecurring ? { endMonth: v.endMonth, notes: v.notes } : v, { onSuccess: () => { toast.success('Adjustment saved'); onClose() }, onError: (e) => toast.error('Not saved', e.message) })}>
            Save adjustment
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!adj && (
          <Field id="adj-emp" label="Employee" className="sm:col-span-2">
            <EmployeeSelect id="adj-emp" value={v.employeeId ?? ''} onChange={(employeeId) => set({ employeeId })} />
          </Field>
        )}
        <Field id="adj-kind" label="Kind">
          <SelectInput id="adj-kind" disabled={paidRecurring} value={v.kind} onChange={(e) => set({ kind: e.target.value as AdjustmentKind })}>
            {ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{ADJUSTMENT_KIND_LABEL[k]}</option>)}
          </SelectInput>
        </Field>
        <Field id="adj-amount" label="Amount">
          <TextInput id="adj-amount" type="number" min={0} step="0.01" disabled={paidRecurring} value={v.amount ?? ''} onChange={(e) => set({ amount: Number(e.target.value) })} />
        </Field>
        <Field id="adj-label" label="Label" className="sm:col-span-2">
          <TextInput id="adj-label" disabled={paidRecurring} value={v.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Mobile allowance" />
        </Field>
        <Field id="adj-rec" label="Repeats">
          <SelectInput id="adj-rec" disabled={paidRecurring} value={v.recurrence} onChange={(e) => set({ recurrence: e.target.value as 'once' | 'monthly' })}>
            <option value="once">One-off</option>
            <option value="monthly">Every month</option>
          </SelectInput>
        </Field>
        <Field id="adj-month" label={v.recurrence === 'monthly' ? 'From month' : 'Month'}>
          <TextInput id="adj-month" type="month" disabled={paidRecurring} value={v.month ?? ''} onChange={(e) => set({ month: e.target.value })} />
        </Field>
        {v.recurrence === 'monthly' && (
          <Field id="adj-end" label="Until month (optional)">
            <TextInput id="adj-end" type="month" value={v.endMonth ?? ''} onChange={(e) => set({ endMonth: e.target.value || null })} />
          </Field>
        )}
      </div>
    </Modal>
  )
}

/* ---------------- Loans ---------------- */

export function LoansTab() {
  const q = useLoans()
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<PayLoan | null>(null)
  if (q.error) return <HrError error={q.error} onRetry={() => q.refetch()} />
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-muted">Salary advances and loans: the installment is deducted in every payroll run from the start month until it is repaid.</p>
        <Button write onClick={() => setCreating(true)}><Plus />New loan or advance</Button>
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : !q.data?.length ? (
        <EmptyState icon={<HandCoins />} title="No loans" body="Record a salary advance or a loan." />
      ) : (
        <SimpleTable
          label="Loans"
          head={
            <tr>
              <th className={th}>Employee</th>
              <th className={th}>Type</th>
              <th className={th}>Status</th>
              <th className={thEnd}>Amount</th>
              <th className={thEnd}>Installment</th>
              <th className={thEnd}>Remaining</th>
            </tr>
          }
        >
          {q.data.map((l) => (
            <tr key={l.id} className="cursor-pointer hover:bg-hover" onClick={() => setOpen(l)}>
              <td className={td}>
                <span className="block font-medium text-ink">{l.employeeName}</span>
                <span className="block text-xs text-muted">{l.reason || '—'}</span>
              </td>
              <td className={td}>{l.kind === 'advance' ? 'Salary advance' : 'Loan'}</td>
              <td className={td}><Badge tone={l.status === 'active' ? 'amber' : l.status === 'repaid' || l.status === 'settled' ? 'green' : 'neutral'}>{LOAN_STATUS_LABEL[l.status]}</Badge></td>
              <td className={tdEnd}><Amount value={l.principal} /></td>
              <td className={tdEnd}><Amount value={l.installmentAmount} /></td>
              <td className={tdEnd}><Amount value={l.remaining} strong /></td>
            </tr>
          ))}
        </SimpleTable>
      )}
      {creating && <LoanModal onClose={() => setCreating(false)} />}
      {open && <ScheduleModal loan={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function LoanModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [v, setV] = useState<LoanInput>({ employeeId: '', kind: 'advance', principal: 0, installmentAmount: 0, startMonth: addMonths(thisMonth(), 1), reason: '' })
  const set = (p: Partial<LoanInput>) => setV((x) => ({ ...x, ...p }))
  const save = usePayrollMutation((input: LoanInput) => payrollApi.saveLoan(input))
  return (
    <Modal
      open
      onClose={onClose}
      title="New loan or advance"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={() => save.mutate(v, { onSuccess: () => { toast.success('Saved'); onClose() }, onError: (e) => toast.error('Not saved', e.message) })}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="loan-emp" label="Employee" className="sm:col-span-2">
          <EmployeeSelect id="loan-emp" value={v.employeeId ?? ''} onChange={(employeeId) => set({ employeeId })} />
        </Field>
        <Field id="loan-kind" label="Type">
          <SelectInput id="loan-kind" value={v.kind} onChange={(e) => set({ kind: e.target.value as 'advance' | 'loan' })}>
            <option value="advance">Salary advance</option>
            <option value="loan">Loan</option>
          </SelectInput>
        </Field>
        <Field id="loan-start" label="First deduction">
          <TextInput id="loan-start" type="month" value={v.startMonth ?? ''} onChange={(e) => set({ startMonth: e.target.value })} />
        </Field>
        <Field id="loan-amount" label="Amount">
          <TextInput id="loan-amount" type="number" min={0} value={v.principal || ''} onChange={(e) => set({ principal: Number(e.target.value) })} />
        </Field>
        <Field id="loan-inst" label="Monthly installment">
          <TextInput id="loan-inst" type="number" min={0} value={v.installmentAmount || ''} onChange={(e) => set({ installmentAmount: Number(e.target.value) })} />
        </Field>
        <Field id="loan-reason" label="Reason" className="sm:col-span-2">
          <TextInput id="loan-reason" value={v.reason ?? ''} onChange={(e) => set({ reason: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

function ScheduleModal({ loan, onClose }: { loan: PayLoan; onClose: () => void }) {
  const toast = useToast()
  const cancel = usePayrollMutation(() => payrollApi.saveLoan({ status: 'cancelled' }, loan.id))
  return (
    <Modal open onClose={onClose} title={`${loan.kind === 'advance' ? 'Salary advance' : 'Loan'} · ${loan.employeeName}`} description={`${LOAN_STATUS_LABEL[loan.status]} · repaid ${loan.repaid} of ${loan.principal}`}
      footer={
        <>
          {loan.status === 'active' && loan.repaid === 0 && (
            <Button write variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(undefined, { onSuccess: () => { toast.success('Cancelled'); onClose() }, onError: (e) => toast.error('Not cancelled', e.message) })}>Cancel loan</Button>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </>
      }
    >
      <ul className="space-y-1 text-[0.8125rem]" aria-label="Installment schedule">
        {loan.schedule.map((s, i) => (
          <li key={`${s.month}-${i}`} className="flex justify-between">
            <span>{monthLabel(s.month)} {s.status === 'paid' ? <Badge tone="green">Paid</Badge> : <Badge tone="neutral">Planned</Badge>}</span>
            <Amount value={s.amount} />
          </li>
        ))}
      </ul>
    </Modal>
  )
}

/* ---------------- Payroll profiles ---------------- */

export function ProfilesTab() {
  const q = usePayrollProfiles()
  const [editing, setEditing] = useState<PayrollProfile | null>(null)
  if (q.error) return <HrError error={q.error} onRetry={() => q.refetch()} />
  return (
    <div className="space-y-4">
      <p className="text-[0.8125rem] text-muted">How each employee is paid. Pay components come from the active contract (Employee Contracts); bank details from the employee profile. Ids and IBANs are masked; showing one is audited.</p>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : !q.data?.length ? (
        <EmptyState icon={<Users />} title="No employees" body="Add employees first." />
      ) : (
        <SimpleTable
          label="Payroll profiles"
          head={
            <tr>
              <th className={th}>Employee</th>
              <th className={th}>Pay method</th>
              <th className={th}>Payroll id</th>
              <th className={th}>Bank</th>
              <th className={thEnd}>Monthly pay</th>
              <th className={th}><span className="sr-only">Actions</span></th>
            </tr>
          }
        >
          {q.data.map((p) => (
            <tr key={p.employeeId}>
              <td className={td}>
                <span className="block font-medium text-ink">{p.employeeName}</span>
                <span className="num block text-xs text-muted">{p.employeeNo} · {p.departmentName ?? 'No department'}</span>
                <span className="flex flex-wrap gap-1">
                  {p.issues.map((i) => <Badge key={i} tone="amber">{i === 'no_contract' ? 'No active contract' : i === 'no_iban' ? 'No IBAN' : 'No payroll id'}</Badge>)}
                </span>
              </td>
              <td className={td}>{PAY_METHOD_LABEL[p.payMethod]}</td>
              <td className={td}><MaskedValue masked={p.personIdMasked} canReveal label={`payroll id of ${p.employeeName}`} reveal={() => payrollApi.revealPersonId(p.employeeId)} /></td>
              <td className={td}><span className="block">{p.bankName || '—'}</span><span className="num text-xs text-muted">{p.ibanMasked || 'No IBAN'}</span></td>
              <td className={tdEnd}>{p.totalSalary === null ? <span className="text-muted">—</span> : <Amount value={p.totalSalary} currency={p.currency} />}</td>
              <td className={tdEnd}><Button write size="xs" variant="ghost" aria-label={`Edit payroll profile of ${p.employeeName}`} onClick={() => setEditing(p)}><Pencil /></Button></td>
            </tr>
          ))}
        </SimpleTable>
      )}
      {editing && <ProfileModal p={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ProfileModal({ p, onClose }: { p: PayrollProfile; onClose: () => void }) {
  const toast = useToast()
  const [method, setMethod] = useState<PayMethod>(p.payMethod)
  const [personId, setPersonId] = useState('')
  const [routing, setRouting] = useState(p.bankRoutingCode)
  const save = usePayrollMutation(() => payrollApi.saveProfile(p.employeeId, { payMethod: method, bankRoutingCode: routing, ...(personId ? { personId } : {}) }))
  return (
    <Modal
      open
      onClose={onClose}
      title={`Payroll profile · ${p.employeeName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { toast.success('Saved'); onClose() }, onError: (e) => toast.error('Not saved', e.message) })}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field id="pp-method" label="Pay method">
          <SelectInput id="pp-method" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
            {PAY_METHODS.map((m) => <option key={m} value={m}>{PAY_METHOD_LABEL[m]}</option>)}
          </SelectInput>
        </Field>
        <Field id="pp-id" label="WPS person id (UAE, 14 digits) / national id or iqama (KSA, 10 digits)" hint={p.personIdMasked ? `Stored: ${p.personIdMasked}. Leave empty to keep it.` : 'Not set yet.'}>
          <TextInput id="pp-id" inputMode="numeric" autoComplete="off" value={personId} onChange={(e) => setPersonId(e.target.value)} />
        </Field>
        <Field id="pp-routing" label="Employee bank routing code (optional, 9 digits)" hint="Empty: the company's agent routing code is used in the WPS file.">
          <TextInput id="pp-routing" inputMode="numeric" value={routing} onChange={(e) => setRouting(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
