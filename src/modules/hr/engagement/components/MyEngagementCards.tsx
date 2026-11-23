import { Link } from 'react-router-dom'
import { HeartPulse, MessagesSquare } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { fmtDate } from '@/shared/lib/utils'
import { PATHS } from '@/app/paths'
import { useMyFeedback, useMySurveys } from '../api'

/**
 * "Surveys to answer" card for My HR (GET /hr/engagement/my; every employee, whatever their `hr` scope).
 * Renders nothing when there is nothing to answer.
 */
export function MySurveysCard({ className }: { className?: string }) {
  const q = useMySurveys()
  if (q.isPending) return <Skeleton className="h-24" />
  const d = q.data
  if (!d?.employeeLinked || d.toAnswer.length === 0) return null
  return (
    <Card className={className} data-testid="my-surveys-card">
      <CardHeader icon={<HeartPulse className="size-4" />} title="Surveys to answer" description="Anonymous unless marked confidential" action={<Link className="text-xs text-brand-600 hover:underline" to={PATHS.hrEngagement}>Open</Link>} />
      <CardBody>
        <ul className="space-y-1" aria-label="Surveys to answer">
          {d.toAnswer.slice(0, 4).map((s) => (
            <li key={s.surveyId} className="text-[0.8125rem]">
              <Link className="text-ink hover:underline" to={`${PATHS.hrEngagement}?answer=${encodeURIComponent(s.surveyId)}`}>
                {s.name}
              </Link>
              <span className="text-muted"> · closes {fmtDate(s.closesOn)}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

/** "Feedback requests" card for My HR (GET /hr/feedback/my): 360° requests to answer and nominations to make. */
export function MyFeedbackCard({ className }: { className?: string }) {
  const q = useMyFeedback()
  if (q.isPending) return <Skeleton className="h-24" />
  const d = q.data
  if (!d?.employeeLinked) return null
  const pending = d.invitations.filter((i) => i.status === 'pending' && i.roundStatus === 'open')
  const nominate = d.aboutMe.filter((r) => r.can.nominate)
  if (!pending.length && !nominate.length) return null
  return (
    <Card className={className} data-testid="my-feedback-card">
      <CardHeader icon={<MessagesSquare className="size-4" />} title="Feedback requests" description="360° feedback for colleagues" action={<Link className="text-xs text-brand-600 hover:underline" to={PATHS.hrFeedback}>Open</Link>} />
      <CardBody>
        <ul className="space-y-1" aria-label="Feedback requests">
          {pending.slice(0, 4).map((i) => (
            <li key={i.id} className="text-[0.8125rem]">
              <Link className="text-ink hover:underline" to={`${PATHS.hrFeedback}?invitation=${encodeURIComponent(i.id)}`}>
                Feedback for {i.subjectName}
              </Link>
              <span className={i.overdue ? 'text-danger-600' : 'text-muted'}> · due {fmtDate(i.deadline)}</span>
            </li>
          ))}
          {nominate.map((r) => (
            <li key={r.id} className="text-[0.8125rem]">
              <Link className="text-ink hover:underline" to={`${PATHS.hrFeedback}?tab=about`}>
                Nominate colleagues for your feedback
              </Link>
              <span className="text-muted"> · by {fmtDate(r.deadline)}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}
