import { useEffect, useState, type FormEvent } from 'react'
import type { CandidateInput, CandidateSource, InterviewCard, Interview, Opening, OpeningInput, Recommendation } from '@/modules/hr/recruitmentTypes'
import { CANDIDATE_SOURCES, CANDIDATE_SOURCE_LABEL, RECOMMENDATIONS, RECOMMENDATION_LABEL } from '@/modules/hr/recruitmentTypes'
import { EMPLOYMENT_TYPE_LABEL, type EmploymentType } from '@/modules/hr/types'
import { checkDuplicates } from '@/modules/hr/api/talentApi'
import { useRecruitmentOptions, useSaveCandidate, useSaveOpening, useSubmitScorecard } from '@/modules/hr/hooks/useTalent'
import { FormError } from '@/modules/hr/components/talentBits'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'

/* ---------------- Opening ---------------- */

/** New / edit opening. HR full may open it right away; a department head sends it to HR for approval. */
export function OpeningDrawer({ open, onClose, opening, onSaved }: { open: boolean; onClose: () => void; opening: Opening | null; onSaved?: (o: Opening) => void }) {
  const options = useRecruitmentOptions()
  const save = useSaveOpening()
  const toast = useToast()
  const manage = options.data?.manage ?? false
  const blank = (): Partial<OpeningInput> => ({ title: '', departmentId: '', hiringManagerId: '', headcount: 1, employmentType: 'full_time', location: '', salaryMin: null, salaryMax: null, salaryCurrency: null, description: '', requirements: '' })
  const [d, setD] = useState<Partial<OpeningInput>>(blank)
  useEffect(() => {
    if (!open) return
    save.reset()
    setD(opening ? { ...opening, salaryCurrency: opening.salaryCurrency } : blank())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opening?.id])
  const set = <K extends keyof OpeningInput>(k: K, v: OpeningInput[K]) => setD((x) => ({ ...x, [k]: v }))
  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  function submit(status?: OpeningInput['status']) {
    const input: Partial<OpeningInput> = { ...d, ...(opening ? {} : { status: status ?? 'draft' }) }
    if (opening) {
      // The detail view adds read-only fields; send only the editable ones.
      const keys: (keyof OpeningInput)[] = ['title', 'departmentId', 'hiringManagerId', 'headcount', 'employmentType', 'location', 'description', 'requirements', 'criteria']
      if (opening.salaryVisible) keys.push('salaryMin', 'salaryMax', 'salaryCurrency')
      const clean = Object.fromEntries(keys.map((k) => [k, d[k]])) as Partial<OpeningInput>
      save.mutate({ id: opening.id, input: clean }, { onSuccess: (o) => { toast.success('Opening saved', o.title); onSaved?.(o); onClose() } })
      return
    }
    save.mutate({ input }, { onSuccess: (o) => { toast.success('Opening created', o.title); onSaved?.(o); onClose() } })
  }
  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault()
    submit(manage ? 'open' : 'pending_approval')
  }
  const showSalary = !opening || opening.salaryVisible

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={opening ? `Edit ${opening.title}` : 'New job opening'}
      description={manage ? 'Openings you create can go live straight away.' : 'HR approves the opening before candidates can apply.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {!opening && (
            <Button variant="secondary" write loading={save.isPending} onClick={() => submit('draft')}>Save draft</Button>
          )}
          <Button write type="submit" form="opening-form" loading={save.isPending}>
            {opening ? 'Save opening' : manage ? 'Open position' : 'Send for approval'}
          </Button>
        </>
      }
    >
      <form id="opening-form" noValidate onSubmit={onSubmit} className="space-y-4">
        <Field id="op-title" label="Job title" required>
          <TextInput id="op-title" value={d.title ?? ''} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="op-dept" label="Department" required>
            <SelectInput id="op-dept" value={d.departmentId ?? ''} onChange={(e) => set('departmentId', e.target.value)}>
              <option value="">Pick a department</option>
              {options.data?.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="op-hm" label="Hiring manager">
            <SelectInput id="op-hm" value={d.hiringManagerId ?? ''} onChange={(e) => set('hiringManagerId', e.target.value)}>
              <option value="">Me</option>
              {options.data?.people.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.role}</option>)}
            </SelectInput>
          </Field>
          <Field id="op-headcount" label="Headcount">
            <TextInput id="op-headcount" type="number" min={1} value={d.headcount ?? 1} onChange={(e) => set('headcount', Number(e.target.value))} />
          </Field>
          <Field id="op-type" label="Employment type">
            <SelectInput id="op-type" value={d.employmentType ?? 'full_time'} onChange={(e) => set('employmentType', e.target.value as EmploymentType)}>
              {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SelectInput>
          </Field>
          <Field id="op-location" label="Location" className="sm:col-span-2">
            <TextInput id="op-location" value={d.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Dubai (hybrid)" />
          </Field>
        </div>
        {showSalary && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field id="op-smin" label="Salary from (monthly)">
              <TextInput id="op-smin" type="number" min={0} value={d.salaryMin ?? ''} onChange={(e) => set('salaryMin', num(e.target.value))} />
            </Field>
            <Field id="op-smax" label="Salary to">
              <TextInput id="op-smax" type="number" min={0} value={d.salaryMax ?? ''} onChange={(e) => set('salaryMax', num(e.target.value))} />
            </Field>
            <Field id="op-cur" label="Currency" hint="Visible to HR and the hiring manager only.">
              <TextInput id="op-cur" value={d.salaryCurrency ?? options.data?.currency ?? ''} maxLength={3} onChange={(e) => set('salaryCurrency', e.target.value.toUpperCase())} />
            </Field>
          </div>
        )}
        <Field id="op-desc" label="Description">
          <TextArea id="op-desc" value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field id="op-req" label="Requirements">
          <TextArea id="op-req" value={d.requirements ?? ''} onChange={(e) => set('requirements', e.target.value)} />
        </Field>
        <FormError error={save.error} />
      </form>
    </Drawer>
  )
}

