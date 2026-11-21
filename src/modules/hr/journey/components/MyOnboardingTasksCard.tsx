import { Link } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { useMyJourneyTasksQuery } from '../hooks'
import { JOURNEY_KIND_LABEL } from '../types'
import { ItemLine } from './JourneyBits'

/**
 * "My onboarding tasks" for the My HR portal (any role): the onboarding / offboarding items assigned to the
 * signed-in user, open first, tickable in place. Self-contained (own query: GET /hr/journeys/my-tasks).
 *
 *   import { MyOnboardingTasksCard } from '@/modules/hr/journey/components/MyOnboardingTasksCard'
 *   <MyOnboardingTasksCard />            // `limit` (default 6) rows, "View all" → /hr/journeys?tab=mine
 *
 * Renders nothing when the caller has no task at all (`hideWhenEmpty`, default true).
 */
export function MyOnboardingTasksCard({ limit = 6, hideWhenEmpty = true }: { limit?: number; hideWhenEmpty?: boolean }) {
  const q = useMyJourneyTasksQuery()
  const tasks = q.data ?? []
  const open = tasks.filter((t) => t.item.status === 'open')
  if (q.isError || (hideWhenEmpty && q.isSuccess && tasks.length === 0)) return null
  return (
    <Card>
      <CardHeader
        title="My onboarding tasks"
        icon={<ListChecks />}
        description={q.isSuccess ? `${open.length} open${open.some((t) => t.item.overdue) ? ` · ${open.filter((t) => t.item.overdue).length} overdue` : ''}` : undefined}
        action={<Link to="/hr/journeys?tab=mine" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">View all</Link>}
      />
      <CardBody>
        {q.isPending ? (
          <Skeleton className="h-16" />
        ) : tasks.length === 0 ? (
          <EmptyState icon={<ListChecks />} title="Nothing to do" body="Onboarding and offboarding tasks assigned to you show up here." />
        ) : (
          <ul className="divide-y divide-line" aria-label="My onboarding tasks">
            {(open.length ? open : tasks).slice(0, limit).map((t) => (
              <ItemLine key={t.item.id} journeyId={t.journeyId} employeeId={t.employeeId} item={t.item} subtitle={t.self ? `Your ${JOURNEY_KIND_LABEL[t.journeyKind].toLowerCase()}` : `${t.employeeName} · ${JOURNEY_KIND_LABEL[t.journeyKind]}`} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
