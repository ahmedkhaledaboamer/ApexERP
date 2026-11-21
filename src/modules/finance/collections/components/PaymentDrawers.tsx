import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import type { OpenInvoice, Payment, PaymentMethod } from '@/modules/finance/collections/types'
import { MANUAL_METHODS, PAYMENT_METHOD_LABEL } from '@/modules/finance/collections/types'
import { collectionsApi, useCollectionsMutation, useCustomerCredits, useDepositAccounts, useOpenItems, usePayment } from '@/modules/finance/collections/api'
import { financeInvoicePath, financeReceiptPath } from '@/app/paths'
import { Amount, PaymentStatusBadge, SimpleTable, baseCurrency, companyToday, errMsg, fmt2, td, tdEnd, th, thEnd } from './bits'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Segmented } from '@/shared/components/ui/Segmented'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
type Mode = 'auto' | 'manual' | 'none'

/** Oldest due first until the money runs out (the server does the same for `auto`). */
export function autoAllocate(invoices: OpenInvoice[], amount: number): Record<string, number> {
  let left = amount
  const out: Record<string, number> = {}
  for (const i of [...invoices].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number))) {
    if (left <= 0) break
    const take = r2(Math.min(left, i.available))
    if (take > 0) {
      out[i.id] = take
      left = r2(left - take)
    }
  }
  return out
}

/* ---------------- record a payment ---------------- */

