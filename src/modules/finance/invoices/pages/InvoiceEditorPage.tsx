import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import type { InvoiceInput, InvoiceLineInput, InvoiceMeta } from '@/modules/finance/invoices/types'
import { invoicesApi, useInvoice, useInvoiceMeta, useInvoiceMutation, useInvoicesScope } from '@/modules/finance/invoices/api'
import { addDaysIso, fmtMoney, lineMath, totalsOf } from '@/modules/finance/invoices/calc'
import { invoicePath } from '@/modules/finance/invoices/components/InvoiceModals'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

interface LineDraft {
  key: string
  id?: string
  serviceId: string
  description: string
  quantity: string
  unitPrice: string
  discount: string
  taxCodeId: string
  revenueAccountId: string
}

let keySeq = 0
const blankLine = (meta: InvoiceMeta | undefined): LineDraft => ({ key: `n${++keySeq}`, serviceId: '', description: '', quantity: '1', unitPrice: '', discount: '', taxCodeId: meta?.standardTaxCodeId ?? '', revenueAccountId: '' })

/**
 * `/finance/invoices/new` and `/finance/invoices/:id/edit` (drafts only): customer, VAT number (KSA: B2B with it,
 * simplified without), currency and rate, dates and terms, lines from the services catalog or free text with qty,
 * unit price, discount amount, tax code and revenue account (default: service revenue for catalog lines, the
 * finance-settings default otherwise). Totals preview with the server's rounding (per line).
 */
export default function InvoiceEditorPage() {
  const { id } = useParams()
  const meta = useInvoiceMeta()
  const existing = useInvoice(id ?? null)
  const { canWrite } = useInvoicesScope()
  if (!canWrite) return <PageBody><ErrorState message="Only a Company Admin, Management or an Accountant can edit invoices." /></PageBody>
  if (meta.isLoading || (id && existing.isLoading)) return <PageBody><Skeleton className="h-96" /></PageBody>
  if (meta.isError || !meta.data) return <PageBody><ErrorState message={meta.error ? (meta.error as Error).message : 'Couldn’t load the invoice settings.'} /></PageBody>
  if (id && (existing.isError || !existing.data)) return <PageBody><ErrorState message="Invoice not found." /></PageBody>
  if (existing.data && existing.data.status !== 'draft') return <PageBody><ErrorState message="Issued invoices can’t be edited. Issue a credit note or void the invoice." /></PageBody>
  return <Editor meta={meta.data} />
}

