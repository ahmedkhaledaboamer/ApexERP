import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { useStatement } from '@/modules/finance/collections/api'
import { FinError, fmt2 } from '@/modules/finance/collections/components/bits'
import { StatementTable } from '@/modules/finance/collections/components/ReceivablesTabs'
import { PATHS } from '@/app/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'

/** `/finance/receivables/statements/:id?from=&to=`: a customer's printable statement of account. */
export default function StatementPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const q = useStatement(id, params.get('from') ?? undefined, params.get('to') ?? undefined)
  const s = q.data
  return (
    <PageBody className="max-w-4xl">
      <PrintStyles orientation="portrait" margin="14mm" />
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Link to={`${PATHS.financeReceivables}?tab=statements&customer=${encodeURIComponent(id)}`} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Receivables
        </Link>
        <Button variant="secondary" onClick={() => window.print()} disabled={!s}><Printer /> Print</Button>
      </div>
      {q.error ? (
        <FinError error={q.error} onRetry={() => q.refetch()} />
      ) : !s ? (
        <Skeleton className="h-[28rem]" />
      ) : (
        <article aria-label={`Statement of ${s.customerName}`} className="space-y-5 rounded-2xl border border-line bg-surface p-6 shadow-xs print:border-0 print:p-0 print:shadow-none sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
            <div className="flex items-start gap-3">
              {s.company.logoUrl ? <img src={s.company.logoUrl} alt="" className="h-12 w-auto max-w-40 object-contain" /> : <span className="grid size-12 place-items-center rounded-xl bg-brand-600 text-sm font-semibold text-white">{s.company.monogram}</span>}
              <div>
                <p className="font-semibold text-ink">{s.company.name}</p>
                {s.company.addressLines.map((l) => <p key={l} className="text-xs text-muted">{l}</p>)}
              </div>
            </div>
            <div className="text-end">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">Statement of account</h1>
              <p className="text-[0.8125rem] text-muted">{fmtDate(s.from)} – {fmtDate(s.to)}</p>
            </div>
          </header>
          <div className="flex flex-wrap justify-between gap-4 text-[0.8125rem]">
            <div><p className="text-xs text-muted">Customer</p><p className="font-medium text-ink">{s.customerName}</p>{s.customerAddress && <p className="text-xs text-muted">{s.customerAddress}</p>}</div>
            <div className="text-end"><p className="text-xs text-muted">Balance due ({s.baseCurrency})</p><p className="num text-2xl font-semibold text-ink">{fmt2(s.closingBalance)}</p></div>
          </div>
          <StatementTable s={s} />
          {s.pdcHeld > 0 && <p className="text-xs text-muted">Cheques held, not yet cleared: {s.baseCurrency} {fmt2(s.pdcHeld)}. They count once they clear.</p>}
        </article>
      )}
    </PageBody>
  )
}
