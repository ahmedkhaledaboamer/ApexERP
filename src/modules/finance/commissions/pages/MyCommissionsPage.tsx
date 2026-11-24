import { useState } from 'react'
import { BadgePercent, ChevronDown, ChevronRight } from 'lucide-react'
import { COMMISSION_BASIS_LABEL } from '@/modules/finance/commissions/types'
import { useMyCommissions } from '@/modules/finance/commissions/api'
import { Amount, errMsg, monthName } from '@/modules/finance/ledger/components/bits'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Card, CardBody } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatementStatus, StatementView } from '../components/StatementView'

/** `/sales/my-commissions`: the signed-in rep's own commission plan and statements (no accounting access needed). */
export default function MyCommissionsPage() {
  const q = useMyCommissions()
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <PageHeader icon={<IconTile><BadgePercent /></IconTile>} title="My commissions" description="Your commission plan and monthly statements with the calculation per invoice or deal." />
      <PageBody className="space-y-4">
        {q.isError ? <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-64" /> : (
          <>
            <Card>
              <CardBody className="text-[0.8125rem]">
                {q.data.plan ? (
                  <p>
                    <span className="font-semibold text-ink">{q.data.plan.name}</span> · {COMMISSION_BASIS_LABEL[q.data.plan.basis]} · {q.data.plan.rate} %
                    {q.data.plan.tiers.map((t) => ` · ${t.rate} % from ${t.minAchievement} % of target`).join('')}
                    {q.data.plan.capPerMonth !== null && <> · capped at <Amount value={q.data.plan.capPerMonth} /> a month</>}
                  </p>
                ) : <p className="text-muted">No commission plan applies to you.</p>}
              </CardBody>
            </Card>
            {!q.data.statements.length ? <EmptyState title="No statements yet" body="Statements are prepared after each month closes." /> : (
              <ul className="space-y-2" aria-label="My commission statements">
                {q.data.statements.map((s) => (
                  <li key={s.id} className="rounded-xl border border-line bg-surface">
                    <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                      <span className="flex items-center gap-2">
                        {open === s.id ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />}
                        <span className="font-medium text-ink">{monthName(s.month)}</span>
                        <StatementStatus s={s} />
                      </span>
                      <Amount value={s.total} currency={s.currency} strong />
                    </button>
                    {open === s.id && <div className="border-t border-line px-4 py-3"><StatementView s={s} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </PageBody>
    </>
  )
}
