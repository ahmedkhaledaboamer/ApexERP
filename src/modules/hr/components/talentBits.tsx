import type { ReactNode } from 'react'
import type { ApplicationStage, OfferStatus, OpeningStatus } from '@/modules/hr/recruitmentTypes'
import { OFFER_STATUS_LABEL, OPENING_STATUS_LABEL, STAGE_LABEL } from '@/modules/hr/recruitmentTypes'
import type { CertificateState, EnrollmentStatus, MatrixCell } from '@/modules/hr/trainingTypes'
import { CERTIFICATE_STATE_LABEL, ENROLLMENT_STATUS_LABEL } from '@/modules/hr/trainingTypes'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { ApiError } from '@/shared/lib/apiError'

/** Small shared pieces of the Recruitment and Training screens. */

export const OPENING_TONE: Record<OpeningStatus, Tone> = { draft: 'neutral', pending_approval: 'amber', open: 'green', on_hold: 'sky', filled: 'brand', closed: 'neutral' }
export const STAGE_TONE: Record<ApplicationStage, Tone> = { applied: 'neutral', screening: 'sky', interview: 'blue', assessment: 'teal', offer: 'amber', hired: 'green', rejected: 'red', withdrawn: 'neutral' }
const OFFER_TONE: Record<OfferStatus, Tone> = { draft: 'neutral', sent: 'amber', accepted: 'green', declined: 'red' }
const ENROLL_TONE: Record<EnrollmentStatus, Tone> = { invited: 'neutral', enrolled: 'blue', attended: 'sky', no_show: 'red', completed: 'green', failed: 'red' }
const CERT_TONE: Record<CertificateState, Tone> = { valid: 'green', expiring: 'amber', expired: 'red' }
export const CELL_TONE: Record<MatrixCell, Tone> = { compliant: 'green', expiring: 'amber', expired: 'red', missing: 'neutral', overdue: 'red' }
export const CELL_LABEL: Record<MatrixCell, string> = { compliant: 'Done', expiring: 'Expiring', expired: 'Expired', missing: 'Due', overdue: 'Overdue' }

export const OpeningStatusBadge = ({ status }: { status: OpeningStatus }) => <Badge tone={OPENING_TONE[status]}>{OPENING_STATUS_LABEL[status]}</Badge>
export const StageBadge = ({ stage }: { stage: ApplicationStage }) => <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>
export const OfferBadge = ({ status, expired }: { status: OfferStatus; expired?: boolean }) => <Badge tone={expired ? 'red' : OFFER_TONE[status]}>{expired ? 'Expired' : OFFER_STATUS_LABEL[status]}</Badge>
export const EnrollmentBadge = ({ status }: { status: EnrollmentStatus }) => <Badge tone={ENROLL_TONE[status]}>{ENROLLMENT_STATUS_LABEL[status]}</Badge>
export const CertificateBadge = ({ state }: { state: CertificateState }) => <Badge tone={CERT_TONE[state]}>{CERTIFICATE_STATE_LABEL[state]}</Badge>

export function Score({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-subtle">—</span>
  return <span className="num text-[0.8125rem] font-medium text-ink">{value.toFixed(1)}<span className="text-xs text-muted"> / 5</span></span>
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/** Inline error under a form or action. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-700 dark:bg-danger-500/10 dark:text-danger-500">
      {errorText(error)}
    </p>
  )
}

/** A failed query (403 for roles outside the section, 404…). */
export function ErrorText({ error }: { error: unknown }) {
  return <p className="rounded-lg border border-line bg-surface p-4 text-[0.8125rem] text-muted">{errorText(error)}</p>
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Simple bordered table (Linear-style), with a horizontal scroll on small screens. */
export function SimpleTable({ head, children, label }: { head: ReactNode[]; children: ReactNode; label: string }) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
      <table aria-label={label} className="w-full text-start text-[0.8125rem]">
        <thead className="bg-sunken text-xs text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 text-start font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  )
}

export const td = 'px-3 py-2 align-middle text-ink-2'