function Editor({ meta }: { meta: InvoiceMeta }) {
  const { id } = useParams()
  const [params] = useSearchParams()
  const existing = useInvoice(id ?? null).data
  const navigate = useNavigate()
  const toast = useToast()
  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '')
  const [vat, setVat] = useState('')
  const [currency, setCurrency] = useState(meta.baseCurrency)
  const [rate, setRate] = useState('1')
  const [issueDate, setIssueDate] = useState('')
  const [terms, setTerms] = useState(String(meta.paymentTermsDays))
  const [dueDate, setDueDate] = useState('')
  const [projectId, setProjectId] = useState('')
  const [eventId, setEventId] = useState('')
  const [notes, setNotes] = useState('')
  const [termsText, setTermsText] = useState('')
  const [lines, setLines] = useState<LineDraft[]>(() => [blankLine(meta)])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!existing || loaded) return
    setLoaded(true)
    setCustomerId(existing.customerId)
    setVat(existing.customerVatNumber)
    setCurrency(existing.currency)
    setRate(String(existing.exchangeRate))
    setIssueDate(existing.issueDate ?? '')
    setTerms(String(existing.paymentTermsDays))
    setDueDate(existing.dueDate ?? '')
    setProjectId(existing.projectId ?? '')
    setEventId(existing.eventId ?? '')
    setNotes(existing.notes)
    setTermsText(existing.terms)
    setLines(existing.lines.map((l) => ({ key: l.id, id: l.id, serviceId: l.serviceId ?? '', description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), discount: l.discount ? String(l.discount) : '', taxCodeId: l.taxCodeId, revenueAccountId: l.revenueAccountId })))
  }, [existing, loaded])

  const pickCustomer = (cid: string) => {
    setCustomerId(cid)
    if (!existing) setVat(meta.customers.find((c) => c.id === cid)?.vatNumber ?? '')
  }
  const pickCurrency = (c: string) => {
    setCurrency(c)
    setRate(String(meta.rates[c] ?? (c === meta.baseCurrency ? 1 : '')))
  }
  const setLine = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const pickService = (key: string, sid: string) => {
    const s = meta.services.find((x) => x.id === sid)
    setLine(key, s ? { serviceId: sid, description: s.name, unitPrice: String(s.price) } : { serviceId: '' })
  }

  const rateOf = (taxCodeId: string) => meta.taxCodes.find((t) => t.id === taxCodeId)?.rate ?? 0
  const math = useMemo(() => lines.map((l) => lineMath(Number(l.quantity) || 0, Number(l.unitPrice) || 0, Number(l.discount) || 0, rateOf(l.taxCodeId))), [lines]) // eslint-disable-line react-hooks/exhaustive-deps
  const totals = totalsOf(math)
  const ksa = meta.country === 'SA'
  const kind = ksa && !vat.trim() ? 'Simplified tax invoice (B2C)' : 'Tax invoice'

  const input = (): InvoiceInput => ({
    customerId,
    customerVatNumber: vat.trim(),
    currency,
    exchangeRate: currency === meta.baseCurrency ? 1 : Number(rate) || null,
    issueDate: issueDate || null,
    dueDate: dueDate || null,
    paymentTermsDays: Number(terms),
    projectId: projectId || null,
    eventId: eventId || null,
    ...(notes || existing ? { notes } : {}),
    ...(termsText || existing ? { terms: termsText } : {}),
    lines: lines.map<InvoiceLineInput>((l) => ({
      id: l.id,
      description: l.description,
      serviceId: l.serviceId || null,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discount: Number(l.discount) || 0,
      taxCodeId: l.taxCodeId || null,
      revenueAccountId: l.revenueAccountId || null,
    })),
  })

  const save = useInvoiceMutation((i: InvoiceInput) => (existing ? invoicesApi.update(existing.id, i) : invoicesApi.create(i)))
  const issue = useInvoiceMutation(invoicesApi.issue)
  const submit = (andIssue: boolean) =>
    save.mutate(input(), {
      onSuccess: (inv) => {
        if (!andIssue) {
          toast.success('Draft saved')
          navigate(invoicePath(inv.id))
          return
        }
        issue.mutate(inv.id, {
          onSuccess: (d) => {
            toast.success(`Invoice ${d.number} issued`)
            navigate(invoicePath(d.id))
          },
          onError: (e) => {
            toast.error('Saved as a draft, but couldn’t issue it', errMsg(e))
            navigate(invoicePath(inv.id))
          },
        })
      },
      onError: (e) => toast.error('Couldn’t save the invoice', errMsg(e)),
    })

  const projects = meta.projects.filter((p) => !customerId || p.customerId === customerId)

  return (
    <>
      <PageHeader
        title={existing ? `Edit draft ${existing.id}` : 'New invoice'}
        description={`${kind} · amounts in ${currency}${currency !== meta.baseCurrency ? `, posted in ${meta.baseCurrency}` : ''}. Drafts don’t post to the ledger.`}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => navigate(existing ? invoicePath(existing.id) : '/finance/invoices')}>Cancel</Button>
            <Button variant="secondary" write onClick={() => submit(false)} loading={save.isPending && !issue.isPending} disabled={!customerId}>Save draft</Button>
            <Button write onClick={() => submit(true)} loading={issue.isPending} disabled={!customerId}>Save and issue</Button>
          </div>
        }
      />
      <PageBody>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Customer and terms" />
            <CardBody>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field id="inv-customer" label="Customer" required>
                  <SelectInput id="inv-customer" value={customerId} onChange={(e) => pickCustomer(e.target.value)}>
                    <option value="">Choose a customer…</option>
                    {meta.customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </SelectInput>
                </Field>
                <Field id="inv-vat" label={ksa ? 'Customer VAT number' : 'Customer TRN'} hint={ksa ? 'With it: standard tax invoice (B2B). Empty: simplified (B2C).' : 'Printed on the tax invoice when the customer is VAT registered.'}>
                  <TextInput id="inv-vat" value={vat} onChange={(e) => setVat(e.target.value)} maxLength={20} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field id="inv-currency" label="Currency">
                    <SelectInput id="inv-currency" value={currency} onChange={(e) => pickCurrency(e.target.value)}>
                      {meta.currencies.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </SelectInput>
                  </Field>
                  <Field id="inv-rate" label={`Rate to ${meta.baseCurrency}`}>
                    <TextInput id="inv-rate" inputMode="decimal" value={currency === meta.baseCurrency ? '1' : rate} disabled={currency === meta.baseCurrency} onChange={(e) => setRate(e.target.value)} />
                  </Field>
                </div>
                <Field id="inv-issue" label="Issue date" hint="Empty = the day it is issued.">
                  <TextInput id="inv-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                </Field>
                <Field id="inv-terms" label="Payment terms (days)">
                  <TextInput id="inv-terms" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} />
                </Field>
                <Field id="inv-due" label="Due date" hint={issueDate && terms ? `From the terms: ${addDaysIso(issueDate, Number(terms) || 0)}` : 'Empty = issue date + terms.'}>
                  <TextInput id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </Field>
                <Field id="inv-project" label="Project" hint="Optional (reporting dimension).">
                  <SelectInput id="inv-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">None</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </SelectInput>
                </Field>
                <Field id="inv-event" label="Event" hint="Optional (reporting dimension).">
                  <SelectInput id="inv-event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                    <option value="">None</option>
                    {meta.events.map((ev) => (
                      <option key={ev.id} value={ev.id}>{ev.name}</option>
                    ))}
                  </SelectInput>
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Lines" description="Discount is an amount per line. VAT is rounded per line." />
            <CardBody className="space-y-3">
              {lines.map((l, i) => (
                <div key={l.key} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3 md:grid-cols-[minmax(10rem,1.2fr)_minmax(12rem,2fr)_5rem_7rem_6rem_8rem_9rem_auto]">
                  <SelectInput aria-label={`Line ${i + 1} service`} value={l.serviceId} onChange={(e) => pickService(l.key, e.target.value)}>
                    <option value="">Free text</option>
                    {meta.services.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </SelectInput>
                  <TextInput aria-label={`Line ${i + 1} description`} placeholder="Description" value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
                  <TextInput aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                  <TextInput aria-label={`Line ${i + 1} unit price`} inputMode="decimal" placeholder="Unit price" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} />
                  <TextInput aria-label={`Line ${i + 1} discount`} inputMode="decimal" placeholder="Discount" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} />
                  <SelectInput aria-label={`Line ${i + 1} tax code`} value={l.taxCodeId} onChange={(e) => setLine(l.key, { taxCodeId: e.target.value })}>
                    {meta.taxCodes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </SelectInput>
                  <SelectInput aria-label={`Line ${i + 1} revenue account`} value={l.revenueAccountId} onChange={(e) => setLine(l.key, { revenueAccountId: e.target.value })}>
                    <option value="">Default ({meta.revenueAccounts.find((a) => a.id === (l.serviceId ? meta.serviceRevenueAccountId : meta.defaultRevenueAccountId))?.code ?? '—'})</option>
                    {meta.revenueAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                    ))}
                  </SelectInput>
                  <div className="flex items-center justify-end gap-2">
                    <span className="num text-[0.8125rem] font-medium whitespace-nowrap">{fmtMoney(math[i].total)}</span>
                    <Button iconOnly size="sm" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, blankLine(meta)])}>
                <Plus className="size-4" aria-hidden /> Add line
              </Button>
              <dl className="num ms-auto grid max-w-80 grid-cols-[1fr_auto] gap-y-1 text-[0.8125rem]">
                <dt className="text-muted">Subtotal</dt>
                <dd className="text-end">{fmtMoney(totals.subtotal, currency)}</dd>
                <dt className="text-muted">Discounts</dt>
                <dd className="text-end">−{fmtMoney(totals.discountTotal, currency)}</dd>
                <dt className="text-muted">VAT</dt>
                <dd className="text-end">{fmtMoney(totals.taxTotal, currency)}</dd>
                <dt className="font-semibold">Total</dt>
                <dd className="text-end font-semibold" data-testid="editor-total">{fmtMoney(totals.total, currency)}</dd>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field id="inv-notes" label="Notes">
                <TextArea id="inv-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <Field id="inv-terms-text" label="Terms" hint="Empty = the Finance settings default.">
                <TextArea id="inv-terms-text" rows={3} value={termsText} onChange={(e) => setTermsText(e.target.value)} />
              </Field>
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
