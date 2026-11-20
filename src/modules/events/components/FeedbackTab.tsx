import { Gauge, MessageSquareText, Star, Users } from 'lucide-react'
import type { EventDetail } from '@/modules/events/types'
import { useSurveyResultsQuery } from '@/modules/events/hooks/useEventsAdvanced'
import { fmtDate } from '@/shared/lib/utils'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'

/** Feedback survey results: response rate, average rating, NPS (promoters − detractors) and comments. */
export function FeedbackTab({ event: e }: { event: EventDetail }) {
  const q = useSurveyResultsQuery(e.id)
  if (q.isPending) return <Skeleton className="h-48 rounded-card" />
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  const s = q.data
  return (
    <div className="space-y-6">
      <section aria-label="Survey results" className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatCard label="Responses" icon={<Users />} value={s.responses} hint={s.responseRate === null ? 'No attendees yet' : `${s.responseRate}% of ${s.invited} attendees`} />
        <StatCard label="Average rating" icon={<Star />} value={s.averageRating === null ? '—' : `${s.averageRating} / 5`} />
        <StatCard
          label="NPS"
          icon={<Gauge />}
          value={s.nps === null ? '—' : s.nps > 0 ? `+${s.nps}` : String(s.nps)}
          hint={`${s.promoters} promoters · ${s.passives} passives · ${s.detractors} detractors`}
        />
      </section>
      <Card>
        <CardHeader
          title="Comments"
          icon={<MessageSquareText />}
          description={e.status === 'completed' ? 'Each attendee gets their own survey link ({{event.survey_url}} in the follow-up email); one answer each.' : 'The survey opens once the event is over.'}
        />
        {s.comments.length === 0 ? (
          <CardBody><p className="text-[0.8125rem] text-muted">No comments yet.</p></CardBody>
        ) : (
          <ul className="divide-y divide-line" aria-label="Survey comments">
            {s.comments.map((c, i) => (
              <li key={i} className="px-5 py-3 text-[0.8125rem]">
                <p className="text-ink">{c.comment}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {c.attendeeName} · {'★'.repeat(c.rating)} · NPS {c.nps} · {fmtDate(c.submittedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
