import { useState, type ReactNode } from 'react'
import { Check, Circle, Clock } from 'lucide-react'
import type { ApprovalStepView, ClaimStatus, DocHistoryEntry, ExpenseStatus, PettyExpenseStatus, PolicyWarning } from '@/modules/finance/expenses/types'
import { CLAIM_STATUS_LABEL, EXPENSE_STATUS_LABEL, PETTY_EXPENSE_STATUS_LABEL } from '@/modules/finance/expenses/types'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { Field, TextArea } from '@/shared/components/form/Field'
import { fmtDate } from '@/shared/lib/utils'
import { FormError } from '@/modules/hr/components/PeopleBits'

/** Shared pieces of the Expenses screens (expenses, claims, petty cash). */

export { FileInput as ReceiptInput, FileLink as ReceiptLink, FormError } from '@/modules/hr/components/PeopleBits'
export { Amount, FinError, SimpleTable, downloadText, errMsg, fmt2, td, tdEnd, th, thEnd, toCsv } from '@/modules/finance/collections/components/bits'

const EXPENSE_TONE: Record<ExpenseStatus, Tone> = { pending: 'amber', approved: 'green', rejected: 'red', void: 'neutral' }
export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  return <Badge tone={EXPENSE_TONE[status]} variant="dot">{EXPENSE_STATUS_LABEL[status]}</Badge>
}
const CLAIM_TONE: Record<ClaimStatus, Tone> = { draft: 'neutral', pending: 'amber', approved: 'blue', in_payroll: 'sky', reimbursed: 'green', rejected: 'red' }
export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  return <Badge tone={CLAIM_TONE[status]} variant="dot">{CLAIM_STATUS_LABEL[status]}</Badge>
}
const PETTY_TONE: Record<PettyExpenseStatus, Tone> = { pending: 'amber', approved: 'green', rejected: 'red' }
export function PettyStatusBadge({ status }: { status: PettyExpenseStatus }) {
  return <Badge tone={PETTY_TONE[status]}>{PETTY_EXPENSE_STATUS_LABEL[status]}</Badge>
}

/** The approval chain of a document. */
export function Steps({ steps }: { steps: ApprovalStepView[] }) {
  if (!steps.length) return <p className="text-xs text-muted">No approval needed.</p>
  return (
    <ol className="space-y-1.5" aria-label="Approval steps">
      {steps.map((s) => (
        <li key={s.index} className="flex items-start gap-2 text-[0.8125rem]">
          {s.status === 'approved' ? <Check className="mt-0.5 size-4 text-success-600" aria-hidden /> : s.status === 'current' ? <Clock className="mt-0.5 size-4 text-warning-600" aria-hidden /> : <Circle className="mt-0.5 size-4 text-subtle" aria-hidden />}
          <span>
            <span className="font-medium text-ink">{s.label}</span>
            <span className="block text-xs text-muted">{s.status === 'approved' ? `Approved by ${s.approvedByName} · ${fmtDate(s.approvedAt ?? '')}` : s.status === 'current' ? 'Waiting' : 'Later'}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export function History({ items }: { items: DocHistoryEntry[] }) {
  return (
    <ul className="space-y-1 text-xs text-muted">
      {[...items].reverse().map((h, i) => (
        <li key={i}>
          <span className="num">{fmtDate(h.at)}</span> · {h.byName} {h.action}
          {h.note ? ` — ${h.note}` : ''}
        </li>
      ))}
    </ul>
  )
}

export function Warnings({ items }: { items: PolicyWarning[] }) {
  if (!items.length) return null
  return (
    <ul className="space-y-1 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-800 dark:bg-warning-700/20 dark:text-warning-300" aria-label="Policy warnings">
      {items.map((w, i) => (
        <li key={i}>
          {w.blocking ? 'Blocks submission: ' : ''}
          {w.message}
        </li>
      ))}
    </ul>
  )
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-[0.8125rem]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-end text-ink">{children}</dd>
    </div>
  )
}

/** Asks for a reason, then runs `onConfirm(reason)`. */
export function ReasonModal({ open, title, label, confirm, onClose, onConfirm, pending, error }: { open: boolean; title: string; label: string; confirm: string; onClose: () => void; onConfirm: (reason: string) => void; pending?: boolean; error?: Error | null }) {
  const [reason, setReason] = useState('')
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" write loading={pending} disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>{confirm}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field id="reason" label={label} required>
          <TextArea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormError error={error ?? null} />
      </div>
    </Modal>
  )
}
