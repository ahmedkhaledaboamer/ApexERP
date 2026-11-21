import { Link } from 'react-router-dom'
import { Target } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { fmtDate } from '@/shared/lib/utils'
import { PATHS } from '@/app/paths'
import { useMyPerformance } from '../api'
import { PENDING_LABEL } from '../types'
import { RatingText } from './bits'

/**
 * "My reviews" card for the self-service portal (My HR). Self-contained: reads GET /hr/performance/my
 * (works for every employee, whatever their `hr` scope) and links into /hr/performance.
 * Usage: `<MyPerformanceCard />` (optional `className`).
 */
export function MyPerformanceCard({ className }: { className?: string }) {
  const q = useMyPerformance()
  const d = q.data
  return (
    <Card className={className}>
      <CardHeader icon={<Target className="size-4" />} title="My reviews" description="Performance reviews and goals" action={<Link className="text-xs text-brand-600 hover:underline" to={PATHS.hrPerformance}>Open</Link>} />
      <CardBody className="space-y-3">
        {q.isPending ? (
          <Skeleton className="h-16" />
        ) : !d || !d.employeeId ? (
          <p className="text-xs text-muted">No employee record is linked to your account.</p>
        ) : (
          <>
            {d.pending.length === 0 ? (
              <p className="text-xs text-muted">Nothing to do right now.</p>
            ) : (
              <ul className="space-y-1" aria-label="Review actions">
                {d.pending.slice(0, 4).map((p) => (
                  <li key={`${p.reviewId}-${p.action}`} className="text-[0.8125rem]">
                    <Link className="text-ink hover:underline" to={`${PATHS.hrPerformance}?review=${encodeURIComponent(p.reviewId)}`}>
                      {PENDING_LABEL[p.action]}
                      {p.action === 'manager_review' || p.action === 'approve_goals' ? `: ${p.employeeName}` : ''}
                    </Link>
                    <span className={p.overdue ? 'text-danger-600' : 'text-muted'}>{p.dueDate ? ` · due ${fmtDate(p.dueDate)}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            {d.latestShared && (
              <p className="text-xs text-muted">
                Latest result ({d.latestShared.cycleName}): <RatingText value={d.latestShared.finalRating} label={d.latestShared.finalLabel} max={5} />
              </p>
            )}
            {d.goals.length > 0 && <p className="text-xs text-muted">{d.goals.length} active goal{d.goals.length === 1 ? '' : 's'}</p>}
          </>
        )}
      </CardBody>
    </Card>
  )
}

export default MyPerformanceCard
