import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, Printer } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { TextArea } from '@/shared/components/form/Field'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'
import { PATHS } from '@/app/paths'
import { useCurrentUser } from '@/store/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { LETTER_LANGUAGE_LABEL, LETTER_STATUS_LABEL } from '../types'
import { selfServiceApi, useLetterRequest, useSelfServiceMutation } from '../api'
import { LetterSheet } from '../components/LetterSheet'
import { errorMessage, F } from '@/modules/hr/time/components/shared'

/**
 * `/hr/letters/:id`: an issued HR letter, printable (browser print, A4 portrait) in its language — English, Arabic (RTL)
 * or bilingual (side by side / stacked) — with a QR code to the public verification page. The employee's own letter, or
 * any for HR full (the API answers 404 to everyone else, a Department Head included). HR full can revoke it here.
 */
export default function LetterPage() {
  const { id = '' } = useParams()
  const q = useLetterRequest(id)
  const user = useCurrentUser()
  const full = user ? scopeOf(user.role, 'hr') === 'full' : false
  const [revoking, setRevoking] = useState(false)
  const r = q.data
  const l = r?.letter
  const back = full ? `${PATHS.hrRequests}?tab=letters` : PATHS.hrMe
  return (
    <PageBody className="max-w-5xl">
      <PrintStyles orientation="portrait" margin="18mm" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to={back} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {full ? 'Employee requests' : 'My HR'}
        </Link>
        <div className="flex items-center gap-2">
          {l && <span className="text-xs text-muted">{LETTER_LANGUAGE_LABEL[l.language ?? 'en']}</span>}
          {r?.canRevoke && (
            <Button variant="secondary" onClick={() => setRevoking(true)}>
              <Ban />
              Revoke
            </Button>
          )}
          <Button variant="secondary" onClick={() => window.print()} disabled={!l}>
            <Printer />
            Print
          </Button>
        </div>
      </div>
      {q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !r ? (
        <Skeleton className="h-[40rem]" />
      ) : !l ? (
        <EmptyState title={`${r.typeName}: ${LETTER_STATUS_LABEL[r.status]}`} body={r.status === 'rejected' ? r.rejectionReason : 'The letter appears here once HR issues it.'} />
      ) : (
        <LetterSheet
          label={`${l.title} ${l.referenceNo}`}
          letterhead={l.letterhead}
          language={l.language ?? 'en'}
          layout={l.layout ?? null}
          title={l.title}
          titleAr={l.titleAr ?? null}
          body={l.body}
          bodyAr={l.bodyAr ?? null}
          referenceNo={l.referenceNo}
          issueDate={l.issueDate}
          issueDateAr={l.issueDateAr ?? null}
          signatoryName={l.signatoryName}
          signatoryTitle={l.signatoryTitle}
          verificationCode={l.verificationCode}
          revoked={r.status === 'revoked' ? { at: r.revokedAt, reason: r.revokeReason } : null}
        />
      )}
      {revoking && r && <RevokeModal id={r.id} what={`${r.typeName} ${r.referenceNo ?? ''}`} onClose={() => setRevoking(false)} />}
    </PageBody>
  )
}

export function RevokeModal({ id, what, onClose }: { id: string; what: string; onClose: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const m = useSelfServiceMutation(selfServiceApi.revokeLetter)
  return (
    <Modal
      open
      onClose={onClose}
      title={`Revoke ${what}`}
      description="The letter stays in the history, marked revoked; anyone checking its QR code or verification code sees that it is no longer valid. The employee is told. Audited."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={m.isPending}
            disabled={!reason.trim()}
            onClick={() =>
              m.mutate(
                { id, reason },
                {
                  onSuccess: () => {
                    toast.success('Letter revoked')
                    onClose()
                  },
                },
              )
            }
          >
            Revoke letter
          </Button>
        </>
      }
    >
      <F label="Reason">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </F>
      {m.error && <p className="mt-3 text-[0.8125rem] text-danger-700 dark:text-danger-300" role="alert">{errorMessage(m.error)}</p>}
    </Modal>
  )
}
