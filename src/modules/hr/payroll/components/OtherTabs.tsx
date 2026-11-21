import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calculator, FileText, Plus, Receipt } from 'lucide-react'
import type { ExitReason, FinalSettlement, GratuityResult, PayCountry, PaySettings, PaySettingsInput, SiBase } from '@/modules/hr/payroll/types'
import { EXIT_REASONS, EXIT_REASON_LABEL, SI_BASE_LABEL } from '@/modules/hr/payroll/types'
import { gratuity, monthLabel } from '@/modules/hr/payroll/calc'
import { payrollApi, usePaySettings, usePayrollMutation, usePayrollSummary, usePayslips, useSettlements } from '@/modules/hr/payroll/api'
import { useEmployeesQuery } from '@/modules/hr/hooks/useHrPeople'
import { HrError } from '@/modules/hr/components/PeopleBits'
import { payslipPath } from '@/app/paths'
import { Amount, DefaultsNote, SimpleTable, fmt2, td, tdEnd, th, thEnd } from './bits'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, Switch, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

/* ---------------- Payslips ---------------- */

export function PayslipsTab({ mine, highlight }: { mine: boolean; highlight: string | null }) {
  const q = usePayslips()
  const [month, setMonth] = useState('')
  if (q.error) return <HrError error={q.error} onRetry={() => q.refetch()} />
  const months = [...new Set((q.data ?? []).map((p) => p.month))]
  const rows = (q.data ?? []).filter((p) => !month || p.month === month)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-muted">{mine ? 'Your payslips appear here once the month’s payroll is paid.' : 'Payslips of every paid run.'}</p>
        {!mine && months.length > 1 && (
          <SelectInput aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-48">
            <option value="">All months</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </SelectInput>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : !rows.length ? (
        <EmptyState icon={<Receipt />} title="No payslips yet" body="A payslip is available once the month’s payroll is paid." />
      ) : (
        <SimpleTable
          label="Payslips"
          head={
            <tr>
              <th className={th}>Month</th>
              {!mine && <th className={th}>Employee</th>}
              <th className={thEnd}>Gross</th>
              <th className={thEnd}>Deductions</th>
              <th className={thEnd}>Net pay</th>
              <th className={th}>Paid</th>
              <th className={th}><span className="sr-only">Open</span></th>
            </tr>
          }
        >
          {rows.map((p) => (
            <tr key={p.id} className={p.id === highlight ? 'bg-brand-50/60 dark:bg-brand-500/10' : undefined}>
              <td className={td}><span className="font-medium text-ink">{monthLabel(p.month)}</span></td>
              {!mine && (
                <td className={td}>
                  <span className="block">{p.employeeName}</span>
                  <span className="num text-xs text-muted">{p.employeeNo}</span>
                </td>
              )}
              <td className={tdEnd}><Amount value={p.gross} /></td>
              <td className={tdEnd}><Amount value={p.totalDeductions} /></td>
              <td className={tdEnd}><Amount value={p.net} currency={p.currency} strong /></td>
              <td className={td}><span className="num">{fmtDate(p.payDate)}</span></td>
              <td className={tdEnd}>
                <Link to={payslipPath(p.id)} className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-brand-600 hover:underline">
                  <FileText className="size-3.5" aria-hidden />
                  View payslip<span className="sr-only"> for {monthLabel(p.month)}</span>
                </Link>
              </td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  )
}

/* ---------------- Summary ---------------- */

export function SummaryTab() {
  const q = usePayrollSummary()
  if (q.error) return <HrError error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Skeleton className="h-64" />
  const s = q.data
  if (!s.months.length) return <EmptyState icon={<Receipt />} title="No approved payroll yet" body="The summary uses approved and paid runs." />
  const last = s.months[s.months.length - 1]
  const max = Math.max(...s.months.map((m) => m.employerCost), 1)
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Employees paid (latest)', String(last.headcount)],
          [`Net pay, ${monthLabel(last.month)}`, `${s.currency} ${fmt2(last.net)}`],
          [`Employer cost, ${s.months.length} months`, `${s.currency} ${fmt2(s.totals.employerCost)}`],
          [`Gross, ${s.months.length} months`, `${s.currency} ${fmt2(s.totals.gross)}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-surface px-4 py-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="num mt-1 text-lg font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <Card>
        <CardHeader title="Employer cost by month" description="Gross pay + employer social insurance of the approved and paid runs." />
        <CardBody>
          <ul className="space-y-2" aria-label="Employer cost by month">
            {s.months.map((m) => (
              <li key={m.month} className="grid grid-cols-[8rem_1fr_9rem] items-center gap-3 text-[0.8125rem]">
                <span>{monthLabel(m.month)}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                  <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(m.employerCost / max) * 100}%` }} />
                </span>
                <span className="text-end"><Amount value={m.employerCost} /> <span className="text-xs text-muted">· {m.headcount}</span></span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <SimpleTable
        label="Cost by department and month"
        head={
          <tr>
            <th className={th}>Department</th>
            {s.months.map((m) => <th key={m.month} className={thEnd}>{monthLabel(m.month)}</th>)}
            <th className={thEnd}>Total</th>
          </tr>
        }
      >
        {s.departments.map((d) => (
          <tr key={d.departmentId ?? 'none'}>
            <td className={td}>
              <span className="block font-medium text-ink">{d.departmentName}</span>
              <span className="text-xs text-muted">{d.headcount} paid in the latest month</span>
            </td>
            {s.months.map((m) => <td key={m.month} className={tdEnd}><Amount value={d.byMonth[m.month] ?? 0} /></td>)}
            <td className={tdEnd}><Amount value={d.total} strong /></td>
          </tr>
        ))}
      </SimpleTable>
    </div>
  )
}

/* ---------------- Settings ---------------- */

export function SettingsTab() {
  const q = usePaySettings()
  if (q.error) return <HrError error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Skeleton className="h-64" />
  return <SettingsForm s={q.data} key={q.data.updatedAt} />
}

function SettingsForm({ s }: { s: PaySettings }) {
  const toast = useToast()
  const [v, setV] = useState<PaySettingsInput>({
    payDay: s.payDay,
    cutoffDay: s.cutoffDay,
    wpsEmployerId: s.wpsEmployerId,
    wpsRoutingCode: s.wpsRoutingCode,
    mudadEstablishmentNo: s.mudadEstablishmentNo,
    deductAbsences: s.deductAbsences,
    overtimeEnabled: s.overtimeEnabled,
    overtimeMultiplier: s.overtimeMultiplier,
    gratuityBasis: s.gratuityBasis,
    socialInsurance: { ...s.socialInsurance },
  })
  const set = (p: Partial<PaySettingsInput>) => setV((x) => ({ ...x, ...p }))
  const si = v.socialInsurance!
  const setSi = (p: Partial<typeof si>) => set({ socialInsurance: { ...si, ...p } })
  const save = usePayrollMutation((input: PaySettingsInput) => payrollApi.saveSettings(input))
  const ae = s.country === 'AE'
  const num = (x: string) => (x === '' ? 0 : Number(x))
  return (
    <div className="max-w-3xl space-y-5">
      <DefaultsNote />
      {!s.defaultsConfirmed ? (
        <p className="text-[0.8125rem] text-warning-700">The social insurance rates are still the built-in defaults: review them and confirm.</p>
      ) : (
        <p className="text-xs text-muted">Confirmed by {s.defaultsConfirmedByName ?? 'HR'} on {fmtDate(s.defaultsConfirmedAt)}.</p>
      )}
      <Card>
        <CardHeader title="Pay calendar" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field id="ps-payday" label="Pay day (1–28)"><TextInput id="ps-payday" type="number" min={1} max={28} value={v.payDay} onChange={(e) => set({ payDay: num(e.target.value) })} /></Field>
          <Field id="ps-cutoff" label="Attendance cut-off day (31 = month end)" hint="Absences and overtime after this day are not counted in the month."><TextInput id="ps-cutoff" type="number" min={1} max={31} value={v.cutoffDay} onChange={(e) => set({ cutoffDay: num(e.target.value) })} /></Field>
          <div className="flex items-center gap-2 text-[0.8125rem] sm:col-span-2"><Switch id="ps-abs" checked={!!v.deductAbsences} onChange={(c) => set({ deductAbsences: c })} label="Deduct unexcused absence days" /><span>Deduct unexcused absence days (no clock-in, no approved leave, not a holiday)</span></div>
          <div className="flex items-center gap-2 text-[0.8125rem] sm:col-span-2"><Switch id="ps-ot" checked={!!v.overtimeEnabled} onChange={(c) => set({ overtimeEnabled: c })} label="Pay overtime from attendance" /><span>Pay overtime from attendance (minutes beyond the shift)</span></div>
          {v.overtimeEnabled && <Field id="ps-otm" label="Overtime multiplier"><TextInput id="ps-otm" type="number" step="0.05" min={1} max={3} value={v.overtimeMultiplier} onChange={(e) => set({ overtimeMultiplier: num(e.target.value) })} /></Field>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={ae ? 'UAE Wage Protection System (WPS)' : 'KSA Mudad'} description="Used in the bank file. Confirm the exact file specifications with your bank before go-live." />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          {ae ? (
            <>
              <Field id="ps-wps" label="Employer id (13 digits)"><TextInput id="ps-wps" inputMode="numeric" value={v.wpsEmployerId} onChange={(e) => set({ wpsEmployerId: e.target.value })} /></Field>
              <Field id="ps-routing" label="Agent / bank routing code (9 digits)"><TextInput id="ps-routing" inputMode="numeric" value={v.wpsRoutingCode} onChange={(e) => set({ wpsRoutingCode: e.target.value })} /></Field>
            </>
          ) : (
            <Field id="ps-mudad" label="Mudad establishment number"><TextInput id="ps-mudad" value={v.mudadEstablishmentNo} onChange={(e) => set({ mudadEstablishmentNo: e.target.value })} /></Field>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={ae ? 'Social insurance (GPSSA)' : 'Social insurance (GOSI)'} description={ae ? 'UAE nationals: employee 11 %, employer 12.5 % of basic + housing (defaults).' : 'Saudis: employee 9.75 %, employer 11.75 %; others: employer 2 % (occupational hazards); base capped at 45,000 SAR (defaults).'} />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field id="ps-ne" label={`Employee rate, ${ae ? 'UAE nationals' : 'Saudis'} (%)`}><TextInput id="ps-ne" type="number" step="0.01" value={si.nationalEmployeeRate} onChange={(e) => setSi({ nationalEmployeeRate: num(e.target.value) })} /></Field>
          <Field id="ps-nr" label={`Employer rate, ${ae ? 'UAE nationals' : 'Saudis'} (%)`}><TextInput id="ps-nr" type="number" step="0.01" value={si.nationalEmployerRate} onChange={(e) => setSi({ nationalEmployerRate: num(e.target.value) })} /></Field>
          <Field id="ps-ee" label="Employee rate, others (%)"><TextInput id="ps-ee" type="number" step="0.01" value={si.expatEmployeeRate} onChange={(e) => setSi({ expatEmployeeRate: num(e.target.value) })} /></Field>
          <Field id="ps-er" label="Employer rate, others (%)"><TextInput id="ps-er" type="number" step="0.01" value={si.expatEmployerRate} onChange={(e) => setSi({ expatEmployerRate: num(e.target.value) })} /></Field>
          <Field id="ps-base" label="Contributory base">
            <SelectInput id="ps-base" value={si.base} onChange={(e) => setSi({ base: e.target.value as SiBase })}>
              {(Object.keys(SI_BASE_LABEL) as SiBase[]).map((b) => <option key={b} value={b}>{SI_BASE_LABEL[b]}</option>)}
            </SelectInput>
          </Field>
          <Field id="ps-cap" label="Monthly cap of the base (empty = none)"><TextInput id="ps-cap" type="number" value={si.cap ?? ''} onChange={(e) => setSi({ cap: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          {!ae && (
            <Field id="ps-gb" label="End-of-service wage basis">
              <SelectInput id="ps-gb" value={v.gratuityBasis} onChange={(e) => set({ gratuityBasis: e.target.value as 'basic' | 'basic_housing' })}>
                <option value="basic_housing">Basic + housing</option>
                <option value="basic">Basic only</option>
              </SelectInput>
            </Field>
          )}
          <div className="sm:col-span-2">
            <Button variant="ghost" size="sm" onClick={() => set({ socialInsurance: { ...s.countryDefaults } })}>Reset to the {ae ? 'UAE' : 'KSA'} defaults</Button>
          </div>
        </CardBody>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button write loading={save.isPending && !save.variables?.defaultsConfirmed} onClick={() => save.mutate(v, { onSuccess: () => toast.success('Pay settings saved'), onError: (e) => toast.error('Not saved', e.message) })}>Save settings</Button>
        {!s.defaultsConfirmed && (
          <Button write variant="secondary" onClick={() => save.mutate({ ...v, defaultsConfirmed: true }, { onSuccess: () => toast.success('Rates confirmed'), onError: (e) => toast.error('Not saved', e.message) })}>Save and confirm the rates</Button>
        )}
      </div>
    </div>
  )
}

/* ---------------- Final settlements + gratuity calculator ---------------- */

export function SettlementsTab({ country }: { country: PayCountry }) {
  const q = useSettlements()
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<FinalSettlement | null>(null)
  if (q.error) return <HrError error={q.error} onRetry={() => q.refetch()} />
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-muted">End-of-service settlement for a leaving employee: gratuity + unpaid salary to the exit date + leave encashment − open loans ± adjustments. Paying it completes the offboarding step.</p>
        <Button write onClick={() => setCreating(true)}><Plus />New settlement</Button>
      </div>
      {q.isPending ? (
        <Skeleton className="h-32" />
      ) : !q.data?.length ? (
        <EmptyState icon={<Receipt />} title="No final settlements" body="Prepare one when an employee is on notice or has left." />
      ) : (
        <SimpleTable
          label="Final settlements"
          head={
            <tr>
              <th className={th}>Employee</th>
              <th className={th}>Exit</th>
              <th className={th}>Reason</th>
              <th className={th}>Status</th>
              <th className={thEnd}>Total</th>
            </tr>
          }
        >
          {q.data.map((f) => (
            <tr key={f.id} className="cursor-pointer hover:bg-hover" onClick={() => setOpen(f)}>
              <td className={td}><span className="block font-medium text-ink">{f.employeeName}</span><span className="num text-xs text-muted">{f.id}</span></td>
              <td className={td}><span className="num">{fmtDate(f.exitDate)}</span></td>
              <td className={td}>{EXIT_REASON_LABEL[f.reason]}</td>
              <td className={td}><Badge tone={f.status === 'paid' ? 'green' : 'amber'}>{f.status === 'paid' ? 'Paid' : 'Draft'}</Badge></td>
              <td className={tdEnd}><Amount value={f.total} currency={f.currency} strong /></td>
            </tr>
          ))}
        </SimpleTable>
      )}
      <GratuityCalculator country={country} />
      {creating && <NewSettlement onClose={() => setCreating(false)} onCreated={(f) => setOpen(f)} />}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `Final settlement · ${open.employeeName}` : 'Final settlement'} description={open ? `${open.id} · exit ${fmtDate(open.exitDate)}` : undefined}>
        {open && <SettlementBody f={(q.data ?? []).find((x) => x.id === open.id) ?? open} onClose={() => setOpen(null)} />}
      </Drawer>
    </div>
  )
}

function NewSettlement({ onClose, onCreated }: { onClose: () => void; onCreated: (f: FinalSettlement) => void }) {
  const emps = useEmployeesQuery()
  const leaving = (emps.data ?? []).filter((e) => e.status === 'notice' || e.status === 'terminated')
  const [employeeId, setEmployeeId] = useState('')
  const [reason, setReason] = useState<ExitReason>('resignation')
  const [exitDate, setExitDate] = useState('')
  const toast = useToast()
  const preview = usePayrollMutation(() => payrollApi.previewSettlement({ employeeId, reason, exitDate: exitDate || undefined }))
  const create = usePayrollMutation(() => payrollApi.createSettlement({ employeeId, reason, exitDate: exitDate || undefined }))
  return (
    <Drawer
      open
      onClose={onClose}
      title="New final settlement"
      description="Only employees on notice or who have left (Employees › status) can be settled."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" disabled={!employeeId} loading={preview.isPending} onClick={() => preview.mutate(undefined, { onError: (e) => toast.error('No preview', e.message) })}>Preview</Button>
          <Button write disabled={!employeeId} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: (f) => { toast.success('Settlement prepared'); onClose(); onCreated(f) }, onError: (e) => toast.error('Not saved', e.message) })}>Save draft</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field id="fs-emp" label="Employee">
          <SelectInput id="fs-emp" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setExitDate(leaving.find((x) => x.id === e.target.value)?.exitDate ?? '') }}>
            <option value="">Pick a leaving employee…</option>
            {leaving.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.employeeNo}) · exit {e.exitDate ?? '—'}</option>)}
          </SelectInput>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="fs-reason" label="Reason">
            <SelectInput id="fs-reason" value={reason} onChange={(e) => setReason(e.target.value as ExitReason)}>
              {EXIT_REASONS.map((r) => <option key={r} value={r}>{EXIT_REASON_LABEL[r]}</option>)}
            </SelectInput>
          </Field>
          <Field id="fs-exit" label="Exit date (last working day)"><TextInput id="fs-exit" type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} /></Field>
        </div>
        {preview.data && <Breakdown f={preview.data} />}
      </div>
    </Drawer>
  )
}

