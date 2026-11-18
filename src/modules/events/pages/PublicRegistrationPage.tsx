import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CalendarDays, CheckCircle2, Globe, MapPin, Ticket } from 'lucide-react'
import type { CountryCode } from '@/modules/tenancy/types'
import { EVENT_TYPE_LABEL } from '@/modules/events/types'
import { getPublicEvent, registerPublic } from '@/modules/events/api/eventsApi'
import { eventWhen } from '@/modules/events/components/eventMeta'
import { ApiError } from '@/shared/lib/apiError'
import { isMobile, mobileError, mobileExample, MOBILE_RULES } from '@/shared/lib/phone'
import { PRODUCT_NAME } from '@/modules/tenancy/branding'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Field, TextInput } from '@/shared/components/form/Field'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * `/e/:token`: an event's public registration page (no sign-in, no workspace). Shows the event's
 * public details and a short form; whoever registers becomes a lead with the source Event in the
 * organizer's workspace. A hidden honeypot field catches bots.
 */
export default function PublicRegistrationPage() {
  const { token = '' } = useParams()
  const info = useQuery({ queryKey: ['public-event', token], queryFn: () => getPublicEvent(token), retry: false, staleTime: 60_000 })
  const [v, setV] = useState({ name: '', companyName: '', email: '', mobile: '', title: '', website: '' })
  const [touched, setTouched] = useState(false)
  const register = useMutation({ mutationFn: () => registerPublic(token, v) })
  const set = (k: keyof typeof v, value: string) => setV((x) => ({ ...x, [k]: value }))
  const country = (info.data?.country && info.data.country in MOBILE_RULES ? info.data.country : 'AE') as CountryCode

  const errs: Partial<Record<keyof typeof v, string>> = {}
  if (touched) {
    if (v.name.trim().length < 2) errs.name = 'Enter your full name.'
    if (!EMAIL_RE.test(v.email.trim())) errs.email = 'Enter a valid email address.'
    if (v.mobile && !isMobile(v.mobile, country)) errs.mobile = mobileError(country)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (v.name.trim().length < 2 || !EMAIL_RE.test(v.email.trim()) || (v.mobile && !isMobile(v.mobile, country))) return
    register.mutate()
  }

  return (
    <div className="min-h-full bg-canvas px-4 py-10 sm:py-16">
      <main className="mx-auto w-full max-w-xl">
        {info.isPending ? (
          <div className="space-y-4 rounded-card border border-line bg-surface p-8">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-40" />
          </div>
        ) : info.error ? (
          <div role="alert" className="rounded-card border border-line bg-surface p-8 text-center shadow-soft">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-sunken text-muted [&_svg]:size-6">
              <Ticket />
            </div>
            <h1 className="text-[1.25rem] font-semibold tracking-tight">Registration link not found</h1>
            <p className="mt-2 text-[0.875rem] text-muted">
              {info.error instanceof ApiError && info.error.status === 404 ? 'Check the link you were sent, or ask the organizer for a new one.' : info.error.message}
            </p>
          </div>
        ) : (
          <div className="rounded-card border border-line bg-surface shadow-soft">
            <header className="border-b border-line p-6 sm:p-8">
              <p className="text-xs font-medium tracking-wide text-muted uppercase">
                {EVENT_TYPE_LABEL[info.data.type]} · {info.data.organizerName}
              </p>
              <h1 className="mt-1.5 text-[1.5rem] leading-tight font-semibold tracking-[-0.02em]">{info.data.name}</h1>
              <ul className="mt-3 space-y-1 text-[0.875rem] text-ink-2">
                <li className="num flex items-center gap-2">
                  <CalendarDays className="size-4 text-muted" aria-hidden />
                  {eventWhen(info.data)}
                  <span className="text-xs text-muted">({info.data.timezone})</span>
                </li>
                {info.data.location && (
                  <li className="flex items-center gap-2">
                    <MapPin className="size-4 text-muted" aria-hidden />
                    {info.data.location}
                  </li>
                )}
                {info.data.onlineUrl && (
                  <li className="flex items-center gap-2">
                    <Globe className="size-4 text-muted" aria-hidden />
                    Online
                  </li>
                )}
              </ul>
              {info.data.description && <p className="mt-3 text-[0.875rem] whitespace-pre-line text-muted">{info.data.description}</p>}
            </header>
            <div className="p-6 sm:p-8">
              {register.isSuccess ? (
                <div role="status" className="text-center">
                  <CheckCircle2 className="mx-auto size-10 text-success-600" aria-hidden />
                  <h2 className="mt-3 text-lg font-semibold">{register.data.message}</h2>
                  <p className="mt-1 text-[0.875rem] text-muted">{info.data.organizerName} will be in touch about {info.data.name}.</p>
                </div>
              ) : !info.data.registrationOpen ? (
                <p role="status" className="rounded-lg bg-sunken px-4 py-3 text-[0.875rem] text-ink-2">
                  {info.data.closedReason ?? 'Registration is closed.'}
                </p>
              ) : (
                <form noValidate onSubmit={submit} className="space-y-4" aria-label="Register for this event">
                  <h2 className="text-base font-semibold">Register</h2>
                  <Field id="pr-name" label="Full name" required error={errs.name}>
                    <TextInput id="pr-name" autoComplete="name" value={v.name} invalid={!!errs.name} onChange={(e) => set('name', e.target.value)} />
                  </Field>
                  <Field id="pr-email" label="Work email" required error={errs.email}>
                    <TextInput id="pr-email" type="email" autoComplete="email" value={v.email} invalid={!!errs.email} onChange={(e) => set('email', e.target.value)} />
                  </Field>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field id="pr-company" label="Company">
                      <TextInput id="pr-company" autoComplete="organization" value={v.companyName} onChange={(e) => set('companyName', e.target.value)} />
                    </Field>
                    <Field id="pr-title" label="Job title">
                      <TextInput id="pr-title" autoComplete="organization-title" value={v.title} onChange={(e) => set('title', e.target.value)} />
                    </Field>
                  </div>
                  <Field id="pr-mobile" label="Mobile" error={errs.mobile} hint={errs.mobile ? undefined : mobileExample(country)}>
                    <TextInput id="pr-mobile" type="tel" autoComplete="tel" value={v.mobile} invalid={!!errs.mobile} onChange={(e) => set('mobile', e.target.value)} />
                  </Field>
                  {/* Honeypot: hidden from people (and from assistive tech); bots fill it. */}
                  <div aria-hidden="true" className="absolute -start-[10000px] h-px w-px overflow-hidden">
                    <label htmlFor="pr-website">Website</label>
                    <input id="pr-website" tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => set('website', e.target.value)} />
                  </div>
                  {register.isError && (
                    <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
                      {register.error.message}
                    </p>
                  )}
                  <Button type="submit" className="w-full" loading={register.isPending}>
                    Register
                  </Button>
                  <p className="text-xs text-muted">Your details go to {info.data.organizerName} so they can follow up about this event.</p>
                </form>
              )}
            </div>
          </div>
        )}
        <p className="mt-6 text-center text-[0.75rem] text-subtle">{PRODUCT_NAME}</p>
      </main>
    </div>
  )
}
