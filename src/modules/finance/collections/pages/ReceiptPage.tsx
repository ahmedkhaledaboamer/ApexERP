import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { PAYMENT_METHOD_LABEL } from '@/modules/finance/collections/types'
import { useReceipt } from '@/modules/finance/collections/api'
import { FinError, fmt2 } from '@/modules/finance/collections/components/bits'
import { PATHS } from '@/app/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'

/** `/finance/payments/:id/receipt`: the printable receipt (company branding, receipt number, allocations). */
export default function ReceiptPage() {
  const { id = '' } = useParams()
  const q = useReceipt(id)
  const r = q.data
  const p = r?.payment
  return (
    <PageBody className="max-w-3xl">
      <PrintStyles orientation="portrait" margin="14mm" />
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Link to={`${PATHS.financePayments}?payment=${encodeURIComponent(id)}`} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Payments
        </Link>
        <Button variant="secondary" onClick={() => window.print()} disabled={!r}>
          <Printer /> Print
        </Button>
      </div>
      {q.error ? (
        <FinError error={q.error} onRetry={() => q.refetch()} />
      ) : !r || !p ? (
        <Skeleton className="h-[28rem]" />
      ) : (
        <article aria-label={`Receipt ${p.number}`} className="rounded-2xl border border-line bg-surface p-6 shadow-xs print:border-0 print:p-0 print:shadow-none sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
            <div className="flex items-start gap-3">
              {r.company.logoUrl ? (
                <img src={r.company.logoUrl} alt="" className="h-12 w-auto max-w-40 object-contain" />
              ) : (
                <span className="grid size-12 place-items-center rounded-xl bg-brand-600 text-sm font-semibold text-white">{r.company.monogram}</span>
              )}
              <div>
                <p className="font-semibold text-ink">{r.company.legalName || r.company.name}</p>
                {r.company.addressLines.map((l) => <p key={l} className="text-xs text-muted">{l}</p>)}
                {r.company.taxNumber && <p className="text-xs text-muted">{r.company.taxLabel} {r.company.taxNumber}</p>}
              </div>
            </div>
            <div className="text-end">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">Receipt</h1>
              <p className="num mt-1 text-[0.8125rem] font-medium text-ink">{p.number}</p>
              <p className="text-[0.8125rem] text-muted">{fmtDate(p.date)}</p>
              {p.status === 'void' && <p className="mt-1 text-sm font-semibold text-danger-600">VOID</p>}
            </div>
          </header>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line py-5 text-[0.8125rem]">
            <div><dt className="text-xs text-muted">Received from</dt><dd className="mt-0.5 font-medium text-ink">{r.customer.name}</dd>{r.customer.address && <dd className="text-xs text-muted">{r.customer.address}</dd>}</div>
            <div className="text-end"><dt className="text-xs text-muted">Amount received</dt><dd className="num mt-0.5 text-2xl font-semibold text-ink">{p.currency} {fmt2(p.amount)}</dd></div>
            <div><dt className="text-xs text-muted">Payment method</dt><dd className="mt-0.5 text-ink">{PAYMENT_METHOD_LABEL[p.method]}{p.cardHint ? ` · ${p.cardHint}` : ''}</dd></div>
            <div className="text-end"><dt className="text-xs text-muted">Reference</dt><dd className="mt-0.5 text-ink">{p.reference || '—'}</dd></div>
          </dl>
          <table className="my-5 w-full text-[0.8125rem]" aria-label="Applied to">
            <thead className="text-xs text-muted">
              <tr><th className="py-1.5 text-start font-medium">Applied to</th><th className="py-1.5 text-end font-medium">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.allocations.filter((a) => !a.reversedOn).map((a) => (
                <tr key={a.id}><td className="num py-1.5">{a.invoiceNumber}{a.kind === 'credit' ? ' (credit applied)' : ''}</td><td className="num py-1.5 text-end">{fmt2(a.amount)}</td></tr>
              ))}
              {p.unallocated > 0 && <tr><td className="py-1.5">Customer credit (unallocated)</td><td className="num py-1.5 text-end">{fmt2(p.unallocated)}</td></tr>}
              {p.refunded > 0 && <tr><td className="py-1.5">Refunded</td><td className="num py-1.5 text-end">{fmt2(p.refunded)}</td></tr>}
            </tbody>
            <tfoot><tr className="border-t-2 border-line-strong font-semibold"><td className="py-2">Total</td><td className="num py-2 text-end">{p.currency} {fmt2(p.amount)}</td></tr></tfoot>
          </table>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-muted">
            <span>Thank you for your payment.{r.company.email ? ` ${r.company.email}` : ''}{r.company.phone ? ` · ${r.company.phone}` : ''}</span>
            <span className="num">{p.id}</span>
          </footer>
        </article>
      )}
    </PageBody>
  )
}