function SettlementBody({ f, onClose }: { f: FinalSettlement; onClose: () => void }) {
  const toast = useToast()
  const pay = usePayrollMutation(() => payrollApi.paySettlement(f.id))
  const del = usePayrollMutation(() => payrollApi.deleteSettlement(f.id))
  const [reason, setReason] = useState<ExitReason>(f.reason)
  const update = usePayrollMutation((r: ExitReason) => payrollApi.updateSettlement(f.id, { reason: r }))
  return (
    <div className="space-y-4">
      {f.status === 'draft' && (
        <div className="flex flex-wrap items-end gap-2">
          <Field id="fsb-reason" label="Reason">
            <SelectInput id="fsb-reason" value={reason} onChange={(e) => { const r = e.target.value as ExitReason; setReason(r); update.mutate(r, { onError: (x) => toast.error('Not saved', x.message) }) }}>
              {EXIT_REASONS.map((r) => <option key={r} value={r}>{EXIT_REASON_LABEL[r]}</option>)}
            </SelectInput>
          </Field>
          <Button write loading={pay.isPending} onClick={() => pay.mutate(undefined, { onSuccess: () => toast.success('Settlement paid', 'The offboarding step is done.'), onError: (e) => toast.error('Not paid', e.message) })}>Mark paid</Button>
          <Button write variant="ghost" loading={del.isPending} onClick={() => del.mutate(undefined, { onSuccess: () => { toast.success('Deleted'); onClose() }, onError: (e) => toast.error('Not deleted', e.message) })}>Delete draft</Button>
        </div>
      )}
      {f.status === 'paid' && <p className="text-[0.8125rem] text-muted">Paid {fmtDate(f.paidAt)} by {f.paidByName ?? 'HR'}. Locked.</p>}
      <Breakdown f={update.data && update.data.id === f.id ? update.data : f} />
    </div>
  )
}

