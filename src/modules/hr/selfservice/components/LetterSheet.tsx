import type { ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useAppSelector } from '@/store/hooks'
import { ROOT_DOMAIN } from '@/shared/lib/tenantContext'
import { letterDate, letterVerifyUrl } from '../letters'
import type { BilingualLayout, LetterLanguage, Letterhead } from '../types'

/**
 * An A4 letter on the company letterhead (HR letters and warning letters), in English, Arabic (RTL) or both — side by
 * side (English start / Arabic end column) or stacked (English, then Arabic). Plain text bodies (never HTML); the Arabic
 * text carries its own bidi marks (RLM / isolates) and sits in a `dir="rtl" lang="ar"` block. Optional QR code to the
 * public verification page and a "revoked" stamp.
 */
export interface LetterSheetProps {
  letterhead: Letterhead
  language: LetterLanguage
  layout: BilingualLayout | null
  title: string
  titleAr: string | null
  body: string
  bodyAr: string | null
  referenceNo: string
  issueDate: string
  issueDateAr: string | null
  signatoryName: string
  signatoryTitle: string
  /** Verification code → QR code + footer. */
  verificationCode?: string | null
  revoked?: { at: string | null; reason: string } | null
  label: string
}

/** The public verification address of a code on this workspace (production subdomain, or ?workspace= in development). */
export function useLetterVerifyUrl(code: string | null | undefined): string | null {
  const sub = useAppSelector((s) => s.auth.session?.tenant.subdomain) ?? ''
  if (!code) return null
  return letterVerifyUrl(code, { subdomain: sub, origin: typeof window === 'undefined' ? '' : window.location.origin, rootDomain: ROOT_DOMAIN })
}

function EnglishBlock({ p, compact }: { p: LetterSheetProps; compact?: boolean }) {
  return (
    <div dir="ltr" lang="en" className="text-start">
      <h1 className={`text-center font-semibold tracking-wide uppercase ${compact ? 'text-[0.9375rem]' : 'text-[1.125rem]'}`}>{p.title}</h1>
      <div className={`mt-5 whitespace-pre-line ${compact ? 'text-[0.8125rem]' : ''}`} data-testid="letter-body">
        {p.body}
      </div>
      <div className="mt-10">
        <p>Yours faithfully,</p>
        <Signature p={p} />
      </div>
    </div>
  )
}

function ArabicBlock({ p, compact }: { p: LetterSheetProps; compact?: boolean }) {
  return (
    <div dir="rtl" lang="ar" className="text-start" data-testid="letter-ar">
      <h1 className={`text-center font-semibold ${compact ? 'text-[1rem]' : 'text-[1.25rem]'}`}>{p.titleAr}</h1>
      <div className={`mt-5 leading-loose whitespace-pre-line ${compact ? 'text-[0.875rem]' : 'text-[1rem]'}`} data-testid="letter-body-ar">
        {p.bodyAr}
      </div>
      <div className="mt-10">
        <Signature p={p} />
      </div>
    </div>
  )
}

function Signature({ p }: { p: LetterSheetProps }) {
  return (
    <div className="mt-8 w-56 border-t border-neutral-400 pt-2">
      <p className="font-semibold" dir="auto">
        {p.signatoryName}
      </p>
      <p className="text-[0.8125rem]" dir="auto">
        {p.signatoryTitle}
      </p>
      <p className="text-[0.8125rem]" dir="auto">
        {p.letterhead.name}
      </p>
    </div>
  )
}