export function RecordPaymentDrawer({ open, onClose, initialCustomerId, initialInvoiceId, onRecorded }: { open: boolean; onClose: () => void; initialCustomerId?: string | null; initialInvoiceId?: string | null; onRecorded?: (p: Payment) => void }) {
  const toast = useToast()
  const customers = useCustomerCredits(open)
  const accounts = useDepositAccounts(open)
  const [customerId, setCustomerId] = useState(initialCustomerId ?? '')
  const items = useOpenItems(customerId || null)
  const [date, setDate] = useState(companyToday())
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(baseCurrency())
  const [rate, setRate] = useState('')
  const [charges, setCharges] = useState('')
  const [deposit, setDeposit] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [mode, setMode] = useState<Mode>('auto')
  const [manual, setManual] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setCustomerId(initialCustomerId ?? '')
    setDate(companyToday())
    setMethod('bank_transfer')
    setAmount('')
    setCurrency(baseCurrency())
    setRate('')
    setCharges('')
    setDeposit('')
    setReference('')
    setNotes('')
    setMode(initialInvoiceId ? 'manual' : 'auto')
    setManual({})
    setError(null)
  }, [open, initialCustomerId, initialInvoiceId])

  // Prefill from the invoice we came from: its currency and balance.
  useEffect(() => {
    if (!initialInvoiceId || !items.data) return
    const inv = items.data.invoices.find((i) => i.id === initialInvoiceId)
    if (!inv) return
    setCurrency(inv.currency)
    setAmount(String(inv.available))
    setManual({ [inv.id]: String(inv.available) })
  }, [initialInvoiceId, items.data])

  const invoices = useMemo(() => (items.data?.invoices ?? []).filter((i) => i.currency === currency), [items.data, currency])
  const currencies = useMemo(() => [...new Set([baseCurrency(), ...(items.data?.invoices ?? []).map((i) => i.currency)])], [items.data])
  const amt = Number(amount) || 0
  const alloc: Record<string, number> = mode === 'auto' ? autoAllocate(invoices, amt) : mode === 'manual' ? Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => (v as number) > 0)) : {}
  const allocated = r2(Object.values(alloc).reduce((s, v) => s + v, 0))
  const credit = r2(amt - allocated)

  const save = useCollectionsMutation(() =>
    collectionsApi.createPayment({
      customerId,
      date,
      method,
      amount: amt,
      currency,
      exchangeRate: currency === baseCurrency() || !rate ? undefined : Number(rate),
      bankCharges: Number(charges) || 0,
      depositAccountId: deposit || undefined,
      reference,
      notes,
      allocationMode: mode,
      allocations: mode === 'manual' ? Object.entries(alloc).map(([invoiceId, a]) => ({ invoiceId, amount: a })) : undefined,
    }),
  )

  const submit = async () => {
    setError(null)
    if (!customerId) return setError('Pick the customer who paid.')
    if (amt <= 0) return setError('Enter the amount received.')
    if (credit < 0) return setError('The allocations add up to more than the payment.')
    try {
      const p = await save.mutateAsync(undefined)
      toast.success(`Payment ${p.number} recorded`, credit > 0 ? `${p.currency} ${fmt2(p.unallocated)} kept as customer credit.` : undefined)
      // One URL update: two in a row would overwrite each other (react-router search params).
      if (onRecorded) onRecorded(p)
      else onClose()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title="Record payment"
      description="Money received from a customer, allocated to their open invoices; anything left becomes customer credit."
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.8125rem] text-muted" aria-live="polite">
            Allocated <span className="num font-medium text-ink">{fmt2(allocated)}</span> · Credit <span className="num font-medium text-ink">{fmt2(Math.max(0, credit))}</span>
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button write loading={save.isPending} onClick={submit}>Record payment</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-[0.8125rem] text-danger-700 dark:text-danger-400">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pay-customer" label="Customer" required>
            <SelectInput id="pay-customer" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setManual({}) }}>
              <option value="">Select a customer…</option>
              {(customers.data ?? []).map((c) => (
                <option key={c.customerId} value={c.customerId}>{c.customerName}{c.openAr > 0 ? ` · ${c.baseCurrency} ${fmt2(c.openAr)} open` : ''}</option>
              ))}
            </SelectInput>
          </Field>
          <Field id="pay-date" label="Date" required>
            <TextInput id="pay-date" type="date" value={date} max={companyToday()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="pay-method" label="Method">
            <SelectInput id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {MANUAL_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
            </SelectInput>
          </Field>
          <Field id="pay-deposit" label="Deposit to" hint="Default: bank for transfers and cards, cash on hand for cash, undeposited funds for cheques.">
            <SelectInput id="pay-deposit" value={deposit} onChange={(e) => setDeposit(e.target.value)}>
              <option value="">Default for the method</option>
              {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="pay-amount" label="Amount received" required>
            <TextInput id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field id="pay-currency" label="Currency">
            <SelectInput id="pay-currency" value={currency} onChange={(e) => { setCurrency(e.target.value); setManual({}) }}>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </SelectInput>
          </Field>
          {currency !== baseCurrency() && (
            <Field id="pay-rate" label={`Rate (1 ${currency} = ? ${baseCurrency()})`} hint="Empty: the rate in Finance settings. Differences to the invoice rate post to exchange gain / loss.">
              <TextInput id="pay-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
          )}
          <Field id="pay-charges" label="Bank charges deducted" hint="If the bank received less than the customer paid.">
            <TextInput id="pay-charges" inputMode="decimal" value={charges} onChange={(e) => setCharges(e.target.value)} placeholder="0.00" />
          </Field>
          <Field id="pay-ref" label="Reference">
            <TextInput id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer ref., cheque no.…" />
          </Field>
        </div>

        <section aria-label="Allocation" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[0.8125rem] font-semibold text-ink">Allocate to invoices</h3>
            <Segmented label="Allocation" size="sm" value={mode} onChange={setMode} options={[{ value: 'auto', label: 'Oldest first' }, { value: 'manual', label: 'Manual' }, { value: 'none', label: 'All to credit' }]} />
          </div>
          {!customerId ? (
            <p className="text-[0.8125rem] text-muted">Pick a customer to see their open invoices.</p>
          ) : items.isPending ? (
            <Skeleton className="h-24" />
          ) : !invoices.length ? (
            <p className="text-[0.8125rem] text-muted">No open {currency} invoices: the whole amount becomes customer credit.</p>
          ) : (
            <SimpleTable
              label="Open invoices"
              head={
                <tr>
                  <th className={th}>Invoice</th>
                  <th className={th}>Due</th>
                  <th className={thEnd}>Open</th>
                  <th className={thEnd}>Can take</th>
                  <th className={thEnd}>Allocate</th>
                </tr>
              }
            >
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className={td}>
                    <span className="num font-medium text-ink">{i.number}</span>
                    {i.overdue && <Badge tone="red" className="ms-2">Overdue</Badge>}
                    {i.pdcHeld > 0 && <span className="block text-xs text-muted">{fmt2(i.pdcHeld)} secured by cheque</span>}
                  </td>
                  <td className={td}><span className="num">{fmtDate(i.dueDate)}</span></td>
                  <td className={tdEnd}><Amount value={i.balanceDue} /></td>
                  <td className={tdEnd}><Amount value={i.available} /></td>
                  <td className={tdEnd}>
                    {mode === 'manual' ? (
                      <TextInput aria-label={`Allocate to ${i.number}`} className="w-28 text-end" inputMode="decimal" value={manual[i.id] ?? ''} onChange={(e) => setManual((m) => ({ ...m, [i.id]: e.target.value }))} disabled={i.available <= 0} />
                    ) : (
                      <Amount value={alloc[i.id] ?? 0} />
                    )}
                  </td>
                </tr>
              ))}
            </SimpleTable>
          )}
        </section>
        <Field id="pay-notes" label="Notes">
          <TextArea id="pay-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  )
}

