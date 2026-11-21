import { useState } from 'react'
import { Download, HandCoins } from 'lucide-react'
import type { ClaimStatus, ClaimView, ReimbursementMethod } from '@/modules/finance/expenses/types'
import { CLAIM_STATUSES, CLAIM_STATUS_LABEL } from '@/modules/finance/expenses/types'
import { expensesApi, useClaim, useClaims, useClaimsMeta, useExpensesMutation } from '@/modules/finance/expenses/api'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { Segmented } from '@/shared/components/ui/Segmented'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { fmtDate } from '@/shared/lib/utils'
import { Amount, ClaimStatusBadge, DetailRow, FinError, FormError, History, ReasonModal, ReceiptLink, SimpleTable, Steps, Warnings, downloadText, td, tdEnd, th, thEnd, toCsv } from './bits'

export function ClaimsTab({ onOpen, canSeeAll }: { onOpen: (id: string) => void; canSeeAll: boolean }) {
  const [view, setView] = useState<ClaimView>('mine')
  const [status, setStatus] = useState<ClaimStatus | ''>('')
  const list = useClaims({ view, status })
  const views: { value: ClaimView; label: string }[] = [
    { value: 'mine', label: 'My claims' },
    { value: 'approvals', label: 'To approve' },
    { value: 'all', label: canSeeAll ? 'All claims' : 'My team' },
  ]
  const rows = list.data ?? []
  const exportCsv = () =>
    downloadText(`expense-claims-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([['Number', 'Employee', 'Title', 'Submitted', 'Total', 'VAT', 'Status'], ...rows.map((c) => [c.number, c.employeeName, c.title, c.submittedAt?.slice(0, 10) ?? '', c.total, c.vatTotal, CLAIM_STATUS_LABEL[c.status]])]))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Segmented label="Claims to show" options={views} value={view} onChange={setView} />
        <SelectInput aria-label="Claim status" value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus | '')} className="w-52">
          <option value="">Any status</option>
          {CLAIM_STATUSES.map((s) => <option key={s} value={s}>{CLAIM_STATUS_LABEL[s]}</option>)}
        </SelectInput>
        {canSeeAll && <Button variant="secondary" className="ms-auto" onClick={exportCsv} disabled={!rows.length}><Download /> Export CSV</Button>}
      </div>
      {list.error ? (
        <FinError error={list.error} onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        <Skeleton className="h-64" />
      ) : !rows.length ? (
        <EmptyState icon={<HandCoins />} title={view === 'approvals' ? 'Nothing to approve' : 'No claims'} body={view === 'mine' ? 'Spent your own money for the company? Claim it back with “New claim”.' : 'Claims appear here when they need you.'} />
      ) : (
        <SimpleTable
          label="Expense claims"
          head={
            <tr>
              <th className={th}>Number</th>
              <th className={th}>Employee</th>
              <th className={th}>Title</th>
              <th className={th}>Submitted</th>
              <th className={thEnd}>Total</th>
              <th className={th}>Status</th>
            </tr>
          }
        >
          {rows.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-hover" onClick={() => onOpen(c.id)}>
              <td className={td}><button type="button" className="num font-medium text-brand-600 hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(c.id) }}>{c.number}</button></td>
              <td className={td}>{c.employeeName}</td>
              <td className={td}>{c.title}</td>
              <td className={td}><span className="num">{c.submittedAt ? fmtDate(c.submittedAt) : '—'}</span></td>
              <td className={tdEnd}><Amount value={c.total} currency={c.currency} /></td>
              <td className={td}><ClaimStatusBadge status={c.status} /></td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  )
}

export function ClaimDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useClaim(id)
  const meta = useClaimsMeta(!!id)
  const act = useExpensesMutation(expensesApi.claimAction)
  const reimburse = useExpensesMutation(expensesApi.reimburse)
  const remove = useExpensesMutation(expensesApi.deleteClaim)
  const toast = useToast()
  const [rejecting, setRejecting] = useState(false)
  const [paying, setPaying] = useState(false)
  const [method, setMethod] = useState<ReimbursementMethod>('payroll')
  const [account, setAccount] = useState('')
  const c = q.data
  const run = (action: 'submit' | 'approve' | 'reject', reason?: string) =>
    act.mutate({ id: id!, action, reason }, { onSuccess: (x) => { setRejecting(false); toast.success(`Claim ${x.number}: ${CLAIM_STATUS_LABEL[x.status].toLowerCase()}`) } })
  const accounts = meta.data?.paymentAccounts ?? []
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={c ? `Expense claim ${c.number}` : 'Expense claim'}
      description={c ? `${c.employeeName} · ${c.title}` : undefined}
      width="xl"
      footer={
        c && (c.can.submit || c.can.approve || c.can.reimburse || c.can.delete) ? (
          <>
            {c.can.delete && <Button variant="secondary" write loading={remove.isPending} onClick={() => remove.mutate(c.id, { onSuccess: () => { toast.success('Draft deleted'); onClose() } })}>Delete draft</Button>}
            {c.can.submit && <Button write loading={act.isPending} onClick={() => run('submit')}>Submit for approval</Button>}
            {c.can.reject && <Button variant="secondary" write onClick={() => setRejecting(true)}>Reject</Button>}
            {c.can.approve && <Button write loading={act.isPending && !rejecting} onClick={() => run('approve')}>Approve</Button>}
            {c.can.reimburse && <Button write onClick={() => { setPaying(true); setAccount(accounts.find((a) => a.code === '1120')?.id ?? accounts[0]?.id ?? '') }}>Reimburse…</Button>}
          </>
        ) : undefined
      }
    >
      {q.error ? (
        <FinError error={q.error} onRetry={() => q.refetch()} />
      ) : !c ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2"><ClaimStatusBadge status={c.status} />{c.status === 'pending' && c.waitingOn.length ? <span className="text-xs text-muted">Waiting on {c.waitingOn.join(', ')}</span> : null}</div>
          <Warnings items={c.warnings} />
          <SimpleTable
            label="Claim lines"
            head={<tr><th className={th}>Date</th><th className={th}>Category</th><th className={th}>Purpose</th><th className={thEnd}>Amount</th><th className={th}>Receipt</th></tr>}
            foot={<tr><td className={td} colSpan={3}>Total ({c.currency}){c.vatTotal ? ` · VAT recovered ${c.vatTotal.toFixed(2)}` : ''}</td><td className={tdEnd}><Amount value={c.total} /></td><td /></tr>}
          >
            {c.lines.map((l) => (
              <tr key={l.id}>
                <td className={td}><span className="num">{fmtDate(l.date)}</span></td>
                <td className={td}>{l.categoryName}</td>
                <td className={td}>{l.description}{l.merchant ? <span className="block text-xs text-muted">{l.merchant}{l.projectName ? ` · ${l.projectName}` : ''}{l.customerName ? ` · ${l.customerName}` : ''}{l.eventName ? ` · ${l.eventName}` : ''}</span> : null}</td>
                <td className={tdEnd}><Amount value={l.amount} currency={l.currency} />{l.currency !== c.currency ? <span className="block text-xs text-muted"><Amount value={l.baseAmount} currency={c.currency} /></span> : null}</td>
                <td className={td}>{l.receipt ? <ReceiptLink file={l.receipt} /> : <span className="text-xs text-muted">None</span>}</td>
              </tr>
            ))}
          </SimpleTable>
          <dl>
            {c.journal && <DetailRow label="Posted">{c.journal.number} (Dr expenses / Cr 2450 Employee reimbursements payable)</DetailRow>}
            {c.reimbursement && (
              <DetailRow label="Reimbursement">
                {c.reimbursement.method === 'payroll' ? `Payroll of ${c.reimbursement.payrollMonth}${c.reimbursement.reimbursedAt ? ' · paid' : ''}` : `Paid from ${c.reimbursement.accountName} on ${fmtDate(c.reimbursement.date ?? '')}`}
              </DetailRow>
            )}
            {c.rejectReason && <DetailRow label="Rejected">{c.rejectReason}</DetailRow>}
          </dl>
          <section><h3 className="mb-2 text-xs font-semibold uppercase text-muted">Approvals</h3><Steps steps={c.steps} /></section>
          <section><h3 className="mb-2 text-xs font-semibold uppercase text-muted">History</h3><History items={c.history} /></section>
          <FormError error={!rejecting ? (act.error ?? remove.error) : null} />
        </div>
      )}
      <ReasonModal open={rejecting} title="Reject claim" label="Reason" confirm="Reject" onClose={() => setRejecting(false)} onConfirm={(r) => run('reject', r)} pending={act.isPending} error={act.error} />
      <Modal
        open={paying}
        onClose={() => setPaying(false)}
        title="Reimburse claim"
        description={c ? `${c.employeeName} · ${c.currency} ${c.total.toFixed(2)}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPaying(false)}>Cancel</Button>
            <Button
              write
              loading={reimburse.isPending}
              onClick={() =>
                reimburse.mutate(
                  { id: id!, input: method === 'payment' ? { method, accountId: account } : { method } },
                  { onSuccess: (x) => { setPaying(false); toast.success(x.status === 'in_payroll' ? `Added to the payroll of ${x.reimbursement?.payrollMonth}` : `Claim ${x.number} reimbursed`) } },
                )
              }
            >
              {method === 'payroll' ? 'Add to payroll' : 'Record payment'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Segmented label="How" options={[{ value: 'payroll', label: 'Next payroll run' }, { value: 'payment', label: 'Pay now' }]} value={method} onChange={(x) => setMethod(x as ReimbursementMethod)} />
          {method === 'payroll' ? (
            <p className="text-sm text-muted">A non-taxable reimbursement is added to the payroll of {meta.data?.nextPayrollMonth}; the claim is marked reimbursed when that run is paid.</p>
          ) : (
            <>
              <Field id="reimb-account" label="Paid from"><SelectInput id="reimb-account" value={account} onChange={(e) => setAccount(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</SelectInput></Field>
              <Field id="reimb-date" label="Date"><TextInput id="reimb-date" type="date" disabled value={new Date().toISOString().slice(0, 10)} /></Field>
            </>
          )}
          <FormError error={reimburse.error} />
        </div>
      </Modal>
    </Drawer>
  )
}
