import { Fragment, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { QuotationItem, QuotationStatus } from '@/modules/quotations/types'
import { COMPANY } from '@/modules/quotations/lib/company'
import { computeTotals, fmtAed, lineTotal, unitLabel } from '@/modules/quotations/lib/totals'
import { LOGO_URL } from '@/shared/lib/constants'
import { cn, fmtDate } from '@/shared/lib/utils'

/** Everything the printed quotation needs; built from the saved quotation or the live form. */
export interface QuotationDocumentData {
  number: string | null
  title: string
  status: QuotationStatus
  company: string
  contactName: string
  contactEmail: string
  issuedAt: string
  validUntil: string
  items: Omit<QuotationItem, 'id'>[]
  vatPct: number
  notes: string
  terms: string
  preparedBy: string
}

const fmtQty = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)

/**
 * The quotation as a clean A4 page (Stripe-invoice style). Colours are fixed, not themed:
 * paper stays white in dark mode and prints the same.
 */
export function QuotationDocument({ data, className }: { data: QuotationDocumentData; className?: string }) {
  const totals = computeTotals(data.items, data.vatPct)
  const draft = data.status === 'Draft'

  return (
    <article
      className={cn(
        'quotation-paper relative mx-auto w-full max-w-[210mm] bg-white px-6 py-8 text-[0.8125rem] leading-relaxed text-zinc-800 sm:min-h-[297mm] sm:px-[16mm] sm:py-[14mm]',
        className,
      )}
    >
      {draft && (
        <span className="absolute top-6 right-6 rounded border border-zinc-300 px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase print:top-0 print:right-0">
          Draft
        </span>
      )}

      {/* Letterhead */}
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-3">
          <img src={LOGO_URL} alt="" className="size-11 rounded-lg object-contain" />
          <div>
            <p className="text-[0.9375rem] font-semibold text-zinc-900">{COMPANY.name}</p>
            <p className="text-xs text-zinc-500">{COMPANY.website}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[1.375rem] font-semibold tracking-[-0.01em] text-zinc-900">Quotation</p>
          <p className="num font-mono text-xs text-zinc-500">{data.number ?? 'Not saved yet'}</p>
        </div>
      </header>

      {/* Parties and dates */}
      <section className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div>
          <p className="text-[0.6875rem] font-medium tracking-wide text-zinc-400 uppercase">Prepared for</p>
          <p className="mt-1.5 font-semibold text-zinc-900">{data.company || 'Select a lead'}</p>
          {data.contactName && <p>{data.contactName}</p>}
          {data.contactEmail && <p className="text-zinc-500">{data.contactEmail}</p>}
        </div>
        <div>
          <p className="text-[0.6875rem] font-medium tracking-wide text-zinc-400 uppercase">From</p>
          <p className="mt-1.5 font-semibold text-zinc-900">{COMPANY.name}</p>
          {COMPANY.addressLines.map((l) => (
            <p key={l}>{l}</p>
          ))}
          <p className="text-zinc-500">{COMPANY.email}</p>
          {COMPANY.trn && <p className="text-zinc-500">TRN {COMPANY.trn}</p>}
        </div>
        <dl className="num grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1.5 sm:justify-self-end">
          <dt className="text-zinc-400">Issued</dt>
          <dd className="text-right text-zinc-900">{fmtDate(data.issuedAt)}</dd>
          <dt className="text-zinc-400">Valid until</dt>
          <dd className="text-right font-medium text-zinc-900">{data.validUntil ? fmtDate(data.validUntil) : '—'}</dd>
          <dt className="text-zinc-400">Prepared by</dt>
          <dd className="text-right text-zinc-900">{data.preparedBy}</dd>
        </dl>
      </section>

      {/* Amount banner */}
      <section className="mt-8 rounded-lg bg-zinc-50 px-5 py-4 print:border print:border-zinc-200 print:bg-white">
        <p className="text-[0.9375rem] font-semibold text-zinc-900">{data.title || 'Untitled quotation'}</p>
        <p className="mt-0.5 text-zinc-500">
          <span className="num font-semibold text-zinc-900">{fmtAed(totals.total)}</span>
          {data.validUntil && <> due on acceptance, valid until {fmtDate(data.validUntil)}</>}
        </p>
      </section>

      {/* Items */}
      <table className="mt-8 w-full border-collapse">
        <thead>
          <tr className="border-b border-zinc-200 text-[0.6875rem] tracking-wide text-zinc-400 uppercase">
            <th className="py-2 pr-3 text-left font-medium">Description</th>
            <th className="px-3 py-2 text-right font-medium">Qty</th>
            <th className="hidden px-3 py-2 text-right font-medium sm:table-cell print:table-cell">Unit price</th>
            <th className="hidden px-3 py-2 text-right font-medium sm:table-cell print:table-cell">Disc.</th>
            <th className="py-2 pl-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.items.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-zinc-400">
                No line items yet.
              </td>
            </tr>
          ) : (
            data.items.map((it, i) => (
              <Fragment key={i}>
              {it.groupId && data.items[i - 1]?.groupId !== it.groupId && (
                <tr className="break-inside-avoid">
                  <td colSpan={5} className="pt-4 pb-1 text-xs font-semibold text-zinc-700">
                    Package: {it.groupLabel || 'Package'}
                  </td>
                </tr>
              )}
              <tr className="border-b border-zinc-100 align-top break-inside-avoid">
                <td className="py-3 pr-3">
                  <p className="font-medium text-zinc-900">{it.description || 'Untitled line'}</p>
                  <p className="text-xs text-zinc-500 sm:hidden print:hidden">
                    {fmtAed(it.unitPrice)} / {unitLabel(it.unit, 1)}
                    {it.discountPct > 0 && ` · ${fmtQty(it.discountPct)}% off`}
                  </p>
                </td>
                <td className="num px-3 py-3 text-right whitespace-nowrap">
                  {fmtQty(it.quantity)} <span className="text-zinc-500">{unitLabel(it.unit, it.quantity)}</span>
                </td>
                <td className="num hidden px-3 py-3 text-right whitespace-nowrap sm:table-cell print:table-cell">{fmtAed(it.unitPrice)}</td>
                <td className="num hidden px-3 py-3 text-right whitespace-nowrap text-zinc-500 sm:table-cell print:table-cell">
                  {it.discountPct > 0 ? `${fmtQty(it.discountPct)}%` : '—'}
                </td>
                <td className="num py-3 pl-3 text-right font-medium whitespace-nowrap text-zinc-900">{fmtAed(lineTotal(it))}</td>
              </tr>
              </Fragment>
            ))

          )}
        </tbody>
      </table>

      {/* Totals */}
      <section className="mt-6 flex justify-end break-inside-avoid">
        <dl className="num grid w-full max-w-72 grid-cols-[1fr_auto] gap-x-6 gap-y-2">
          <dt className="text-zinc-500">Subtotal</dt>
          <dd className="text-right">{fmtAed(totals.subtotal)}</dd>
          {totals.discount > 0 && (
            <>
              <dt className="text-zinc-500">Discount</dt>
              <dd className="text-right">−{fmtAed(totals.discount)}</dd>
            </>
          )}
          <dt className="text-zinc-500">VAT ({fmtQty(data.vatPct)}%)</dt>
          <dd className="text-right">{fmtAed(totals.vat)}</dd>
          <dt className="border-t border-zinc-200 pt-2.5 font-semibold text-zinc-900">Total</dt>
          <dd className="border-t border-zinc-200 pt-2.5 text-right text-[0.9375rem] font-semibold text-zinc-900">{fmtAed(totals.total)}</dd>
        </dl>
      </section>

      {(data.notes || data.terms) && (
        <section className="mt-10 grid grid-cols-1 gap-6 border-t border-zinc-200 pt-6 break-inside-avoid sm:grid-cols-2 print:grid-cols-2">
          {data.notes && (
            <div>
              <p className="text-[0.6875rem] font-medium tracking-wide text-zinc-400 uppercase">Notes</p>
              <p className="mt-1.5 whitespace-pre-line">{data.notes}</p>
            </div>
          )}
          {data.terms && (
            <div>
              <p className="text-[0.6875rem] font-medium tracking-wide text-zinc-400 uppercase">Terms</p>
              <p className="mt-1.5 whitespace-pre-line text-zinc-600">{data.terms}</p>
            </div>
          )}
        </section>
      )}

      <footer className="mt-12 border-t border-zinc-100 pt-4 text-center text-[0.6875rem] text-zinc-400">
        {COMPANY.name} · {COMPANY.addressLines.join(', ')} · {COMPANY.email}
        {data.validUntil && <> · This quotation is valid until {fmtDate(data.validUntil)}.</>}
      </footer>
    </article>
  )
}

const PRINT_CSS = `
.quotation-print-root { display: none; }
@media print {
  @page { size: A4; margin: 14mm 14mm 16mm; }
  html, body { background: #fff !important; height: auto !important; }
  body > *:not(.quotation-print-root) { display: none !important; }
  .quotation-print-root { display: block !important; }
  .quotation-print-root .quotation-paper { max-width: none; min-height: 0; padding: 0 !important; box-shadow: none; }
  .quotation-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`

/**
 * A copy of the document attached to <body> that only shows when printing, so
 * `window.print()` gives a clean PDF from any tab. Removed on unmount.
 */
export function QuotationPrintPortal({ data }: { data: QuotationDocumentData }) {
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const el = document.createElement('div')
    el.className = 'quotation-print-root'
    document.body.appendChild(el)
    setHost(el)
    return () => {
      el.remove()
    }
  }, [])

  return (
    <>
      <style>{PRINT_CSS}</style>
      {host && createPortal(<QuotationDocument data={data} />, host)}
    </>
  )
}
