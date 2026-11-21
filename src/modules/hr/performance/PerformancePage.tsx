import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Plus, Target } from 'lucide-react'
import { AXIS_TICK, C, CURSOR, TOOLTIP_STYLE } from '@/modules/reports/components/chartKit'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ErrorText, FormError, Section, SimpleTable, td } from '@/modules/hr/components/talentBits'
import { fmtDate } from '@/shared/lib/utils'
import * as api from './api'
import { useCycle, useCycles, useMyPerformance, usePerfOptions, usePerfWrite, useReviews, useTemplates } from './api'
import { nextPhase } from './calc'
import { CYCLE_TYPE_LABEL, GOAL_STATUS_LABEL, PENDING_LABEL, PHASE_LABEL, STAGE_LABEL, type CycleType, type ReviewRow, type ReviewTemplate } from './types'
import { PhaseBadge, RatingText, StageBadge } from './components/bits'
import { ReviewDrawer } from './components/ReviewDrawer'

type Tab = 'my' | 'team' | 'cycles' | 'templates'

/**
 * `/hr/performance`: "My reviews & goals" for every employee (whatever their `hr` scope), "Team reviews" for
 * direct managers / Department Heads / HR, and for HR full the cycles (progress by phase, completion,
 * rating distribution, per department) and the templates. Plan-gated only; the API scopes every row.
 */
export default function PerformancePage() {
  const options = usePerfOptions()
  const [params, setParams] = useSearchParams()
  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = [{ id: 'my', label: 'My reviews & goals' }]
    if (options.data?.reviews) t.push({ id: 'team', label: 'Team reviews' })
    if (options.data?.manage) t.push({ id: 'cycles', label: 'Cycles' }, { id: 'templates', label: 'Templates' })
    return t
  }, [options.data])
  const tab = (tabs.find((t) => t.id === params.get('tab'))?.id ?? 'my') as Tab
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }
  const [creating, setCreating] = useState(false)
  return (
    <>
      <PageHeader
        icon={<IconTile><Target /></IconTile>}
        title="Performance"
        description="Goals, self and manager reviews, HR calibration and shared results. Probation reviews are created before probation ends."
        actions={
          options.data?.manage && (
            <Button write onClick={() => setCreating(true)}>
              <Plus />
              New cycle
            </Button>
          )
        }
      />
      <PageBody>
        <Tabs items={tabs} value={tab} onChange={(t) => set({ tab: t })} label="Performance sections" className="mb-4" />
        {tab === 'my' && <MyTab onOpen={(id) => set({ review: id })} />}
        {tab === 'team' && <TeamTab onOpen={(id) => set({ review: id })} />}
        {tab === 'cycles' && <CyclesTab onOpen={(id) => set({ cycle: id })} />}
        {tab === 'templates' && <TemplatesTab />}
      </PageBody>
      <NewCycleDrawer open={creating} onClose={() => setCreating(false)} onCreated={(id) => set({ tab: 'cycles', cycle: id })} />
      <CycleDrawer id={params.get('cycle')} onClose={() => set({ cycle: null })} onOpenReview={(id) => set({ review: id })} />
      <ReviewDrawer id={params.get('review')} onClose={() => set({ review: null })} />
    </>
  )
}

function ReviewTable({ rows, onOpen, label, showEmployee }: { rows: ReviewRow[]; onOpen: (id: string) => void; label: string; showEmployee: boolean }) {
  return (
    <SimpleTable label={label} head={[...(showEmployee ? ['Employee'] : []), 'Cycle', 'Stage', 'Due', 'Final rating', '']}>
      {rows.map((r) => (
        <tr key={r.id}>
          {showEmployee && (
            <td className={td}>
              {r.employeeName}
              <span className="block text-xs text-muted">{r.departmentName ?? r.jobTitle}</span>
            </td>
          )}
          <td className={td}>{r.cycleName}</td>
          <td className={td}><StageBadge stage={r.stage} /></td>
          <td className={`${td} ${r.overdue ? 'text-danger-600' : ''}`}>{r.dueDate ? fmtDate(r.dueDate) : '—'}</td>
          <td className={td}><RatingText value={r.finalRating} label={r.finalLabel} max={5} /></td>
          <td className={td}>
            <Button size="xs" variant="secondary" aria-label={`Open ${r.cycleName} · ${r.employeeName}`} onClick={() => onOpen(r.id)}>
              Open
            </Button>
          </td>
        </tr>
      ))}
    </SimpleTable>
  )
}

