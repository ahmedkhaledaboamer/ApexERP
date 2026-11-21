import { useEffect, useState } from 'react'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { ErrorText, FormError, Section, SimpleTable, td } from '@/modules/hr/components/talentBits'
import { fmtDate } from '@/shared/lib/utils'
import * as api from '../api'
import { usePerfOptions, usePerfWrite, useReview } from '../api'
import {
  GOAL_STATUSES,
  GOAL_STATUS_LABEL,
  PROBATION_LABEL,
  PROBATION_RECOMMENDATIONS,
  type Assessment,
  type GoalStatus,
  type ManagerAssessment,
  type ProbationRecommendation,
  type ReviewDetail,
  type Scores,
} from '../types'
import { RatingText, StageBadge } from './bits'

/**
 * One review, shaped by what the caller may see and do (the API's `viewer` and `can`):
 * goals (set / progress / approve), self-assessment, manager assessment (+ training, probation outcome),
 * HR calibration (note never shown to anyone else) and sharing, the employee's acknowledgement.
 */
export function ReviewDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useReview(id)
  const d = q.data
  return (
    <Drawer open={!!id} onClose={onClose} width="xl" title={d ? `${d.cycleName} · ${d.employeeName}` : 'Review'} description={d ? `${d.jobTitle}${d.managerName ? ` · Manager: ${d.managerName}` : ''}` : undefined}>
      {q.error ? <ErrorText error={q.error} /> : !d ? <Skeleton className="h-60" /> : <ReviewBody d={d} />}
    </Drawer>
  )
}

function ReviewBody({ d }: { d: ReviewDetail }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted">
        <StageBadge stage={d.stage} />
        {d.locked && (
          <Badge tone="neutral" icon={<Lock className="size-3" />}>
            Locked
          </Badge>
        )}
        <span>
          Period {fmtDate(d.periodStart)} – {fmtDate(d.periodEnd)}
        </span>
        {d.dueDate && <span className={d.overdue ? 'text-danger-600' : ''}>· Due {fmtDate(d.dueDate)}</span>}
      </div>
      {(d.finalRating !== null || d.scores) && <ResultPanel d={d} />}
      {d.template.goalsEnabled && <GoalsSection d={d} />}
      {d.template.selfReview && <SelfSection d={d} />}
      <ManagerSection d={d} />
      {(d.can.calibrate || d.can.share || d.calibration) && <HrSection d={d} />}
      {(d.can.acknowledge || d.acknowledgement) && <AckSection d={d} />}
      {d.salesKpis && (
        <Section title="Sales targets in the period (for context)">
          <SimpleTable label="Sales targets" head={['Target', 'Goal', 'Actual', 'Attainment']}>
            {d.salesKpis.map((k) => (
              <tr key={k.key}>
                <td className={td}>{k.label}</td>
                <td className={`${td} num`}>{k.target}</td>
                <td className={`${td} num`}>{k.actual}</td>
                <td className={`${td} num`}>{k.attainmentPct === null ? '—' : `${k.attainmentPct}%`}</td>
              </tr>
            ))}
          </SimpleTable>
        </Section>
      )}
    </div>
  )
}

function ScoreLine({ label, s }: { label: string; s: Scores | null }) {
  if (!s) return null
  const f = (n: number | null) => (n === null ? '—' : n.toFixed(2))
  return (
    <p className="text-xs text-muted">
      {label}: competencies {f(s.competency)}
      {s.goals !== null ? ` · goals ${f(s.goals)}` : ''} · overall <span className="num font-medium text-ink">{f(s.overall)}</span>
    </p>
  )
}