function Breakdown({ f }: { f: FinalSettlement }) {
  const rows: [string, number, string?][] = [
    [`End-of-service gratuity (${f.gratuity.years} years)`, f.gratuity.amount],
    [`Unpaid salary (${f.unpaidSalaryDays} days${f.unpaidSalaryFrom ? ` from ${fmtDate(f.unpaidSalaryFrom)}` : ''})`, f.unpaidSalary],
    [`Annual leave encashment (${f.leaveDays} days)`, f.leaveEncashment],
    ['Outstanding loans / advances', -f.loanBalance],
    ...f.adjustments.map((a) => [a.label, a.amount] as [string, number]),
  ]
  return (
    <div className="space-y-3">
      <SimpleTable label="Settlement breakdown" head={<tr><th className={th}>Item</th><th className={thEnd}>Amount</th></tr>}>
        {rows.map(([k, v]) => (
          <tr key={k}><td className={td}>{k}</td><td className={tdEnd}><Amount value={v} /></td></tr>
        ))}
        <tr><td className={`${td} font-semibold`}>Total</td><td className={tdEnd}><Amount value={f.total} currency={f.currency} strong /></td></tr>
      </SimpleTable>
      <GratuityExplanation g={f.gratuity} />
    </div>
  )
}

function GratuityExplanation({ g }: { g: GratuityResult }) {
  return (
    <ul className="list-disc space-y-0.5 ps-5 text-xs text-muted">
      {g.explanation.map((x) => <li key={x}>{x}</li>)}
    </ul>
  )
}

