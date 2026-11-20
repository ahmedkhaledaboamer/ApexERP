import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, MessageSquareHeart, Star } from 'lucide-react'
import { getPublicSurvey, submitSurvey } from '@/modules/events/api/eventsAdvancedApi'
import { PRODUCT_NAME } from '@/modules/tenancy/branding'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Field, TextArea } from '@/shared/components/form/Field'

/** `/s/:token`: an attendee's feedback survey (no sign-in): rating 1–5, NPS 0–10, comment; once. */
export default function PublicSurveyPage() {
  const { token = '' } = useParams()
  const info = useQuery({ queryKey: ['public-survey', token], queryFn: () => getPublicSurvey(token), retry: false })
  const [rating, setRating] = useState(0)
  const [nps, setNps] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [touched, setTouched] = useState(false)
  const send = useMutation({ mutationFn: () => submitSurvey(token, { rating, nps: nps ?? 0, comment }) })

  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!rating || nps === null) return
    send.mutate()
  }

  return (
    <div className="min-h-full bg-canvas px-4 py-10 sm:py-16">
      <main className="mx-auto w-full max-w-lg">
        {info.isPending ? (
          <Skeleton className="h-80 rounded-card" />
        ) : info.error ? (
          <div role="alert" className="rounded-card border border-line bg-surface p-8 text-center shadow-soft">
            <h1 className="text-[1.25rem] font-semibold">Survey not found</h1>
            <p className="mt-2 text-[0.875rem] text-muted">Check the link you were sent.</p>
          </div>
        ) : (
          <div className="rounded-card border border-line bg-surface p-6 shadow-soft sm:p-8">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">{info.data.organizerName}</p>
            <h1 className="mt-1 text-[1.375rem] leading-tight font-semibold">How was {info.data.eventName}?</h1>
            {send.isSuccess || info.data.submitted ? (
              <div role="status" className="mt-6 text-center">
                <CheckCircle2 className="mx-auto size-10 text-success-600" aria-hidden />
                <p className="mt-3 font-semibold">Thank you for your feedback{info.data.attendeeFirstName ? `, ${info.data.attendeeFirstName}` : ''}!</p>
              </div>
            ) : !info.data.open ? (
              <p role="status" className="mt-4 rounded-lg bg-sunken px-4 py-3 text-[0.875rem]">{info.data.closedReason ?? 'This survey is closed.'}</p>
            ) : (
              <form onSubmit={submit} noValidate className="mt-5 space-y-5" aria-label="Feedback survey">
                <fieldset>
                  <legend className="mb-1.5 text-[0.875rem] font-medium">Your overall rating</legend>
                  <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setRating(n)} className="rounded p-1 text-warning-500 hover:bg-sunken">
                        <Star className={`size-7 ${n <= rating ? 'fill-current' : ''}`} />
                      </button>
                    ))}
                  </div>
                  {touched && !rating && <p className="mt-1 text-xs text-danger-600">Pick a rating.</p>}
                </fieldset>
                <fieldset>
                  <legend className="mb-1.5 text-[0.875rem] font-medium">How likely are you to recommend us to a colleague?</legend>
                  <div className="grid grid-cols-11 gap-1" role="radiogroup" aria-label="Likelihood to recommend">
                    {Array.from({ length: 11 }, (_, n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={nps === n}
                        aria-label={`${n} out of 10`}
                        onClick={() => setNps(n)}
                        className={`num h-9 rounded-md border text-sm ${nps === n ? 'border-brand-500 bg-brand-600 text-white' : 'border-line hover:bg-sunken'}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-muted">
                    <span>Not likely</span>
                    <span>Very likely</span>
                  </div>
                  {touched && nps === null && <p className="mt-1 text-xs text-danger-600">Pick a number.</p>}
                </fieldset>
                <Field id="sv-comment" label="Anything else?">
                  <TextArea id="sv-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
                </Field>
                {send.isError && <p role="alert" className="text-sm text-danger-600">{send.error.message}</p>}
                <Button type="submit" className="w-full" loading={send.isPending}>
                  <MessageSquareHeart />
                  Send feedback
                </Button>
              </form>
            )}
          </div>
        )}
        <p className="mt-6 text-center text-[0.75rem] text-subtle">{PRODUCT_NAME}</p>
      </main>
    </div>
  )
}
