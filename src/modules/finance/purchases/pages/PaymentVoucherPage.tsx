import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { BILL_PAYMENT_METHOD_LABEL } from '@/modules/finance/purchases/types'
import { useBillPayment, usePurchasesMeta } from '@/modules/finance/purchases/api'
import { FinError, fmt2 } from '@/modules/finance/collections/components/bits'
import { CompanyBlock, fmtDay } from '@/modules/finance/purchases/components/bits'
import { PATHS } from '@/app/paths'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'

/** `/finance/bill-payments/:id/voucher`: the printable payment voucher of a supplier payment. */
export default function PaymentVoucherPage() {
  const { id = '' } = useParams()
  const q = useBillPayment(id)
  const meta = usePurchasesMeta()
  const p = q.data
  const base = meta.data?.baseCurrency ?? ''
  return (
    <PageBody className="max-w-3xl">
      <PrintStyles orientation="portrait" margin="14mm" />
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Link to={`${PATHS.financeBills}?tab=payments`} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Bill payments
        </Link>
        <Button variant="secondary" onClick={() => window.print()} disabled={!p}><Printer /> Print</Button>
      </div>
      {q.error ? (
        <FinError error={q.error as Error} onRetry={() => void q.refetch()} />
      ) : !p ? (
        <Skeleton className="h-[28rem]" />
      ) : (
        <article aria-label={`Payment voucher ${p.number}`} className="relative rounded-2xl border border-line bg-surface p-6 shadow-xs print:border-0 print:p-0 print:shadow-none sm:p-8">
          {p.status === 'void' && (
            <span className="pointer-events-none absolute inset-0 grid place-items-center text-7xl font-bold tracking-widest text-danger-600/20" aria-hidden>VOID</span>
          )}
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
            <CompanyBlock company={p.company} />
            <div className="text-end">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">Payment voucher</h1>
              <p className="num mt-1 text-[0.8125rem] font-medium text-ink">{p.number}</p>
              <p className="text-[0.8125rem] text-muted">{fmtDay(p.date)}</p>
              {p.status === 'void' && <p className="mt-1 text-sm font-semibold text-danger-600">VOID{p.voidReason ? `: ${p.voidReason}` : ''}</p>}
            </div>
          </header>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line py-5 text-[0.8125rem]">
            <div>
              <dt className="text-xs text-muted">Paid to</dt>
              <dd className="mt-0.5 font-medium text-ink">{p.vendorName}</dd>
              {(p.vendorBankName || p.vendorIbanMasked) && <dd className="text-xs text-muted">{p.vendorBankName}{p.vendorIbanMasked ? ` · IBAN ${p.vendorIbanMasked}` : ''}</dd>}
            </div>
            <div className="text-end">
              <dt className="text-xs text-muted">Amount paid</dt>
              <dd className="num mt-0.5 text-2xl font-semibold text-ink">{p.currency} {fmt2(p.amount)}</dd>
              {p.currency !== base && base && <dd className="num text-xs text-muted">{base} {fmt2(p.baseAmount)} at {p.exchangeRate}</dd>}
            </div>
            <div><dt className="text-xs text-muted">Method</dt><dd className="mt-0.5 text-ink">{BILL_PAYMENT_METHOD_LABEL[p.method]}</dd></div>
            <div className="text-end"><dt className="text-xs text-muted">Reference</dt><dd className="mt-0.5 text-ink">{p.reference || '—'}</dd></div>
            <div><dt className="text-xs text-muted">Paid from</dt><dd className="mt-0.5 text-ink">{p.paymentAccountName}</dd></div>
            <div className="text-end">
              <dt className="text-xs text-muted">Bank charges · FX difference ({base})</dt>
              <dd className="num mt-0.5 text-ink">{fmt2(p.bankCharges)} · {fmt2(p.fxDifference)}</dd>
            </div>
          </dl>
          <table className="my-5 w-full text-[0.8125rem]" aria-label="Bills paid">
            <thead className="text-xs text-muted">
              <tr><th className="py-1.5 text-start font-medium">Bill</th><th className="py-1.5 text-start font-medium">Supplier invoice</th><th className="py-1.5 text-end font-medium">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.allocations.map((a) => (
                <tr key={a.billId}><td className="num py-1.5">{a.billNumber}</td><td className="py-1.5">{a.supplierInvoiceNumber}</td><td className="num py-1.5 text-end">{fmt2(a.amount)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-line-strong font-semibold"><td className="py-2" colSpan={2}>Total</td><td className="num py-2 text-end">{p.currency} {fmt2(p.amount)}</td></tr></tfoot>
          </table>
          {p.notes && <p className="text-[0.8125rem] text-ink-2">{p.notes}</p>}
          <footer className="mt-10 grid grid-cols-3 gap-6 text-xs text-muted">
            <div className="border-t border-line pt-2">Prepared by<span className="block text-ink">{p.createdByName}</span></div>
            <div className="border-t border-line pt-2">Approved by</div>
            <div className="border-t border-line pt-2">Received by</div>
          </footer>
        </article>
      )}
    </PageBody>
  )
}
