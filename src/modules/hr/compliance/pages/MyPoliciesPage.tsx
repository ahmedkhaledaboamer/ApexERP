import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, FileCheck2 } from 'lucide-react'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { fmtDate } from '@/shared/lib/utils'
import { errorCode, errorMessage } from '@/modules/hr/time/components/shared'
import { complianceApi, useComplianceMutation, useMyPolicies } from '../api'
import { POLICY_CATEGORY_LABEL, type MyPolicy } from '../types'
import { FileLink, PolicyBody } from '../components/bits'

/** `/hr/me/policies`: the policies addressed to me (pending first); read one and acknowledge the current version. */
export default function MyPoliciesPage() {
  const q = useMyPolicies()
  const [params, setParams] = useSearchParams()
  const openId = params.get('policy')
  const open = q.data?.find((p) => p.id === openId) ?? null
  const setOpen = (id: string | null) =>
    setParams(
      (p) => {
        if (id) p.set('policy', id)
        else p.delete('policy')
        return p
      },
      { replace: true },
    )
  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <FileCheck2 />
          </IconTile>
        }
        title="My policies"
        description="Company policies that apply to you. Read each one and confirm you have read and understood it; a new version needs a new confirmation."
      />
      <PageBody className="space-y-4">
        <Link to="/hr/me" className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          My HR
        </Link>
        {q.isPending ? (
          <Skeleton className="h-64" />
        ) : q.error ? (
          errorCode(q.error) === 'no_employee_record' ? (
            <EmptyState title="No employee record" body="You don’t have an employee record in this company yet." />
          ) : (
            <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
          )
        ) : !q.data.length ? (
          <EmptyState title="No policies for you" body="HR hasn’t published a policy that applies to you." icon={<FileCheck2 />} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_1fr]">
            <ul className="space-y-1" aria-label="Policies">
              {q.data.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(p.id)}
                    className={`block w-full rounded-lg px-3 py-2 text-start text-[0.8125rem] ${p.id === open?.id ? 'bg-accent-50 text-accent-800 dark:bg-accent-950 dark:text-accent-200' : 'text-ink-2 hover:bg-sunken'}`}
                  >
                    <span className="font-medium">{p.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                      {p.acknowledged ? <Badge tone="green">Acknowledged</Badge> : <Badge tone="amber">{p.reacknowledge ? 'New version' : 'To acknowledge'}</Badge>}
                      <span className="text-muted">v{p.version}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {open ? <PolicyView key={`${open.id}:${open.version}`} p={open} /> : <EmptyState title="Pick a policy" body="Open a policy to read it and acknowledge it." />}
          </div>
        )}
      </PageBody>
    </>
  )
}

function PolicyView({ p }: { p: MyPolicy }) {
  const toast = useToast()
  const [read, setRead] = useState(false)
  const m = useComplianceMutation(complianceApi.acknowledgePolicy)
  return (
    <section aria-label={p.title} className="space-y-3 rounded-xl border border-line bg-surface p-5">
      <div>
        <h2 className="text-[1.125rem] font-semibold text-ink">{p.title}</h2>
        <p className="text-xs text-muted">
          {POLICY_CATEGORY_LABEL[p.category]} · version {p.version} · effective {fmtDate(p.effectiveDate)}
        </p>
        {p.reacknowledge && p.changeNote && <p className="mt-1 text-[0.8125rem] text-warning-700 dark:text-warning-500">What changed: {p.changeNote}</p>}
      </div>
      <PolicyBody body={p.body} />
      <FileLink file={p.file} />
      {p.acknowledged ? (
        <p className="flex items-center gap-2 text-[0.8125rem] text-success-700 dark:text-success-500" role="status">
          <CheckCircle2 className="size-4" aria-hidden /> You acknowledged version {p.version} on {fmtDate(p.acknowledgedAt ?? '')}.
        </p>
      ) : (
        <div className="space-y-2 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-[0.8125rem] text-ink">
            <Checkbox checked={read} onChange={(e) => setRead(e.target.checked)} />I have read and understood this policy (version {p.version}).
          </label>
          <Button disabled={!read} loading={m.isPending} onClick={() => m.mutate({ id: p.id, version: p.version }, { onSuccess: () => toast.success('Policy acknowledged') })}>
            Acknowledge
          </Button>
          {m.error && <p className="text-[0.8125rem] text-danger-700 dark:text-danger-500" role="alert">{errorMessage(m.error)}</p>}
        </div>
      )}
    </section>
  )
}