/* ---------------- Candidate ---------------- */

const blankCandidate = (openingId: string | null): Partial<CandidateInput> => ({ fullName: '', email: '', mobile: '', currentCompany: '', currentTitle: '', source: 'linkedin', notes: '', tags: [], openingId })

/** Add a candidate (HR), optionally applying to an opening. Warns about a candidate with the same email or mobile. */
export function CandidateDrawer({ open, onClose, openings, defaultOpeningId }: { open: boolean; onClose: () => void; openings: Opening[]; defaultOpeningId?: string | null }) {
  const save = useSaveCandidate()
  const toast = useToast()
  const [d, setD] = useState<Partial<CandidateInput>>(() => blankCandidate(defaultOpeningId ?? null))
  const [tags, setTags] = useState('')
  const [dupes, setDupes] = useState<string[]>([])
  useEffect(() => {
    if (!open) return
    save.reset()
    setD(blankCandidate(defaultOpeningId ?? null))
    setTags('')
    setDupes([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultOpeningId])
  const set = <K extends keyof CandidateInput>(k: K, v: CandidateInput[K]) => setD((x) => ({ ...x, [k]: v }))

  async function check() {
    if (!d.email && !d.mobile) return setDupes([])
    try {
      const res = await checkDuplicates(d.email ?? '', d.mobile ?? '')
      setDupes(res.matches.map((m) => `${m.fullName} (same ${m.matchedOn.join(' and ')})`))
    } catch {
      setDupes([])
    }
  }

  function submit(ev: FormEvent) {
    ev.preventDefault()
    const input = { ...d, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }
    save.mutate({ input }, { onSuccess: (c) => { toast.success('Candidate added', c.fullName); onClose() } })
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="Add candidate"
      description="Mobile numbers abroad are accepted in the international form (+ country code)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write type="submit" form="candidate-form" loading={save.isPending}>Add candidate</Button>
        </>
      }
    >
      <form id="candidate-form" noValidate onSubmit={submit} className="space-y-4">
        <Field id="cd-name" label="Full name" required>
          <TextInput id="cd-name" value={d.fullName ?? ''} onChange={(e) => set('fullName', e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="cd-email" label="Email">
            <TextInput id="cd-email" type="email" value={d.email ?? ''} onBlur={check} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field id="cd-mobile" label="Mobile">
            <TextInput id="cd-mobile" inputMode="tel" value={d.mobile ?? ''} onBlur={check} onChange={(e) => set('mobile', e.target.value)} />
          </Field>
          <Field id="cd-company" label="Current company">
            <TextInput id="cd-company" value={d.currentCompany ?? ''} onChange={(e) => set('currentCompany', e.target.value)} />
          </Field>
          <Field id="cd-title" label="Current title">
            <TextInput id="cd-title" value={d.currentTitle ?? ''} onChange={(e) => set('currentTitle', e.target.value)} />
          </Field>
          <Field id="cd-source" label="Source">
            <SelectInput id="cd-source" value={d.source ?? 'other'} onChange={(e) => set('source', e.target.value as CandidateSource)}>
              {CANDIDATE_SOURCES.map((s) => <option key={s} value={s}>{CANDIDATE_SOURCE_LABEL[s]}</option>)}
            </SelectInput>
          </Field>
          <Field id="cd-opening" label="Apply to opening">
            <SelectInput id="cd-opening" value={d.openingId ?? ''} onChange={(e) => set('openingId', e.target.value || null)}>
              <option value="">None for now</option>
              {openings.filter((o) => o.status === 'open').map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
            </SelectInput>
          </Field>
        </div>
        <Field id="cd-tags" label="Tags" hint="Comma separated.">
          <TextInput id="cd-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field id="cd-notes" label="Notes">
          <TextArea id="cd-notes" value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {dupes.length > 0 && (
          <p role="status" className="rounded-md bg-warning-50 px-3 py-2 text-xs text-ink-2 dark:bg-warning-500/10">
            Possible duplicate: {dupes.join(', ')}. Open the existing candidate instead.
          </p>
        )}
        <FormError error={save.error} />
      </form>
    </Drawer>
  )
}

/* ---------------- Scorecard ---------------- */

/** An interviewer's scorecard: every criterion 1–5, a recommendation and notes. */
export function ScorecardModal({ interview, onClose }: { interview: Interview | InterviewCard | null; onClose: () => void }) {
  const submit = useSubmitScorecard()
  const toast = useToast()
  const [scores, setScores] = useState<Record<string, number>>({})
  const [rec, setRec] = useState<Recommendation>('yes')
  const [notes, setNotes] = useState('')
  useEffect(() => {
    if (!interview) return
    submit.reset()
    const mine = 'myScorecard' in interview ? interview.myScorecard : null
    setScores(Object.fromEntries((mine?.scores ?? []).map((s) => [s.criterion, s.score])))
    setRec(mine?.recommendation ?? 'yes')
    setNotes(mine?.notes ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview?.id])
  if (!interview) return null
  const done = interview.criteria.every((c) => scores[c])
  return (
    <Modal
      open={!!interview}
      onClose={onClose}
      title={`Scorecard · ${interview.candidateName}`}
      description="Rate each criterion from 1 (poor) to 5 (excellent)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            disabled={!done}
            loading={submit.isPending}
            onClick={() =>
              submit.mutate(
                { id: interview.id, input: { scores: interview.criteria.map((criterion) => ({ criterion, score: scores[criterion] })), recommendation: rec, notes } },
                { onSuccess: () => { toast.success('Scorecard submitted'); onClose() } },
              )
            }
          >
            Submit scorecard
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {interview.criteria.map((c) => (
          <fieldset key={c} className="flex flex-wrap items-center justify-between gap-2">
            <legend className="text-[0.8125rem] font-medium text-ink-2">{c}</legend>
            <div role="radiogroup" aria-label={c} className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={scores[c] === n}
                  aria-label={`${c} ${n}`}
                  onClick={() => setScores((s) => ({ ...s, [c]: n }))}
                  className={`size-8 rounded-md border text-[0.8125rem] ${scores[c] === n ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface text-ink-2 hover:bg-hover'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        <Field id="sc-rec" label="Recommendation">
          <SelectInput id="sc-rec" value={rec} onChange={(e) => setRec(e.target.value as Recommendation)}>
            {RECOMMENDATIONS.map((r) => <option key={r} value={r}>{RECOMMENDATION_LABEL[r]}</option>)}
          </SelectInput>
        </Field>
        <Field id="sc-notes" label="Notes">
          <TextArea id="sc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <FormError error={submit.error} />
      </div>
    </Modal>
  )
}
