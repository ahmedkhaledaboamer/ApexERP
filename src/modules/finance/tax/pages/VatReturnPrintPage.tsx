import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { useVatReturn } from '@/modules/finance/tax/api'
import { VAT_STATUS_LABEL } from '@/modules/finance/tax/types'
import { BoxesTable, layoutTitle } from '@/modules/finance/tax/components/VatReturnView'
import { Amount, fmtDate } from '@/modules/finance/ledger/components/bits'
import { FinError } from '@/modules/finance/collections/components/bits'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'

/** `/finance/tax/vat-returns/:id/print`: the return in the authority's layout, for the file or a reviewer. */
export default function VatReturnPrintPage() {
  const { id = '' } = useParams()
  const q = useVatReturn(id)
  const d = q.data
  return (
    <PageBody className="max-w-4xl">
      <PrintStyles orientation="portrait" margin="12mm" />
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Link to={`/finance/tax?return=${encodeURIComponent(id)}`} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Back to the return
        </Link>
        <Button variant="secondary" onClick={() => window.print()} disabled={!d}><Printer /> Print</Button>
      </div>
      {q.error ? (
        <FinError error={q.error as Error} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <Skeleton className="h-[28rem]" />
      ) : (
        <article aria-label={`${layoutTitle(d)} ${d.label}`} className="space-y-5 rounded-2xl border border-line bg-surface p-6 shadow-xs print:border-0 print:p-0 print:shadow-none sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
            <div className="text-[0.8125rem]">
              <p className="text-base font-semibold text-ink">{d.seller.legalName}</p>
              {d.seller.legalNameAr && <p dir="rtl" className="text-ink-2">{d.seller.legalNameAr}</p>}
              <p className="text-muted">{d.seller.address}</p>
              <p className="num text-muted">{d.layout === 'uae_vat201' ? 'TRN' : 'VAT number'} {d.seller.vatNumber || '—'}</p>
            </div>
            <div className="text-end text-[0.8125rem]">
              <h1 className="text-xl font-semibold tracking-tight text-ink">{layoutTitle(d)}</h1>
              <p className="font-medium text-ink">{d.label}</p>
              <p className="text-muted">{fmtDate(d.from)} – {fmtDate(d.to)} · due {fmtDate(d.dueDate)}</p>
              <p className="mt-1 font-semibold">{d.status === 'draft' ? 'DRAFT — not filed' : `${VAT_STATUS_LABEL[d.status]} · ref. ${d.filingReference} · ${fmtDate(d.filedDate)}`}</p>
            </div>
          </header>
          <BoxesTable d={d} compact />
          <p className="text-end text-sm">
            {d.totals.payable >= 0 ? 'Payable to the authority' : 'Credit carried forward'}: <Amount value={Math.abs(d.totals.payable)} currency={d.currency} strong />
            {d.totals.creditBroughtForward > 0 && <span className="block text-xs text-muted">after a credit brought forward of {d.totals.creditBroughtForward.toFixed(2)}</span>}
          </p>
          {!!d.warnings.length && <ul className="list-disc ps-5 text-xs text-muted">{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          <p className="text-xs text-muted">Prepared from the books by Apex CRM. Amounts in {d.currency}. Submit through the authority’s portal; this page is a working copy.</p>
        </article>
      )}
    </PageBody>
  )
}
