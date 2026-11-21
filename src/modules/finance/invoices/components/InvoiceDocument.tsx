import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import type { InvoiceDetail } from '@/modules/finance/invoices/types'
import { TenantLogo } from '@/modules/tenancy/components/TenantLogo'
import { useTenant } from '@/modules/tenancy/hooks'
import { issuerFor } from '@/modules/quotations/lib/company'
import { fmtMoney } from '@/modules/finance/invoices/calc'
import { cn } from '@/shared/lib/utils'

/**
 * The printable invoice (A4). Colours are fixed (paper stays white in dark mode). UAE: "Tax Invoice" with the
 * seller TRN, the customer TRN when given and the VAT amounts also in AED. KSA: bilingual Arabic + English
 * labels (ZATCA requires Arabic), "فاتورة ضريبية" / "فاتورة ضريبية مبسطة", and the QR code (TLV base64) of the
 * phase-1 fields. Arabic runs carry lang="ar" dir="rtl"; the layout uses logical properties, so it also reads
 * correctly when the app itself is in RTL.
 */

const AR: Record<string, string> = {
  seller: 'البائع',
  buyer: 'المشتري',
  invoiceNo: 'رقم الفاتورة',
  issueDate: 'تاريخ الإصدار',
  supplyDate: 'تاريخ التوريد',
  dueDate: 'تاريخ الاستحقاق',
  vatNo: 'الرقم الضريبي',
  cr: 'السجل التجاري',
  description: 'الوصف',
  qty: 'الكمية',
  unitPrice: 'سعر الوحدة',
  discount: 'الخصم',
  taxable: 'المبلغ الخاضع للضريبة',
  vatRate: 'نسبة الضريبة',
  vat: 'ضريبة القيمة المضافة',
  total: 'الإجمالي',
  subtotal: 'الإجمالي غير شامل الضريبة',
  totalVat: 'مجموع ضريبة القيمة المضافة',
  grandTotal: 'الإجمالي شامل الضريبة',
  balance: 'الرصيد المستحق',
  notes: 'ملاحظات',
  terms: 'الشروط',
}

function Ar({ k, className }: { k: keyof typeof AR; className?: string }) {
  return (
    <span lang="ar" dir="rtl" className={cn('font-[Tahoma,Arial,sans-serif]', className)}>
      {AR[k]}
    </span>
  )
}

/** "English / عربي" label (KSA) or just English (UAE). */
function L({ en, ar, ksa, block }: { en: string; ar: keyof typeof AR; ksa: boolean; block?: boolean }) {
  if (!ksa) return <>{en}</>
  return block ? (
    <span className="flex flex-col leading-tight">
      <span>{en}</span>
      <Ar k={ar} />
    </span>
  ) : (
    <>
      {en} · <Ar k={ar} />
    </>
  )
}

const qtyFmt = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n)
const dateFmt = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')

