import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { ApprovalRulesView, ApproverKind, SpendDocType } from '@/modules/finance/purchases/types'
import { APPROVER_LABEL } from '@/modules/finance/purchases/types'
import { purchasesApi, useApprovalRules, usePurchasesMutation } from '@/modules/finance/purchases/api'
import { FinError, errMsg } from '@/modules/finance/collections/components/bits'
import { fmtWhen } from './bits'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

type Band = { minAmount: string; approver: ApproverKind }
const APPROVERS = Object.keys(APPROVER_LABEL) as ApproverKind[]

/**
 * Finance settings › Approval rules: amount bands per spending document (purchase orders, bills, expenses, expense
 * claims) and the PO match tolerance. Each band adds a step for documents whose base-currency total is at least its
 * amount. Company Admin / Accountant edit (audited); others read.
 */
export function ApprovalRulesCard() {
  const q = useApprovalRules()
  const v = q.data
  return (
    <Card>
      <CardHeader
        title="Approval rules"
        description={v ? `Steps by amount in ${v.baseCurrency}. The requester never approves their own request; one person approves one step.${v.updatedByName ? ` Last changed by ${v.updatedByName} on ${fmtWhen(v.updatedAt)}.` : ''}${v.canEdit ? '' : ' View only.'}` : undefined}
      />
      <CardBody>
        {q.error ? <FinError error={q.error as Error} onRetry={() => void q.refetch()} /> : !v ? <Skeleton className="h-48" /> : (
          <div className="grid gap-4 xl:grid-cols-2">
            {v.docTypes.map((d) => <DocRules key={d.id} view={v} docType={d.id} label={d.label} />)}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function DocRules({ view, docType, label }: { view: ApprovalRulesView; docType: SpendDocType; label: string }) {
  const toast = useToast()
  const initial = () => view.rules.filter((r) => r.docType === docType).map((r) => ({ minAmount: String(r.minAmount), approver: r.approver }))
  const [bands, setBands] = useState<Band[]>(initial)
  const [tol, setTol] = useState(String(view.matchTolerancePct))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setBands(initial())
    setTol(String(view.matchTolerancePct))
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = usePurchasesMutation(() =>
    purchasesApi.saveRules({ docType, rules: bands.map((b) => ({ minAmount: Number(b.minAmount) || 0, approver: b.approver })), ...(docType === 'purchase_order' ? { matchTolerancePct: Number(tol) } : {}) }),
  )
  const ro = !view.canEdit
  const set = (i: number, patch: Partial<Band>) => setBands((x) => x.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  return (
    <section aria-label={`${label} approval rules`} className="rounded-xl border border-line p-3">
      <h3 className="mb-2 text-sm font-semibold text-ink">{label}</h3>
      {bands.length === 0 && <p className="mb-2 text-[0.8125rem] text-muted">No approval needed.</p>}
      <ol className="space-y-2">
        {bands.map((b, i) => (
          <li key={i} className="flex items-center gap-2 text-[0.8125rem]">
            <span className="w-14 text-xs text-muted">Step {i + 1}</span>
            <span className="text-xs text-muted">from</span>
            <TextInput aria-label={`${label} step ${i + 1} amount`} type="number" min="0" className="num w-32" value={b.minAmount} disabled={ro} onChange={(e) => set(i, { minAmount: e.target.value })} />
            <SelectInput aria-label={`${label} step ${i + 1} approver`} className="w-44" value={b.approver} disabled={ro} onChange={(e) => set(i, { approver: e.target.value as ApproverKind })}>
              {APPROVERS.map((a) => <option key={a} value={a}>{APPROVER_LABEL[a]}</option>)}
            </SelectInput>
            {!ro && (
              <Button variant="ghost" size="xs" iconOnly aria-label={`Remove ${label} step ${i + 1}`} onClick={() => setBands((x) => x.filter((_, j) => j !== i))}>
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ol>
      {docType === 'purchase_order' && (
        <label className="mt-3 flex items-center gap-2 text-[0.8125rem]">
          <span className="text-muted">Bill-to-PO price tolerance</span>
          <TextInput aria-label="Match tolerance percent" type="number" min="0" max="25" step="0.5" className="num w-20" value={tol} disabled={ro} onChange={(e) => setTol(e.target.value)} />
          <span className="text-muted">%</span>
        </label>
      )}
      {error && <p role="alert" className="mt-2 text-[0.8125rem] text-danger-600">{error}</p>}
      {!ro && (
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" size="sm" disabled={bands.length >= 8} onClick={() => setBands((x) => [...x, { minAmount: '0', approver: APPROVERS.find((a) => !x.some((b) => b.approver === a)) ?? 'Accountant' }])}>
            <Plus className="size-3.5" aria-hidden /> Add step
          </Button>
          <Button size="sm" write loading={save.isPending} onClick={() => {
            setError(null)
            save.mutate(undefined, { onSuccess: () => toast.success(`${label}: approval rules saved`), onError: (e) => setError(errMsg(e)) })
          }}>Save</Button>
        </div>
      )}
    </section>
  )
}
