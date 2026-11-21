import { Fragment, useState } from 'react'
import { AlertTriangle, Banknote, CheckCircle2, Download, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import type { PayLine, PayrollRunDetail } from '@/modules/hr/payroll/types'
import { WARNING_LABEL } from '@/modules/hr/payroll/types'
import { addMonths, monthLabel } from '@/modules/hr/payroll/calc'
import { payrollApi, usePaySettings, usePayrollMutation, useRun, useRuns } from '@/modules/hr/payroll/api'
import { Amount, RunStatusBadge, SimpleTable, downloadText, fmt2, td, tdEnd, th, thEnd } from './bits'
import { HrError } from '@/modules/hr/components/PeopleBits'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Modal } from '@/shared/components/ui/Modal'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

/** Salary › Runs: the monthly runs and the run drawer (calculate → approve (another HR user) → paid). */
export function RunsTab({ openRun, onOpenRun }: { openRun: string | null; onOpenRun: (id: string | null) => void }) {
  const runs = useRuns()
  const [creating, setCreating] = useState(false)
  if (runs.error) return <HrError error={runs.error} onRetry={() => runs.refetch()} />
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-muted">One run per month: calculate, have another HR user approve it, then mark it paid. A paid run is locked; corrections go into the next month as adjustments.</p>
        <Button write onClick={() => setCreating(true)}>
          <Plus />
          New run
        </Button>
      </div>
      {runs.isPending ? (
        <Skeleton className="h-40" />
      ) : !runs.data?.length ? (
        <EmptyState icon={<Banknote />} title="No payroll runs yet" body="Start with the current month." />
      ) : (
        <SimpleTable
          label="Payroll runs"
          head={
            <tr>
              <th className={th}>Month</th>
              <th className={th}>Status</th>
              <th className={thEnd}>Employees</th>
              <th className={thEnd}>Gross</th>
              <th className={thEnd}>Net</th>
              <th className={thEnd}>Employer cost</th>
              <th className={th}>Pay date</th>
              <th className={th}>Approved by</th>
            </tr>
          }
        >
          {runs.data.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-hover" onClick={() => onOpenRun(r.id)}>
              <td className={td}>
                <button type="button" className="font-medium text-ink hover:underline" onClick={() => onOpenRun(r.id)}>
                  {monthLabel(r.month)}
                </button>
                <span className="num block text-xs text-muted">{r.id}</span>
              </td>
              <td className={td}>
                <span className="flex flex-wrap items-center gap-1">
                  <RunStatusBadge status={r.status} />
                  {r.openWarnings > 0 && r.status === 'calculated' && <Badge tone="amber">{r.openWarnings} warnings</Badge>}
                </span>
              </td>
              <td className={tdEnd}><span className="num">{r.status === 'draft' && !r.totals.headcount ? '—' : r.totals.headcount}</span></td>
              <td className={tdEnd}><Amount value={r.totals.gross} /></td>
              <td className={tdEnd}><Amount value={r.totals.net} strong /></td>
              <td className={tdEnd}><Amount value={r.totals.employerCost} /></td>
              <td className={td}><span className="num">{fmtDate(r.payDate)}</span></td>
              <td className={td}>{r.approvedByName ?? <span className="text-muted">—</span>}</td>
            </tr>
          ))}
        </SimpleTable>
      )}
      <NewRunModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => onOpenRun(id)} />
      <RunDrawer id={openRun} onClose={() => onOpenRun(null)} />
    </div>
  )
}

function NewRunModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const now = new Date().toISOString().slice(0, 7)
  const [month, setMonth] = useState(addMonths(now, 0))
  const toast = useToast()
  const create = usePayrollMutation((m: string) => payrollApi.createRun(m))
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New payroll run"
      description="Lines are calculated from the active contracts, leave, attendance, adjustments and loans."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            loading={create.isPending}
            onClick={() =>
              create.mutate(month, {
                onSuccess: (r) => {
                  toast.success('Run created', monthLabel(r.month))
                  onClose()
                  onCreated(r.id)
                },
                onError: (e) => toast.error('Not created', e.message),
              })
            }
          >
            Create run
          </Button>
        </>
      }
    >
      <Field id="run-month" label="Month">
        <TextInput id="run-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </Field>
    </Modal>
  )
}

function RunDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useRun(id)
  const r = q.data
  return (
    <Drawer open={!!id} onClose={onClose} width="xl" title={r ? `Payroll ${monthLabel(r.month)}` : 'Payroll run'} description={r ? `${r.id} · ${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)} · pay date ${fmtDate(r.payDate)}` : undefined}>
      {q.error ? <HrError error={q.error} onRetry={() => q.refetch()} /> : !r ? <Skeleton className="h-64" /> : <RunBody r={r} onDeleted={onClose} />}
    </Drawer>
  )
}