export function InvoiceDocument({ inv, className, printCopy }: { inv: InvoiceDetail; className?: string; printCopy?: boolean }) {
  /** The print copy carries no test ids (the on-screen copy is the one tests and assistive tech read). */
  const tid = (id: string) => (printCopy ? undefined : id)
  const tenant = useTenant()
  const issuer = issuerFor(tenant)
  const ksa = inv.seller.country === 'SA'
  const money = (n: number) => fmtMoney(n, inv.currency)
  const foreign = inv.currency !== inv.baseCurrency
  const draft = inv.status === 'draft'
  const isVoid = inv.status === 'void'

  return (
    <article
      data-testid={tid('invoice-document')}
      className={cn(
        'invoice-paper relative mx-auto w-full max-w-[210mm] bg-white px-6 py-8 text-[0.8125rem] leading-relaxed text-zinc-800 sm:min-h-[297mm] sm:px-[14mm] sm:py-[12mm]',
        className,
      )}
    >
      {(draft || isVoid) && (
        <span className="absolute top-6 end-6 rounded border border-zinc-300 px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
          {draft ? 'Draft — not a tax invoice' : 'Void'}
        </span>
      )}

      {/* Letterhead */}
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-3">
          <TenantLogo size="lg" variant="light" className="object-contain" />
          <div>
            <p className="text-[0.9375rem] font-semibold text-zinc-900">{issuer.name}</p>
            {issuer.website && <p className="text-xs text-zinc-500">{issuer.website}</p>}
          </div>
        </div>
        <div className="text-end">
          <p className="text-[1.375rem] font-semibold tracking-[-0.01em] text-zinc-900" data-testid={tid('invoice-title')}>
            {inv.title}
          </p>
          {ksa && inv.titleAr && (
            <p lang="ar" dir="rtl" className="text-[1.25rem] font-semibold text-zinc-900">
              {inv.titleAr}
            </p>
          )}
          <p className="num font-mono text-xs text-zinc-500">{draft ? 'Draft' : inv.number}</p>
        </div>
      </header>

      {/* Parties, dates, QR */}
      <section className={cn('mt-8 grid grid-cols-1 gap-6', ksa ? 'sm:grid-cols-[1fr_1fr_auto]' : 'sm:grid-cols-3')}>
        <div>
          <p className="text-[0.6875rem] font-medium tracking-wide text-zinc-400 uppercase">
            <L en="Seller" ar="seller" ksa={ksa} />
          </p>
          <p className="mt-1.5 font-semibold text-zinc-900">{inv.seller.legalName}</p>
          {ksa && inv.seller.legalNameAr && (
            <p lang="ar" dir="rtl" className="font-semibold text-zinc-900">
              {inv.seller.legalNameAr}
            </p>
          )}
          {inv.seller.addressLines.map((l, i) => (
            <p key={`${i}-${l}`}>{l}</p>
          ))}
          <p className="text-zinc-600">
            {ksa ? <L en="VAT no." ar="vatNo" ksa /> : inv.seller.taxLabel}:{' '}
            <span className="num font-medium text-zinc-900">{inv.seller.vatNumber || 'not set (Finance settings)'}</span>
          </p>
          {inv.seller.commercialRegistration && (
            <p className="text-zinc-500">
              {ksa ? <L en="CR" ar="cr" ksa /> : 'Licence'}: <span className="num">{inv.seller.commercialRegistration}</span>
            </p>
          )}
        </div>
        <div>
          <p className="text-[0.6875rem] font-medium tracking-wide text-zinc-400 uppercase">
            <L en="Buyer" ar="buyer" ksa={ksa} />
          </p>
          <p className="mt-1.5 font-semibold text-zinc-900">{inv.customerName}</p>
          {inv.customerAddress && <p>{inv.customerAddress}</p>}
          {inv.customerVatNumber && (
            <p className="text-zinc-600">
              {ksa ? <L en="VAT no." ar="vatNo" ksa /> : 'TRN'}: <span className="num font-medium text-zinc-900">{inv.customerVatNumber}</span>
            </p>
          )}
          <dl className="num mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-zinc-400"><L en="Issue date" ar="issueDate" ksa={ksa} /></dt>
            <dd className="text-zinc-900">{dateFmt(inv.issueDate)}</dd>
            {ksa && (
              <>
                <dt className="text-zinc-400"><L en="Supply date" ar="supplyDate" ksa /></dt>
                <dd className="text-zinc-900">{dateFmt(inv.issueDate)}</dd>
              </>
            )}
            <dt className="text-zinc-400"><L en="Due date" ar="dueDate" ksa={ksa} /></dt>
            <dd className="font-medium text-zinc-900">{dateFmt(inv.dueDate)}</dd>
            {inv.quotationNumber && (
              <>
                <dt className="text-zinc-400">Quotation</dt>
                <dd className="text-zinc-900">{inv.quotationNumber}</dd>
              </>
            )}
            {foreign && (
              <>
                <dt className="text-zinc-400">Rate</dt>
                <dd className="text-zinc-900">1 {inv.currency} = {inv.exchangeRate} {inv.baseCurrency}</dd>
              </>
            )}
          </dl>
        </div>
        {ksa && inv.zatca && (
          <div className="flex flex-col items-center gap-1 justify-self-center sm:justify-self-end" data-testid={tid('zatca-qr')}>
            <QRCodeSVG value={inv.zatca.qr} size={128} level="M" marginSize={1} title="ZATCA QR code" />
            <p className="text-[0.625rem] text-zinc-400">ZATCA QR · ICV {inv.zatca.icv}</p>
          </div>
        )}
      </section>

      {inv.milestone && <p className="mt-6 rounded-lg bg-zinc-50 px-4 py-2 text-zinc-700 print:border print:border-zinc-200">{inv.milestone}</p>}

      {/* Lines */}
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b border-zinc-200 text-[0.6875rem] tracking-wide text-zinc-400 uppercase">
            <th className="py-2 pe-2 text-start font-medium"><L en="Description" ar="description" ksa={ksa} block /></th>
            <th className="px-2 py-2 text-end font-medium"><L en="Qty" ar="qty" ksa={ksa} block /></th>
            <th className="px-2 py-2 text-end font-medium"><L en="Unit price" ar="unitPrice" ksa={ksa} block /></th>
            <th className="hidden px-2 py-2 text-end font-medium sm:table-cell print:table-cell"><L en="Discount" ar="discount" ksa={ksa} block /></th>
            <th className="hidden px-2 py-2 text-end font-medium sm:table-cell print:table-cell"><L en="Taxable" ar="taxable" ksa={ksa} block /></th>
            <th className="px-2 py-2 text-end font-medium"><L en="VAT" ar="vat" ksa={ksa} block /></th>
            <th className="py-2 ps-2 text-end font-medium"><L en="Total" ar="total" ksa={ksa} block /></th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => {
            const tax = inv.taxSummary.find((t) => t.taxCodeId === l.taxCodeId)
            return (
              <tr key={l.id} className="border-b border-zinc-100 align-top break-inside-avoid">
                <td className="py-2.5 pe-2 font-medium text-zinc-900">{l.description}</td>
                <td className="num px-2 py-2.5 text-end">{qtyFmt(l.quantity)}</td>
                <td className="num px-2 py-2.5 text-end whitespace-nowrap">{fmtMoney(l.unitPrice)}</td>
                <td className="num hidden px-2 py-2.5 text-end text-zinc-500 sm:table-cell print:table-cell">{l.discount > 0 ? fmtMoney(l.discount) : '—'}</td>
                <td className="num hidden px-2 py-2.5 text-end sm:table-cell print:table-cell">{fmtMoney(l.net)}</td>
                <td className="num px-2 py-2.5 text-end whitespace-nowrap">
                  {fmtMoney(l.taxAmount)}
                  <span className="block text-[0.6875rem] text-zinc-400">{tax ? `${tax.rate}%` : ''}</span>
                </td>
                <td className="num py-2.5 ps-2 text-end font-medium whitespace-nowrap text-zinc-900">{fmtMoney(l.total)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Totals */}
      <section className="mt-5 flex justify-end break-inside-avoid">
        <dl className="num grid w-full max-w-96 grid-cols-[1fr_auto] gap-x-6 gap-y-1.5">
          <dt className="text-zinc-500"><L en="Total excl. VAT" ar="subtotal" ksa={ksa} /></dt>
          <dd className="text-end">{money(inv.subtotal - inv.discountTotal)}</dd>
          {inv.taxSummary.map((t) => (
            <FragmentRow key={t.taxCodeId} label={`${t.name} on ${fmtMoney(t.net)}`} value={money(t.tax)} />
          ))}
          <dt className="text-zinc-500"><L en="Total VAT" ar="totalVat" ksa={ksa} /></dt>
          <dd className="text-end">{money(inv.taxTotal)}</dd>
          <dt className="border-t border-zinc-200 pt-2 font-semibold text-zinc-900"><L en="Total incl. VAT" ar="grandTotal" ksa={ksa} /></dt>
          <dd className="border-t border-zinc-200 pt-2 text-end text-[0.9375rem] font-semibold text-zinc-900" data-testid={tid('invoice-total')}>{money(inv.total)}</dd>
          {(inv.amountCredited > 0 || inv.amountPaid > 0) && (
            <>
              {inv.amountCredited > 0 && <FragmentRow label="Credited" value={`−${money(inv.amountCredited)}`} />}
              {inv.amountPaid > 0 && <FragmentRow label="Paid" value={`−${money(inv.amountPaid)}`} />}
              <dt className="font-semibold text-zinc-900"><L en="Balance due" ar="balance" ksa={ksa} /></dt>
              <dd className="text-end font-semibold text-zinc-900">{money(inv.balanceDue)}</dd>
            </>
          )}
          {foreign && (
            <>
              <dt className="pt-2 text-xs text-zinc-500">VAT in {inv.baseCurrency} (at {inv.exchangeRate})</dt>
              <dd className="pt-2 text-end text-xs">{fmtMoney(inv.baseTaxTotal, inv.baseCurrency)}</dd>
              <dt className="text-xs text-zinc-500">Total in {inv.baseCurrency}</dt>
              <dd className="text-end text-xs">{fmtMoney(inv.baseTotal, inv.baseCurrency)}</dd>
            </>
          )}
        </dl>
      </section>

      {(inv.notes || inv.terms) && (
        <section className="mt-8 grid grid-cols-1 gap-6 border-t border-zinc-200 pt-5 break-inside-avoid sm:grid-cols-2 print:grid-cols-2">
          {inv.notes && (
            <div>
              <p className="text-[0.6875rem] font-medium tracking-wide text-zinc-400 uppercase"><L en="Notes" ar="notes" ksa={ksa} /></p>
              <p className="mt-1.5 whitespace-pre-line">{inv.notes}</p>
            </div>
          )}
          {inv.terms && (
            <div>
              <p className="text-[0.6875rem] font-medium tracking-wide text-zinc-400 uppercase"><L en="Terms" ar="terms" ksa={ksa} /></p>
              <p className="mt-1.5 whitespace-pre-line text-zinc-600">{inv.terms}</p>
            </div>
          )}
        </section>
      )}

      <footer className="mt-10 border-t border-zinc-100 pt-3 text-center text-[0.6875rem] text-zinc-400">
        <p>{[inv.seller.legalName, inv.seller.vatNumber && `${ksa ? 'VAT' : inv.seller.taxLabel} ${inv.seller.vatNumber}`, issuer.email, issuer.phone].filter(Boolean).join(' · ')}</p>
        {issuer.bank && <p className="mt-1">Bank: {[issuer.bank.bankName, issuer.bank.iban && `IBAN ${issuer.bank.iban}`, issuer.bank.swift && `SWIFT ${issuer.bank.swift}`].filter(Boolean).join(' · ')}</p>}
        {ksa && <p className="mt-1">Not yet cleared / reported to ZATCA: cryptographic stamping needs the backend and CSID onboarding.</p>}
      </footer>
    </article>
  )
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-end text-xs">{value}</dd>
    </>
  )
}

const PRINT_CSS = `
.invoice-print-root { display: none; }
@media print {
  @page { size: A4; margin: 12mm 12mm 14mm; }
  html, body { background: #fff !important; height: auto !important; }
  body > *:not(.invoice-print-root) { display: none !important; }
  .invoice-print-root { display: block !important; }
  .invoice-print-root .invoice-paper { max-width: none; min-height: 0; padding: 0 !important; box-shadow: none; }
  .invoice-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`

/** A copy of the invoice attached to <body> that only shows when printing (`window.print()` → clean A4 PDF). */
export function InvoicePrintPortal({ inv }: { inv: InvoiceDetail }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const el = document.createElement('div')
    el.className = 'invoice-print-root'
    document.body.appendChild(el)
    setHost(el)
    return () => el.remove()
  }, [])
  return (
    <>
      <style>{PRINT_CSS}</style>
      {host && createPortal(<InvoiceDocument inv={inv} printCopy />, host)}
    </>
  )
}