function ResultPanel({ d }: { d: ReviewDetail }) {
  return (
    <section aria-label="Result" className="rounded-lg border border-line bg-sunken p-4">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Final rating</p>
      <p className="mt-1 text-lg text-ink" data-testid="final-rating">
        <RatingText value={d.finalRating} label={d.finalLabel} max={d.template.scale.length} />
      </p>
      <ScoreLine label="Manager assessment" s={d.scores} />
      <ScoreLine label="Self-assessment" s={d.selfScores} />
      {d.probation?.outcome && <p className="mt-1 text-[0.8125rem] text-ink">Probation outcome: {PROBATION_LABEL[d.probation.outcome]}</p>}
      {d.recommendedCourses.length > 0 && <p className="mt-1 text-xs text-muted">Recommended training: {d.recommendedCourses.map((c) => c.title).join(', ')}</p>}
    </section>
  )
}

/* ---------------- Goals ---------------- */

function GoalsSection({ d }: { d: ReviewDetail }) {
  const toast = useToast()
  const add = usePerfWrite((v: { title: string; weight: number; target: string }) => api.addGoal(d.id, v))
  const upd = usePerfWrite((v: { id: string; progress?: number; status?: GoalStatus }) => api.updateGoal(v.id, v))
  const del = usePerfWrite((gid: string) => api.deleteGoal(gid))
  const approve = usePerfWrite(() => api.approveGoals(d.id))
  const [form, setForm] = useState({ title: '', weight: '', target: '' })
  const error = add.error ?? upd.error ?? del.error ?? approve.error
  return (
    <Section
      title={`Goals · ${d.goalWeightTotal}% of 100%`}
      action={
        d.can.approveGoals && (
          <Button size="sm" write loading={approve.isPending} onClick={() => approve.mutate(undefined, { onSuccess: () => toast.success('Goals approved') })}>
            Approve goals
          </Button>
        )
      }
    >
      {d.goals.length === 0 ? (
        <p className="text-xs text-muted">No goals yet.</p>
      ) : (
        <SimpleTable label="Goals" head={['Goal', 'Weight', 'Target', 'Progress', 'Status', '']}>
          {d.goals.map((g) => (
            <tr key={g.id}>
              <td className={td}>
                {g.title} {g.approved ? <Badge tone="green">Approved</Badge> : <Badge tone="amber">Not approved</Badge>}
              </td>
              <td className={`${td} num`}>{g.weight}%</td>
              <td className={td}>{g.target || '—'}</td>
              <td className={td}>
                {d.can.editGoals ? (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    aria-label={`Progress of ${g.title}`}
                    defaultValue={g.progress}
                    className="w-16 rounded border border-line-strong bg-surface px-1 text-[0.8125rem]"
                    onBlur={(e) => Number(e.target.value) !== g.progress && upd.mutate({ id: g.id, progress: Number(e.target.value) })}
                  />
                ) : (
                  `${g.progress}%`
                )}
              </td>
              <td className={td}>
                {d.can.editGoals ? (
                  <select aria-label={`Status of ${g.title}`} value={g.status} onChange={(e) => upd.mutate({ id: g.id, status: e.target.value as GoalStatus })} className="rounded border border-line-strong bg-surface text-[0.8125rem]">
                    {GOAL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {GOAL_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                ) : (
                  GOAL_STATUS_LABEL[g.status]
                )}
              </td>
              <td className={td}>
                {d.can.editGoalTerms && (
                  <Button size="xs" variant="ghost" iconOnly aria-label={`Remove ${g.title}`} write onClick={() => del.mutate(g.id)}>
                    <Trash2 />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </SimpleTable>
      )}
      {d.can.editGoalTerms && (
        <form
          className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_6rem_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            add.mutate({ title: form.title, weight: Number(form.weight), target: form.target }, { onSuccess: () => setForm({ title: '', weight: '', target: '' }) })
          }}
        >
          <Field id="goal-title" label="Goal">
            <TextInput id="goal-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field id="goal-weight" label="Weight %">
            <TextInput id="goal-weight" type="number" min={1} max={100} value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
          </Field>
          <Field id="goal-target" label="Target">
            <TextInput id="goal-target" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
          </Field>
          <Button type="submit" size="md" write loading={add.isPending}>
            <Plus />
            Add goal
          </Button>
        </form>
      )}
      <FormError error={error} />
    </Section>
  )
}

/* ---------------- Assessments ---------------- */

type Draft = { answers: Record<string, { rating: number | null; comment: string }>; goals: Record<string, { rating: number | null; comment: string }>; summary: string }
const draftOf = (a: Assessment | null): Draft => ({
  answers: Object.fromEntries((a?.answers ?? []).map((x) => [x.questionId, { rating: x.rating, comment: x.comment }])),
  goals: Object.fromEntries((a?.goalRatings ?? []).map((x) => [x.goalId, { rating: x.rating, comment: x.comment }])),
  summary: a?.summary ?? '',
})
const payloadOf = (dr: Draft) => ({
  answers: Object.entries(dr.answers).map(([questionId, v]) => ({ questionId, rating: v.rating, comment: v.comment })),
  goalRatings: Object.entries(dr.goals).map(([goalId, v]) => ({ goalId, rating: v.rating, comment: v.comment })),
  summary: dr.summary,
})

function RatingSelect({ label, value, onChange, d }: { label: string; value: number | null; onChange: (v: number | null) => void; d: ReviewDetail }) {
  return (
    <SelectInput aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">Not rated</option>
      {d.template.scale.map((l) => (
        <option key={l.value} value={l.value}>
          {l.value} · {l.label}
        </option>
      ))}
    </SelectInput>
  )
}

/** Editable or read-only ratings of every question (and goal). `prefix` keeps the labels unique per form. */
function AssessmentForm({ d, draft, setDraft, editable, prefix }: { d: ReviewDetail; draft: Draft; setDraft: (dr: Draft) => void; editable: boolean; prefix: string }) {
  const label = (n: number | null) => (n === null ? 'Not rated' : `${n} · ${d.template.scale.find((l) => l.value === n)?.label ?? ''}`)
  return (
    <div className="space-y-4">
      {d.template.sections.map((s) => (
        <fieldset key={s.id} className="space-y-2">
          <legend className="text-[0.8125rem] font-medium text-ink">{s.title}</legend>
          {s.questions.map((q) => {
            const v = draft.answers[q.id] ?? { rating: null, comment: '' }
            return (
              <div key={q.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_14rem] sm:items-center">
                <span className="text-[0.8125rem] text-ink-2">{q.text}</span>
                {editable ? (
                  <RatingSelect d={d} label={`${prefix}${q.text}`} value={v.rating} onChange={(rating) => setDraft({ ...draft, answers: { ...draft.answers, [q.id]: { ...v, rating } } })} />
                ) : (
                  <span className="text-[0.8125rem] text-ink">{label(v.rating)}</span>
                )}
              </div>
            )
          })}
        </fieldset>
      ))}
      {d.template.goalsEnabled && d.goals.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-[0.8125rem] font-medium text-ink">Goals</legend>
          {d.goals.map((g) => {
            const v = draft.goals[g.id] ?? { rating: null, comment: '' }
            return (
              <div key={g.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_14rem] sm:items-center">
                <span className="text-[0.8125rem] text-ink-2">
                  {g.title} <span className="text-muted">({g.weight}%)</span>
                </span>
                {editable ? (
                  <RatingSelect d={d} label={`${prefix}Goal: ${g.title}`} value={v.rating} onChange={(rating) => setDraft({ ...draft, goals: { ...draft.goals, [g.id]: { ...v, rating } } })} />
                ) : (
                  <span className="text-[0.8125rem] text-ink">{label(v.rating)}</span>
                )}
              </div>
            )
          })}
        </fieldset>
      )}
      {editable ? (
        <Field id={`${prefix}summary`} label="Comments">
          <TextArea id={`${prefix}summary`} rows={3} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
        </Field>
      ) : (
        draft.summary && <p className="rounded-md bg-sunken p-3 text-[0.8125rem] whitespace-pre-wrap text-ink">{draft.summary}</p>
      )}
    </div>
  )
}

function SelfSection({ d }: { d: ReviewDetail }) {
  const toast = useToast()
  const [draft, setDraft] = useState(() => draftOf(d.self))
  useEffect(() => setDraft(draftOf(d.self)), [d.id, d.self?.submittedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = usePerfWrite((submit: boolean) => api.saveSelf(d.id, { ...payloadOf(draft), submit }))
  if (!d.self) return <Section title="Self-assessment"><p className="text-xs text-muted">Not submitted yet.</p></Section>
  const status = d.self.submittedAt ? `submitted ${fmtDate(d.self.submittedAt)}` : 'draft'
  return (
    <Section title={`Self-assessment · ${status}`}>
      <AssessmentForm d={d} draft={draft} setDraft={setDraft} editable={d.can.editSelf} prefix="Self: " />
      {d.can.editSelf && (
        <div className="flex gap-2">
          <Button variant="secondary" write loading={save.isPending && save.variables === false} onClick={() => save.mutate(false, { onSuccess: () => toast.success('Draft saved') })}>
            Save draft
          </Button>
          <Button write loading={save.isPending && save.variables === true} onClick={() => save.mutate(true, { onSuccess: () => toast.success('Self-review submitted') })}>
            Submit self-review
          </Button>
        </div>
      )}
      <FormError error={save.error} />
    </Section>
  )
}

function ManagerSection({ d }: { d: ReviewDetail }) {
  const toast = useToast()
  const options = usePerfOptions()
  const m = d.manager
  const [draft, setDraft] = useState(() => draftOf(m))
  const [courses, setCourses] = useState<string[]>(m?.recommendedCourseIds ?? [])
  const [rec, setRec] = useState<ProbationRecommendation | null>(m?.recommendation ?? null)
  const [months, setMonths] = useState<string>(m?.extendMonths ? String(m.extendMonths) : '3')
  useEffect(() => {
    setDraft(draftOf(d.manager))
    setCourses(d.manager?.recommendedCourseIds ?? [])
    setRec(d.manager?.recommendation ?? null)
  }, [d.id, d.manager?.submittedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = usePerfWrite((submit: boolean) =>
    api.saveManager(d.id, { ...payloadOf(draft), recommendedCourseIds: courses, recommendation: rec, extendMonths: rec === 'extend' ? Number(months) : null, submit }),
  )
  if (!m) return <Section title="Manager assessment"><p className="text-xs text-muted">{d.viewer === 'employee' ? 'You’ll see it once HR shares your review.' : 'Not submitted yet.'}</p></Section>
  const editable = d.can.editManager
  const probation = d.cycleType === 'probation'
  return (
    <Section title={`Manager assessment · ${m.submittedAt ? `submitted ${fmtDate(m.submittedAt)}` : 'draft'}`}>
      <AssessmentForm d={d} draft={draft} setDraft={setDraft} editable={editable} prefix="Manager: " />
      {editable && (options.data?.courses.length ?? 0) > 0 && (
        <Field id="rec-courses" label="Recommend training (optional)">
          <SelectInput id="rec-courses" multiple value={courses} onChange={(e) => setCourses([...e.target.selectedOptions].map((o) => o.value))} className="h-24">
            {options.data!.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectInput>
        </Field>
      )}
      {probation && (editable || m.recommendation) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field id="prob-rec" label="Probation recommendation" required>
            <SelectInput id="prob-rec" disabled={!editable} value={rec ?? ''} onChange={(e) => setRec((e.target.value || null) as ProbationRecommendation | null)}>
              <option value="">Choose…</option>
              {PROBATION_RECOMMENDATIONS.map((r) => (
                <option key={r} value={r}>
                  {PROBATION_LABEL[r]}
                </option>
              ))}
            </SelectInput>
          </Field>
          {rec === 'extend' && (
            <Field id="prob-months" label="Extend by (months)">
              <TextInput id="prob-months" type="number" min={1} max={6} disabled={!editable} value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
          )}
        </div>
      )}
      {editable && (
        <div className="flex gap-2">
          <Button variant="secondary" write loading={save.isPending && save.variables === false} onClick={() => save.mutate(false, { onSuccess: () => toast.success('Draft saved') })}>
            Save draft
          </Button>
          {d.can.submitManager && (
            <Button write loading={save.isPending && save.variables === true} onClick={() => save.mutate(true, { onSuccess: () => toast.success('Manager review submitted') })}>
              Submit manager review
            </Button>
          )}
        </div>
      )}
      <FormError error={save.error} />
    </Section>
  )
}

function HrSection({ d }: { d: ReviewDetail }) {
  const toast = useToast()
  const [rating, setRating] = useState<string>(String(d.finalRating ?? ''))
  const [note, setNote] = useState('')
  const [rec, setRec] = useState<string>(d.probation?.outcome ?? '')
  const cal = usePerfWrite(() => api.calibrate(d.id, { rating: Number(rating), note, ...(d.cycleType === 'probation' && rec ? { recommendation: rec as ProbationRecommendation } : {}) }))
  const share = usePerfWrite(() => api.share(d.id))
  return (
    <Section title="HR calibration (HR only)">
      {d.calibration && (
        <ul className="space-y-1 text-xs text-muted" aria-label="Calibration history">
          {d.calibration.history.map((h, i) => (
            <li key={i}>
              {fmtDate(h.at)} · {h.byName}: {h.previousRating ?? '—'} → {h.rating}. {h.note}
            </li>
          ))}
        </ul>
      )}
      {d.can.calibrate && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr]">
          <Field id="cal-rating" label="Calibrated rating">
            <SelectInput id="cal-rating" value={rating} onChange={(e) => setRating(e.target.value)}>
              {d.template.scale.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.value} · {l.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id="cal-note" label="Calibration note" required hint="Required. Never shown to the employee or the manager; kept in the audit log.">
            <TextInput id="cal-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {d.cycleType === 'probation' && (
            <Field id="cal-rec" label="Probation outcome">
              <SelectInput id="cal-rec" value={rec} onChange={(e) => setRec(e.target.value)}>
                <option value="">As recommended</option>
                {PROBATION_RECOMMENDATIONS.map((r) => (
                  <option key={r} value={r}>
                    {PROBATION_LABEL[r]}
                  </option>
                ))}
              </SelectInput>
            </Field>
          )}
        </div>
      )}
      <div className="flex gap-2">
        {d.can.calibrate && (
          <Button variant="secondary" write loading={cal.isPending} onClick={() => cal.mutate(undefined, { onSuccess: () => (setNote(''), toast.success('Rating calibrated')) })}>
            Save calibration
          </Button>
        )}
        {d.can.share && (
          <Button write loading={share.isPending} onClick={() => share.mutate(undefined, { onSuccess: () => toast.success('Shared with the employee') })}>
            Share with employee
          </Button>
        )}
      </div>
      <FormError error={cal.error ?? share.error} />
    </Section>
  )
}

function AckSection({ d }: { d: ReviewDetail }) {
  const toast = useToast()
  const [comment, setComment] = useState('')
  const ack = usePerfWrite(() => api.acknowledge(d.id, { comment }))
  if (d.acknowledgement)
    return (
      <Section title="Acknowledgement">
        <p className="text-[0.8125rem] text-ink">
          Acknowledged {fmtDate(d.acknowledgement.at)}
          {d.acknowledgement.comment ? `: “${d.acknowledgement.comment}”` : '.'}
        </p>
      </Section>
    )
  return (
    <Section title="Acknowledge your review">
      <Field id="ack-comment" label="Your comment (optional)">
        <TextArea id="ack-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <Button write loading={ack.isPending} onClick={() => ack.mutate(undefined, { onSuccess: () => toast.success('Review acknowledged') })}>
        Acknowledge
      </Button>
      <FormError error={ack.error} />
    </Section>
  )
}

export type { ManagerAssessment }
