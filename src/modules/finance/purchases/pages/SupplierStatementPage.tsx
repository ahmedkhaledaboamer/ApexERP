import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { useSupplierStatement } from '@/modules/finance/purchases/api'
import { FinError, fmt2 } from '@/modules/finance/collections/components/bits'
import { CompanyBlock, fmtDay } from '@/modules/finance/purchases/components/bits'
import { PATHS } from '@/app/paths'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { TextInput } from '@/shared/components/form/Field'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'

const TYPE_LABEL = { bill: 'Bill', payment: 'Payment', debit_note: 'Debit note', void: 'Void', advance: 'Advance', advance_applied: 'Advance applied', advance_refund: 'Advance refund' } as const

/** `/finance/suppliers/:id/statement?from=&to=`: printable supplier statement in base currency. */
export default function SupplierStatementPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const from = params.get('from') ?? undefined
  const to = params.get('to') ?? undefined
  const q = useSupplierStatement(id, from, to)
  const s = q.data
  const set = (k: string, v: string) => setParams((p) => {
    const n = new URLSearchParams(p)
    if (v) n.set(k, v)
    else n.delete(k)
    return n
  })
  return (
    <PageBody className="max-w-4xl">
      <PrintStyles orientation="portrait" margin="14mm" />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2 print:hidden">
        <Link to={`${PATHS.financeSuppliers}?supplier=${encodeURIComponent(id)}`} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Suppliers
        </Link>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-muted">From<TextInput type="date" aria-label="From" className="w-40" value={from ?? s?.from ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
          <label className="flex flex-col text-xs text-muted">To<TextInput type="date" aria-label="To" className="w-40" value={to ?? s?.to ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
          <Button variant="secondary" onClick={() => window.print()} disabled={!s}><Printer /> Print</Button>
        </div>
      </div>
      {q.error ? (
        <FinError error={q.error as Error} onRetry={() => void q.refetch()} />
      ) : !s ? (
        <Skeleton className="h-[28rem]" />
      ) : (
        <article aria-label={`Statement ${s.vendorName}`} className="rounded-2xl border border-line bg-surface p-6 shadow-xs print:border-0 print:p-0 print:shadow-none sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
            <CompanyBlock company={s.company} />
            <div className="text-end">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">Supplier statement</h1>
              <p className="mt-1 font-medium text-ink">{s.vendorName}</p>
              {s.vendorVatNumber && <p className="text-xs text-muted">VAT no. {s.vendorVatNumber}</p>}
              <p className="text-[0.8125rem] text-muted">{fmtDay(s.from)} – {fmtDay(s.to)} · {s.baseCurrency}</p>
            </div>
          </header>
          <table className="my-5 w-full text-[0.8125rem]" aria-label="Statement lines">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1.5 text-start font-medium">Date</th>
                <th className="py-1.5 text-start font-medium">Type</th>
                <th className="py-1.5 text-start font-medium">Reference</th>
                <th className="py-1.5 text-start font-medium">Description</th>
                <th className="py-1.5 text-end font-medium">Paid / credited</th>
                <th className="py-1.5 text-end font-medium">Billed</th>
                <th className="py-1.5 text-end font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr><td className="py-1.5" colSpan={6}>Opening balance</td><td className="num py-1.5 text-end">{fmt2(s.openingBalance)}</td></tr>
              {s.lines.map((l, i) => (
                <tr key={`${l.reference}-${i}`}>
                  <td className="num py-1.5">{fmtDay(l.date)}</td>
                  <td className="py-1.5">{TYPE_LABEL[l.type]}</td>
                  <td className="num py-1.5">{l.reference}</td>
                  <td className="py-1.5">{l.description}</td>
                  <td className="num py-1.5 text-end">{l.debit ? fmt2(l.debit) : ''}</td>
                  <td className="num py-1.5 text-end">{l.credit ? fmt2(l.credit) : ''}</td>
                  <td className="num py-1.5 text-end">{fmt2(l.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-line-strong font-semibold"><td className="py-2" colSpan={6}>Closing balance (we owe)</td><td className="num py-2 text-end">{s.baseCurrency} {fmt2(s.closingBalance)}</td></tr></tfoot>
          </table>
        </article>
      )}
    </PageBody>
  )
}
