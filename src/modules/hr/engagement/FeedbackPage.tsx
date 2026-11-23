import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MessagesSquare } from 'lucide-react'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { TextArea } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ErrorText, FormError, Section, SimpleTable, td } from '@/modules/hr/components/talentBits'
import { fmtDate } from '@/shared/lib/utils'
import { feedbackApi, useEngWrite, useInvitation, useMyFeedback, useRound, useRoundSummary, useRounds } from './api'
import { PROVIDER_STATUS_LABEL, RELATIONSHIP_LABEL, type FeedbackRating, type FeedbackRound, type Invitation } from './types'
import { ColleaguePicker, RoundManage } from './components/RoundPanels'
import { FeedbackSummaryView } from './components/FeedbackSummaryView'

type Tab = 'give' | 'about' | 'manage'

/**
 * `/hr/feedback` (360° feedback; plan-gated only, every employee): "Requests to answer" (answer or decline),
 * "About me" (nominate peers; the summary once the review is shared), "Requests I manage" for HR and managers.
 * Within a review cycle the same panel lives in the performance review drawer. ?invitation=, ?round=.
 */
export default function FeedbackPage() {
  const my = useMyFeedback()
  const rounds = useRounds()
  const [params, setParams] = useSearchParams()
  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = [
      { id: 'give', label: 'Requests to answer' },
      { id: 'about', label: 'About me' },
    ]
    if (rounds.data?.length) t.push({ id: 'manage', label: 'Requests I manage' })
    return t
  }, [rounds.data])
  const tab = (tabs.find((t) => t.id === params.get('tab'))?.id ?? 'give') as Tab
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }
  return (
    <>
      <PageHeader icon={<IconTile><MessagesSquare /></IconTile>} title="360° feedback" description="Feedback from colleagues, grouped and anonymous: no one sees who said what." />
      <PageBody>
        <Tabs items={tabs} value={tab} onChange={(t) => set({ tab: t })} label="Feedback sections" className="mb-4" />
        {my.error ? (
          <ErrorText error={my.error} />
        ) : my.isPending ? (
          <Skeleton className="h-40" />
        ) : !my.data.employeeLinked ? (
          <EmptyState icon={<MessagesSquare />} title="No employee record" body="Your account isn’t linked to an employee record yet." />
        ) : (
          <>
            {tab === 'give' && (
              my.data.invitations.length === 0 ? (
                <p className="text-[0.8125rem] text-muted">Nobody has asked you for feedback.</p>
              ) : (
                <SimpleTable label="Feedback requests" head={['About', 'Relationship', 'Deadline', 'Status', '']}>
                  {my.data.invitations.map((i) => (
                    <tr key={i.id}>
                      <td className={td}>{i.subjectName}</td>
                      <td className={td}>{RELATIONSHIP_LABEL[i.relationship]}</td>
                      <td className={`${td} ${i.overdue ? 'text-danger-600' : ''}`}>{fmtDate(i.deadline)}</td>
                      <td className={td}>
                        <Badge tone={i.status === 'submitted' ? 'green' : i.status === 'declined' ? 'neutral' : 'sky'}>{PROVIDER_STATUS_LABEL[i.status]}</Badge>
                      </td>
                      <td className={td}>
                        <Button size="xs" variant={i.status === 'pending' ? 'primary' : 'secondary'} aria-label={`Give feedback · ${i.subjectName}`} onClick={() => set({ invitation: i.id })}>
                          {i.status === 'pending' ? 'Give feedback' : 'Open'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </SimpleTable>
              )
            )}
            {tab === 'about' && (my.data.aboutMe.length === 0 ? <p className="text-[0.8125rem] text-muted">No 360° feedback has been requested for you.</p> : <div className="space-y-6">{my.data.aboutMe.map((r) => <AboutMe key={r.id} r={r} />)}</div>)}
            {tab === 'manage' && (
              <SimpleTable label="Feedback rounds" head={['Employee', 'Cycle', 'Deadline', 'Answers', '']}>
                {(rounds.data ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className={td}>
                      {r.subjectName}
                      <span className="block text-xs text-muted">{r.departmentName ?? ''}</span>
                    </td>
                    <td className={td}>{r.cycleName ?? 'Ad hoc'}</td>
                    <td className={td}>{fmtDate(r.deadline)}</td>
                    <td className={`${td} num`}>
                      {r.counts.submitted} / {r.counts.invited}
                      {r.counts.nominated ? <Badge tone="amber">{r.counts.nominated} to approve</Badge> : null}
                    </td>
                    <td className={td}>
                      <Button size="xs" variant="secondary" aria-label={`Open feedback · ${r.subjectName}`} onClick={() => set({ round: r.id })}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </SimpleTable>
            )}
          </>
        )}
      </PageBody>
      <InvitationDrawer id={params.get('invitation')} onClose={() => set({ invitation: null })} />
      <RoundDrawer id={params.get('round')} onClose={() => set({ round: null })} />
    </>
  )
}

function AboutMe({ r }: { r: FeedbackRound }) {
  const toast = useToast()
  const nominate = useEngWrite((ids: string[]) => feedbackApi.nominate(r.id, ids))
  const summary = useRoundSummary(r.summaryVisible ? r.id : null)
  return (
    <Section title={`${r.cycleName ?? 'Ad hoc feedback'} · deadline ${fmtDate(r.deadline)}`}>
      <p className="text-xs text-muted">
        {r.counts.invited} colleague{r.counts.invited === 1 ? '' : 's'} asked. You never see who answered.
      </p>
      {r.nominations.length > 0 && (
        <ul className="text-[0.8125rem] text-ink-2">
          {r.nominations.map((n) => (
            <li key={n.employeeId}>
              {n.name} · <span className="text-muted">{n.status === 'awaiting' ? 'awaiting your manager’s approval' : n.status === 'approved' ? 'approved' : 'not approved'}</span>
            </li>
          ))}
        </ul>
      )}
      {r.can.nominate && (
        <ColleaguePicker
          withRelationship={false}
          exclude={[r.subjectEmployeeId, ...r.nominations.map((n) => n.employeeId)]}
          busy={nominate.isPending}
          label="Nominate"
          onPick={(p) => nominate.mutate(p.map((x) => x.employeeId), { onSuccess: () => toast.success('Nominations sent to your manager') })}
        />
      )}
      <FormError error={nominate.error} />
      {r.summaryVisible ? summary.data ? <FeedbackSummaryView s={summary.data} /> : <Skeleton className="h-24" /> : <p className="text-xs text-muted">The summary appears here once your review is shared.</p>}
    </Section>
  )
}

function RoundDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useRound(id)
  const summary = useRoundSummary(q.data && q.data.viewer !== 'subject' ? q.data.id : null)
  return (
    <Drawer open={!!id} onClose={onClose} width="xl" title={q.data ? `360° feedback · ${q.data.subjectName}` : '360° feedback'} description={q.data?.cycleName ?? undefined}>
      {q.error ? (
        <ErrorText error={q.error} />
      ) : !q.data ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="space-y-6">
          {q.data.viewer !== 'subject' && <RoundManage r={q.data} />}
          {summary.data && <FeedbackSummaryView s={summary.data} />}
        </div>
      )}
    </Drawer>
  )
}

function InvitationDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useInvitation(id)
  return (
    <Drawer open={!!id} onClose={onClose} width="lg" title={q.data ? `Feedback for ${q.data.subjectName}` : 'Feedback'} description={q.data ? `${q.data.subjectJobTitle} · answer by ${fmtDate(q.data.deadline)}` : undefined}>
      {q.error ? <ErrorText error={q.error} /> : !q.data ? <Skeleton className="h-60" /> : <InvitationForm key={q.data.id} inv={q.data} onDone={onClose} />}
    </Drawer>
  )
}

function InvitationForm({ inv, onDone }: { inv: Invitation; onDone: () => void }) {
  const toast = useToast()
  const [ratings, setRatings] = useState<FeedbackRating[]>(() => inv.competencies.map((c) => inv.ratings.find((r) => r.competencyId === c.id) ?? { competencyId: c.id, rating: null }))
  const [strengths, setStrengths] = useState(inv.strengths)
  const [improvements, setImprovements] = useState(inv.improvements)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const save = useEngWrite((submit: boolean) => feedbackApi.answer(inv.id, { ratings, strengths, improvements, submit }))
  const decline = useEngWrite(() => feedbackApi.decline(inv.id, reason))
  const disabled = !inv.editable
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted">Your answers are combined with others’ (groups of 3 or more) and never shown with your name to {inv.subjectName} or their manager.</p>
      {inv.status === 'declined' && <p className="text-[0.8125rem] text-ink-2">You declined: “{inv.declineReason}”.</p>}
      {inv.competencies.map((c) => {
        const r = ratings.find((x) => x.competencyId === c.id)!
        return (
          <fieldset key={c.id} className="space-y-1" disabled={disabled}>
            <legend className="text-[0.8125rem] font-medium text-ink">{c.text}</legend>
            <div role="radiogroup" aria-label={c.text} className="flex flex-wrap gap-1">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={r.rating === v}
                  aria-label={String(v)}
                  onClick={() => setRatings((xs) => xs.map((x) => (x.competencyId === c.id ? { ...x, rating: v } : x)))}
                  className={`rounded-md border px-3 py-1.5 text-xs ${r.rating === v ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface text-ink-2 hover:bg-sunken'}`}
                >
                  {v}
                </button>
              ))}
              <button type="button" role="radio" aria-checked={r.rating === null} onClick={() => setRatings((xs) => xs.map((x) => (x.competencyId === c.id ? { ...x, rating: null } : x)))} className="rounded-md px-2 text-xs text-muted hover:underline">
                Can’t say
              </button>
            </div>
          </fieldset>
        )
      })}
      <label className="block text-[0.8125rem]">
        <span className="mb-1 block text-xs text-muted">Strengths</span>
        <TextArea aria-label="Strengths" rows={3} maxLength={2000} value={strengths} disabled={disabled} onChange={(e) => setStrengths(e.target.value)} />
      </label>
      <label className="block text-[0.8125rem]">
        <span className="mb-1 block text-xs text-muted">What could they improve?</span>
        <TextArea aria-label="Improvements" rows={3} maxLength={2000} value={improvements} disabled={disabled} onChange={(e) => setImprovements(e.target.value)} />
      </label>
      <FormError error={save.error ?? decline.error} />
      {inv.editable && (
        <div className="flex flex-wrap justify-end gap-2">
          {inv.status === 'pending' && !declining && (
            <Button variant="ghost" onClick={() => setDeclining(true)}>
              Decline
            </Button>
          )}
          {inv.status === 'pending' && (
            <Button variant="secondary" write loading={save.isPending && save.variables === false} onClick={() => save.mutate(false, { onSuccess: () => toast.success('Draft saved') })}>
              Save draft
            </Button>
          )}
          <Button write loading={save.isPending && save.variables === true} onClick={() => save.mutate(true, { onSuccess: () => { toast.success('Feedback sent', 'Thank you'); onDone() } })}>
            {inv.status === 'submitted' ? 'Update feedback' : 'Submit feedback'}
          </Button>
        </div>
      )}
      {declining && (
        <div className="space-y-2 rounded-lg border border-line p-3">
          <TextArea aria-label="Reason for declining" rows={2} maxLength={500} placeholder="Why can’t you give feedback? (seen by the manager and HR)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDeclining(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" write loading={decline.isPending} onClick={() => decline.mutate(undefined, { onSuccess: () => { toast.success('Request declined'); onDone() } })}>
              Decline request
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
