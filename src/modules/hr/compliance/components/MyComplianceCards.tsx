import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileCheck2, Gavel } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, TextArea } from '@/shared/components/form/Field'
import { fmtDate } from '@/shared/lib/utils'
import { errorMessage, F } from '@/modules/hr/time/components/shared'
import { LETTER_LANGUAGES, LETTER_LANGUAGE_LABEL } from '@/modules/hr/selfservice/types'
import { complianceApi, useComplianceMutation, useDiscipline, useDisciplineRecord, useMyPolicies } from '../api'
import { DISCIPLINARY_CATEGORY_LABEL, DISCIPLINARY_TYPE_LABEL } from '../types'
import { AckBadge, MY_POLICIES_PATH, RecordStatusBadge, warningLetterPath } from './bits'

/** My HR slot "Policies to acknowledge": pending policies (new or new version), link to the page. Nothing when none apply. */
export function MyPoliciesCard() {
  const q = useMyPolicies()
  if (!q.data?.length) return null
  const pending = q.data.filter((p) => !p.acknowledged)
  return (
    <section aria-label="Policies to acknowledge" className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-ink">
          <FileCheck2 className="size-4 text-muted" aria-hidden /> Policies to acknowledge
        </h2>
        <Link to={MY_POLICIES_PATH} className="text-[0.8125rem] font-medium text-accent-700 hover:underline dark:text-accent-300">
          All my policies
        </Link>
      </div>
      {pending.length ? (
        <ul className="divide-y divide-line text-[0.8125rem]">
          {pending.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <span className="text-ink">
                {p.title} <span className="text-muted">· v{p.version}{p.reacknowledge ? ' (new version)' : ''}</span>
              </span>
              <Link to={`${MY_POLICIES_PATH}?policy=${encodeURIComponent(p.id)}`} className="font-medium text-accent-700 hover:underline dark:text-accent-300">
                Read and acknowledge
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.8125rem] text-muted">You’re up to date: every policy that applies to you is acknowledged.</p>
      )}
    </section>
  )
}

/** My HR slot "My warnings": the caller's own disciplinary records, acknowledge or appeal. Nothing when there are none. */
export function MyDisciplineCard() {
  const q = useDiscipline({ mine: true })
  const [open, setOpen] = useState<string | null>(null)
  if (!q.data?.length) return null
  return (
    <section aria-label="My warnings" className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink">
        <Gavel className="size-4 text-muted" aria-hidden /> My warnings and disciplinary actions
      </h2>
      <ul className="divide-y divide-line text-[0.8125rem]">
        {q.data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`my-record-${r.caseNo}`}>
            <span className="text-ink">
              {DISCIPLINARY_TYPE_LABEL[r.type]} <span className="text-muted">· {DISCIPLINARY_CATEGORY_LABEL[r.category]} · {fmtDate(r.issueDate)}</span>
            </span>
            <span className="flex items-center gap-2">
              <RecordStatusBadge status={r.status} />
              <AckBadge status={r.ackStatus} />
              <Button size="sm" variant={r.ackStatus === 'pending' && r.status !== 'withdrawn' ? 'primary' : 'ghost'} onClick={() => setOpen(r.id)}>
                {r.ackStatus === 'pending' && r.status !== 'withdrawn' ? 'Read and acknowledge' : 'Open'}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {open && <AcknowledgeModal id={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

function AcknowledgeModal({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast()
  const q = useDisciplineRecord(id)
  const [comment, setComment] = useState('')
  const [appeal, setAppeal] = useState(false)
  const m = useComplianceMutation(complianceApi.acknowledge)
  const r = q.data
  return (
    <Modal
      open
      onClose={onClose}
      title={r ? `${DISCIPLINARY_TYPE_LABEL[r.type]} · ${r.caseNo}` : 'Disciplinary record'}
      description={r ? `Issued ${fmtDate(r.issueDate)} by ${r.issuedByName}${r.expiresOn ? ` · on file until ${fmtDate(r.expiresOn)}` : ''}` : undefined}
      footer={
        r?.canAcknowledge ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Later
            </Button>
            <Button
              variant={appeal ? 'danger' : 'primary'}
              loading={m.isPending}
              disabled={appeal && comment.trim().length < 5}
              onClick={() => m.mutate({ id, comment, appeal }, { onSuccess: () => (toast.success(appeal ? 'Appeal sent to HR' : 'Acknowledged'), onClose()) })}
            >
              {appeal ? 'Send appeal' : 'Acknowledge'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {!r ? (
        <p className="text-[0.8125rem] text-muted">Loading…</p>
      ) : (
        <div className="space-y-3 text-[0.8125rem]">
          <p className="text-xs text-muted">{DISCIPLINARY_CATEGORY_LABEL[r.category]} · incident on {fmtDate(r.incidentDate)}</p>
          <p className="whitespace-pre-line text-ink">{r.description}</p>
          {r.type === 'deduction' && r.deductionAmount !== null && (
            <p className="text-ink">
              Deduction: {r.currency} {r.deductionAmount.toFixed(2)} ({r.deductionMonth})
            </p>
          )}
          <p className="flex flex-wrap gap-2 text-xs">
            Letter:
            {LETTER_LANGUAGES.map((l) => (
              <Link key={l} to={warningLetterPath(r.id, l)} className="font-medium text-accent-700 hover:underline dark:text-accent-300">
                {LETTER_LANGUAGE_LABEL[l]}
              </Link>
            ))}
          </p>
          {r.canAcknowledge ? (
            <>
              <F label={appeal ? 'Why you disagree (sent to HR)' : 'Comment (optional)'}>
                <TextArea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
              </F>
              <label className="flex items-center gap-2">
                <Checkbox checked={appeal} onChange={(e) => setAppeal(e.target.checked)} />I disagree and want to appeal
              </label>
            </>
          ) : (
            <p className="rounded-lg bg-sunken p-3">
              {r.ackStatus === 'pending' ? 'This record was withdrawn.' : `${r.ackStatus === 'appealed' ? 'You appealed' : 'You acknowledged'} on ${fmtDate(r.ackAt ?? '')}${r.employeeComment ? `: “${r.employeeComment}”` : '.'}`}
            </p>
          )}
          {m.error && <p className="text-danger-700 dark:text-danger-500" role="alert">{errorMessage(m.error)}</p>}
        </div>
      )}
    </Modal>
  )
}
