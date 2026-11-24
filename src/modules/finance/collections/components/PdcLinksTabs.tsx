import { useMemo, useState } from 'react'
import { CalendarClock, Copy, Link2, Plus } from 'lucide-react'
import type { Pdc, PdcStatus } from '@/modules/finance/collections/types'
import { PDC_STATUSES, PDC_STATUS_LABEL } from '@/modules/finance/collections/types'
import { collectionsApi, useCollectionsMutation, useCustomerCredits, useDepositAccounts, useOpenItems, usePaymentLinks, usePdcs } from '@/modules/finance/collections/api'
import { Amount, FinError, LinkStatusBadge, PdcStatusBadge, SimpleTable, baseCurrency, companyToday, errMsg, fmt2, td, tdEnd, th, thEnd } from './bits'
import { fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Modal } from '@/shared/components/ui/Modal'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { useNewParam } from '@/shared/hooks/useNewParam'

/* ---------------- post-dated cheques ---------------- */

export function PdcTab({ canWrite, highlight }: { canWrite: boolean; highlight: string | null }) {
  const [status, setStatus] = useState<PdcStatus | ''>('')
  const q = usePdcs(status ? { status } : {})
  const [receiving, setReceiving] = useState(false)
  useNewParam(() => setReceiving(true), { when: canWrite })
  const [action, setAction] = useState<{ pdc: Pdc; kind: 'deposit' | 'clear' | 'bounce' } | null>(null)
  const today = companyToday()
  const all = q.data ?? []
  const maturing = all.filter((p) => p.maturingSoon)
  const due = all.filter((p) => p.depositDue)
  if (q.error) return <FinError error={q.error} onRetry={() => q.refetch()} />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[0.8125rem] text-muted">
          A post-dated cheque secures invoices but doesn’t pay them: the invoice stays open until the cheque clears. A bounced cheque leaves it open as before.
        </p>
        <div className="flex gap-2">
          <SelectInput aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as PdcStatus | '')} className="w-44">
            <option value="">All statuses</option>
            {PDC_STATUSES.map((s) => <option key={s} value={s}>{PDC_STATUS_LABEL[s]}</option>)}
          </SelectInput>
          {canWrite && <Button write onClick={() => setReceiving(true)}><Plus /> Receive cheque</Button>}
        </div>
      </div>
      {(due.length > 0 || maturing.length > 0) && (
        <div className="flex flex-wrap gap-3" aria-label="Cheque reminders">
          {due.length > 0 && (
            <p className="flex items-center gap-2 rounded-lg border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-[0.8125rem] text-ink-2">
              <CalendarClock className="size-4" aria-hidden /> Deposit today: {due.map((p) => `${p.chequeNo} (${p.customerName})`).join(', ')}
            </p>
          )}
          {maturing.length > 0 && (
            <p className="rounded-lg border border-line bg-sunken/60 px-3 py-2 text-[0.8125rem] text-ink-2">
              Maturing this week: {maturing.length} cheque{maturing.length === 1 ? '' : 's'}, {baseCurrency()} {fmt2(maturing.reduce((s, p) => s + p.amount * p.exchangeRate, 0))}
            </p>
          )}
        </div>
      )}
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : !all.length ? (
        <EmptyState icon={<CalendarClock />} title="No post-dated cheques" body="Cheques received for a later date appear here until they clear or bounce." />
      ) : (
        <SimpleTable
          label="Post-dated cheques"
          head={
            <tr>
              <th className={th}>Cheque</th>
              <th className={th}>Customer</th>
              <th className={th}>Cheque date</th>
              <th className={th}>Invoices</th>
              <th className={thEnd}>Amount</th>
              <th className={th}>Status</th>
              {canWrite && <th className={th}><span className="sr-only">Actions</span></th>}
            </tr>
          }
        >
          {all.map((p) => (
            <tr key={p.id} className={p.id === highlight ? 'bg-brand-50/60 dark:bg-brand-500/10' : undefined}>
              <td className={td}>
                <span className="num font-medium text-ink">{p.chequeNo}</span>
                <span className="block text-xs text-muted">{p.bankName}</span>
              </td>
              <td className={td}>{p.customerName}</td>
              <td className={td}>
                <span className="num">{fmtDate(p.dueDate)}</span>
                {p.depositDue && <span className="block text-xs font-medium text-warning-700 dark:text-warning-500">Deposit {p.dueDate === today ? 'today' : 'now'}</span>}
              </td>
              <td className={td}><span className="num text-xs">{p.allocations.map((a) => a.invoiceNumber).join(', ') || 'Advance'}</span></td>
              <td className={tdEnd}><Amount value={p.amount} currency={p.currency} /></td>
              <td className={td}>
                <PdcStatusBadge status={p.status} />
                {p.paymentNumber && <span className="num block text-xs text-muted">Receipt {p.paymentNumber}</span>}
                {p.bounceReason && <span className="block text-xs text-muted">{p.bounceReason}</span>}
              </td>
              {canWrite && (
                <td className={tdEnd}>
                  <div className="flex justify-end gap-1">
                    {p.status === 'received' && <Button write size="xs" variant="secondary" disabled={p.dueDate > today} title={p.dueDate > today ? `Can be deposited from ${fmtDate(p.dueDate)}` : undefined} onClick={() => setAction({ pdc: p, kind: 'deposit' })}>Deposit</Button>}
                    {p.status === 'deposited' && <Button write size="xs" variant="secondary" onClick={() => setAction({ pdc: p, kind: 'clear' })}>Cleared</Button>}
                    {(p.status === 'received' || p.status === 'deposited') && <Button write size="xs" variant="ghost" onClick={() => setAction({ pdc: p, kind: 'bounce' })}>Bounced</Button>}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </SimpleTable>
      )}
      <ReceivePdcDrawer open={receiving} onClose={() => setReceiving(false)} />
      <PdcActionModal action={action} onClose={() => setAction(null)} />
    </div>
  )
}

function ReceivePdcDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const customers = useCustomerCredits(open)
  const [customerId, setCustomerId] = useState('')
  const items = useOpenItems(customerId || null)
  const [f, setF] = useState({ chequeNo: '', bankName: '', receivedDate: companyToday(), dueDate: '', amount: '', currency: baseCurrency() })
  const [alloc, setAlloc] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const invoices = useMemo(() => (items.data?.invoices ?? []).filter((i) => i.currency === f.currency), [items.data, f.currency])
  const save = useCollectionsMutation(() =>
    collectionsApi.createPdc({
      customerId,
      chequeNo: f.chequeNo,
      bankName: f.bankName,
      receivedDate: f.receivedDate,
      dueDate: f.dueDate,
      amount: Number(f.amount) || 0,
      currency: f.currency,
      allocations: Object.entries(alloc).map(([invoiceId, v]) => ({ invoiceId, amount: Number(v) || 0 })).filter((a) => a.amount > 0),
    }),
  )
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async () => {
    setError(null)
    try {
      const p = await save.mutateAsync(undefined)
      toast.success(`Cheque ${p.chequeNo} registered`, 'The invoices stay open until it clears.')
      setCustomerId('')
      setAlloc({})
      setF({ chequeNo: '', bankName: '', receivedDate: companyToday(), dueDate: '', amount: '', currency: baseCurrency() })
      onClose()
    } catch (e) {
      setError(errMsg(e))
    }
  }
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="Receive post-dated cheque"
      description="Registers the cheque (Dr PDC receivable). It pays the invoices only once it clears."
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button write loading={save.isPending} onClick={submit}>Register cheque</Button></div>}
    >
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-[0.8125rem] text-danger-700 dark:text-danger-500">{error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="pdc-customer" label="Customer" required className="sm:col-span-2">
            <SelectInput id="pdc-customer" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setAlloc({}) }}>
              <option value="">Select a customer…</option>
              {(customers.data ?? []).map((c) => <option key={c.customerId} value={c.customerId}>{c.customerName}</option>)}
            </SelectInput>
          </Field>
          <Field id="pdc-no" label="Cheque number" required><TextInput id="pdc-no" value={f.chequeNo} onChange={set('chequeNo')} /></Field>
          <Field id="pdc-bank" label="Drawn on (bank)" required><TextInput id="pdc-bank" value={f.bankName} onChange={set('bankName')} /></Field>
          <Field id="pdc-received" label="Received on" required><TextInput id="pdc-received" type="date" value={f.receivedDate} max={companyToday()} onChange={set('receivedDate')} /></Field>
          <Field id="pdc-due" label="Cheque date" required><TextInput id="pdc-due" type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
          <Field id="pdc-amount" label="Amount" required><TextInput id="pdc-amount" inputMode="decimal" value={f.amount} onChange={set('amount')} /></Field>
          <Field id="pdc-currency" label="Currency"><TextInput id="pdc-currency" value={f.currency} maxLength={3} onChange={(e) => setF((x) => ({ ...x, currency: e.target.value.toUpperCase() }))} /></Field>
        </div>
        {customerId && (
          <section aria-label="Invoices this cheque secures" className="space-y-2">
            <h3 className="text-[0.8125rem] font-semibold text-ink">Invoices this cheque secures</h3>
            {!invoices.length ? (
              <p className="text-[0.8125rem] text-muted">No open {f.currency} invoices: the cheque is an advance (customer credit once it clears).</p>
            ) : (
              <SimpleTable label="Open invoices" head={<tr><th className={th}>Invoice</th><th className={th}>Due</th><th className={thEnd}>Can take</th><th className={thEnd}>Secure</th></tr>}>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td className={td}><span className="num">{i.number}</span></td>
                    <td className={td}><span className="num">{fmtDate(i.dueDate)}</span></td>
                    <td className={tdEnd}><Amount value={i.available} /></td>
                    <td className={tdEnd}><TextInput aria-label={`Secure ${i.number}`} className="w-28 text-end" inputMode="decimal" value={alloc[i.id] ?? ''} onChange={(e) => setAlloc((a) => ({ ...a, [i.id]: e.target.value }))} /></td>
                  </tr>
                ))}
              </SimpleTable>
            )}
          </section>
        )}
      </div>
    </Drawer>
  )
}

