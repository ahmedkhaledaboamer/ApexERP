import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { QuotationItem, QuotationStatus } from '@/modules/quotations/types'
import { issuerAddress, issuerFor, type Issuer } from '@/modules/quotations/lib/company'
import { computeTotals, fmtAmount, lineTotal, unitLabel } from '@/modules/quotations/lib/totals'
import { useTenant } from '@/modules/tenancy/hooks'
import { TenantLogo } from '@/modules/tenancy/components/TenantLogo'
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
  /** ISO currency of the quotation; the tenant currency when missing. */
  currency?: string | null
}

const fmtQty = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)

/**
 * The quotation as a clean A4 page (Stripe-invoice style). Colours are fixed, not themed:
 * paper stays white in dark mode and prints the same.
 */
export function QuotationDocument({ data, className, issuer: issuerOverride }: { data: QuotationDocumentData; className?: string; issuer?: Issuer }) {
  const totals = computeTotals(data.items, data.vatPct)
  const draft = data.status === 'Draft'
  const tenant = useTenant()
  const issuer = issuerOverride ?? issuerFor(tenant)
  const fmtAed = (v: number) => fmtAmount(v, data.currency)

  return (
    <article
      className={cn(
        'quotation-paper relative mx-auto w-full max-w-[210mm] bg-white px-6 py-8 text-[0.8125rem] leading-relaxed text-zinc-800 sm:min-h-[297mm] sm:px-[16mm] sm:py-[14mm]',
        className,
      )}
    >
      {draft && (
        <span className="absolute top-6 end-6 rounded border border-zinc-300 px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase print:top-0 print:end-0">
          Draft
        </span>
      )}

      {/* Letterhead */}
      <QuotationLetterhead issuer={issuer} number={data.number ?? 'Not saved yet'} />

      {/* Parties and dates */}
      <section className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div>
          <p className="text-[0.6875rem] font-medium tracking-wide text-zinc-400 uppercase">Prepared for</p>
          <p className="mt-1.5 font-semibold text-zinc-900">{data.company || 'Select a lead'}</p>
          {data.contactName && <p>{data.contactName}</p>}
          {data.contactEmail && <p className="text-zinc-500">{data.contactEmail}</p>}
        </div>
        <IssuerFromBlock issuer={issuer} />
        <dl className="num grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1.5 sm:justify-self-end">
          <dt className="text-zinc-400">Issued</dt>
          <dd className="text-end text-zinc-900">{fmtDate(data.issuedAt)}</dd>
          <dt className="text-zinc-400">Valid until</dt>
          <dd className="text-end font-medium text-zinc-900">{data.validUntil ? fmtDate(data.validUntil) : '—'}</dd>
          <dt className="text-zinc-400">Prepared by</dt>
          <dd className="text-end text-zinc-900">{data.preparedBy}</dd>
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
            <th className="py-2 pe-3 text-start font-medium">Description</th>
            <th className="px-3 py-2 text-end font-medium">Qty</th>
            <th className="hidden px-3 py-2 text-end font-medium sm:table-cell print:table-cell">Unit price</th>
            <th className="hidden px-3 py-2 text-end font-medium sm:table-cell print:table-cell">Disc.</th>
            <th className="py-2 ps-3 text-end font-medium">Amount</th>
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
                <td className="py-3 pe-3">
                  <p className="font-medium text-zinc-900">{it.description || 'Untitled line'}</p>
                  <p className="text-xs text-zinc-500 sm:hidden print:hidden">
                    {fmtAed(it.unitPrice)} / {unitLabel(it.unit, 1)}
                    {it.discountPct > 0 && ` · ${fmtQty(it.discountPct)}% off`}
                  </p>
                </td>
                <td className="num px-3 py-3 text-end whitespace-nowrap">
                  {fmtQty(it.quantity)} <span className="text-zinc-500">{unitLabel(it.unit, it.quantity)}</span>
                </td>
                <td className="num hidden px-3 py-3 text-end whitespace-nowrap sm:table-cell print:table-cell">{fmtAed(it.unitPrice)}</td>
                <td className="num hidden px-3 py-3 text-end whitespace-nowrap text-zinc-500 sm:table-cell print:table-cell">
                  {it.discountPct > 0 ? `${fmtQty(it.discountPct)}%` : '—'}
                </td>
                <td className="num py-3 ps-3 text-end font-medium whitespace-nowrap text-zinc-900">{fmtAed(lineTotal(it))}</td>
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
          <dd className="text-end">{fmtAed(totals.subtotal)}</dd>
          {totals.discount > 0 && (
            <>
              <dt className="text-zinc-500">Discount</dt>
              <dd className="text-end">−{fmtAed(totals.discount)}</dd>
            </>
          )}
          <dt className="text-zinc-500">VAT ({fmtQty(data.vatPct)}%)</dt>
          <dd className="text-end">{fmtAed(totals.vat)}</dd>
          <dt className="border-t border-zinc-200 pt-2.5 font-semibold text-zinc-900">Total</dt>
          <dd className="border-t border-zinc-200 pt-2.5 text-end text-[0.9375rem] font-semibold text-zinc-900">{fmtAed(totals.total)}</dd>
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

      <QuotationFooter issuer={issuer} className="mt-12">
        {data.validUntil && <>This quotation is valid until {fmtDate(data.validUntil)}.</>}
      </QuotationFooter>
    </article>
  )
}

