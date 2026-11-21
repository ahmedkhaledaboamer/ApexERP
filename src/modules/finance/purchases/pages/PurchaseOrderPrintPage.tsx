import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { usePurchaseOrder } from '@/modules/finance/purchases/api'
import { FinError, fmt2 } from '@/modules/finance/collections/components/bits'
import { CompanyBlock, fmtDay } from '@/modules/finance/purchases/components/bits'
import { financePurchaseOrderPath } from '@/app/paths'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'

/** `/finance/purchase-orders/:id/print`: the purchase order to send to the supplier. */
export default function PurchaseOrderPrintPage() {
  const { id = '' } = useParams()
  const q = usePurchaseOrder(id)
  const po = q.data
  const approvedBy = po?.approvals.filter((a) => a.decision === 'approved').map((a) => a.decidedByName).filter(Boolean) ?? []
  return (
    <PageBody className="max-w-3xl">
      <PrintStyles orientation="portrait" margin="14mm" />
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Link to={financePurchaseOrderPath(id)} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Back to the order
        </Link>
        <Button variant="secondary" onClick={() => window.print()} disabled={!po}><Printer /> Print</Button>
      </div>
      {q.error ? (
        <FinError error={q.error as Error} onRetry={() => void q.refetch()} />
      ) : !po ? (
        <Skeleton className="h-[28rem]" />
      ) : (
        <article aria-label={`Purchase order ${po.number}`} className="rounded-2xl border border-line bg-surface p-6 shadow-xs print:border-0 print:p-0 print:shadow-none sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
            <CompanyBlock company={po.company} />
            <div className="text-end">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">Purchase order</h1>
              <p className="num mt-1 text-[0.8125rem] font-medium text-ink">{po.number}</p>
              <p className="text-[0.8125rem] text-muted">Date {fmtDay(po.orderDate)}</p>
              {po.expectedDate && <p className="text-[0.8125rem] text-muted">Deliver by {fmtDay(po.expectedDate)}</p>}
              {(po.status === 'draft' || po.status === 'pending_approval' || po.status === 'rejected') && <p className="mt-1 text-sm font-semibold text-warning-600">NOT APPROVED</p>}
              {po.status === 'cancelled' && <p className="mt-1 text-sm font-semibold text-danger-600">CANCELLED</p>}
            </div>
          </header>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line py-5 text-[0.8125rem]">
            <div>
              <dt className="text-xs text-muted">Supplier</dt>
              <dd className="mt-0.5 font-medium text-ink">{po.vendorName}</dd>
              {po.vendorVatNumber && <dd className="text-xs text-muted">VAT no. {po.vendorVatNumber}</dd>}
              {po.vendorEmail && <dd className="text-xs text-muted">{po.vendorEmail}</dd>}
            </div>
            <div className="text-end">
              <dt className="text-xs text-muted">Deliver to</dt>
              <dd className="mt-0.5 text-ink">{po.deliveryAddress || po.company.address || '—'}</dd>
              <dd className="text-xs text-muted">Requested by {po.requesterName}{po.departmentName ? ` · ${po.departmentName}` : ''}</dd>
            </div>
          </dl>
          <table className="my-5 w-full text-[0.8125rem]" aria-label="Lines">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1.5 text-start font-medium">Description</th>
                <th className="py-1.5 text-end font-medium">Qty</th>
                <th className="py-1.5 text-end font-medium">Unit price</th>
                <th className="py-1.5 text-end font-medium">VAT</th>
                <th className="py-1.5 text-end font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5">{l.description}</td>
                  <td className="num py-1.5 text-end">{l.quantity}</td>
                  <td className="num py-1.5 text-end">{fmt2(l.unitPrice)}</td>
                  <td className="num py-1.5 text-end">{fmt2(l.taxAmount)}</td>
                  <td className="num py-1.5 text-end">{fmt2(l.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4} className="pt-3 text-end text-muted">Subtotal</td><td className="num pt-3 text-end">{fmt2(po.subtotal)}</td></tr>
              <tr><td colSpan={4} className="text-end text-muted">VAT</td><td className="num text-end">{fmt2(po.taxTotal)}</td></tr>
              <tr className="font-semibold"><td colSpan={4} className="py-2 text-end">Total</td><td className="num py-2 text-end">{po.currency} {fmt2(po.total)}</td></tr>
            </tfoot>
          </table>
          {po.notes && <p className="border-t border-line pt-4 text-[0.8125rem] text-ink-2">{po.notes}</p>}
          <footer className="mt-6 flex flex-wrap items-end justify-between gap-6 border-t border-line pt-4 text-xs text-muted">
            <span>Approved by: {approvedBy.length ? approvedBy.join(', ') : '—'}</span>
            <span>Please quote <span className="num font-medium text-ink">{po.number}</span> on your invoice.</span>
          </footer>
        </article>
      )}
    </PageBody>
  )
}