/* ---------------- payment detail ---------------- */

export function PaymentDetailDrawer({ id, onClose, canWrite }: { id: string | null; onClose: () => void; canWrite: boolean }) {
  const toast = useToast()
  const q = usePayment(id)
  const p = q.data
  const [refundAmt, setRefundAmt] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const [panel, setPanel] = useState<'none' | 'refund' | 'void'>('none')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setPanel('none')
    setRefundAmt('')
    setVoidReason('')
    setError(null)
  }, [id])
  const apply = useCollectionsMutation((pid: string) => collectionsApi.applyCredit(pid, {}))
  const refund = useCollectionsMutation((a: { id: string; amount: number }) => collectionsApi.refund(a.id, { amount: a.amount, date: companyToday() }))
  const voidIt = useCollectionsMutation((a: { id: string; reason: string }) => collectionsApi.voidPayment(a.id, a.reason))
  const run = async (f: () => Promise<unknown>, ok: string) => {
    setError(null)
    try {
      await f()
      toast.success(ok)
      setPanel('none')
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <Drawer open={!!id} onClose={onClose} width="lg" title={p ? `Payment ${p.number}` : 'Payment'} description={p ? `${p.customerName} · ${fmtDate(p.date)}` : undefined}>
      {!p ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-5">
          {error && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-[0.8125rem] text-danger-700 dark:text-danger-400">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <PaymentStatusBadge status={p.status} />
            <Badge tone="neutral">{PAYMENT_METHOD_LABEL[p.method]}</Badge>
            {p.source === 'pdc' && <Badge tone="blue">From a cleared cheque</Badge>}
            {p.cardHint && <Badge tone="neutral">{p.cardHint}</Badge>}
            <Link to={financeReceiptPath(p.id)} className="ms-auto inline-flex items-center gap-1 text-[0.8125rem] font-medium text-brand-600 hover:underline">
              <Printer className="size-3.5" aria-hidden /> Receipt
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-[0.8125rem]">
            {(
              [
                ['Amount', <Amount key="a" value={p.amount} currency={p.currency} strong />],
                ['In base currency', <Amount key="b" value={p.amountBase} />],
                ['Exchange rate', String(p.exchangeRate)],
                ['Bank charges', <Amount key="c" value={p.bankCharges} />],
                ['Deposited to', p.depositAccountName],
                ['Reference', p.reference || '—'],
                ['Allocated', <Amount key="d" value={p.allocated} />],
                ['Customer credit left', <Amount key="e" value={p.unallocated} strong={p.unallocated > 0} />],
                ['Refunded', <Amount key="f" value={p.refunded} />],
                ['Recorded by', p.createdByName ?? 'Online payment'],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5 text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {p.voidReason && <p className="text-[0.8125rem] text-muted">Voided {fmtDate(p.voidedAt)}: {p.voidReason}</p>}

          <section aria-label="Allocations">
            <h3 className="mb-2 text-[0.8125rem] font-semibold text-ink">Allocations</h3>
            {!p.allocations.length ? (
              <p className="text-[0.8125rem] text-muted">Not allocated: the whole payment is customer credit.</p>
            ) : (
              <SimpleTable label="Allocations" head={<tr><th className={th}>Invoice</th><th className={th}>Date</th><th className={th}>Kind</th><th className={thEnd}>Amount</th></tr>}>
                {p.allocations.map((a) => (
                  <tr key={a.id} className={a.reversedOn ? 'text-muted line-through' : undefined}>
                    <td className={td}><Link className="num text-brand-600 hover:underline" to={financeInvoicePath(a.invoiceId)}>{a.invoiceNumber}</Link></td>
                    <td className={td}><span className="num">{fmtDate(a.date)}</span></td>
                    <td className={td}>{a.kind === 'credit' ? 'Credit applied' : 'Payment'}{a.reversedOn ? ` · refunded ${fmtDate(a.reversedOn)}` : ''}</td>
                    <td className={tdEnd}><Amount value={a.amount} /></td>
                  </tr>
                ))}
              </SimpleTable>
            )}
          </section>
          {p.refunds.length > 0 && (
            <section aria-label="Refunds">
              <h3 className="mb-2 text-[0.8125rem] font-semibold text-ink">Refunds</h3>
              <ul className="space-y-1 text-[0.8125rem]">
                {p.refunds.map((r) => (
                  <li key={r.id} className="flex justify-between"><span>{fmtDate(r.date)} {r.reference && `· ${r.reference}`}</span><Amount value={r.amount} currency={p.currency} /></li>
                ))}
              </ul>
            </section>
          )}

          {canWrite && p.status === 'posted' && (
            <div className="space-y-3 border-t border-line pt-4">
              <div className="flex flex-wrap gap-2">
                {p.unallocated > 0 && (
                  <Button write size="sm" variant="secondary" loading={apply.isPending} onClick={() => run(() => apply.mutateAsync(p.id), 'Credit applied to the oldest open invoices')}>
                    Apply credit to invoices
                  </Button>
                )}
                <Button write size="sm" variant="secondary" onClick={() => setPanel('refund')}>Refund</Button>
                {p.source !== 'pdc' && <Button write size="sm" variant="danger" onClick={() => setPanel('void')}>Void payment</Button>}
              </div>
              {panel === 'refund' && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
                  <Field id="refund-amt" label={`Refund amount (${p.currency})`} hint="Taken from the customer credit first, then back off the newest invoices.">
                    <TextInput id="refund-amt" inputMode="decimal" value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} />
                  </Field>
                  <Button write loading={refund.isPending} onClick={() => run(() => refund.mutateAsync({ id: p.id, amount: Number(refundAmt) || 0 }), 'Refund recorded')}>Record refund</Button>
                </div>
              )}
              {panel === 'void' && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-danger-500/30 p-3">
                  <Field id="void-reason" label="Why is it voided?" hint="Reverses the postings; the invoices are open again.">
                    <TextInput id="void-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                  </Field>
                  <Button write variant="danger" loading={voidIt.isPending} onClick={() => run(() => voidIt.mutateAsync({ id: p.id, reason: voidReason }), `Payment ${p.number} voided`)}>Void</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}