/* ---------------- Issuer blocks (shared with the Company profile preview and future invoices) ---------------- */

/** Logo, trade name and website on the left; the document kind and number on the right. */
export function QuotationLetterhead({ issuer, number, title = 'Quotation' }: { issuer: Issuer; number: string; title?: string }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-6">
      <div className="flex items-center gap-3">
        <TenantLogo size="lg" variant="light" className="object-contain" />
        <div>
          <p className="text-[0.9375rem] font-semibold text-zinc-900">{issuer.name}</p>
          {issuer.website && <p className="text-xs text-zinc-500">{issuer.website}</p>}
        </div>
      </div>
      <div className="text-end">
        <p className="text-[1.375rem] font-semibold tracking-[-0.01em] text-zinc-900">{title}</p>
        <p className="num font-mono text-xs text-zinc-500">{number}</p>
      </div>
    </header>
  )
}

/** The "From" party: legal name, address, contact, tax and licence numbers. */
export function IssuerFromBlock({ issuer }: { issuer: Issuer }) {
  return (
    <div>
      <p className="text-[0.6875rem] font-medium tracking-wide text-zinc-400 uppercase">From</p>
      <p className="mt-1.5 font-semibold text-zinc-900">{issuer.legalName || issuer.name}</p>
      {issuer.addressLines.map((l, i) => (
        <p key={`${i}-${l}`}>{l}</p>
      ))}
      {issuer.phone && <p className="text-zinc-500">{issuer.phone}</p>}
      {issuer.email && <p className="text-zinc-500">{issuer.email}</p>}
      {issuer.taxNumber && (
        <p className="text-zinc-500">
          {issuer.taxLabel} <span className="num">{issuer.taxNumber}</span>
        </p>
      )}
      {issuer.commercialLicenseNo && (
        <p className="text-zinc-500">
          CR / Licence <span className="num">{issuer.commercialLicenseNo}</span>
        </p>
      )}
    </div>
  )
}

/** Legal footer: identity and contact line, bank details when set, then any extra note. */
export function QuotationFooter({ issuer, className, children }: { issuer: Issuer; className?: string; children?: ReactNode }) {
  const identity = [
    issuer.legalName || issuer.name,
    issuerAddress(issuer),
    issuer.phone,
    issuer.email,
    issuer.website,
    issuer.taxNumber && `${issuer.taxLabel} ${issuer.taxNumber}`,
  ].filter(Boolean)
  const bank = issuer.bank
  return (
    <footer className={cn('border-t border-zinc-100 pt-4 text-center text-[0.6875rem] text-zinc-400', className)}>
      <p>{identity.join(' · ')}</p>
      {bank && (
        <p className="mt-1">
          Bank: {[bank.bankName, bank.accountName, bank.iban && `IBAN ${bank.iban}`, bank.swift && `SWIFT ${bank.swift}`].filter(Boolean).join(' · ')}
        </p>
      )}
      {children && <p className="mt-1">{children}</p>}
    </footer>
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
