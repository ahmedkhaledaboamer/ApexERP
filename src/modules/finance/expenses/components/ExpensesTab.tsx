import { useEffect, useMemo, useState } from 'react'
import { Download, Receipt } from 'lucide-react'
import type { Expense, ExpenseInput, ExpensePaymentMethod, ReceiptFile } from '@/modules/finance/expenses/types'
import { EXPENSE_PAYMENT_METHODS, EXPENSE_PAYMENT_METHOD_LABEL, EXPENSE_STATUSES, EXPENSE_STATUS_LABEL } from '@/modules/finance/expenses/types'
import { isValidTaxNumber, vatSplit } from '@/modules/finance/expenses/calc'
import { expensesApi, useExpense, useExpenses, useExpensesMeta, useExpensesMutation } from '@/modules/finance/expenses/api'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SearchInput, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { fmtDate } from '@/shared/lib/utils'
import {
  Amount,
  DetailRow,
  ExpenseStatusBadge,
  FinError,
  FormError,
  History,
  ReasonModal,
  ReceiptInput,
  ReceiptLink,
  SimpleTable,
  Steps,
  downloadText,
  fmt2,
  td,
  tdEnd,
  th,
  thEnd,
  toCsv,
} from './bits'

const today = () => new Date().toISOString().slice(0, 10)

