import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'
import { PATHS } from '@/app/paths'
import { useCurrentUser } from '@/store/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { letterDate } from '../letters'
import { LETTER_STATUS_LABEL } from '../types'
import { useLetterRequest } from '../api'
import { errorMessage } from '@/modules/hr/time/components/shared'

/**
 * `/hr/letters/:id`: an issued HR letter, printable (browser print, A4 portrait). The employee's own letter, or any for
 * HR full (the API answers 404 to everyone else, a Department Head included). Plain text body (never HTML); logical
 * CSS properties and `dir="auto"` keep it right in RTL.
 */
export default function LetterPage() {
  const { id = '' } = useParams()
  const q = useLetterRequest(id)
  const user = useCurrentUser()
  const full = user ? scopeOf(user.role, 'hr') === 'full' : false
  const r = q.data
  const l = r?.letter
  const back = full ? `${PATHS.hrRequests}?tab=letters` : PATHS.hrMe
  return (
    <PageBody className="max-w-4xl">
      <PrintStyles orientation="portrait" margin="18mm" />
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Link to={back} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {full ? 'Employee requests' : 'My HR'}
        </Link>
        <Button variant="secondary" onClick={() => window.print()} disabled={!l}>
          <Printer />
          Print
        </Button>
      </div>
      {q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !r ? (
        <Skeleton className="h-[40rem]" />
      ) : !l ? (
        <EmptyState title={`${r.typeName}: ${LETTER_STATUS_LABEL[r.status]}`} body={r.status === 'rejected' ? r.rejectionReason : 'The letter appears here once HR issues it.'} />
      ) : (
        <article aria-label={`${l.title} ${l.referenceNo}`} className="min-h-[60rem] rounded-2xl border border-line bg-white p-8 text-[0.9375rem] leading-relaxed text-neutral-900 shadow-xs print:min-h-0 print:border-0 print:p-0 print:shadow-none sm:p-12">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 pb-5" style={{ borderColor: l.letterhead.primaryColor ?? '#334155' }}>
            <div className="flex items-center gap-3">
              {l.letterhead.logoUrl ? <img src={l.letterhead.logoUrl} alt={l.letterhead.name} className="h-12 max-w-48 object-contain" /> : null}
              <div>
                <p className="text-[1.125rem] font-semibold">{l.letterhead.legalName || l.letterhead.name}</p>
                {l.letterhead.addressLines.length > 0 && <p className="text-xs text-neutral-600">{l.letterhead.addressLines.join(', ')}</p>}
              </div>
            </div>
            <div className="text-end text-xs text-neutral-600">
              {l.letterhead.phone && <p>{l.letterhead.phone}</p>}
              {l.letterhead.email && <p>{l.letterhead.email}</p>}
              {l.letterhead.website && <p>{l.letterhead.website}</p>}
              {l.letterhead.licenseNo && <p>Licence {l.letterhead.licenseNo}</p>}
            </div>
          </header>

          <div className="mt-6 flex flex-wrap justify-between gap-2 text-[0.8125rem]">
            <p>
              Ref: <span className="num font-medium" data-testid="letter-ref">{l.referenceNo}</span>
            </p>
            <p>Date: {letterDate(l.issueDate)}</p>
          </div>

          <h1 className="mt-8 text-center text-[1.125rem] font-semibold tracking-wide uppercase">{l.title}</h1>

          <div className="mt-6 whitespace-pre-line" dir="auto" data-testid="letter-body">
            {l.body}
          </div>

          <div className="mt-12">
            <p>Yours faithfully,</p>
            <div className="mt-10 w-56 border-t border-neutral-400 pt-2">
              <p className="font-semibold">{l.signatoryName}</p>
              <p className="text-[0.8125rem]">{l.signatoryTitle}</p>
              <p className="text-[0.8125rem]">{l.letterhead.name}</p>
            </div>
          </div>

          <footer className="mt-16 border-t border-neutral-200 pt-3 text-xs text-neutral-500">
            Verification code <span className="num font-medium text-neutral-700" data-testid="letter-code">{l.verificationCode}</span> · reference {l.referenceNo}. To check this
            letter, contact {l.letterhead.name} HR with the code.
          </footer>
        </article>
      )}
    </PageBody>
  )
}
