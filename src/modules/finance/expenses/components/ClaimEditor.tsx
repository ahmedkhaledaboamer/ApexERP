import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { ClaimLineInput, ExpenseClaim, ReceiptFile } from '@/modules/finance/expenses/types'
import { useQueryClient } from '@tanstack/react-query'
import { expensesApi, useClaimsMeta } from '@/modules/finance/expenses/api'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { FormError, ReceiptInput } from './bits'

const today = () => new Date().toISOString().slice(0, 10)

interface Line {
  key: number
  date: string
  categoryId: string
  description: string
  merchant: string
  merchantVatNumber: string
  amount: string
  currency: string
  receipt: ReceiptFile | null
  projectId: string
  customerId: string
  eventId: string
}

let k = 0
const blank = (categoryId: string, currency: string): Line => ({ key: ++k, date: today(), categoryId, description: '', merchant: '', merchantVatNumber: '', amount: '', currency, receipt: null, projectId: '', customerId: '', eventId: '' })

/**
 * New expense claim (the caller's own): lines with a receipt each; "Save draft" or "Submit for approval". Used by
 * Expenses › Claims and the My HR card.
 */
export function ClaimEditorDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: (c: ExpenseClaim) => void }) {
  const meta = useClaimsMeta(open)
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [busy, setBusy] = useState(false)
  const d = meta.data
  useEffect(() => {
    if (open && d && !lines.length) setLines([blank(d.categories[0]?.id ?? '', d.baseCurrency)])
  }, [open, d, lines.length])
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['finance'] })
    void qc.invalidateQueries({ queryKey: ['alerts'] })
  }
  const close = () => {
    setTitle('')
    setLines([])
    setError(null)
    onClose()
  }
  const set = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const save = async (submit: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const input: ClaimLineInput[] = lines.map((l) => ({
        date: l.date,
        categoryId: l.categoryId,
        description: l.description,
        merchant: l.merchant,
        merchantVatNumber: l.merchantVatNumber,
        amount: Number(l.amount),
        currency: l.currency,
        receipt: l.receipt,
        projectId: l.projectId || null,
        customerId: l.customerId || null,
        eventId: l.eventId || null,
      }))
      let c = await expensesApi.createClaim({ title, lines: input })
      if (submit) {
        try {
          c = await expensesApi.claimAction({ id: c.id, action: 'submit' })
        } catch (e) {
          // Keep the draft; say why it can't be submitted.
          toast.info(`Saved ${c.number} as a draft`)
          throw e
        }
      }
      toast.success(submit ? `Claim ${c.number} submitted` : `Draft ${c.number} saved`, submit ? `Waiting on ${c.waitingOn.join(', ') || 'approval'}.` : undefined)
      refresh()
      close()
      onDone?.(c)
    } catch (e) {
      refresh()
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }
  const total = lines.reduce((s, l) => s + (l.currency === d?.baseCurrency ? Number(l.amount) || 0 : 0), 0)
  return (
    <Drawer
      open={open}
      onClose={close}
      title="New expense claim"
      description={d?.employee ? `${d.employee.name}${d.employee.departmentName ? ` · ${d.employee.departmentName}` : ''} — money you spent for the company.` : undefined}
      width="xl"
      footer={
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button variant="secondary" write loading={busy} disabled={!lines.length} onClick={() => save(false)}>Save draft</Button>
          <Button write loading={busy} disabled={!lines.length} onClick={() => save(true)}>Submit for approval</Button>
        </>
      }
    >
      {!d ? (
        <Skeleton className="h-80" />
      ) : !d.employee ? (
        <p className="text-sm text-muted">You have no employee record, so you can’t claim expenses. Ask HR to add you.</p>
      ) : (
        <div className="space-y-4">
          <Field id="claim-title" label="Title"><TextInput id="claim-title" placeholder="e.g. Client visits — November" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <p className="text-xs text-muted">
            Receipts are required above {d.baseCurrency} {d.policy.receiptRequiredAbove}; claim within {d.policy.claimMaxAgeDays} days. VAT is recovered when the receipt shows the merchant’s {d.baseCurrency === 'SAR' ? 'VAT number' : 'TRN'}.
          </p>
          {lines.map((l, i) => (
            <fieldset key={l.key} className="grid grid-cols-1 gap-3 rounded-xl border border-line p-3 sm:grid-cols-3" aria-label={`Line ${i + 1}`}>
              <legend className="px-1 text-xs font-semibold text-muted">Line {i + 1}</legend>
              <Field id={`cl-date-${l.key}`} label="Date"><TextInput id={`cl-date-${l.key}`} type="date" max={today()} value={l.date} onChange={(e) => set(l.key, { date: e.target.value })} /></Field>
              <Field id={`cl-cat-${l.key}`} label="Category">
                <SelectInput id={`cl-cat-${l.key}`} value={l.categoryId} onChange={(e) => set(l.key, { categoryId: e.target.value })}>
                  {d.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </SelectInput>
              </Field>
              <Field id={`cl-purpose-${l.key}`} label="Purpose"><TextInput id={`cl-purpose-${l.key}`} value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} /></Field>
              <Field id={`cl-merchant-${l.key}`} label="Merchant"><TextInput id={`cl-merchant-${l.key}`} value={l.merchant} onChange={(e) => set(l.key, { merchant: e.target.value })} /></Field>
              <Field id={`cl-trn-${l.key}`} label={d.baseCurrency === 'SAR' ? 'Merchant VAT number' : 'Merchant TRN'}><TextInput id={`cl-trn-${l.key}`} value={l.merchantVatNumber} onChange={(e) => set(l.key, { merchantVatNumber: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field id={`cl-amount-${l.key}`} label="Amount"><TextInput id={`cl-amount-${l.key}`} inputMode="decimal" value={l.amount} onChange={(e) => set(l.key, { amount: e.target.value })} /></Field>
                <Field id={`cl-cur-${l.key}`} label="Currency"><SelectInput id={`cl-cur-${l.key}`} value={l.currency} onChange={(e) => set(l.key, { currency: e.target.value })}>{d.currencies.map((c) => <option key={c} value={c}>{c}</option>)}</SelectInput></Field>
              </div>
              <Field id={`cl-proj-${l.key}`} label="Project"><SelectInput id={`cl-proj-${l.key}`} value={l.projectId} onChange={(e) => set(l.key, { projectId: e.target.value })}><option value="">—</option>{d.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectInput></Field>
              <Field id={`cl-cust-${l.key}`} label="Customer"><SelectInput id={`cl-cust-${l.key}`} value={l.customerId} onChange={(e) => set(l.key, { customerId: e.target.value })}><option value="">—</option>{d.customers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectInput></Field>
              <Field id={`cl-event-${l.key}`} label="Event"><SelectInput id={`cl-event-${l.key}`} value={l.eventId} onChange={(e) => set(l.key, { eventId: e.target.value })}><option value="">—</option>{d.events.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectInput></Field>
              <Field id={`cl-receipt-${l.key}`} label="Receipt" className="sm:col-span-2"><ReceiptInput id={`cl-receipt-${l.key}`} value={l.receipt} onChange={(f) => set(l.key, { receipt: f })} /></Field>
              <div className="flex items-end justify-end">
                {lines.length > 1 && <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 /> Remove line</Button>}
              </div>
            </fieldset>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, blank(d.categories[0]?.id ?? '', d.baseCurrency)])}><Plus /> Add line</Button>
            <span className="num text-sm text-muted">Total ({d.baseCurrency} lines): <span className="font-semibold text-ink">{total.toFixed(2)}</span></span>
          </div>
          <FormError error={error} />
        </div>
      )}
    </Drawer>
  )
}
