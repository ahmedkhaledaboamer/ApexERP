import { useState } from 'react'
import { displayMobile } from '@/shared/lib/phone'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CalendarClock, ExternalLink, Mail, Mic2, Pencil, Phone, Star, Trash2 } from 'lucide-react'
import type { SpeakerEventEntry } from '@/modules/events/libraryTypes'
import { useDeleteSpeaker, useRateSpeaker, useSpeakerQuery } from '@/modules/events/hooks/useEventLibrary'
import { EVENT_STATUS_LABEL, type EventStatus } from '@/modules/events/types'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { LibraryError, Rating, RatingInput, Tags } from '@/modules/events/components/library/LibraryBits'
import { SpeakerDrawer } from '@/modules/events/components/library/SpeakerDrawer'
import { PATHS, eventPath } from '@/app/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader, Property, PropertyList } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, TextArea } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'

/** `/events/speakers/:id`: a directory speaker — profile, the events and sessions they spoke at, ratings history. */
export default function SpeakerDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const query = useSpeakerQuery(id)
  const remove = useDeleteSpeaker()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [rating, setRating] = useState<SpeakerEventEntry | null>(null)

  if (query.isPending) return <PageBody><Skeleton className="h-64 rounded-card" /></PageBody>
  if (query.error) return <PageBody><LibraryError error={query.error} onRetry={() => query.refetch()} what="Speakers" /></PageBody>
  const s = query.data

  return (
    <>
      <PageHeader
        icon={s.photoUrl ? <img src={s.photoUrl} alt="" className="size-10 rounded-full object-cover" /> : <Avatar name={s.name} />}
        title={s.name}
        description={
          <>
            {[s.title, s.company].filter(Boolean).join(' · ') || 'Speaker'} ·{' '}
            <Link to={PATHS.eventSpeakers} className="font-medium text-brand-700 hover:underline dark:text-brand-300">All speakers</Link>
          </>
        }
        actions={
          s.canManage && (
            <>
              <Button
                write
                variant="ghost"
                onClick={() => remove.mutate(s.id, { onSuccess: () => { toast.success('Speaker deleted', s.name); navigate(PATHS.eventSpeakers) }, onError: (err) => toast.error('Not deleted', err.message) })}
              >
                <Trash2 />
                Delete
              </Button>
              <Button write variant="secondary" onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
            </>
          )
        }
      />
      <PageBody className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Events & sessions" icon={<CalendarClock />} description={s.hiddenEvents ? `${s.hiddenEvents} more event${s.hiddenEvents === 1 ? '' : 's'} you can’t see.` : undefined} />
            {s.events.length === 0 ? (
              <CardBody>
                <p className="text-[0.8125rem] text-muted">Not on any event yet. Add them from an event’s Agenda tab.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-line" aria-label="Events">
                {s.events.map((e) => (
                  <li key={e.eventId} className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <Link to={eventPath(e.eventId, 'agenda')} className="font-medium text-ink hover:underline">{e.eventName}</Link>
                        <p className="text-xs text-muted">{fmtDate(e.startDate)} · {EVENT_STATUS_LABEL[e.status as EventStatus] ?? e.status}</p>
                      </div>
                      {e.rating !== null && <Rating value={e.rating} />}
                      {e.canRate && (
                        <Button write variant="secondary" size="sm" onClick={() => setRating(e)}>
                          <Star />
                          {e.rating === null ? 'Rate' : 'Re-rate'}
                        </Button>
                      )}
                    </div>
                    {e.sessions.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {e.sessions.map((x) => (
                          <li key={x.id} className="text-xs text-ink-2">
                            <span className="num text-muted">{fmtDate(x.date)} {x.startTime}–{x.endTime}</span> · {x.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Ratings history" icon={<Star />} action={<Rating value={s.rating} count={s.ratingCount} />} />
            <CardBody>
              {s.ratings.length === 0 ? (
                <p className="text-[0.8125rem] text-muted">No ratings yet. Rate a speaker after a completed event.</p>
              ) : (
                <ul className="space-y-3" aria-label="Ratings">
                  {s.ratings.map((r) => (
                    <li key={r.eventId} className="text-[0.8125rem]">
                      <div className="flex items-center gap-2">
                        <Rating value={r.rating} />
                        <span className="font-medium">{r.eventName}</span>
                        <span className="ms-auto text-xs text-muted">{r.ratedByName} · {fmtDate(r.ratedAt.slice(0, 10))}</span>
                      </div>
                      {r.note && <p className="mt-0.5 text-xs text-muted">{r.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader title="Profile" icon={<Mic2 />} action={<Badge tone={s.kind === 'internal' ? 'brand' : 'neutral'}>{s.kind === 'internal' ? 'Internal' : 'External'}</Badge>} />
          <CardBody>
            <PropertyList>
              {s.kind === 'internal' && <Property label="Employee">{s.userName || 'Not linked'}</Property>}
              <Property label="Email" icon={<Mail />}>{s.email ? <a href={`mailto:${s.email}`} className="hover:underline">{s.email}</a> : '—'}</Property>
              <Property label="Mobile" icon={<Phone />}>{displayMobile(s.mobile) || '—'}</Property>
              <Property label="LinkedIn" icon={<ExternalLink />}>
                {s.linkedinUrl ? <a href={s.linkedinUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">Profile</a> : '—'}
              </Property>
              <Property label="Topics"><Tags tags={s.topics} /></Property>
              <Property label="Fee">{s.fee === null ? '—' : moneyIn(s.fee, s.feeCurrency)}</Property>
            </PropertyList>
            {s.bio && <p className="mt-4 whitespace-pre-line text-[0.8125rem] text-ink-2">{s.bio}</p>}
            {s.notes && <p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-xs text-muted">{s.notes}</p>}
          </CardBody>
        </Card>
      </PageBody>
      {s.canManage && <SpeakerDrawer open={editing} onClose={() => setEditing(false)} speaker={s} />}
      {rating && <RateSpeakerModal speakerId={s.id} entry={rating} onClose={() => setRating(null)} />}
    </>
  )
}

function RateSpeakerModal({ speakerId, entry, onClose }: { speakerId: string; entry: SpeakerEventEntry; onClose: () => void }) {
  const rate = useRateSpeaker()
  const toast = useToast()
  const [value, setValue] = useState(entry.rating ?? 4)
  const [note, setNote] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      title="Rate the talk"
      description={entry.eventName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            loading={rate.isPending}
            onClick={() => rate.mutate({ id: speakerId, input: { eventId: entry.eventId, rating: value, note } }, { onSuccess: () => { toast.success('Rating saved'); onClose() }, onError: (err) => toast.error('Not saved', err.message) })}
          >
            Save rating
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <RatingInput value={value} onChange={setValue} label="Talk rating" />
        <Field id="rate-note" label="Note">
          <TextArea id="rate-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
