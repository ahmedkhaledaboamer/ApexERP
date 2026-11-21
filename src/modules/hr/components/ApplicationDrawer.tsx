import { useEffect, useState } from 'react'
import type { Application, ApplicationStage, Interview, InterviewType, OpeningDetail } from '@/modules/hr/recruitmentTypes'
import { APPLICATION_STAGES, INTERVIEW_STATUS_LABEL, INTERVIEW_TYPES, INTERVIEW_TYPE_LABEL, RECOMMENDATION_LABEL, STAGE_LABEL } from '@/modules/hr/recruitmentTypes'
import { useCreateOffer, useMoveApplication, useOfferStatus, useRecruitmentOptions, useScheduleInterview } from '@/modules/hr/hooks/useTalent'
import { FormError, OfferBadge, Score, Section, StageBadge } from '@/modules/hr/components/talentBits'
import { ScorecardModal } from '@/modules/hr/components/RecruitmentForms'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { useRegion } from '@/modules/tenancy/hooks'
import { todayIsoIn } from '@/shared/lib/companyDay'

const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** One application of an opening: stage, interviews (schedule, scorecards), offer (create, send, record the answer → hire). */
export function ApplicationDrawer({ opening, application, onClose }: { opening: OpeningDetail; application: Application | null; onClose: () => void }) {
  const me = useCurrentUser()
  const region = useRegion()
  const today = todayIsoIn(region.timezone)
  const toast = useToast()
  const options = useRecruitmentOptions()
  const move = useMoveApplication()
  const schedule = useScheduleInterview()
  const createOffer = useCreateOffer()
  const offerStatus = useOfferStatus()
  const [stage, setStage] = useState<ApplicationStage>('screening')
  const [reason, setReason] = useState('')
  const [iv, setIv] = useState({ date: plusDays(today, 2), time: '10:00', type: 'video' as InterviewType, location: '', interviewer: '' })
  const [offer, setOffer] = useState({ salary: '', startDate: plusDays(today, 30), expiryDate: plusDays(today, 7) })
  const [scoring, setScoring] = useState<Interview | null>(null)
  useEffect(() => {
    if (!application) return
    setStage(application.stage)
    setReason('')
    move.reset()
    schedule.reset()
    createOffer.reset()
    offerStatus.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application?.id])
  if (!application) return null
  const a = opening.applications.find((x) => x.id === application.id) ?? application
  const interviews = opening.interviews.filter((i) => i.applicationId === a.id)
  const offers = opening.offers.filter((f) => f.applicationId === a.id)
  const live = offers.find((f) => f.status === 'draft' || f.status === 'sent')
  const closed = ['hired', 'rejected', 'withdrawn'].includes(a.stage)

  return (
    <Drawer open={!!application} onClose={onClose} width="lg" title={a.candidateName} description={[a.candidateTitle, a.candidateCompany].filter(Boolean).join(' · ') || opening.title}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <StageBadge stage={a.stage} />
          <span className="text-xs text-muted">Overall</span>
          <Score value={a.overallScore} />
          {a.employeeId && <span className="text-xs text-success-600">Employee {a.employeeId}</span>}
          {a.rejectionReason && <span className="text-xs text-muted">Reason: {a.rejectionReason}</span>}
        </div>

        {opening.can.moveStages && !closed && (
          <Section title="Move">
            <div className="flex flex-wrap items-end gap-2">
              <Field id="ap-stage" label="Stage" className="w-44">
                <SelectInput id="ap-stage" value={stage} onChange={(e) => setStage(e.target.value as ApplicationStage)}>
                  {APPLICATION_STAGES.filter((s) => s !== 'hired').map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </SelectInput>
              </Field>
              {stage === 'rejected' && (
                <Field id="ap-reason" label="Reason" className="min-w-48 flex-1">
                  <TextInput id="ap-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              )}
              <Button write variant="secondary" loading={move.isPending} disabled={stage === a.stage} onClick={() => move.mutate({ id: a.id, input: { stage, reason } }, { onSuccess: (r) => toast.success(`Moved to ${STAGE_LABEL[r.stage]}`) })}>
                Move
              </Button>
            </div>
            <FormError error={move.error} />
          </Section>
        )}

        <Section title={`Interviews (${interviews.length})`}>
          {interviews.length === 0 && <p className="text-xs text-muted">No interviews yet.</p>}
          <ul className="space-y-2">
            {interviews.map((i) => (
              <li key={i.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[0.8125rem] font-medium text-ink">
                    {INTERVIEW_TYPE_LABEL[i.type]} · {fmtDate(i.scheduledAt, 'd MMM yyyy, HH:mm')}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {INTERVIEW_STATUS_LABEL[i.status]} · <Score value={i.overallScore} />
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">{i.interviewerNames.join(', ')}{i.location ? ` · ${i.location}` : ''}</p>
                {i.scorecards.map((s) => (
                  <p key={s.interviewerId} className="mt-1 text-xs text-ink-2">
                    {s.interviewerName}: {s.average.toFixed(1)} · {RECOMMENDATION_LABEL[s.recommendation]}{s.notes ? ` — ${s.notes}` : ''}
                  </p>
                ))}
                {me && i.interviewerIds.includes(me.id) && i.status !== 'cancelled' && (
                  <Button size="sm" variant="secondary" write className="mt-2" onClick={() => setScoring(i)}>
                    {i.scorecards.some((s) => s.interviewerId === me.id) ? 'Edit my scorecard' : 'Score interview'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {opening.can.moveStages && !closed && (
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-sunken p-3 sm:grid-cols-4">
              <Field id="iv-date" label="Date">
                <TextInput id="iv-date" type="date" value={iv.date} onChange={(e) => setIv({ ...iv, date: e.target.value })} />
              </Field>
              <Field id="iv-time" label={`Time (${region.timezone})`}>
                <TextInput id="iv-time" type="time" value={iv.time} onChange={(e) => setIv({ ...iv, time: e.target.value })} />
              </Field>
              <Field id="iv-type" label="Type">
                <SelectInput id="iv-type" value={iv.type} onChange={(e) => setIv({ ...iv, type: e.target.value as InterviewType })}>
                  {INTERVIEW_TYPES.map((t) => <option key={t} value={t}>{INTERVIEW_TYPE_LABEL[t]}</option>)}
                </SelectInput>
              </Field>
              <Field id="iv-who" label="Interviewer">
                <SelectInput id="iv-who" value={iv.interviewer} onChange={(e) => setIv({ ...iv, interviewer: e.target.value })}>
                  <option value="">Pick…</option>
                  {options.data?.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </SelectInput>
              </Field>
              <div className="col-span-2 sm:col-span-4">
                <Button
                  size="sm"
                  write
                  loading={schedule.isPending}
                  disabled={!iv.interviewer}
                  onClick={() =>
                    schedule.mutate(
                      { applicationId: a.id, input: { date: iv.date, time: iv.time, durationMinutes: 60, type: iv.type, location: iv.location, interviewerIds: [iv.interviewer] } },
                      { onSuccess: () => toast.success('Interview scheduled') },
                    )
                  }
                >
                  Schedule interview
                </Button>
              </div>
            </div>
          )}
          <FormError error={schedule.error} />
        </Section>

        {opening.salaryVisible && (
          <Section title="Offer">
            {offers.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
                <span className="text-[0.8125rem] text-ink">
                  {fmtMoney(f.salary, f.currency)} · starts {fmtDate(f.startDate)} · expires {fmtDate(f.expiryDate)}
                </span>
                <span className="flex items-center gap-2">
                  <OfferBadge status={f.status} expired={f.expired} />
                  {opening.can.makeOffers && f.status === 'draft' && (
                    <Button size="sm" write onClick={() => offerStatus.mutate({ id: f.id, input: { status: 'sent' } })}>Mark sent</Button>
                  )}
                  {opening.can.makeOffers && f.status === 'sent' && (
                    <>
                      <Button size="sm" write onClick={() => offerStatus.mutate({ id: f.id, input: { status: 'accepted' } }, { onSuccess: (r) => toast.success('Offer accepted', r.employeeId ? `Hired: employee ${r.employeeId} created.` : undefined) })}>
                        Accepted
                      </Button>
                      <Button size="sm" variant="secondary" write onClick={() => offerStatus.mutate({ id: f.id, input: { status: 'declined' } })}>Declined</Button>
                    </>
                  )}
                </span>
              </div>
            ))}
            {opening.can.makeOffers && !live && !closed && ['interview', 'assessment', 'offer'].includes(a.stage) && (
              <div className="grid grid-cols-1 gap-2 rounded-lg bg-sunken p-3 sm:grid-cols-3">
                <Field id="of-salary" label={`Monthly salary (${opening.salaryCurrency ?? options.data?.currency ?? ''})`}>
                  <TextInput id="of-salary" type="number" min={0} value={offer.salary} onChange={(e) => setOffer({ ...offer, salary: e.target.value })} />
                </Field>
                <Field id="of-start" label="Start date">
                  <TextInput id="of-start" type="date" value={offer.startDate} onChange={(e) => setOffer({ ...offer, startDate: e.target.value })} />
                </Field>
                <Field id="of-expiry" label="Offer expires">
                  <TextInput id="of-expiry" type="date" value={offer.expiryDate} onChange={(e) => setOffer({ ...offer, expiryDate: e.target.value })} />
                </Field>
                <div className="sm:col-span-3">
                  <Button
                    size="sm"
                    write
                    loading={createOffer.isPending}
                    onClick={() =>
                      createOffer.mutate(
                        { applicationId: a.id, input: { salary: Number(offer.salary), currency: opening.salaryCurrency ?? options.data?.currency ?? 'AED', startDate: offer.startDate, expiryDate: offer.expiryDate } },
                        { onSuccess: () => toast.success('Offer drafted') },
                      )
                    }
                  >
                    Create offer
                  </Button>
                </div>
              </div>
            )}
            <FormError error={createOffer.error ?? offerStatus.error} />
          </Section>
        )}
      </div>
      <ScorecardModal interview={scoring} onClose={() => setScoring(null)} />
    </Drawer>
  )
}
