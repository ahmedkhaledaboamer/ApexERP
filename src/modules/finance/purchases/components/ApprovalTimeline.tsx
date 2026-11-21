import { CheckCircle2, Circle, Clock, XCircle } from 'lucide-react'
import type { ApprovalStepView } from '@/modules/finance/purchases/types'
import { APPROVER_LABEL } from '@/modules/finance/purchases/types'
import { fmt2 } from '@/modules/finance/collections/components/bits'
import { fmtWhen } from './bits'

/** The approval chain of a PO / bill: each step, its band, the decision and who decided (or who can act now). */
export function ApprovalTimeline({ steps, baseCurrency, pending }: { steps: ApprovalStepView[]; baseCurrency: string; pending: boolean }) {
  if (!steps.length) return <p className="text-[0.8125rem] text-muted">No approval steps (not submitted yet, or none needed for this amount).</p>
  return (
    <ol className="space-y-3" aria-label="Approvals">
      {steps.map((s) => {
        const waiting = pending && !s.decision && s.approverNames.length > 0
        const Icon = s.decision === 'approved' ? CheckCircle2 : s.decision === 'rejected' ? XCircle : waiting ? Clock : Circle
        const tone = s.decision === 'approved' ? 'text-success-600' : s.decision === 'rejected' ? 'text-danger-600' : waiting ? 'text-warning-600' : 'text-subtle'
        return (
          <li key={s.index} className="flex gap-3 text-[0.8125rem]">
            <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden />
            <div className="min-w-0">
              <p className="font-medium text-ink">
                Step {s.index + 1}: {APPROVER_LABEL[s.approver]}
                <span className="ms-2 text-xs font-normal text-muted">from {fmt2(s.minAmount)} {baseCurrency}</span>
              </p>
              {s.decision ? (
                <p className="text-ink-2">
                  {s.decision === 'approved' ? 'Approved' : 'Rejected'} by {s.decidedByName} · <span className="num text-xs text-muted">{fmtWhen(s.decidedAt)}</span>
                  {s.reason && <span className="block text-xs text-muted">“{s.reason}”</span>}
                </p>
              ) : waiting ? (
                <p className="text-ink-2">Waiting for: {s.approverNames.join(', ')}</p>
              ) : (
                <p className="text-muted">Not reached yet</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
