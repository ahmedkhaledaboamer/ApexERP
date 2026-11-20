import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Contact, Flame, Snowflake, Sun, Trophy } from 'lucide-react'
import type { CaptureRating } from '@/modules/events/types'
import { CAPTURE_RATINGS, CAPTURE_RATING_LABEL } from '@/modules/events/types'
import { useEventQuery } from '@/modules/events/hooks/useEvents'
import { useCapturesQuery, useCreateCapture } from '@/modules/events/hooks/useEventsAdvanced'
import { eventPath, leadPath } from '@/app/paths'
import { useRegion } from '@/modules/tenancy/hooks'
import { useCurrentUser } from '@/store/hooks'
import { mobileExample } from '@/shared/lib/phone'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, TextArea, TextInput } from '@/shared/components/form/Field'
import { PageBody } from '@/shared/components/layout/PageHeader'

const RATING_ICON = { hot: Flame, warm: Sun, cold: Snowflake } as const
const RATING_TONE = { hot: 'red', warm: 'amber', cold: 'sky' } as const

const EMPTY = { name: '', companyName: '', email: '', mobile: '', title: '', notes: '', cardPhotoUrl: '' }

/**
 * `/events/:id/capture`: fast, phone-friendly booth lead capture for the event team. Saving creates
 * (or links) the lead at once and clears the form for the next visitor.
 */
export default function EventCapturePage() {
  const { id = '' } = useParams()
  const me = useCurrentUser()
  const region = useRegion()
  const event = useEventQuery(id)
  const captures = useCapturesQuery(id)
  const create = useCreateCapture()
  const toast = useToast()
  const [v, setV] = useState(EMPTY)
  const [rating, setRating] = useState<CaptureRating | null>(null)
  const set = (k: keyof typeof EMPTY, val: string) => setV((x) => ({ ...x, [k]: val }))

  if (event.isPending) return <PageBody><Skeleton className="h-96 rounded-card" /></PageBody>
  if (event.error) return <PageBody><ErrorState message={event.error.message} onRetry={() => event.refetch()} /></PageBody>
  const e = event.data
  if (!e.canEdit) return <PageBody><EmptyState icon={<Contact />} title="Booth capture isn’t available to you" body="Event team members and marketing managers capture leads." /></PageBody>
  const mine = (captures.data ?? []).filter((c) => c.capturedBy === me?.id)

  function submit(ev: FormEvent) {
    ev.preventDefault()
    if (!rating) {
      toast.error('Rate the interest', 'Hot, warm or cold.')
      return
    }
    create.mutate(
      { id, input: { ...v, rating } },
      {
        onSuccess: (r) => {
          toast.success('Captured', r.message)
          setV(EMPTY)
          setRating(null)
        },
        onError: (err) => toast.error('Not captured', err.message),
      },
    )
  }

  return (
    <PageBody className="mx-auto max-w-xl space-y-5">
      <div>
        <Link to={eventPath(e.id)} className="text-xs text-muted hover:text-ink">
          ← {e.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Booth capture</h1>
        <p className="text-[0.8125rem] text-muted">
          You’ve captured {mine.length} visitor{mine.length === 1 ? '' : 's'} here.{' '}
          <Link to={eventPath(e.id, 'leads')} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
            <Trophy className="inline size-3.5" aria-hidden /> Leaderboard
          </Link>
        </p>
      </div>
      <Card>
        <CardBody>
          <form onSubmit={submit} className="space-y-4" aria-label="Capture a lead">
            <Field id="cap-name" label="Name" required>
              <TextInput id="cap-name" autoComplete="off" value={v.name} onChange={(ev) => set('name', ev.target.value)} className="h-11 text-base" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="cap-company" label="Company">
                <TextInput id="cap-company" autoComplete="off" value={v.companyName} onChange={(ev) => set('companyName', ev.target.value)} className="h-11 text-base" />
              </Field>
              <Field id="cap-title" label="Title">
                <TextInput id="cap-title" autoComplete="off" value={v.title} onChange={(ev) => set('title', ev.target.value)} className="h-11 text-base" />
              </Field>
            </div>
            <Field id="cap-email" label="Email" hint="Email or mobile">
              <TextInput id="cap-email" type="email" inputMode="email" autoComplete="off" value={v.email} onChange={(ev) => set('email', ev.target.value)} className="h-11 text-base" />
            </Field>
            <Field id="cap-mobile" label="Mobile" hint={mobileExample(region.country)}>
              <TextInput id="cap-mobile" type="tel" inputMode="tel" autoComplete="off" value={v.mobile} onChange={(ev) => set('mobile', ev.target.value)} className="h-11 text-base" />
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-[0.8125rem] font-medium">Interest</legend>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Interest rating">
                {CAPTURE_RATINGS.map((r) => {
                  const Icon = RATING_ICON[r]
                  const on = rating === r
                  return (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setRating(r)}
                      className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border text-sm font-medium ${on ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'border-line text-ink-2 hover:bg-sunken'}`}
                    >
                      <Icon className="size-5" aria-hidden />
                      {CAPTURE_RATING_LABEL[r]}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <Field id="cap-notes" label="Notes">
              <TextArea id="cap-notes" rows={3} value={v.notes} onChange={(ev) => set('notes', ev.target.value)} />
            </Field>
            <Field id="cap-card" label="Business card photo (link)">
              <TextInput id="cap-card" type="url" placeholder="https://…" value={v.cardPhotoUrl} onChange={(ev) => set('cardPhotoUrl', ev.target.value)} />
            </Field>
            <Button write type="submit" size="lg" className="w-full" loading={create.isPending} disabled={e.status === 'cancelled'}>
              Save lead
            </Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="My latest captures" />
        {mine.length === 0 ? (
          <CardBody><p className="text-[0.8125rem] text-muted">Nothing yet.</p></CardBody>
        ) : (
          <ul className="divide-y divide-line" aria-label="My captures">
            {mine.slice(0, 10).map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-2.5 text-[0.8125rem]">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted">{c.companyName || c.email || c.mobile}</p>
                </div>
                <Badge tone={RATING_TONE[c.rating]}>{CAPTURE_RATING_LABEL[c.rating]}</Badge>
                {c.canOpenLead && c.leadId && (
                  <Link to={leadPath(c.leadId)} className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                    Lead
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageBody>
  )
}