function RunBody({ r, onDeleted }: { r: PayrollRunDetail; onDeleted: () => void }) {
  const toast = useToast()
  const settings = usePaySettings()
  const action = usePayrollMutation(({ a }: { a: 'calculate' | 'approve' | 'reopen' | 'pay' }) => payrollApi.runAction(r.id, a))
  const ack = usePayrollMutation((body: { all?: boolean; warnings?: { employeeId: string; code: string }[] }) => payrollApi.acknowledge(r.id, body))
  const del = usePayrollMutation(() => payrollApi.deleteRun(r.id))
  const file = usePayrollMutation((format: 'wps' | 'mudad') => payrollApi.bankFile(r.id, format))
  const [open, setOpen] = useState<string | null>(null)
  const run = (a: 'calculate' | 'approve' | 'reopen' | 'pay', done: string) =>
    action.mutate({ a }, { onSuccess: () => toast.success(done, monthLabel(r.month)), onError: (e) => toast.error('Not done', e.message) })
  const format: 'wps' | 'mudad' = settings.data?.country === 'SA' || r.currency === 'SAR' ? 'mudad' : 'wps'
  const openWarnings = r.lines.flatMap((l) => l.warnings.filter((w) => !w.acknowledged).map((w) => ({ l, w })))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusBadge status={r.status} />
        {r.calculatedByName && <span className="text-xs text-muted">Calculated by {r.calculatedByName} · {fmtDate(r.calculatedAt)}</span>}
        {r.approvedByName && <span className="text-xs text-muted">· Approved by {r.approvedByName}</span>}
        {r.paidByName && <span className="text-xs text-muted">· Paid {fmtDate(r.paidAt)}</span>}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Employees', String(r.totals.headcount)],
          ['Gross', fmt2(r.totals.gross)],
          ['Deductions', fmt2(r.totals.deductions)],
          ['Net pay', fmt2(r.totals.net)],
          ['Employer cost', fmt2(r.totals.employerCost)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line px-3 py-2">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="num mt-0.5 font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-2">
        {r.canCalculate && (
          <Button write loading={action.isPending && action.variables?.a === 'calculate'} onClick={() => run('calculate', r.status === 'draft' ? 'Calculated' : 'Recalculated')}>
            <RefreshCw />
            {r.status === 'draft' && !r.lines.length ? 'Calculate' : 'Recalculate'}
          </Button>
        )}
        {r.status === 'calculated' && openWarnings.length > 0 && (
          <Button write variant="secondary" loading={ack.isPending} onClick={() => ack.mutate({ all: true }, { onSuccess: () => toast.success('Warnings acknowledged'), onError: (e) => toast.error('Not done', e.message) })}>
            Acknowledge all warnings
          </Button>
        )}
        {r.status === 'calculated' && (
          <Button write disabled={!r.canApprove} title={r.approveBlockedReason ?? undefined} loading={action.isPending && action.variables?.a === 'approve'} onClick={() => run('approve', 'Approved')}>
            <CheckCircle2 />
            Approve
          </Button>
        )}
        {r.status === 'approved' && (
          <Button write disabled={!r.canPay} loading={action.isPending && action.variables?.a === 'pay'} onClick={() => run('pay', 'Marked paid')}>
            <Banknote />
            Mark paid
          </Button>
        )}
        {r.canExport && (
          <Button
            variant="secondary"
            loading={file.isPending}
            onClick={() =>
              file.mutate(format, {
                onSuccess: (f) => {
                  downloadText(f.fileName, f.content, f.mimeType)
                  toast.success(`${format === 'wps' ? 'WPS SIF' : 'Mudad'} file downloaded`, `${f.count} employees${f.skipped.length ? ` · ${f.skipped.length} left out` : ''}`)
                },
                onError: (e) => toast.error('No file', e.message),
              })
            }
          >
            <Download />
            {format === 'wps' ? 'Download WPS file' : 'Download Mudad file'}
          </Button>
        )}
        {r.canReopen && (
          <Button write variant="ghost" onClick={() => run('reopen', 'Back to draft')}>
            <RotateCcw />
            Reopen
          </Button>
        )}
        {(r.status === 'draft' || r.status === 'calculated') && (
          <Button write variant="ghost" loading={del.isPending} onClick={() => del.mutate(undefined, { onSuccess: () => { toast.success('Run deleted'); onDeleted() }, onError: (e) => toast.error('Not deleted', e.message) })}>
            <Trash2 />
            Delete
          </Button>
        )}
      </div>
      {r.status === 'calculated' && r.approveBlockedReason && <p className="text-xs text-muted">{r.approveBlockedReason}</p>}
      {r.status === 'paid' && <p className="text-xs text-muted">This run is paid and locked. A correction goes into a later month as an adjustment.</p>}

      {openWarnings.length > 0 && r.status === 'calculated' && (
        <section aria-label="Warnings" className="rounded-xl border border-warning-500/30 bg-warning-500/10 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-[0.8125rem] font-semibold text-ink"><AlertTriangle className="size-4 text-warning-700" aria-hidden />Resolve (fix and recalculate) or acknowledge before approval</h3>
          <ul className="space-y-1.5">
            {openWarnings.map(({ l, w }) => (
              <li key={`${l.employeeId}:${w.code}`} className="flex items-center gap-2 text-[0.8125rem]">
                <Badge tone="amber">{WARNING_LABEL[w.code]}</Badge>
                <span className="min-w-0 flex-1 text-ink-2">{w.message}</span>
                <Button write size="xs" variant="ghost" onClick={() => ack.mutate({ warnings: [{ employeeId: l.employeeId, code: w.code }] }, { onError: (e) => toast.error('Not done', e.message) })}>
                  Acknowledge
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!r.lines.length ? (
        <EmptyState icon={<Banknote />} title="Not calculated yet" body="Calculate to build one line per employee." />
      ) : (
        <SimpleTable
          label="Payroll lines"
          head={
            <tr>
              <th className={th}>Employee</th>
              <th className={thEnd}>Days</th>
              <th className={thEnd}>Gross</th>
              <th className={thEnd}>Deductions</th>
              <th className={thEnd}>Net</th>
              <th className={thEnd}>Employer cost</th>
            </tr>
          }
        >
          {r.lines.map((l) => (
            <Fragment key={l.id}>
              <tr className="cursor-pointer hover:bg-hover" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
                <td className={td}>
                  <span className="block font-medium text-ink">{l.employeeName}</span>
                  <span className="num block text-xs text-muted">{l.employeeNo} · {l.departmentName ?? 'No department'}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {l.warnings.map((w) => (
                      <Badge key={w.code} tone={w.acknowledged ? 'neutral' : 'amber'}>{WARNING_LABEL[w.code]}{w.acknowledged ? ' ✓' : ''}</Badge>
                    ))}
                    {l.unpaidLeaveDays > 0 && <Badge tone="sky">Unpaid leave {l.unpaidLeaveDays}d</Badge>}
                    {l.absenceDays > 0 && <Badge tone="red">Absent {l.absenceDays}d</Badge>}
                  </span>
                </td>
                <td className={tdEnd}><span className="num">{l.paidDays}/{l.daysInMonth}</span></td>
                <td className={tdEnd}><Amount value={l.gross} /></td>
                <td className={tdEnd}><Amount value={l.totalDeductions} /></td>
                <td className={tdEnd}><Amount value={l.net} strong /></td>
                <td className={tdEnd}><Amount value={l.employerCost} /></td>
              </tr>
              {open === l.id && (
                <tr>
                  <td colSpan={6} className="bg-sunken/40 px-3 py-2">
                    <LineItems l={l} currency={r.currency} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </SimpleTable>
      )}

      {r.exports.length > 0 && (
        <p className="text-xs text-muted">
          Bank files: {r.exports.map((x) => `${x.format.toUpperCase()} by ${x.byName} (${fmtDate(x.at)}, ${x.count})`).join(' · ')}
        </p>
      )}
    </div>
  )
}

export function LineItems({ l, currency }: { l: Pick<PayLine, 'items' | 'payMethod' | 'bankName' | 'ibanMasked' | 'payStart' | 'payEnd'>; currency: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(['earning', 'deduction', 'employer'] as const).map((t) => {
        const items = l.items.filter((i) => i.type === t)
        if (!items.length) return null
        return (
          <div key={t}>
            <p className="mb-1 text-xs font-medium text-muted">{t === 'earning' ? 'Earnings' : t === 'deduction' ? 'Deductions' : 'Employer contributions'}</p>
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.code} className="flex justify-between gap-3 text-xs">
                  <span className="text-ink-2">{i.label}{i.note ? <span className="text-muted"> · {i.note}</span> : null}</span>
                  <Amount value={i.amount} currency={currency} />
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      <p className="text-xs text-muted sm:col-span-2">
        {l.payStart ? `Paid ${fmtDate(l.payStart)} – ${fmtDate(l.payEnd)}` : 'Not paid this month'} · {l.payMethod === 'bank' ? `${l.bankName || 'Bank'} ${l.ibanMasked || '(no IBAN)'}` : l.payMethod}
      </p>
    </div>
  )
}
