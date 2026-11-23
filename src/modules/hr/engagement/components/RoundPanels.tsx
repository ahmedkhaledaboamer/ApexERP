import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, SearchInput, SelectInput, TextInput } from '@/shared/components/form/Field'
import { ErrorText, FormError, Section, SimpleTable, td } from '@/modules/hr/components/talentBits'
import { fmtDate } from '@/shared/lib/utils'
import { feedbackApi, useEngWrite, useFeedbackOptions, useReviewFeedback } from '../api'
import { PROVIDER_STATUS_LABEL, RELATIONSHIPS, RELATIONSHIP_LABEL, type FeedbackRound, type ProviderInput, type ProviderStatus, type Relationship } from '../types'
import { FeedbackSummaryView } from './FeedbackSummaryView'

const STATUS_TONE: Record<ProviderStatus, Tone> = { nominated: 'amber', pending: 'sky', submitted: 'green', declined: 'red', rejected: 'neutral' }

/** Pick colleagues (with a relationship) from the colleague directory, minus the employee and those already asked. */
export function ColleaguePicker({ exclude, onPick, busy, label, withRelationship = true }: { exclude: string[]; onPick: (p: ProviderInput[]) => void; busy?: boolean; label: string; withRelationship?: boolean }) {
  const opts = useFeedbackOptions()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [rel, setRel] = useState<Relationship>('peer')
  const list = useMemo(
    () => (opts.data?.colleagues ?? []).filter((c) => !exclude.includes(c.id) && (!search || `${c.name} ${c.jobTitle} ${c.departmentName ?? ''}`.toLowerCase().includes(search.toLowerCase()))),
    [opts.data, exclude, search],
  )
  if (opts.isPending) return <Skeleton className="h-24" />
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <SearchInput aria-label="Search colleagues" placeholder="Search colleagues" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        {withRelationship && (
          <SelectInput aria-label="Relationship" value={rel} onChange={(e) => setRel(e.target.value as Relationship)} className="w-44">
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {RELATIONSHIP_LABEL[r]}
              </option>
            ))}
          </SelectInput>
        )}
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line bg-surface p-2">
        {list.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
            <Checkbox aria-label={c.name} checked={picked.includes(c.id)} onChange={(e) => setPicked((xs) => (e.target.checked ? [...xs, c.id] : xs.filter((x) => x !== c.id)))} />
            {c.name}
            <span className="text-xs text-muted">
              {c.jobTitle}
              {c.departmentName ? ` · ${c.departmentName}` : ''}
            </span>
          </label>
        ))}
        {!list.length && <p className="text-xs text-muted">No colleague matches.</p>}
      </div>
      <Button
        size="sm"
        write
        disabled={!picked.length}
        loading={busy}
        onClick={() => {
          onPick(picked.map((employeeId) => ({ employeeId, relationship: rel })))
          setPicked([])
        }}
      >
        {label}
        {picked.length ? ` (${picked.length})` : ''}
      </Button>
    </div>
  )
}