export function LetterSheet(p: LetterSheetProps) {
  const verifyUrl = useLetterVerifyUrl(p.verificationCode)
  const withEn = p.language !== 'ar'
  const withAr = p.language !== 'en' && !!p.bodyAr
  const side = p.language === 'bilingual' && p.layout !== 'stacked'
  const lh = p.letterhead
  let content: ReactNode
  if (withEn && withAr && side) {
    content = (
      <div className="grid grid-cols-2 gap-8" data-layout="side_by_side">
        <EnglishBlock p={p} compact />
        <ArabicBlock p={p} compact />
      </div>
    )
  } else if (withEn && withAr) {
    content = (
      <div className="space-y-8" data-layout="stacked">
        <EnglishBlock p={p} />
        <hr className="border-neutral-300 print:break-after-page" />
        <ArabicBlock p={p} />
      </div>
    )
  } else content = withAr ? <ArabicBlock p={p} /> : <EnglishBlock p={p} />

  return (
    <article
      aria-label={p.label}
      data-language={p.language}
      className="relative min-h-[60rem] rounded-2xl border border-line bg-white p-8 text-[0.9375rem] leading-relaxed text-neutral-900 shadow-xs print:min-h-0 print:border-0 print:p-0 print:shadow-none sm:p-12"
    >
      {p.revoked && (
        <div role="note" data-testid="letter-revoked" className="mb-4 rounded-lg border-2 border-danger-600 px-4 py-2 text-center font-semibold text-danger-700 uppercase">
          Revoked{p.revoked.at ? ` on ${letterDate(p.revoked.at.slice(0, 10))}` : ''} — {p.revoked.reason} <span lang="ar" dir="rtl">· ملغى</span>
        </div>
      )}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 pb-5" style={{ borderColor: lh.primaryColor ?? '#334155' }}>
        <div className="flex items-center gap-3">
          {lh.logoUrl ? <img src={lh.logoUrl} alt={lh.name} className="h-12 max-w-48 object-contain" /> : null}
          <div>
            {withEn && <p className="text-[1.125rem] font-semibold">{lh.legalName || lh.name}</p>}
            {withAr && lh.legalNameAr && (
              <p className="text-[1.125rem] font-semibold" dir="rtl" lang="ar">
                {lh.legalNameAr}
              </p>
            )}
            {lh.addressLines.length > 0 && <p className="text-xs text-neutral-600">{lh.addressLines.join(', ')}</p>}
          </div>
        </div>
        <div className="text-end text-xs text-neutral-600">
          {lh.phone && <p>{lh.phone}</p>}
          {lh.email && <p>{lh.email}</p>}
          {lh.website && <p>{lh.website}</p>}
          {lh.licenseNo && <p>Licence {lh.licenseNo}</p>}
        </div>
      </header>

      <div className="mt-6 flex flex-wrap justify-between gap-2 text-[0.8125rem]">
        <p>
          {withEn ? 'Ref: ' : ''}
          <span className="num font-medium" data-testid="letter-ref">
            {p.referenceNo}
          </span>
          {withAr && (
            <span dir="rtl" lang="ar" className="ms-2">
              (الرقم المرجعي)
            </span>
          )}
        </p>
        <p>
          {withEn && <>Date: {letterDate(p.issueDate)}</>}
          {withAr && p.issueDateAr && (
            <span dir="rtl" lang="ar" className="ms-3" data-testid="letter-date-ar">
              التاريخ: {p.issueDateAr}
            </span>
          )}
        </p>
      </div>

      <div className="mt-8">{content}</div>

      {p.verificationCode && (
        <footer className="mt-14 flex items-end gap-4 border-t border-neutral-200 pt-3 text-xs text-neutral-500 print:break-inside-avoid">
          {verifyUrl && (
            <div data-testid="letter-qr" data-url={verifyUrl} className="shrink-0">
              <QRCodeSVG value={verifyUrl} size={84} level="M" marginSize={1} title="Verification QR code" />
            </div>
          )}
          <div className="space-y-1">
            <p>
              Verification code{' '}
              <span className="num font-medium text-neutral-700" data-testid="letter-code">
                {p.verificationCode}
              </span>{' '}
              · reference {p.referenceNo}. Scan the QR code or open {verifyUrl ? <span className="break-all">{verifyUrl.replace(/\?.*$/, '')}</span> : 'the verification page'} to check that this letter is genuine.
            </p>
            {withAr && (
              <p dir="rtl" lang="ar">
                للتحقق من صحة هذا الخطاب، امسح رمز الاستجابة السريعة أو أدخل رمز التحقق في صفحة التحقق.
              </p>
            )}
          </div>
        </footer>
      )}
    </article>
  )
}
