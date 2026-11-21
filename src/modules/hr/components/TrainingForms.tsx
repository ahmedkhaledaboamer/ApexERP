import { useEffect, useState, type FormEvent } from 'react'
import type { CourseCategory, CourseInput, EnrollmentStatus, SessionInput } from '@/modules/hr/trainingTypes'
import { COURSE_CATEGORIES, COURSE_CATEGORY_LABEL, ENROLLMENT_STATUSES, ENROLLMENT_STATUS_LABEL, SESSION_STATUS_LABEL } from '@/modules/hr/trainingTypes'
import { useCourse, useCreateSession, useEnroll, useSaveCourse, useTrainingOptions, useUpdateEnrollment } from '@/modules/hr/hooks/useTalent'
import { EnrollmentBadge, FormError, Section, SimpleTable, td } from '@/modules/hr/components/talentBits'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'
import { useRegion } from '@/modules/tenancy/hooks'
import { todayIsoIn } from '@/shared/lib/companyDay'

/** New training course (HR full). */
export function CourseDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (id: string) => void }) {
  const save = useSaveCourse()
  const toast = useToast()
  const region = useRegion()
  const blank = (): Partial<CourseInput> => ({ title: '', category: 'safety', provider: 'internal', providerName: '', durationHours: 2, cost: 0, currency: region.currency, mandatory: false, validityMonths: 12, description: '', active: true })
  const [d, setD] = useState<Partial<CourseInput>>(blank)
  useEffect(() => {
    if (!open) return
    save.reset()
    setD(blank())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const set = <K extends keyof CourseInput>(k: K, v: CourseInput[K]) => setD((x) => ({ ...x, [k]: v }))
  function submit(ev: FormEvent) {
    ev.preventDefault()
    save.mutate({ input: d }, { onSuccess: (c) => { toast.success('Course created', c.title); onSaved?.(c.id); onClose() } })
  }
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New course"
      description="Completing a course issues a certificate valid for the months you set."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write type="submit" form="course-form" loading={save.isPending}>Create course</Button>
        </>
      }
    >
      <form id="course-form" noValidate onSubmit={submit} className="space-y-4">
        <Field id="co-title" label="Course title" required>
          <TextInput id="co-title" value={d.title ?? ''} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="co-cat" label="Category">
            <SelectInput id="co-cat" value={d.category} onChange={(e) => set('category', e.target.value as CourseCategory)}>
              {COURSE_CATEGORIES.map((c) => <option key={c} value={c}>{COURSE_CATEGORY_LABEL[c]}</option>)}
            </SelectInput>
          </Field>
          <Field id="co-provider" label="Provider">
            <SelectInput id="co-provider" value={d.provider} onChange={(e) => set('provider', e.target.value as CourseInput['provider'])}>
              <option value="internal">Internal</option>
              <option value="external">External</option>
            </SelectInput>
          </Field>
          <Field id="co-pname" label="Provider / owner name">
            <TextInput id="co-pname" value={d.providerName ?? ''} onChange={(e) => set('providerName', e.target.value)} />
          </Field>
          <Field id="co-hours" label="Duration (hours)">
            <TextInput id="co-hours" type="number" min={0.5} step={0.5} value={d.durationHours ?? ''} onChange={(e) => set('durationHours', Number(e.target.value))} />
          </Field>
          <Field id="co-cost" label="Cost per participant">
            <TextInput id="co-cost" type="number" min={0} value={d.cost ?? 0} onChange={(e) => set('cost', Number(e.target.value))} />
          </Field>
          <Field id="co-cur" label="Currency">
            <TextInput id="co-cur" maxLength={3} value={d.currency ?? ''} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
          </Field>
          <Field id="co-valid" label="Certificate validity (months)" hint="Empty: never expires. 0: no certificate.">
            <TextInput id="co-valid" type="number" min={0} value={d.validityMonths ?? ''} onChange={(e) => set('validityMonths', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-[0.8125rem] text-ink-2">
            <Checkbox checked={!!d.mandatory} onChange={(e) => set('mandatory', e.target.checked)} />
            Mandatory for everyone
          </label>
        </div>
        <Field id="co-desc" label="Description">
          <TextArea id="co-desc" value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <FormError error={save.error} />
      </form>
    </Drawer>
  )
}

/** A course: its sessions, enrollments (HR records attendance / completion → certificate). */
export function CourseView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useCourse(id)
  const options = useTrainingOptions()
  const createSession = useCreateSession()
  const enroll = useEnroll()
  const update = useUpdateEnrollment()
  const toast = useToast()
  const region = useRegion()
  const today = todayIsoIn(region.timezone)
  const manage = options.data?.manage ?? false
  const [s, setS] = useState<Partial<SessionInput>>({ startDate: today, endDate: today, location: '', onlineLink: '', trainer: '', capacity: 20, extraCost: 0 })
  const [pick, setPick] = useState<Record<string, string>>({})
  const c = q.data
  return (
    <Drawer open={!!id} onClose={onClose} width="xl" title={c?.title ?? 'Course'} description={c ? `${COURSE_CATEGORY_LABEL[c.category]} · ${c.durationHours} h · ${fmtMoney(c.cost, c.currency)} per person${c.mandatory ? ' · mandatory' : ''}${c.validityMonths ? ` · certificate valid ${c.validityMonths} months` : ''}` : undefined}>
      {!c ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="space-y-6">
          {c.description && <p className="text-[0.8125rem] text-ink-2">{c.description}</p>}
          {manage && (
            <Section title="New session">
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-sunken p-3 sm:grid-cols-4">
                <Field id="se-start" label="Start date">
                  <TextInput id="se-start" type="date" value={s.startDate} onChange={(e) => setS({ ...s, startDate: e.target.value, endDate: e.target.value > (s.endDate ?? '') ? e.target.value : s.endDate })} />
                </Field>
                <Field id="se-end" label="End date">
                  <TextInput id="se-end" type="date" value={s.endDate} onChange={(e) => setS({ ...s, endDate: e.target.value })} />
                </Field>
                <Field id="se-loc" label="Location">
                  <TextInput id="se-loc" value={s.location} onChange={(e) => setS({ ...s, location: e.target.value })} />
                </Field>
                <Field id="se-cap" label="Capacity">
                  <TextInput id="se-cap" type="number" min={1} value={s.capacity} onChange={(e) => setS({ ...s, capacity: Number(e.target.value) })} />
                </Field>
                <Field id="se-link" label="Online link" className="col-span-2">
                  <TextInput id="se-link" value={s.onlineLink} placeholder="https://…" onChange={(e) => setS({ ...s, onlineLink: e.target.value })} />
                </Field>
                <Field id="se-trainer" label="Trainer">
                  <TextInput id="se-trainer" value={s.trainer} onChange={(e) => setS({ ...s, trainer: e.target.value })} />
                </Field>
                <Field id="se-cost" label="Session cost">
                  <TextInput id="se-cost" type="number" min={0} value={s.extraCost} onChange={(e) => setS({ ...s, extraCost: Number(e.target.value) })} />
                </Field>
                <div className="col-span-2 sm:col-span-4">
                  <Button size="sm" write loading={createSession.isPending} onClick={() => createSession.mutate({ courseId: c.id, input: s as SessionInput }, { onSuccess: () => toast.success('Session scheduled') })}>
                    Add session
                  </Button>
                </div>
              </div>
              <FormError error={createSession.error} />
            </Section>
          )}
          <Section title={`Sessions (${c.sessions.length})`}>
            {c.sessions.length === 0 && <p className="text-xs text-muted">No sessions yet.</p>}
            {c.sessions.map((se) => {
              const people = c.enrollments.filter((e) => e.sessionId === se.id)
              const taken = new Set(people.map((p) => p.employeeId))
              return (
                <div key={se.id} className="space-y-2 rounded-lg border border-line p-3" data-testid={`session-${se.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[0.8125rem] font-medium text-ink">
                      {fmtDate(se.startDate)}{se.endDate !== se.startDate ? ` – ${fmtDate(se.endDate)}` : ''} · {se.location || se.onlineLink}
                    </span>
                    <span className="text-xs text-muted">{SESSION_STATUS_LABEL[se.status]} · {se.enrolledCount}/{se.capacity} seats{se.trainer ? ` · ${se.trainer}` : ''}</span>
                  </div>
                  {people.length > 0 && (
                    <SimpleTable label="Participants" head={['Employee', 'Status', 'Score', 'Feedback', '']}>
                      {people.map((e) => (
                        <tr key={e.id}>
                          <td className={td}>{e.employeeName}</td>
                          <td className={td}><EnrollmentBadge status={e.status} /></td>
                          <td className={`${td} num`}>{e.score ?? '—'}</td>
                          <td className={td}>{e.feedbackRating ? `${e.feedbackRating}/5` : '—'}</td>
                          <td className={td}>
                            {manage && (
                              <select
                                aria-label={`Status of ${e.employeeName}`}
                                value={e.status}
                                onChange={(ev) => update.mutate({ id: e.id, input: { status: ev.target.value as EnrollmentStatus } }, { onSuccess: (r) => r.status === 'completed' && toast.success('Completed', 'Certificate issued.') })}
                                className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-xs"
                              >
                                {ENROLLMENT_STATUSES.map((x) => <option key={x} value={x}>{ENROLLMENT_STATUS_LABEL[x]}</option>)}
                              </select>
                            )}
                          </td>
                        </tr>
                      ))}
                    </SimpleTable>
                  )}
                  {manage && se.status === 'scheduled' && (
                    <div className="flex flex-wrap items-end gap-2">
                      <Field id={`en-${se.id}`} label="Enroll employee" className="min-w-56 flex-1">
                        <SelectInput id={`en-${se.id}`} value={pick[se.id] ?? ''} onChange={(e) => setPick({ ...pick, [se.id]: e.target.value })}>
                          <option value="">Pick an employee</option>
                          {options.data?.employees.filter((x) => !taken.has(x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </SelectInput>
                      </Field>
                      <Button size="sm" write disabled={!pick[se.id]} loading={enroll.isPending} onClick={() => enroll.mutate({ sessionId: se.id, input: { employeeIds: [pick[se.id]], status: 'enrolled' } }, { onSuccess: () => { setPick({ ...pick, [se.id]: '' }); toast.success('Enrolled') } })}>
                        Enroll
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
            <FormError error={enroll.error ?? update.error} />
          </Section>
        </div>
      )}
    </Drawer>
  )
}