function MyTab({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useMyPerformance()
  if (q.error) return <ErrorText error={q.error} />
  if (q.isPending) return <Skeleton className="h-40" />
  const d = q.data
  if (!d.employeeId) return <EmptyState icon={<Target />} title="No employee record" body="Your account isn’t linked to an employee record yet." />
  return (
    <div className="space-y-6">
      {d.pending.length > 0 && (
        <Section title="To do">
          <ul className="space-y-1">
            {d.pending.map((p) => (
              <li key={`${p.reviewId}-${p.action}`}>
                <button type="button" className="text-[0.8125rem] text-brand-600 hover:underline" onClick={() => onOpen(p.reviewId)}>
                  {PENDING_LABEL[p.action]}
                  {p.action === 'manager_review' || p.action === 'approve_goals' ? `: ${p.employeeName}` : ''} · {p.cycleName}
                </button>
                {p.dueDate && <span className={`text-xs ${p.overdue ? 'text-danger-600' : 'text-muted'}`}> · due {fmtDate(p.dueDate)}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="My reviews">
        {d.reviews.length ? <ReviewTable rows={d.reviews} onOpen={onOpen} label="My reviews" showEmployee={false} /> : <p className="text-xs text-muted">No reviews yet.</p>}
      </Section>
      <Section title="My goals">
        {d.goals.length ? (
          <SimpleTable label="My goals" head={['Goal', 'Weight', 'Progress', 'Status']}>
            {d.goals.map((g) => (
              <tr key={g.id}>
                <td className={td}>{g.title}</td>
                <td className={`${td} num`}>{g.weight}%</td>
                <td className={`${td} num`}>{g.progress}%</td>
                <td className={td}>{GOAL_STATUS_LABEL[g.status]}</td>
              </tr>
            ))}
          </SimpleTable>
        ) : (
          <p className="text-xs text-muted">No goals in an open cycle.</p>
        )}
      </Section>
    </div>
  )
}

function TeamTab({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useReviews()
  const [open, setOpen] = useState(true)
  if (q.error) return <ErrorText error={q.error} />
  if (q.isPending) return <Skeleton className="h-40" />
  const rows = open ? q.data.filter((r) => r.cyclePhase !== 'closed') : q.data
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
        <Checkbox checked={open} onChange={(e) => setOpen(e.target.checked)} /> Open cycles only
      </label>
      {rows.length ? <ReviewTable rows={rows} onOpen={onOpen} label="Team reviews" showEmployee /> : <EmptyState icon={<Target />} title="No reviews" body="Reviews of the people you manage show here." />}
    </div>
  )
}

function CyclesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useCycles()
  if (q.error) return <ErrorText error={q.error} />
  if (q.isPending) return <Skeleton className="h-40" />
  if (!q.data.length) return <EmptyState icon={<Target />} title="No review cycles" body="Create a cycle to start goal setting and reviews." />
  return (
    <SimpleTable label="Review cycles" head={['Cycle', 'Type', 'Phase', 'Deadline', 'Participants', 'Completion', '']}>
      {q.data.map((c) => (
        <tr key={c.id}>
          <td className={td}>{c.name}</td>
          <td className={td}>{CYCLE_TYPE_LABEL[c.type]}</td>
          <td className={td}><PhaseBadge phase={c.phase} /></td>
          <td className={td}>{c.currentDeadline ? fmtDate(c.currentDeadline) : '—'}</td>
          <td className={`${td} num`}>{c.progress.total}</td>
          <td className={`${td} num`}>{c.progress.completionPct}%</td>
          <td className={td}>
            <Button size="xs" variant="secondary" aria-label={`Open cycle ${c.name}`} onClick={() => onOpen(c.id)}>
              Open
            </Button>
          </td>
        </tr>
      ))}
    </SimpleTable>
  )
}

function CycleDrawer({ id, onClose, onOpenReview }: { id: string | null; onClose: () => void; onOpenReview: (id: string) => void }) {
  const q = useCycle(id)
  const toast = useToast()
  const act = usePerfWrite((a: 'launch' | 'advance' | 'close') => api.cycleAction(id!, a))
  const remind = usePerfWrite(() => api.remindCycle(id!))
  const c = q.data
  const next = c ? nextPhase(c.template, c.phase) : null
  return (
    <Drawer open={!!id} onClose={onClose} width="xl" title={c?.name ?? 'Cycle'} description={c ? `${CYCLE_TYPE_LABEL[c.type]} · ${c.templateName} · ${fmtDate(c.periodStart)} – ${fmtDate(c.periodEnd)}` : undefined}>
      {q.error ? (
        <ErrorText error={q.error} />
      ) : !c ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <PhaseBadge phase={c.phase} />
            {c.currentDeadline && <span className="text-xs text-muted">Deadline {fmtDate(c.currentDeadline)}</span>}
            <span className="flex-1" />
            {c.phase === 'draft' && (
              <Button write loading={act.isPending} onClick={() => act.mutate('launch', { onSuccess: () => toast.success('Cycle launched') })}>
                Launch
              </Button>
            )}
            {c.phase !== 'draft' && next && next !== 'closed' && (
              <Button write loading={act.isPending} onClick={() => act.mutate('advance', { onSuccess: () => toast.success(`Moved to ${PHASE_LABEL[next]}`) })}>
                Move to {PHASE_LABEL[next]}
              </Button>
            )}
            {c.phase !== 'draft' && c.phase !== 'closed' && (
              <>
                <Button variant="secondary" write loading={remind.isPending} onClick={() => remind.mutate(undefined, { onSuccess: (r) => toast.success(`${r.sent} reminder${r.sent === 1 ? '' : 's'} sent`) })}>
                  Send reminders
                </Button>
                <Button variant="secondary" write onClick={() => act.mutate('close', { onSuccess: () => toast.success('Cycle closed') })}>
                  Close cycle
                </Button>
              </>
            )}
          </div>
          <FormError error={act.error ?? remind.error} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Participants', c.progress.total],
              ['Self-reviews', c.progress.selfDone],
              ['Manager reviews', `${c.progress.managerDone} (${c.progress.completionPct}%)`],
              ['Acknowledged', `${c.progress.acknowledged} / ${c.progress.shared} shared`],
            ].map(([k, v]) => (
              <Card key={k} className="px-3 py-2">
                <p className="text-xs text-muted">{k}</p>
                <p className="num text-[0.9375rem] text-ink">{v}</p>
              </Card>
            ))}
          </div>
          {c.byStage.length > 0 && (
            <Section title="Progress by stage">
              <div className="flex flex-wrap gap-2" aria-label="Progress by stage">
                {c.byStage.map((s) => (
                  <Badge key={s.stage} tone="neutral">
                    {STAGE_LABEL[s.stage]}: {s.count}
                  </Badge>
                ))}
              </div>
            </Section>
          )}
          <Section title="Rating distribution">
            <div dir="ltr" className="h-52" role="img" aria-label="Rating distribution">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={c.distribution.map((b) => ({ ...b, name: `${b.value} · ${b.label}` }))} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={AXIS_TICK} interval={0} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} tick={AXIS_TICK} />
                  <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="count" name="Employees" fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
          <Section title="By department">
            <SimpleTable label="Departments" head={['Department', 'Participants', 'Manager reviews', 'Average rating']}>
              {c.departments.map((d) => (
                <tr key={d.departmentId ?? 'none'}>
                  <td className={td}>{d.name}</td>
                  <td className={`${td} num`}>{d.total}</td>
                  <td className={`${td} num`}>{d.managerDone} ({d.completionPct}%)</td>
                  <td className={`${td} num`}>{d.averageRating ?? '—'}</td>
                </tr>
              ))}
            </SimpleTable>
          </Section>
          <Section title="Reviews">
            <ReviewTable rows={c.reviews} onOpen={onOpenReview} label="Cycle reviews" showEmployee />
          </Section>
        </div>
      )}
    </Drawer>
  )
}

const addDays = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000)
  return d.toISOString().slice(0, 10)
}

function NewCycleDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const options = usePerfOptions()
  const toast = useToast()
  const templates = (options.data?.templates ?? []).filter((t) => !t.forProbation)
  const year = new Date().getFullYear()
  const [f, setF] = useState({ name: '', type: 'annual' as CycleType, templateId: '', periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`, hiredBefore: '', goalSetting: addDays(7), selfReview: addDays(14), managerReview: addDays(21), calibration: addDays(28) })
  const [depts, setDepts] = useState<string[]>([])
  const templateId = f.templateId || templates[0]?.id || ''
  const t = templates.find((x) => x.id === templateId)
  const save = usePerfWrite(() =>
    api.saveCycle({
      name: f.name,
      type: f.type,
      templateId,
      periodStart: f.periodStart,
      periodEnd: f.periodEnd,
      departmentIds: depts,
      employeeIds: [],
      hiredBefore: f.hiredBefore || null,
      deadlines: { goalSetting: t?.goalsEnabled ? f.goalSetting : null, selfReview: t?.selfReview ? f.selfReview : null, managerReview: f.managerReview, calibration: f.calibration },
    }),
  )
  const input = (k: keyof typeof f, label: string, type = 'date') => (
    <Field id={`cy-${k}`} label={label}>
      <TextInput id={`cy-${k}`} type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  )
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New review cycle"
      description="Draft first; launching creates a review for every participant."
      footer={
        <Button write loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (c) => (toast.success('Cycle created'), onClose(), onCreated(c.id)) })}>
          Create cycle
        </Button>
      }
    >
      <div className="space-y-4">
        {input('name', 'Cycle name', 'text')}
        <div className="grid grid-cols-2 gap-3">
          <Field id="cy-type" label="Type">
            <SelectInput id="cy-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as CycleType })}>
              {(['annual', 'mid_year', 'ad_hoc'] as CycleType[]).map((x) => (
                <option key={x} value={x}>
                  {CYCLE_TYPE_LABEL[x]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id="cy-template" label="Template">
            <SelectInput id="cy-template" value={templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}>
              {templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          {input('periodStart', 'Period from')}
          {input('periodEnd', 'Period to')}
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Departments (none = all active employees)</legend>
          <div className="grid grid-cols-2 gap-1">
            {(options.data?.departments ?? []).map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
                <Checkbox checked={depts.includes(d.id)} onChange={(e) => setDepts(e.target.checked ? [...depts, d.id] : depts.filter((x) => x !== d.id))} />
                {d.name}
              </label>
            ))}
          </div>
        </fieldset>
        {input('hiredBefore', 'Leave out employees hired after')}
        <div className="grid grid-cols-2 gap-3">
          {t?.goalsEnabled && input('goalSetting', 'Goal setting deadline')}
          {t?.selfReview && input('selfReview', 'Self-review deadline')}
          {input('managerReview', 'Manager review deadline')}
          {input('calibration', 'Calibration deadline')}
        </div>
        <FormError error={save.error} />
      </div>
    </Drawer>
  )
}

/* ---------------- Templates ---------------- */

function TemplatesTab() {
  const q = useTemplates()
  const [editing, setEditing] = useState<ReviewTemplate | 'new' | null>(null)
  if (q.error) return <ErrorText error={q.error} />
  if (q.isPending) return <Skeleton className="h-40" />
  return (
    <div className="space-y-3">
      <Button variant="secondary" write onClick={() => setEditing('new')}>
        <Plus />
        New template
      </Button>
      <SimpleTable label="Review templates" head={['Template', 'Scale', 'Sections', 'Weights', 'Self-review', 'Cycles', '']}>
        {q.data.map((t) => (
          <tr key={t.id}>
            <td className={td}>
              {t.name} {t.forProbation && <Badge tone="amber">Probation</Badge>} {!t.active && <Badge>Inactive</Badge>}
            </td>
            <td className={td}>1–{t.scale.length}</td>
            <td className={`${td} num`}>{t.sections.length}</td>
            <td className={td}>{t.goalsEnabled ? `Goals ${t.goalsWeight}% · competencies ${t.competencyWeight}%` : 'Competencies only'}</td>
            <td className={td}>{t.selfReview ? 'Yes' : 'No'}</td>
            <td className={`${td} num`}>{t.cycleCount}</td>
            <td className={td}>
              <Button size="xs" variant="secondary" onClick={() => setEditing(t)}>
                Edit
              </Button>
            </td>
          </tr>
        ))}
      </SimpleTable>
      {editing && <TemplateDrawer template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** Sections as text: one section per line, "Title: question; question". */
const sectionsText = (t: ReviewTemplate | null) => (t ? t.sections.map((s) => `${s.title}: ${s.questions.map((q) => q.text).join('; ')}`).join('\n') : 'Delivery: Delivers agreed work on time; Quality of work\nCollaboration: Works well with others')

function TemplateDrawer({ template, onClose }: { template: ReviewTemplate | null; onClose: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({
    name: template?.name ?? '',
    description: template?.description ?? '',
    scale: (template?.scale ?? []).map((l) => l.label).join(', ') || 'Unsatisfactory, Needs improvement, Meets expectations, Exceeds expectations, Outstanding',
    sections: sectionsText(template),
    goalsEnabled: template?.goalsEnabled ?? true,
    goalsWeight: String(template?.goalsWeight ?? 40),
    selfReview: template?.selfReview ?? true,
    forProbation: template?.forProbation ?? false,
    active: template?.active ?? true,
  })
  const save = usePerfWrite(() =>
    api.saveTemplate(
      {
        name: f.name,
        description: f.description,
        scale: f.scale.split(',').map((label, i) => ({ value: i + 1, label: label.trim() })),
        sections: f.sections
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l, i) => {
            const [title, rest = ''] = l.split(/:(.*)/s)
            const old = template?.sections[i]
            return { id: old?.id, title: title.trim(), questions: rest.split(';').map((x) => x.trim()).filter(Boolean).map((text, j) => ({ id: old?.questions[j]?.id, text })) }
          }),
        goalsEnabled: f.goalsEnabled,
        goalsWeight: Number(f.goalsWeight),
        selfReview: f.selfReview,
        forProbation: f.forProbation,
        active: f.active,
      },
      template?.id,
    ),
  )
  return (
    <Drawer
      open
      onClose={onClose}
      title={template ? `Edit ${template.name}` : 'New review template'}
      description="Running cycles keep the version they were launched with."
      footer={
        <Button write loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => (toast.success('Template saved'), onClose()) })}>
          Save template
        </Button>
      }
    >
      <div className="space-y-4">
        <Field id="tp-name" label="Name">
          <TextInput id="tp-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field id="tp-desc" label="Description">
          <TextInput id="tp-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field id="tp-scale" label="Rating scale (lowest to highest, comma separated)">
          <TextInput id="tp-scale" value={f.scale} onChange={(e) => setF({ ...f, scale: e.target.value })} />
        </Field>
        <Field id="tp-sections" label="Competency sections" hint="One section per line: “Title: question; question”.">
          <TextArea id="tp-sections" rows={5} value={f.sections} onChange={(e) => setF({ ...f, sections: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
            <Checkbox checked={f.goalsEnabled} onChange={(e) => setF({ ...f, goalsEnabled: e.target.checked })} /> Goals section
          </label>
          {f.goalsEnabled && (
            <Field id="tp-weight" label="Goals weight % (competencies get the rest)">
              <TextInput id="tp-weight" type="number" min={0} max={100} value={f.goalsWeight} onChange={(e) => setF({ ...f, goalsWeight: e.target.value })} />
            </Field>
          )}
          <label className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
            <Checkbox checked={f.selfReview} onChange={(e) => setF({ ...f, selfReview: e.target.checked })} /> Self-assessment
          </label>
          <label className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
            <Checkbox checked={f.forProbation} onChange={(e) => setF({ ...f, forProbation: e.target.checked })} /> Use for probation reviews
          </label>
          <label className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
            <Checkbox checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
          </label>
        </div>
        <FormError error={save.error} />
      </div>
    </Drawer>
  )
}