/** A what-if calculator (pure client calc: the same function the API uses). */
function GratuityCalculator({ country: initial }: { country: PayCountry }) {
  const [country, setCountry] = useState<PayCountry>(initial)
  const [basic, setBasic] = useState(10000)
  const [housing, setHousing] = useState(2500)
  const [start, setStart] = useState('2019-01-01')
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState<ExitReason>('resignation')
  const [unpaid, setUnpaid] = useState(0)
  const g = useMemo(() => (start && end && end >= start ? gratuity({ country, reason, basic, housing, startDate: start, endDate: end, unpaidLeaveDays: unpaid }) : null), [country, reason, basic, housing, start, end, unpaid])
  return (
    <Card>
      <CardHeader icon={<Calculator />} title="Gratuity calculator" description="What-if end-of-service award (UAE Decree-Law 33/2021 · KSA Labor Law art. 84–85)." />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="gc-country" label="Country">
            <SelectInput id="gc-country" value={country} onChange={(e) => setCountry(e.target.value as PayCountry)}>
              <option value="AE">UAE</option>
              <option value="SA">Saudi Arabia</option>
            </SelectInput>
          </Field>
          <Field id="gc-basic" label="Monthly basic"><TextInput id="gc-basic" type="number" value={basic} onChange={(e) => setBasic(Number(e.target.value) || 0)} /></Field>
          <Field id="gc-housing" label="Monthly housing (KSA basis)"><TextInput id="gc-housing" type="number" value={housing} onChange={(e) => setHousing(Number(e.target.value) || 0)} /></Field>
          <Field id="gc-start" label="Service start"><TextInput id="gc-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field id="gc-end" label="Last working day"><TextInput id="gc-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field id="gc-reason" label="Reason">
            <SelectInput id="gc-reason" value={reason} onChange={(e) => setReason(e.target.value as ExitReason)}>
              {EXIT_REASONS.map((r) => <option key={r} value={r}>{EXIT_REASON_LABEL[r]}</option>)}
            </SelectInput>
          </Field>
          {country === 'AE' && <Field id="gc-unpaid" label="Unpaid leave days"><TextInput id="gc-unpaid" type="number" value={unpaid} onChange={(e) => setUnpaid(Number(e.target.value) || 0)} /></Field>}
        </div>
        {g && (
          <div className="rounded-lg border border-line px-4 py-3">
            <p className="text-xs text-muted">Gratuity</p>
            <p className="num text-xl font-semibold text-ink" aria-live="polite">{country === 'AE' ? 'AED' : 'SAR'} {fmt2(g.amount)}</p>
            <GratuityExplanation g={g} />
          </div>
        )}
        <DefaultsNote>A calculator for planning: the rules are simplified defaults that HR must confirm. Not legal advice.</DefaultsNote>
      </CardBody>
    </Card>
  )
}
