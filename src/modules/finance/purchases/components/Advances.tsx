import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { HandCoins, Plus } from 'lucide-react'
import type { BillPaymentMethod, SupplierAdvance } from '@/modules/finance/purchases/types'
import { BILL_PAYMENT_METHOD_LABEL } from '@/modules/finance/purchases/types'
import { purchasesApi, usePurchasesMeta, usePurchasesMutation, useSupplierAdvances } from '@/modules/finance/purchases/api'
import { FinError, SimpleTable, errMsg, fmt2, td, tdEnd, th, thEnd } from '@/modules/finance/collections/components/bits'
import { fmtDay } from './bits'
import { financeBillPath, financePurchaseOrderPath } from '@/app/paths'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Modal } from '@/shared/components/ui/Modal'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

/**
 * Supplier advances (prepayments) — Bills › Advances tab, the supplier, the PO ("Pay advance") and the bill ("Apply
 * advance"). Pay: Dr 1420 Supplier advances / Cr bank. Apply to a bill: Dr AP / Cr 1420. Refund: Dr bank / Cr 1420.
 */

export function AdvancesTab({ canWrite, vendorId }: { canWrite: boolean; vendorId?: string }) {
  const list = useSupplierAdvances(vendorId ? { vendorId } : {})
  const [paying, setPaying] = useState(false)
  const [refunding, setRefunding] = useState<SupplierAdvance | null>(null)
  if (list.isLoading) return <Skeleton className="h-48" />
  if (list.error) return <FinError error={list.error as Error} onRetry={() => void list.refetch()} />
  const rows = list.data ?? []
  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex justify-end">
          <Button write onClick={() => setPaying(true)}><Plus className="size-4" aria-hidden /> Pay an advance</Button>
        </div>
      )}
      {!rows.length ? (
        <EmptyState title="No supplier advances" body="Pay a supplier before the bill (e.g. a 30 % advance on approval); apply it to the bill later." icon={<HandCoins />} />
      ) : (
        <SimpleTable
          label="Supplier advances"
          head={
            <tr>
              <th className={th}>Advance</th>
              <th className={th}>Supplier</th>
              <th className={th}>Date</th>
              <th className={th}>Applied to</th>
              <th className={th}>Status</th>
              <th className={thEnd}>Amount</th>
              <th className={thEnd}>Unapplied</th>
              {canWrite && <th className={thEnd}><span className="sr-only">Actions</span></th>}
            </tr>
          }
        >
          {rows.map((a) => (
            <tr key={a.id}>
              <td className={`${td} num font-medium`}>
                {a.number}
                {a.poId && <Link to={financePurchaseOrderPath(a.poId)} className="block text-xs font-normal text-brand-700 hover:underline dark:text-brand-300">{a.poNumber}</Link>}
              </td>
              <td className={td}>{a.vendorName}</td>
              <td className={`${td} num`}>{fmtDay(a.date)}</td>
              <td className={`${td} text-xs`}>
                {a.applications.map((x) => <Link key={x.id} to={financeBillPath(x.billId)} className="num me-2 text-brand-700 hover:underline dark:text-brand-300">{x.billNumber} ({fmt2(x.amount)})</Link>)}
                {a.refunds.map((r) => <span key={r.id} className="me-2">Refunded {fmt2(r.amount)}</span>)}
                {!a.applications.length && !a.refunds.length && '—'}
              </td>
              <td className={td}>{a.status === 'open' ? <Badge tone="amber">Open</Badge> : <Badge tone="green">Used</Badge>}</td>
              <td className={`${tdEnd} num whitespace-nowrap`}>{fmt2(a.amount)} {a.currency}</td>
              <td className={`${tdEnd} num whitespace-nowrap`}>{fmt2(a.remaining)}</td>
              {canWrite && <td className={tdEnd}>{a.remaining > 0 && <Button size="xs" variant="ghost" write onClick={() => setRefunding(a)}>Refund</Button>}</td>}
            </tr>
          ))}
        </SimpleTable>
      )}
      <AdvanceDrawer open={paying} onClose={() => setPaying(false)} vendorId={vendorId} />
      <RefundAdvanceModal advance={refunding} onClose={() => setRefunding(null)} />
    </div>
  )
}

