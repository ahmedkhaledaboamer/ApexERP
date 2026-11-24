import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { InvoiceDetail, RecurringFrequency, RecurringMode } from '@/modules/finance/invoices/types'
import { RECURRING_FREQUENCY_LABEL } from '@/modules/finance/invoices/types'
import { invoicesApi, useInvoiceMutation, useInvoiceSources } from '@/modules/finance/invoices/api'
import { fmtMoney, round2 } from '@/modules/finance/invoices/calc'
import { Modal } from '@/shared/components/ui/Modal'
import { Button } from '@/shared/components/ui/Button'
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
export const invoicePath = (id: string) => `/finance/invoices/${encodeURIComponent(id)}`

/* ---------------- from a quotation / contract / won deal ---------------- */

export interface SourcePreset {
  quotationId?: string
  contractId?: string
  leadId?: string
}

/** Pick a quotation or contract (or a won deal preset), the share to bill and a milestone label → a draft invoice. */
export function FromSourceModal({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: SourcePreset | null }) {
  const sources = useInvoiceSources(open)
  const navigate = useNavigate()
  const toast = useToast()
  const [kind, setKind] = useState<'quotation' | 'contract' | 'lead'>('quotation')
  const [id, setId] = useState('')
  const [percent, setPercent] = useState('')
  const [milestone, setMilestone] = useState('')
  const create = useInvoiceMutation(invoicesApi.fromSource)

  useEffect(() => {
    if (!open) return
    setPercent('')
    setMilestone('')
    if (preset?.leadId) {
      setKind('lead')
      setId(preset.leadId)
    } else if (preset?.contractId) {
      setKind('contract')
      setId(preset.contractId)
    } else {
      setKind('quotation')
      setId(preset?.quotationId ?? '')
    }
  }, [open, preset])

  const q = sources.data?.quotations.find((x) => x.id === id)
  const c = sources.data?.contracts.find((x) => x.id === id)
  const remaining = kind === 'quotation' ? (q ? round2(100 - q.invoicedPct) : 100) : kind === 'contract' && c?.billing === 'One-off' ? round2(100 - c.invoicedPct) : 100
  const partialAllowed = kind === 'quotation' || (kind === 'contract' && c?.billing === 'One-off')

  const submit = () => {
    const pct = percent.trim() ? Number(percent) : undefined
    create.mutate(
      { quotationId: kind === 'quotation' ? id : undefined, contractId: kind === 'contract' ? id : undefined, leadId: kind === 'lead' ? id : undefined, percent: partialAllowed ? pct : undefined, milestone: milestone || undefined },
      {
        onSuccess: (inv) => {
          toast.success('Draft invoice created', `${inv.customerName} · ${fmtMoney(inv.total, inv.currency)}`)
          onClose()
          navigate(invoicePath(inv.id))
        },
        onError: (e) => toast.error('Couldn’t create the invoice', errMsg(e)),
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invoice a quotation, contract or won deal"
      description="Lines are prefilled and the link is kept. A quotation (or one-off contract) can be billed in parts (milestones) up to 100%."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write onClick={submit} loading={create.isPending} disabled={!id}>Create draft</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field id="src-kind" label="Source">
          <SelectInput id="src-kind" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setId('') }}>
            <option value="quotation">Accepted quotation</option>
            <option value="contract">Contract</option>
            {kind === 'lead' && <option value="lead">Won deal</option>}
          </SelectInput>
        </Field>
        {kind === 'lead' ? (
          <p className="text-[0.8125rem] text-muted">Won deal {id}: its accepted quotation is invoiced, or the contract created by the Won flow.</p>
        ) : (
          <Field id="src-id" label={kind === 'quotation' ? 'Quotation' : 'Contract'} required>
            <SelectInput id="src-id" value={id} onChange={(e) => setId(e.target.value)}>
              <option value="">Choose…</option>
              {kind === 'quotation'
                ? sources.data?.quotations.map((x) => (
                    <option key={x.id} value={x.id} disabled={x.invoicedPct >= 100}>
                      {x.number} · {x.customerName} · {fmtMoney(x.netTotal, x.currency)}{x.invoicedPct > 0 ? ` · ${x.invoicedPct}% invoiced` : ''}
                    </option>
                  ))
                : sources.data?.contracts.map((x) => (
                    <option key={x.id} value={x.id} disabled={x.billing === 'One-off' && x.invoicedPct >= 100}>
                      {x.title} · {x.customerName} · {fmtMoney(x.value)} {x.billing.toLowerCase()}{x.invoicedPct > 0 ? ` · ${x.invoicedPct}% invoiced` : ''}
                    </option>
                  ))}
            </SelectInput>
          </Field>
        )}
        {partialAllowed && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="src-pct" label="Share to invoice (%)" hint={`${remaining}% left. Empty = everything left.`}>
              <TextInput id="src-pct" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder={String(remaining)} />
            </Field>
            <Field id="src-ms" label="Milestone label" hint="Optional, e.g. Milestone 1 (kick-off).">
              <TextInput id="src-ms" value={milestone} onChange={(e) => setMilestone(e.target.value)} maxLength={120} />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ---------------- credit note ---------------- */

export function CreditNoteModal({ inv, open, onClose }: { inv: InvoiceDetail; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [full, setFull] = useState(true)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const create = useInvoiceMutation(invoicesApi.createCreditNote)
  useEffect(() => {
    if (open) {
      setReason('')
      setFull(true)
      setAmounts({})
    }
  }, [open])
  const rateOf = (taxCodeId: string) => inv.taxSummary.find((t) => t.taxCodeId === taxCodeId)?.rate ?? 0
  const lines = inv.lines.filter((l) => (inv.creditable[l.id] ?? 0) > 0)
  const preview = useMemo(() => {
    let net = 0
    let tax = 0
    for (const l of lines) {
      const a = full ? inv.creditable[l.id] : Number(amounts[l.id] || 0)
      if (!a) continue
      net += a
      tax += a === l.net ? l.taxAmount : round2((a * rateOf(l.taxCodeId)) / 100)
    }
    return { net: round2(net), tax: round2(tax), total: round2(net + tax) }
  }, [full, amounts, lines]) // eslint-disable-line react-hooks/exhaustive-deps
  const excess = round2(Math.max(0, preview.total - inv.balanceDue))
  const submit = () =>
    create.mutate(
      { invoiceId: inv.id, reason, full, lines: full ? undefined : lines.filter((l) => Number(amounts[l.id] || 0) > 0).map((l) => ({ invoiceLineId: l.id, amount: Number(amounts[l.id]) })) },
      {
        onSuccess: (cn) => {
          toast.success(`Credit note ${cn.number} issued`, `${fmtMoney(cn.total, cn.currency)}${cn.excessAmount > 0 ? ` · ${fmtMoney(cn.excessAmount, cn.currency)} as customer credit` : ''}`)
          onClose()
        },
        onError: (e) => toast.error('Couldn’t issue the credit note', errMsg(e)),
      },
    )
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Credit note for ${inv.number}`}
      description="Reverses revenue and VAT for the credited amount and reduces the balance. Anything above the open balance becomes customer credit."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write onClick={submit} loading={create.isPending} disabled={reason.trim().length < 3 || preview.total <= 0}>Issue credit note</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field id="cn-reason" label="Reason" required>
          <TextInput id="cn-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Service not delivered" />
        </Field>
        <label className="flex items-center gap-2 text-[0.8125rem]">
          <Checkbox checked={full} onChange={(e) => setFull(e.target.checked)} /> Credit everything still creditable
        </label>
        {!full && (
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.id} className="grid grid-cols-[1fr_8rem] items-center gap-3">
                <label htmlFor={`cn-${l.id}`} className="text-[0.8125rem]">
                  {l.description}
                  <span className="block text-xs text-muted">Up to {fmtMoney(inv.creditable[l.id], inv.currency)} excl. VAT</span>
                </label>
                <TextInput id={`cn-${l.id}`} aria-label={`Credit amount for ${l.description}`} inputMode="decimal" value={amounts[l.id] ?? ''} onChange={(e) => setAmounts((a) => ({ ...a, [l.id]: e.target.value }))} placeholder="0.00" />
              </div>
            ))}
          </div>
        )}
        <dl className="num grid grid-cols-[1fr_auto] gap-y-1 rounded-lg bg-sunken px-3 py-2 text-[0.8125rem]">
          <dt className="text-muted">Net</dt>
          <dd className="text-end">{fmtMoney(preview.net, inv.currency)}</dd>
          <dt className="text-muted">VAT</dt>
          <dd className="text-end">{fmtMoney(preview.tax, inv.currency)}</dd>
          <dt className="font-semibold">Credit note total</dt>
          <dd className="text-end font-semibold">{fmtMoney(preview.total, inv.currency)}</dd>
          {excess > 0 && (
            <>
              <dt className="text-warning-700 dark:text-warning-500">Customer credit (above the balance)</dt>
              <dd className="text-end text-warning-700 dark:text-warning-500">{fmtMoney(excess, inv.currency)}</dd>
            </>
          )}
        </dl>
      </div>
    </Modal>
  )
}

/* ---------------- void ---------------- */

export function VoidModal({ inv, open, onClose }: { inv: InvoiceDetail; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const voidIt = useInvoiceMutation((r: string) => invoicesApi.void(inv.id, r))
  useEffect(() => {
    if (open) setReason('')
  }, [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Void ${inv.number}?`}
      description="The journal entry is reversed today. Only an invoice without payments or credit notes can be voided; the number stays used."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            write
            loading={voidIt.isPending}
            disabled={reason.trim().length < 3}
            onClick={() =>
              voidIt.mutate(reason, {
                onSuccess: () => {
                  toast.success(`${inv.number} voided`)
                  onClose()
                },
                onError: (e) => toast.error('Couldn’t void the invoice', errMsg(e)),
              })
            }
          >
            Void invoice
          </Button>
        </>
      }
    >
      <Field id="void-reason" label="Reason" required>
        <TextArea id="void-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
    </Modal>
  )
}

/* ---------------- send ---------------- */

export function SendModal({ inv, open, onClose }: { inv: InvoiceDetail; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [to, setTo] = useState('')
  const [message, setMessage] = useState('')
  const send = useInvoiceMutation((b: { to: string; message: string }) => invoicesApi.send(inv.id, b))
  useEffect(() => {
    if (open) {
      setTo(inv.customerEmail)
      setMessage(`Please find attached ${inv.title.toLowerCase()} ${inv.number} for ${fmtMoney(inv.total, inv.currency)}, due ${inv.dueDate ?? ''}.`)
    }
  }, [open, inv])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Email ${inv.number}`}
      description="Sends the invoice PDF to the customer contact (simulated in this preview; logged with the time)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            loading={send.isPending}
            disabled={!to.trim()}
            onClick={() =>
              send.mutate(
                { to, message },
                {
                  onSuccess: () => {
                    toast.success('Invoice sent', to)
                    onClose()
                  },
                  onError: (e) => toast.error('Couldn’t send the invoice', errMsg(e)),
                },
              )
            }
          >
            Send
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field id="send-to" label="To" required>
          <TextInput id="send-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field id="send-msg" label="Message">
          <TextArea id="send-msg" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

/* ---------------- recurring ---------------- */

export function RecurringModal({ inv, contractId, open, onClose }: { inv?: InvoiceDetail; contractId?: string; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [mode, setMode] = useState<RecurringMode>('draft')
  const create = useInvoiceMutation(invoicesApi.createRecurring)
  useEffect(() => {
    if (!open) return
    const d = new Date()
    d.setMonth(d.getMonth() + 1, 1)
    setStartDate(d.toISOString().slice(0, 10))
    setEndDate('')
    setMode('draft')
    setFrequency('monthly')
  }, [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Make recurring"
      description="Generated on each period date in the company’s timezone, once per period. The accountants are notified."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            loading={create.isPending}
            disabled={!startDate}
            onClick={() =>
              create.mutate(
                { sourceInvoiceId: inv?.id, contractId: inv ? undefined : contractId, frequency, startDate, endDate: endDate || null, mode },
                {
                  onSuccess: (r) => {
                    toast.success('Recurring invoice scheduled', `${RECURRING_FREQUENCY_LABEL[r.frequency]} · next ${r.nextDate ?? '—'}`)
                    onClose()
                  },
                  onError: (e) => toast.error('Couldn’t schedule it', errMsg(e)),
                },
              )
            }
          >
            Schedule
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="rec-freq" label="Frequency">
          <SelectInput id="rec-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}>
            {(Object.keys(RECURRING_FREQUENCY_LABEL) as RecurringFrequency[]).map((f) => (
              <option key={f} value={f}>{RECURRING_FREQUENCY_LABEL[f]}</option>
            ))}
          </SelectInput>
        </Field>
        <Field id="rec-mode" label="On each date">
          <SelectInput id="rec-mode" value={mode} onChange={(e) => setMode(e.target.value as RecurringMode)}>
            <option value="draft">Create a draft to review</option>
            <option value="auto_issue">Issue automatically</option>
          </SelectInput>
        </Field>
        <Field id="rec-start" label="First date" required>
          <TextInput id="rec-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field id="rec-end" label="End date" hint="Optional.">
          <TextInput id="rec-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
