import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import { purchasesApi, usePurchaseOrder, usePurchasesMeta, usePurchasesMutation, usePurchasesScope } from '@/modules/finance/purchases/api'
import type { PoInput } from '@/modules/finance/purchases/types'
import { FinError, errMsg } from '@/modules/finance/collections/components/bits'
import { LineEditor, draftFrom, newLine, toInputs, type LineDraft } from '@/modules/finance/purchases/components/LineEditor'
import { PATHS, financePurchaseOrderPath } from '@/app/paths'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

/**
 * `/finance/purchase-orders/new` and `/:id/edit`: a purchase request. Everyone requests for their own department; the
 * finance team may pick any department. "Save and submit" sends it into the approval chain.
 */
export default function PurchaseOrderEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { canWrite } = usePurchasesScope()
  const meta = usePurchasesMeta()
  const existing = usePurchaseOrder(id ?? null)
  const m = meta.data
  const [vendorId, setVendorId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [currency, setCurrency] = useState('')
  const [rate, setRate] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [advancePct, setAdvancePct] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([newLine()])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loaded) return
    if (id && existing.data) {
      const p = existing.data
      setVendorId(p.vendorId)
      setDepartmentId(p.departmentId ?? '')
      setOrderDate(p.orderDate)
      setExpectedDate(p.expectedDate ?? '')
      setCurrency(p.currency)
      setRate(p.currency === m?.baseCurrency ? '' : String(p.exchangeRate))
      setDeliveryAddress(p.deliveryAddress)
      setNotes(p.notes)
      setAdvancePct(p.advancePct ? String(p.advancePct) : '')
      setLines(p.lines.map((l) => draftFrom(l)))
      setLoaded(true)
    } else if (!id && m) {
      setOrderDate(m.today)
      setCurrency(m.baseCurrency)
      setDepartmentId(m.myDepartmentId ?? '')
      setLoaded(true)
    }
  }, [id, existing.data, m, loaded])

  const supplier = m?.suppliers.find((s) => s.id === vendorId)
  const standard = m?.taxCodes.find((t) => t.category === 'standard')?.id ?? ''
  const defaultTax = supplier?.defaultTaxCodeId ?? (supplier?.vatNumber ? standard : 'OOS')
  const foreign = !!m && currency !== m.baseCurrency
  const metaRate = m?.rates.find((r) => r.currency === currency)?.rate ?? null
  const myDept = useMemo(() => m?.departments.find((d) => d.id === m.myDepartmentId)?.name ?? 'No department', [m])

  const save = usePurchasesMutation(async (submit: boolean) => {
    const input: PoInput = {
      vendorId,
      ...(canWrite ? { departmentId: departmentId || null } : {}),
      orderDate,
      expectedDate: expectedDate || null,
      currency,
      exchangeRate: foreign && rate ? Number(rate) : null,
      deliveryAddress,
      notes,
      advancePct: advancePct ? Number(advancePct) : null,
      lines: toInputs(lines),
    }
    let po = id ? await purchasesApi.updatePo(id, input) : await purchasesApi.createPo(input)
    if (submit) po = await purchasesApi.poAction(po.id, 'submit')
    return po
  })
  const go = (submit: boolean) => {
    setError(null)
    if (!vendorId) return setError('Choose a supplier.')
    save.mutate(submit, {
      onSuccess: (po) => {
        toast.success(submit ? (po.status === 'approved' ? 'Request approved (no approval needed)' : 'Request submitted for approval') : 'Draft saved')
        navigate(financePurchaseOrderPath(po.id))
      },
      onError: (e) => setError(errMsg(e)),
    })
  }

  if (meta.error) return <PageBody><FinError error={meta.error as Error} onRetry={() => void meta.refetch()} /></PageBody>
  if (existing.error) return <PageBody><FinError error={existing.error as Error} onRetry={() => void existing.refetch()} /></PageBody>
  if (!m || (id && !existing.data)) return <PageBody><Skeleton className="h-96" /></PageBody>
  if (existing.data && !existing.data.can.edit) {
    return (
      <PageBody>
        <p className="text-[0.8125rem] text-muted">This order can’t be edited any more. <Link className="text-brand-700 hover:underline dark:text-brand-300" to={financePurchaseOrderPath(existing.data.id)}>Back to the order</Link></p>
      </PageBody>
    )
  }

  return (
    <>
      <PageHeader
        icon={<IconTile><ClipboardList /></IconTile>}
        title={id ? `Edit ${existing.data?.number ?? ''}` : 'New purchase request'}
        description="The approval chain depends on the total in base currency (Finance settings › Approval rules)."
        actions={
          <Link to={id ? financePurchaseOrderPath(id) : PATHS.financePurchaseOrders} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Back
          </Link>
        }
      />
      <PageBody className="space-y-5">
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface p-4 md:grid-cols-2 xl:grid-cols-4">
          <Field id="po-vendor" label="Supplier" required>
            <SelectInput id="po-vendor" aria-label="Supplier" value={vendorId} onChange={(e) => {
              setVendorId(e.target.value)
              const s = m.suppliers.find((x) => x.id === e.target.value)
              if (s && !id) setCurrency(s.currency)
            }}>
              <option value="">Choose a supplier…</option>
              {m.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="po-dept" label="Department" hint={canWrite ? undefined : 'You request for your own department'}>
            {canWrite ? (
              <SelectInput id="po-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">No department</option>
                {m.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </SelectInput>
            ) : (
              <TextInput id="po-dept" value={myDept} readOnly disabled />
            )}
          </Field>
          <Field id="po-date" label="Order date">
            <TextInput id="po-date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </Field>
          <Field id="po-expected" label="Expected by">
            <TextInput id="po-expected" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
          <Field id="po-currency" label="Currency">
            <SelectInput id="po-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {m.currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </SelectInput>
          </Field>
          {foreign && (
            <Field id="po-rate" label={`Rate to ${m.baseCurrency}`} hint={metaRate ? `Default ${metaRate}` : 'No rate in Finance settings: enter one'}>
              <TextInput id="po-rate" type="number" step="any" min="0" value={rate} placeholder={metaRate ? String(metaRate) : ''} onChange={(e) => setRate(e.target.value)} />
            </Field>
          )}
          <Field id="po-advance" label="Advance on approval (%)" hint="e.g. 30 when the supplier asks for an advance; finance pays it once approved">
            <TextInput id="po-advance" type="number" min="0" max="100" step="1" value={advancePct} onChange={(e) => setAdvancePct(e.target.value)} />
          </Field>
          <Field id="po-address" label="Delivery address" className="md:col-span-2">
            <TextInput id="po-address" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
          </Field>
          <Field id="po-notes" label="Notes / justification" className="md:col-span-2 xl:col-span-4">
            <TextArea id="po-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <LineEditor lines={lines} onChange={setLines} meta={m} currency={currency} defaultTaxId={defaultTax} />

        {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" write loading={save.isPending && save.variables === false} onClick={() => go(false)}>Save draft</Button>
          <Button write loading={save.isPending && save.variables === true} onClick={() => go(true)}>Save and submit</Button>
        </div>
      </PageBody>
    </>
  )
}