function PdcActionModal({ action, onClose }: { action: { pdc: Pdc; kind: 'deposit' | 'clear' | 'bounce' } | null; onClose: () => void }) {
  const toast = useToast()
  const accounts = useDepositAccounts(!!action)
  const [date, setDate] = useState(companyToday())
  const [account, setAccount] = useState('')
  const [reason, setReason] = useState('')
  const [fee, setFee] = useState('')
  const [error, setError] = useState<string | null>(null)
  const run = useCollectionsMutation((a: NonNullable<typeof action>) =>
    collectionsApi.pdcAction(a.pdc.id, a.kind, { date, depositAccountId: account || undefined, reason: reason || undefined, bounceFee: Number(fee) || 0 }),
  )
  if (!action) return null
  const { pdc, kind } = action
  const title = kind === 'deposit' ? `Deposit cheque ${pdc.chequeNo}` : kind === 'clear' ? `Cheque ${pdc.chequeNo} cleared` : `Cheque ${pdc.chequeNo} bounced`
  const submit = async () => {
    setError(null)
    try {
      await run.mutateAsync(action)
      toast.success(kind === 'deposit' ? 'Cheque deposited' : kind === 'clear' ? 'Cheque cleared: receipt recorded, invoices paid' : 'Cheque bounced: the invoices are open again')
      setReason('')
      setFee('')
      onClose()
    } catch (e) {
      setError(errMsg(e))
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={`${pdc.customerName} · ${pdc.currency} ${fmt2(pdc.amount)}`}
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button write variant={kind === 'bounce' ? 'danger' : 'primary'} loading={run.isPending} onClick={submit}>{kind === 'deposit' ? 'Deposit' : kind === 'clear' ? 'Mark cleared' : 'Mark bounced'}</Button></div>}
    >
      <div className="space-y-3">
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
        <Field id="pdc-act-date" label="Date"><TextInput id="pdc-act-date" type="date" value={date} max={companyToday()} onChange={(e) => setDate(e.target.value)} /></Field>
        {kind === 'deposit' && (
          <Field id="pdc-act-acc" label="Deposit to">
            <SelectInput id="pdc-act-acc" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">Main bank account</option>
              {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </SelectInput>
          </Field>
        )}
        {kind === 'bounce' && (
          <>
            <Field id="pdc-act-reason" label="Reason"><TextInput id="pdc-act-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Insufficient funds" /></Field>
            <Field id="pdc-act-fee" label="Bank’s returned-cheque fee" hint="Optional; posted to bank charges. The customer is flagged and the accountants and the customer’s owner are notified.">
              <TextInput id="pdc-act-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" />
            </Field>
          </>
        )}
      </div>
    </Modal>
  )
}

/* ---------------- payment links ---------------- */

export function LinksTab({ canWrite }: { canWrite: boolean }) {
  const toast = useToast()
  const q = usePaymentLinks()
  const [creating, setCreating] = useState(false)
  useNewParam(() => setCreating(true), { when: canWrite })
  const voidIt = useCollectionsMutation((id: string) => collectionsApi.voidLink(id))
  const copy = async (url: string) => {
    const abs = `${window.location.origin}${url}`
    try {
      await navigator.clipboard.writeText(abs)
      toast.success('Link copied', abs)
    } catch {
      toast.info('Copy this link', abs)
    }
  }
  if (q.error) return <FinError error={q.error} onRetry={() => q.refetch()} />
  const rows = q.data ?? []
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[0.8125rem] text-muted">A link opens a public page where the customer pays the invoice’s balance by card (test mode, simulated gateway). The payment lands in Payment gateway clearing.</p>
        {canWrite && <Button write onClick={() => setCreating(true)}><Plus /> Create payment link</Button>}
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : !rows.length ? (
        <EmptyState icon={<Link2 />} title="No payment links yet" body="Create a link for an open invoice and share it with the customer." />
      ) : (
        <SimpleTable
          label="Payment links"
          head={<tr><th className={th}>Invoice</th><th className={th}>Customer</th><th className={thEnd}>Amount</th><th className={th}>Expires</th><th className={th}>Status</th><th className={th}><span className="sr-only">Actions</span></th></tr>}
        >
          {rows.map((l) => (
            <tr key={l.id}>
              <td className={td}><span className="num font-medium text-ink">{l.invoiceNumber}</span></td>
              <td className={td}>{l.customerName}</td>
              <td className={tdEnd}><Amount value={l.amount} currency={l.currency} /></td>
              <td className={td}><span className="num">{fmtDate(l.expiresAt)}</span></td>
              <td className={td}><LinkStatusBadge status={l.status} /></td>
              <td className={tdEnd}>
                <div className="flex justify-end gap-1">
                  {l.status === 'active' && (
                    <>
                      <Button size="xs" variant="secondary" onClick={() => copy(l.url)} aria-label={`Copy link for ${l.invoiceNumber}`}><Copy /> Copy</Button>
                      <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center px-2 text-xs font-medium text-brand-600 hover:underline">Open</a>
                      {canWrite && <Button write size="xs" variant="ghost" onClick={() => voidIt.mutate(l.id)}>Void</Button>}
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </SimpleTable>
      )}
      <CreateLinkModal open={creating} onClose={() => setCreating(false)} onCreated={(url) => void copy(url)} />
    </div>
  )
}

function CreateLinkModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (url: string) => void }) {
  const customers = useCustomerCredits(open)
  const [customerId, setCustomerId] = useState('')
  const items = useOpenItems(customerId || null)
  const [invoiceId, setInvoiceId] = useState('')
  const [days, setDays] = useState('14')
  const [error, setError] = useState<string | null>(null)
  const save = useCollectionsMutation(() => collectionsApi.createLink({ invoiceId, expiresInDays: Number(days) || 14 }))
  const submit = async () => {
    setError(null)
    try {
      const l = await save.mutateAsync(undefined)
      onCreated(l.url)
      setInvoiceId('')
      onClose()
    } catch (e) {
      setError(errMsg(e))
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create payment link"
      description="For the invoice’s open balance (minus cheques held)."
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button write disabled={!invoiceId} loading={save.isPending} onClick={submit}>Create and copy link</Button></div>}
    >
      <div className="space-y-3">
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
        <Field id="link-customer" label="Customer">
          <SelectInput id="link-customer" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setInvoiceId('') }}>
            <option value="">Select a customer…</option>
            {(customers.data ?? []).filter((c) => c.openAr > 0).map((c) => <option key={c.customerId} value={c.customerId}>{c.customerName}</option>)}
          </SelectInput>
        </Field>
        <Field id="link-invoice" label="Invoice">
          <SelectInput id="link-invoice" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} disabled={!customerId}>
            <option value="">Select an invoice…</option>
            {(items.data?.invoices ?? []).filter((i) => i.available > 0).map((i) => <option key={i.id} value={i.id}>{i.number} · {i.currency} {fmt2(i.available)}</option>)}
          </SelectInput>
        </Field>
        <Field id="link-days" label="Expires after (days)"><TextInput id="link-days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