/** HR / the manager: the people asked, nominations to decide, more colleagues, close. */
export function RoundManage({ r }: { r: FeedbackRound }) {
  const toast = useToast()
  const add = useEngWrite((p: ProviderInput[]) => feedbackApi.addProviders(r.id, p))
  const decide = useEngWrite((v: { approve: string[]; reject: string[] }) => feedbackApi.decide(r.id, v.approve, v.reject))
  const close = useEngWrite(() => feedbackApi.close(r.id))
  const nominated = r.providers.filter((p) => p.status === 'nominated')
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Deadline {fmtDate(r.deadline)} · {r.counts.submitted} of {r.counts.invited} answered{r.counts.declined ? ` · ${r.counts.declined} declined` : ''} · requested by {r.requestedByName}
        {r.status === 'closed' ? ' · closed' : ''}
      </p>
      <SimpleTable label="Colleagues asked" head={['Colleague', 'Relationship', 'Status', '']}>
        {r.providers.map((p) => (
          <tr key={p.id}>
            <td className={td}>
              {p.name}
              {p.nominatedBy === 'employee' && <span className="block text-xs text-muted">Nominated by {r.subjectName}</span>}
            </td>
            <td className={td}>{RELATIONSHIP_LABEL[p.relationship]}</td>
            <td className={td}>
              <Badge tone={STATUS_TONE[p.status]}>{PROVIDER_STATUS_LABEL[p.status]}</Badge>
              {p.declineReason && <span className="block text-xs text-muted">“{p.declineReason}”</span>}
            </td>
            <td className={td}>
              {p.status === 'nominated' && r.can.decideNominations && (
                <div className="flex gap-1">
                  <Button size="xs" write aria-label={`Approve ${p.name}`} onClick={() => decide.mutate({ approve: [p.id], reject: [] }, { onSuccess: () => toast.success('Nomination approved', p.name) })}>
                    Approve
                  </Button>
                  <Button size="xs" variant="secondary" write aria-label={`Decline ${p.name}`} onClick={() => decide.mutate({ approve: [], reject: [p.id] })}>
                    Decline
                  </Button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </SimpleTable>
      {nominated.length > 1 && r.can.decideNominations && (
        <Button size="sm" variant="secondary" write onClick={() => decide.mutate({ approve: nominated.map((p) => p.id), reject: [] })}>
          Approve all {nominated.length} nominations
        </Button>
      )}
      {r.can.addProviders && (
        <Section title="Ask more colleagues">
          <ColleaguePicker exclude={[r.subjectEmployeeId, ...r.providers.filter((p) => p.status !== 'rejected').map((p) => p.employeeId)]} busy={add.isPending} label="Ask for feedback" onPick={(p) => add.mutate(p, { onSuccess: () => toast.success('Feedback requested', `${p.length} colleague${p.length === 1 ? '' : 's'} asked`) })} />
        </Section>
      )}
      <FormError error={add.error ?? decide.error ?? close.error} />
      {r.can.close && (
        <Button size="sm" variant="secondary" write loading={close.isPending} onClick={() => close.mutate(undefined, { onSuccess: () => toast.success('Feedback round closed') })}>
          Close the round
        </Button>
      )}
    </div>
  )
}

/**
 * The 360° panel of a performance review (added to ReviewDrawer): HR and the reviewer request feedback, follow it and
 * read the aggregated summary while writing the review; the employee sees the summary once the review is shared.
 */
export function ReviewFeedbackPanel({ reviewId }: { reviewId: string }) {
  const q = useReviewFeedback(reviewId)
  const toast = useToast()
  const [deadline, setDeadline] = useState('')
  const create = useEngWrite((p: ProviderInput[]) => feedbackApi.createRound({ subjectEmployeeId: q.data!.subjectEmployeeId, reviewId, providers: p, allowNominations: true, ...(deadline ? { deadline } : {}) }))
  if (q.error) return null
  if (q.isPending) return <Skeleton className="h-16" />
  const d = q.data
  if (!d.round && !d.canRequest) return null
  return (
    <section aria-label="360° feedback" className="space-y-3 rounded-lg border border-line p-4" data-testid="review-feedback-panel">
      <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        <Users className="size-3.5" aria-hidden />
        360° feedback
      </h3>
      {d.round ? (
        <>
          {d.round.viewer !== 'subject' && <RoundManage r={d.round} />}
          {d.summary && <FeedbackSummaryView s={d.summary} />}
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted">Ask colleagues for feedback on this review. Answers come back grouped and anonymous; the employee can also nominate peers for you to approve.</p>
          <label className="block text-[0.8125rem]">
            <span className="mb-1 block text-xs text-muted">Deadline (default: in 14 days)</span>
            <TextInput type="date" aria-label="Feedback deadline" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-44" />
          </label>
          <ColleaguePicker exclude={[d.subjectEmployeeId]} busy={create.isPending} label="Request feedback" onPick={(p) => create.mutate(p, { onSuccess: () => toast.success('Feedback requested', `${p.length} colleague${p.length === 1 ? '' : 's'} asked`) })} />
          <FormError error={create.error} />
        </div>
      )}
    </section>
  )
}

export function RoundLoading({ error }: { error: unknown }) {
  return error ? <ErrorText error={error} /> : <Skeleton className="h-40" />
}