/** Pays an advance to a supplier, or against an approved PO (amount defaults to the PO's advance due). */
export function AdvanceDrawer({ open, onClose, vendorId, po }: { open: boolean; onClose: () => void; vendorId?: string; po?: { id: string; number: string; vendorId: string; currency: string; due: number } }) {
  const toast = useToast()
  const meta = usePurchasesMeta()
  const m = meta.data
  const [vendor, setVendor] = useState('')
  const [date, setDate] = useState('')
  const [account, setAccount] = useState('')
  const [method, setMethod] = useState<BillPaymentMethod>('bank_transfer')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open || !m) return
    setVendor(po?.vendorId ?? vendorId ?? m.suppliers[0]?.id ?? '')
    setDate(m.today)
    setAccount(m.paymentAccounts.find((a) => a.code === '1120')?.id ?? m.paymentAccounts[0]?.id ?? '')
    setMethod('bank_transfer')
    setAmount(po ? String(po.due) : '')
    setReference('')
    setError(null)
  }, [open, m, po, vendorId])
  const save = usePurchasesMutation(() => purchasesApi.createAdvance({ vendorId: vendor, poId: po?.id ?? null, date, paymentAccountId: account, method, reference, amount: Number(amount) }))
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={po ? `Pay advance on ${po.number}` : 'Pay a supplier advance'}
      description="Dr 1420 Supplier advances / Cr the bank. Apply it to the supplier’s bill later."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button write loading={save.isPending} disabled={!vendor || !(Number(amount) > 0)} onClick={() => {
            setError(null)
            save.mutate(undefined, {
              onSuccess: (a) => {
                toast.success(`Advance ${a.number} paid`, `${fmt2(a.amount)} ${a.currency} to ${a.vendorName}`)
                onClose()
              },
              onError: (e) => setError(errMsg(e)),
            })
          }}>Pay advance</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="adv-vendor" label="Supplier">
          <SelectInput id="adv-vendor" value={vendor} disabled={!!po} onChange={(e) => setVendor(e.target.value)}>
            {m?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectInput>
        </Field>
        <Field id="adv-amount" label={`Amount${po ? ` (${po.currency})` : ''}`}><TextInput id="adv-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field id="adv-date" label="Date"><TextInput id="adv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field id="adv-account" label="Pay from">
          <SelectInput id="adv-account" value={account} onChange={(e) => setAccount(e.target.value)}>
            {m?.paymentAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </SelectInput>
        </Field>
        <Field id="adv-method" label="Method">
          <SelectInput id="adv-method" value={method} onChange={(e) => setMethod(e.target.value as BillPaymentMethod)}>
            {(Object.keys(BILL_PAYMENT_METHOD_LABEL) as BillPaymentMethod[]).map((k) => <option key={k} value={k}>{BILL_PAYMENT_METHOD_LABEL[k]}</option>)}
          </SelectInput>
        </Field>
        <Field id="adv-ref" label="Reference"><TextInput id="adv-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </div>
      {error && <p role="alert" className="mt-3 text-[0.8125rem] text-danger-600">{error}</p>}
    </Drawer>
  )
}

export function RefundAdvanceModal({ advance, onClose }: { advance: SupplierAdvance | null; onClose: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (advance) {
      setAmount(String(advance.remaining))
      setError(null)
    }
  }, [advance])
  const save = usePurchasesMutation(() => purchasesApi.refundAdvance(advance!.id, { amount: Number(amount) }))
  return (
    <Modal
      open={!!advance}
      onClose={onClose}
      title={`Refund of ${advance?.number ?? ''}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button write loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { toast.success('Refund recorded'); onClose() }, onError: (e) => setError(errMsg(e)) })}>Record refund</Button>
        </>
      }
    >
      <Field id="refund-amount" label={`Amount refunded by the supplier (${advance?.currency ?? ''})`} hint={advance ? `Unapplied: ${fmt2(advance.remaining)}` : undefined} error={error ?? undefined}>
        <TextInput id="refund-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
    </Modal>
  )
}

/** Applies one of the supplier's unapplied advances to a bill. */
export function ApplyAdvanceModal({ open, onClose, billId, balance, advances }: { open: boolean; onClose: () => void; billId: string; balance: number; advances: { id: string; number: string; remaining: number; currency: string }[] }) {
  const toast = useToast()
  const [pick, setPick] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    const first = advances[0]
    setPick(first?.id ?? '')
    setAmount(first ? String(Math.min(first.remaining, balance)) : '')
    setError(null)
  }, [open, advances, balance])
  const save = usePurchasesMutation(() => purchasesApi.applyAdvance(pick, { billId, amount: Number(amount) }))
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply advance"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button write loading={save.isPending} disabled={!pick} onClick={() => save.mutate(undefined, { onSuccess: () => { toast.success('Advance applied to the bill'); onClose() }, onError: (e) => setError(errMsg(e)) })}>Apply</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field id="apply-adv" label="Advance">
          <SelectInput id="apply-adv" value={pick} onChange={(e) => {
            setPick(e.target.value)
            const a = advances.find((x) => x.id === e.target.value)
            if (a) setAmount(String(Math.min(a.remaining, balance)))
          }}>
            {advances.map((a) => <option key={a.id} value={a.id}>{a.number} · unapplied {fmt2(a.remaining)} {a.currency}</option>)}
          </SelectInput>
        </Field>
        <Field id="apply-amount" label="Amount to apply" error={error ?? undefined}>
          <TextInput id="apply-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