export function ExpensesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const list = useExpenses({ q: q || undefined, status: status || undefined })
  if (list.error) return <FinError error={list.error} onRetry={() => list.refetch()} />
  const rows = list.data ?? []
  const exportCsv = () => {
    const head = ['Number', 'Date', 'Payee', 'Category', 'Description', 'Currency', 'Amount', 'VAT', 'Net', 'Rate', 'Amount (base)', 'Paid by', 'Paid from', 'Status']
    downloadText(`expenses-${today()}.csv`, toCsv([head, ...rows.map((e) => [e.number, e.date, e.payeeName, e.categoryName, e.description, e.currency, e.amount, e.vatAmount, e.netAmount, e.exchangeRate, e.baseAmount, EXPENSE_PAYMENT_METHOD_LABEL[e.paymentMethod], e.paidFromAccountName, EXPENSE_STATUS_LABEL[e.status]])]))
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter expenses">
        <SearchInput aria-label="Search expenses" placeholder="Number, payee, description…" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
        <SelectInput aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">Any status</option>
          {EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{EXPENSE_STATUS_LABEL[s]}</option>)}
        </SelectInput>
        <Button variant="secondary" className="ms-auto" onClick={exportCsv} disabled={!rows.length}><Download /> Export CSV</Button>
      </div>
      {list.isPending ? (
        <Skeleton className="h-64" />
      ) : !rows.length ? (
        <EmptyState icon={<Receipt />} title="No expenses" body="Company spend paid by card, bank transfer, cash or petty cash appears here." />
      ) : (
        <SimpleTable
          label="Expenses"
          head={
            <tr>
              <th className={th}>Number</th>
              <th className={th}>Date</th>
              <th className={th}>Payee</th>
              <th className={th}>Category</th>
              <th className={th}>Paid by</th>
              <th className={thEnd}>Amount</th>
              <th className={thEnd}>VAT</th>
              <th className={th}>Status</th>
            </tr>
          }
        >
          {rows.map((e) => (
            <tr key={e.id} className="cursor-pointer hover:bg-hover" onClick={() => onOpen(e.id)}>
              <td className={td}><button type="button" className="num font-medium text-brand-600 hover:underline" onClick={(ev) => { ev.stopPropagation(); onOpen(e.id) }}>{e.number}</button></td>
              <td className={td}><span className="num">{fmtDate(e.date)}</span></td>
              <td className={td}>{e.payeeName}{e.duplicateOf.length ? <span className="ms-1 text-xs text-warning-700">· possible duplicate</span> : null}</td>
              <td className={td}>{e.categoryName}</td>
              <td className={td}>{EXPENSE_PAYMENT_METHOD_LABEL[e.paymentMethod]}</td>
              <td className={tdEnd}><Amount value={e.amount} currency={e.currency} /></td>
              <td className={tdEnd}><Amount value={e.vatAmount} /></td>
              <td className={td}><ExpenseStatusBadge status={e.status} /></td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  )
}

/* ---------------- record expense ---------------- */

interface FormState {
  date: string
  vendorId: string
  payeeName: string
  payeeVatNumber: string
  categoryId: string
  description: string
  amount: string
  currency: string
  exchangeRate: string
  taxCodeId: string
  paymentMethod: ExpensePaymentMethod
  paidFromAccountId: string
  pettyFundId: string
  reference: string
  departmentId: string
  projectId: string
  eventId: string
  campaignId: string
  receipt: ReceiptFile | null
  notes: string
}

export function RecordExpenseDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (e: Expense) => void }) {
  const meta = useExpensesMeta(open)
  const toast = useToast()
  const save = useExpensesMutation(expensesApi.createExpense)
  const [v, setV] = useState<FormState | null>(null)
  const [dupes, setDupes] = useState<{ number: string }[]>([])
  useEffect(() => {
    if (!open || !meta.data || v) return
    const d = meta.data
    setV({ date: today(), vendorId: '', payeeName: '', payeeVatNumber: '', categoryId: d.categories[0]?.id ?? '', description: '', amount: '', currency: d.baseCurrency, exchangeRate: '', taxCodeId: d.standardTaxCodeId, paymentMethod: 'card', paidFromAccountId: d.paymentAccounts.find((a) => a.code === '1120')?.id ?? d.paymentAccounts[0]?.id ?? '', pettyFundId: d.pettyFunds[0]?.id ?? '', reference: '', departmentId: '', projectId: '', eventId: '', campaignId: '', receipt: null, notes: '' })
  }, [open, meta.data, v])
  const close = () => {
    setV(null)
    setDupes([])
    save.reset()
    onClose()
  }
  const set = (p: Partial<FormState>) => setV((x) => (x ? { ...x, ...p } : x))
  const amount = Number(v?.amount || 0)
  useEffect(() => {
    if (!v || !amount || !(v.vendorId || v.payeeName)) return setDupes([])
    const t = setTimeout(() => {
      expensesApi.checkDuplicate({ vendorId: v.vendorId || null, payeeName: v.payeeName, amount, date: v.date }).then((r) => setDupes(r.duplicates)).catch(() => setDupes([]))
    }, 300)
    return () => clearTimeout(t)
  }, [v?.vendorId, v?.payeeName, amount, v?.date]) // eslint-disable-line react-hooks/exhaustive-deps
  const d = meta.data
  const preview = useMemo(() => {
    if (!d || !v) return null
    const tax = d.taxCodes.find((t) => t.id === v.taxCodeId)
    return vatSplit({ amount, rate: tax?.rate ?? 0, category: tax?.category ?? 'out_of_scope', payeeVatNumber: v.payeeVatNumber, country: d.country, vatRegistered: d.vatRegistered })
  }, [d, v, amount])

  const submit = () => {
    if (!v) return
    const input: ExpenseInput = {
      date: v.date,
      vendorId: v.vendorId || null,
      payeeName: v.payeeName,
      payeeVatNumber: v.payeeVatNumber,
      categoryId: v.categoryId,
      description: v.description,
      amount,
      currency: v.currency,
      exchangeRate: v.exchangeRate ? Number(v.exchangeRate) : null,
      taxCodeId: v.taxCodeId,
      paymentMethod: v.paymentMethod,
      paidFromAccountId: v.paidFromAccountId,
      pettyFundId: v.paymentMethod === 'petty_cash' ? v.pettyFundId : null,
      reference: v.reference,
      departmentId: v.departmentId || null,
      projectId: v.projectId || null,
      eventId: v.eventId || null,
      campaignId: v.campaignId || null,
      receipt: v.receipt,
      notes: v.notes,
    }
    save.mutate(input, {
      onSuccess: (e) => {
        toast.success(`Expense ${e.number} recorded`, e.status === 'approved' ? 'Posted to the ledger.' : 'Sent for approval.')
        setV(null)
        onSaved(e)
      },
    })
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      title="Record expense"
      description="Company spend already paid. VAT is recovered only with a valid tax invoice."
      width="xl"
      footer={
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button write loading={save.isPending} onClick={submit} disabled={!v || !amount}>Save expense</Button>
        </>
      }
    >
      {!d || !v ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="exp-date" label="Date" required><TextInput id="exp-date" type="date" value={v.date} max={today()} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field id="exp-vendor" label="Supplier" hint="Or type the payee below.">
            <SelectInput id="exp-vendor" value={v.vendorId} onChange={(e) => { const vd = d.vendors.find((x) => x.id === e.target.value); set({ vendorId: e.target.value, payeeName: vd?.name ?? '', payeeVatNumber: vd?.taxNumber ?? v.payeeVatNumber }) }}>
              <option value="">— Other payee —</option>
              {d.vendors.map((x) => <option key={x.id} value={x.id} disabled={x.blocked}>{x.name}{x.blocked ? ' (blacklisted)' : ''}</option>)}
            </SelectInput>
          </Field>
          <Field id="exp-payee" label="Payee" required><TextInput id="exp-payee" value={v.payeeName} disabled={!!v.vendorId} onChange={(e) => set({ payeeName: e.target.value })} /></Field>
          <Field id="exp-trn" label={d.country === 'SA' ? 'Payee VAT number (on the tax invoice)' : 'Payee TRN (on the tax invoice)'} hint={v.payeeVatNumber && !isValidTaxNumber(d.country, v.payeeVatNumber) ? 'Not a valid number: VAT won’t be recovered.' : undefined}>
            <TextInput id="exp-trn" value={v.payeeVatNumber} onChange={(e) => set({ payeeVatNumber: e.target.value })} />
          </Field>
          <Field id="exp-cat" label="Category" required>
            <SelectInput id="exp-cat" value={v.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              {d.categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.accountCode})</option>)}
            </SelectInput>
          </Field>
          <Field id="exp-desc" label="Description"><TextInput id="exp-desc" value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field id="exp-amount" label="Amount paid (VAT included)" required><TextInput id="exp-amount" inputMode="decimal" value={v.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field id="exp-cur" label="Currency">
              <SelectInput id="exp-cur" value={v.currency} disabled={v.paymentMethod === 'petty_cash'} onChange={(e) => set({ currency: e.target.value, exchangeRate: '' })}>
                {d.currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </SelectInput>
            </Field>
            {v.currency !== d.baseCurrency && <Field id="exp-rate" label={`Rate to ${d.baseCurrency}`} hint="Empty: Finance settings rate"><TextInput id="exp-rate" inputMode="decimal" value={v.exchangeRate} onChange={(e) => set({ exchangeRate: e.target.value })} /></Field>}
          </div>
          <Field id="exp-tax" label="Tax code">
            <SelectInput id="exp-tax" value={v.taxCodeId} onChange={(e) => set({ taxCodeId: e.target.value })}>
              {d.taxCodes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </SelectInput>
          </Field>
          <div className="self-end rounded-lg bg-sunken px-3 py-2 text-xs text-muted" aria-live="polite" data-testid="vat-preview">
            {preview ? <>VAT <span className="num font-medium text-ink">{fmt2(preview.vat)}</span> · expense <span className="num font-medium text-ink">{fmt2(preview.net)}</span> — {preview.note}</> : null}
          </div>
          <Field id="exp-method" label="Paid by">
            <SelectInput id="exp-method" value={v.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as ExpensePaymentMethod, currency: e.target.value === 'petty_cash' ? d.baseCurrency : v.currency })}>
              {EXPENSE_PAYMENT_METHODS.map((m) => <option key={m} value={m} disabled={m === 'petty_cash' && !d.pettyFunds.length}>{EXPENSE_PAYMENT_METHOD_LABEL[m]}</option>)}
            </SelectInput>
          </Field>
          {v.paymentMethod === 'petty_cash' ? (
            <Field id="exp-fund" label="Petty cash fund"><SelectInput id="exp-fund" value={v.pettyFundId} onChange={(e) => set({ pettyFundId: e.target.value })}>{d.pettyFunds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</SelectInput></Field>
          ) : (
            <Field id="exp-from" label="Paid from account"><SelectInput id="exp-from" value={v.paidFromAccountId} onChange={(e) => set({ paidFromAccountId: e.target.value })}>{d.paymentAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</SelectInput></Field>
          )}
          <Field id="exp-ref" label="Reference"><TextInput id="exp-ref" value={v.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
          <Field id="exp-dept" label="Department"><SelectInput id="exp-dept" value={v.departmentId} onChange={(e) => set({ departmentId: e.target.value })}><option value="">—</option>{d.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectInput></Field>
          <Field id="exp-proj" label="Project"><SelectInput id="exp-proj" value={v.projectId} onChange={(e) => set({ projectId: e.target.value })}><option value="">—</option>{d.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectInput></Field>
          <Field id="exp-event" label="Event"><SelectInput id="exp-event" value={v.eventId} onChange={(e) => set({ eventId: e.target.value })}><option value="">—</option>{d.events.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectInput></Field>
          <Field id="exp-camp" label="Marketing campaign"><SelectInput id="exp-camp" value={v.campaignId} onChange={(e) => set({ campaignId: e.target.value })}><option value="">—</option>{d.campaigns.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectInput></Field>
          <Field id="exp-receipt" label="Receipt" hint={`Required above ${d.baseCurrency} ${d.receiptRequiredAbove}.`} className="sm:col-span-2"><ReceiptInput id="exp-receipt" value={v.receipt} onChange={(f) => set({ receipt: f })} /></Field>
          <Field id="exp-notes" label="Notes" className="sm:col-span-2"><TextArea id="exp-notes" rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          {dupes.length > 0 && <p role="alert" className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-800 sm:col-span-2 dark:bg-warning-700/20 dark:text-warning-300">Possible duplicate: {dupes.map((x) => x.number).join(', ')} has the same payee, amount and date.</p>}
          <div className="sm:col-span-2"><FormError error={save.error} /></div>
        </div>
      )}
    </Drawer>
  )
}

/* ---------------- detail ---------------- */

export function ExpenseDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useExpense(id)
  const act = useExpensesMutation(expensesApi.expenseAction)
  const toast = useToast()
  const [ask, setAsk] = useState<'reject' | 'void' | null>(null)
  const e = q.data
  const run = (action: 'approve' | 'reject' | 'void', reason?: string) =>
    act.mutate({ id: id!, action, reason }, { onSuccess: (x) => { setAsk(null); toast.success(`Expense ${x.number}: ${x.status === 'approved' ? 'approved and posted' : x.status}`) } })
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={e ? `Expense ${e.number}` : 'Expense'}
      description={e ? `${e.payeeName} · ${fmtDate(e.date)}` : undefined}
      footer={
        e && (e.can.approve || e.can.void) ? (
          <>
            {e.can.void && <Button variant="secondary" write onClick={() => setAsk('void')}>Void</Button>}
            {e.can.reject && <Button variant="secondary" write onClick={() => setAsk('reject')}>Reject</Button>}
            {e.can.approve && <Button write loading={act.isPending && !ask} onClick={() => run('approve')}>Approve</Button>}
          </>
        ) : undefined
      }
    >
      {q.error ? (
        <FinError error={q.error} onRetry={() => q.refetch()} />
      ) : !e ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-2"><ExpenseStatusBadge status={e.status} />{e.duplicateOf.length ? <span className="text-xs text-warning-700">Same payee, amount and date as {e.duplicateOf.map((x) => x.number).join(', ')}</span> : null}</div>
          <dl>
            <DetailRow label="Category">{e.categoryName} · {e.accountName}</DetailRow>
            <DetailRow label="Amount"><Amount value={e.amount} currency={e.currency} strong /></DetailRow>
            {e.currency !== 'AED' && e.currency !== 'SAR' ? <DetailRow label="Rate">{e.exchangeRate} → <Amount value={e.baseAmount} /></DetailRow> : null}
            <DetailRow label="VAT recovered"><Amount value={e.vatAmount} /></DetailRow>
            <DetailRow label="VAT note">{e.vatNote}</DetailRow>
            <DetailRow label="Paid">{EXPENSE_PAYMENT_METHOD_LABEL[e.paymentMethod]} · {e.pettyFundName ?? e.paidFromAccountName}</DetailRow>
            {e.description && <DetailRow label="Description">{e.description}</DetailRow>}
            {e.departmentName && <DetailRow label="Department">{e.departmentName}</DetailRow>}
            {e.projectName && <DetailRow label="Project">{e.projectName}</DetailRow>}
            {e.eventName && <DetailRow label="Event">{e.eventName}</DetailRow>}
            {e.campaignName && <DetailRow label="Campaign">{e.campaignName}</DetailRow>}
            <DetailRow label="Receipt">{e.receipt ? <ReceiptLink file={e.receipt} /> : '—'}</DetailRow>
            {e.journal && <DetailRow label="Journal">{e.journal.number}{e.voidJournal ? ` · reversed by ${e.voidJournal.number}` : ''}</DetailRow>}
            {e.rejectReason && <DetailRow label="Rejected">{e.rejectReason}</DetailRow>}
            {e.voidReason && <DetailRow label="Void">{e.voidReason}</DetailRow>}
          </dl>
          <section><h3 className="mb-2 text-xs font-semibold uppercase text-muted">Approvals</h3><Steps steps={e.steps} /></section>
          <section><h3 className="mb-2 text-xs font-semibold uppercase text-muted">History</h3><History items={e.history} /></section>
          <FormError error={!ask ? act.error : null} />
        </div>
      )}
      <ReasonModal open={!!ask} title={ask === 'void' ? 'Void expense' : 'Reject expense'} label="Reason" confirm={ask === 'void' ? 'Void' : 'Reject'} onClose={() => setAsk(null)} onConfirm={(r) => run(ask!, r)} pending={act.isPending} error={act.error} />
    </Drawer>
  )
}
