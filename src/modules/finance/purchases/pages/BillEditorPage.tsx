import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FileInput } from 'lucide-react'
import type { BillInput } from '@/modules/finance/purchases/types'
import { purchasesApi, useBill, usePurchaseOrder, usePurchasesMeta, usePurchasesMutation, usePurchasesScope } from '@/modules/finance/purchases/api'
import { FinError, errMsg } from '@/modules/finance/collections/components/bits'
import { LineEditor, draftFrom, newLine, toInputs, type LineDraft } from '@/modules/finance/purchases/components/LineEditor'
import { PATHS, financeBillPath, financePurchaseOrderPath } from '@/app/paths'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

const r3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * `/finance/bills/new` (?po=<id> prefills what is received / ordered and not billed yet) and `/finance/bills/:id/edit`.
 * Accounting full only. Saving keeps a draft; posting / approvals happen on the bill.
 */
export default function BillEditorPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const poParam = params.get('po')
  const navigate = useNavigate()
  const toast = useToast()
  const { canWrite } = usePurchasesScope()
  const meta = usePurchasesMeta()
  const existing = useBill(id ?? null)
  const poId = id ? (existing.data?.poId ?? null) : poParam
  const po = usePurchaseOrder(poId)
  const m = meta.data
  const [vendorId, setVendorId] = useState('')
  const [ref, setRef] = useState('')
  const [billDate, setBillDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [currency, setCurrency] = useState('')
  const [rate, setRate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([newLine()])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loaded || !m) return
    if (id) {
      if (!existing.data) return
      const b = existing.data
      setVendorId(b.vendorId)
      setRef(b.supplierInvoiceNumber)
      setBillDate(b.billDate)
      setDueDate(b.dueDate)
      setCurrency(b.currency)
      setRate(b.currency === m.baseCurrency ? '' : String(b.exchangeRate))
      setNotes(b.notes)
      setLines(b.lines.map((l) => draftFrom(l)))
      setLoaded(true)
    } else if (poParam) {
      if (!po.data) return
      const p = po.data
      const threeWay = p.receipts.length > 0
      setVendorId(p.vendorId)
      setCurrency(p.currency)
      setBillDate(m.today)
      const ls = p.lines
        .map((l) => ({ l, qty: r3((threeWay ? l.receivedQty : l.quantity) - l.billedQty) }))
        .filter((x) => x.qty > 0)
        .map(({ l, qty }) => draftFrom({ ...l, id: undefined, poLineId: l.id, quantity: qty }))
      setLines(ls.length ? ls : [newLine()])
      setLoaded(true)
    } else {
      setBillDate(m.today)
      setCurrency(m.baseCurrency)
      setLoaded(true)
    }
  }, [loaded, m, id, existing.data, poParam, po.data])

  const supplier = m?.suppliers.find((s) => s.id === vendorId)
  const standard = m?.taxCodes.find((t) => t.category === 'standard')?.id ?? ''
  const defaultTax = supplier?.defaultTaxCodeId ?? (supplier?.vatNumber ? standard : 'OOS')
  const foreign = !!m && currency !== m.baseCurrency
  const metaRate = m?.rates.find((r) => r.currency === currency)?.rate ?? null
  const fromPo = !!poId

  const save = usePurchasesMutation(async () => {
    const input: BillInput = {
      ...(fromPo ? { poId } : { vendorId }),
      supplierInvoiceNumber: ref.trim(),
      billDate,
      dueDate: dueDate || null,
      ...(fromPo ? {} : { currency }),
      exchangeRate: foreign && rate ? Number(rate) : null,
      notes,
      lines: toInputs(lines),
    }
    return id ? purchasesApi.updateBill(id, input) : purchasesApi.createBill(input)
  })

  if (!canWrite) return <PageBody><EmptyState title="Only the finance team enters bills" body="Ask an Accountant to enter the supplier’s invoice." icon={<FileInput />} /></PageBody>
  if (meta.error) return <PageBody><FinError error={meta.error as Error} onRetry={() => void meta.refetch()} /></PageBody>
  if (existing.error) return <PageBody><FinError error={existing.error as Error} onRetry={() => void existing.refetch()} /></PageBody>
  if (!m || !loaded) return <PageBody><Skeleton className="h-96" /></PageBody>

  return (
    <>
      <PageHeader
        icon={<IconTile><FileInput /></IconTile>}
        title={id ? `Edit ${existing.data?.number ?? 'bill'}` : fromPo ? `Bill for ${po.data?.number ?? 'purchase order'}` : 'New bill'}
        description={fromPo ? 'Prefilled with what was received (3-way) or ordered (2-way) and not billed yet. Differences beyond the tolerance need approval.' : 'A supplier’s invoice. VAT is recoverable when the supplier has a VAT number and the line is standard-rated.'}
        actions={
          <Link to={id ? financeBillPath(id) : poId ? financePurchaseOrderPath(poId) : PATHS.financeBills} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Back
          </Link>
        }
      />
      <PageBody className="space-y-5">
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface p-4 md:grid-cols-2 xl:grid-cols-4">
          <Field id="bill-vendor" label="Supplier" required hint={fromPo ? 'From the purchase order' : undefined}>
            <SelectInput id="bill-vendor" aria-label="Supplier" value={vendorId} disabled={fromPo} onChange={(e) => {
              setVendorId(e.target.value)
              const s = m.suppliers.find((x) => x.id === e.target.value)
              if (s) setCurrency(s.currency)
            }}>
              <option value="">Choose a supplier…</option>
              {m.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              {fromPo && po.data && !m.suppliers.some((s) => s.id === po.data!.vendorId) && <option value={po.data.vendorId}>{po.data.vendorName}</option>}
            </SelectInput>
          </Field>
          <Field id="bill-ref" label="Supplier invoice number" required hint="Unique per supplier">
            <TextInput id="bill-ref" aria-label="Supplier invoice number" value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
          <Field id="bill-date" label="Bill date">
            <TextInput id="bill-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </Field>
          <Field id="bill-due" label="Due date" hint={`From the supplier's terms${supplier ? ` (${supplier.paymentTermsDays} days)` : ''} when empty`}>
            <TextInput id="bill-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field id="bill-currency" label="Currency">
            <SelectInput id="bill-currency" value={currency} disabled={fromPo} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([...m.currencies, currency])].filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}
            </SelectInput>
          </Field>
          {foreign && (
            <Field id="bill-rate" label={`Rate to ${m.baseCurrency}`} hint={metaRate ? `Default ${metaRate}` : 'No rate in Finance settings: enter one'}>
              <TextInput id="bill-rate" type="number" step="any" min="0" value={rate} placeholder={metaRate ? String(metaRate) : ''} onChange={(e) => setRate(e.target.value)} />
            </Field>
          )}
          <Field id="bill-notes" label="Notes" className="md:col-span-2 xl:col-span-4">
            <TextArea id="bill-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <LineEditor lines={lines} onChange={setLines} meta={m} currency={currency} defaultTaxId={defaultTax} />

        {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
        <div className="flex justify-end">
          <Button write loading={save.isPending} onClick={() => {
            setError(null)
            if (!fromPo && !vendorId) return setError('Choose a supplier.')
            if (!ref.trim()) return setError('Enter the supplier’s invoice number.')
            save.mutate(undefined, {
              onSuccess: (b) => {
                toast.success('Bill saved as a draft')
                navigate(financeBillPath(b.id))
              },
              onError: (e) => setError(errMsg(e)),
            })
          }}>Save draft</Button>
        </div>
      </PageBody>
    </>
  )
}
