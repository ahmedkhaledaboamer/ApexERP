import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ListChecks, Pencil, Plus, Route } from 'lucide-react'
import { useEmployeesQuery } from '@/modules/hr/hooks/useHrPeople'
import { HrError } from '@/modules/hr/components/PeopleBits'
import { EMPLOYMENT_TYPE_LABEL } from '@/modules/hr/types'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { useJourneyOptionsQuery, useJourneyScope, useJourneysQuery, useJourneyTemplatesQuery, useMyJourneyTasksQuery, useStartJourney } from '../hooks'
import { JOURNEY_KIND_LABEL, OWNER_ROLE_LABEL, type JourneyKind, type TemplateView } from '../types'
import { ItemLine, JourneyStatusBadge, ProgressBar, journeyPath } from '../components/JourneyBits'
import { TemplateDrawer } from '../components/TemplateDrawer'
import { useNewParam } from '@/shared/hooks/useNewParam'

type Tab = 'journeys' | 'mine' | 'templates'

/** `/hr/journeys`: running onboardings / offboardings (full / team / own), My tasks (any role), templates (HR full). */
export default function JourneysPage() {
  const { canManage, canSeeJourneys } = useJourneyScope()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') as Tab | null
  const tab: Tab = !canSeeJourneys ? 'mine' : requested === 'templates' && !canManage ? 'journeys' : requested ?? 'journeys'
  const mine = useMyJourneyTasksQuery()
  const openMine = (mine.data ?? []).filter((t) => t.item.status === 'open').length
  const items = [
    ...(canSeeJourneys ? [{ id: 'journeys' as const, label: 'Journeys' }] : []),
    { id: 'mine' as const, label: 'My tasks', count: openMine || undefined },
    ...(canManage ? [{ id: 'templates' as const, label: 'Templates' }] : []),
  ]
  return (
    <>
      <PageHeader icon={<IconTile><Route /></IconTile>} title="Onboarding & offboarding" description="Checklists for joiners and leavers: who does what, by when." />
      <PageBody>
        <Tabs label="Onboarding sections" items={items} value={tab} onChange={(t) => setParams({ tab: t })} className="mb-4" />
        {tab === 'journeys' && <JourneysTab canManage={canManage} />}
        {tab === 'mine' && <MyTasksTab />}
        {tab === 'templates' && <TemplatesTab />}
      </PageBody>
    </>
  )
}

function JourneysTab({ canManage }: { canManage: boolean }) {
  const [kind, setKind] = useState<JourneyKind | ''>('')
  const [showClosed, setShowClosed] = useState(false)
  const [starting, setStarting] = useState(false)
  useNewParam(() => setStarting(true), { when: canManage })
  const q = useJourneysQuery()
  const rows = useMemo(() => (q.data ?? []).filter((r) => (!kind || r.kind === kind) && (showClosed || r.status === 'active')), [q.data, kind, showClosed])
  if (q.error) return <HrError error={q.error} onRetry={() => q.refetch()} />
  const active = (q.data ?? []).filter((r) => r.status === 'active')
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SelectInput aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as JourneyKind | '')} className="w-44">
          <option value="">All journeys</option>
          <option value="onboarding">Onboarding</option>
          <option value="offboarding">Offboarding</option>
        </SelectInput>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show completed and cancelled
        </label>
        <span className="text-xs text-muted">
          {active.length} in progress · {active.reduce((n, r) => n + r.overdue, 0)} overdue items
        </span>
        {canManage && (
          <Button write size="sm" className="ms-auto" onClick={() => setStarting(true)}>
            <Plus />
            Start onboarding
          </Button>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Route />} title="No journeys" body="An onboarding starts when an employee is created as Onboarding (or hired); an offboarding when the status becomes Notice period or Left." />
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-[0.8125rem]" aria-label="Journeys">
            <thead className="bg-sunken text-start text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">Employee</th>
                <th className="px-3 py-2 text-start font-medium">Journey</th>
                <th className="px-3 py-2 text-start font-medium">Date</th>
                <th className="px-3 py-2 text-start font-medium">Progress</th>
                <th className="px-3 py-2 text-start font-medium">Overdue</th>
                <th className="px-3 py-2 text-start font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line hover:bg-hover">
                  <td className="px-3 py-2">
                    <Link to={journeyPath(r.id)} className="font-medium text-ink hover:underline">{r.employeeName}</Link>
                    <span className="block text-xs text-muted">{[r.jobTitle, r.departmentName].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={r.kind === 'onboarding' ? 'teal' : 'pink'}>{JOURNEY_KIND_LABEL[r.kind]}</Badge>
                    <span className="block text-xs text-muted">{r.templateName ?? 'No template'}</span>
                  </td>
                  <td className="num px-3 py-2">{r.anchorDate ? `${r.kind === 'onboarding' ? 'Starts' : 'Leaves'} ${fmtDate(r.anchorDate)}` : '—'}</td>
                  <td className="px-3 py-2"><ProgressBar pct={r.progress.pct} label={`${r.employeeName} progress`} /></td>
                  <td className="px-3 py-2">{r.overdue ? <Badge tone="red">{r.overdue}</Badge> : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2"><JourneyStatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {starting && <StartModal onClose={() => setStarting(false)} />}
    </div>
  )
}

function StartModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const employees = useEmployeesQuery()
  const opts = useJourneyOptionsQuery(true)
  const start = useStartJourney()
  const [employeeId, setEmployeeId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const candidates = (employees.data ?? []).filter((e) => e.status !== 'terminated')
  return (
    <Modal
      open
      onClose={onClose}
      title="Start an onboarding"
      description="Without a template choice the best match (department, employment type) is used."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            disabled={!employeeId}
            loading={start.isPending}
            onClick={() => start.mutate({ employeeId, kind: 'onboarding', templateId: templateId || null }, { onSuccess: () => { toast.success('Onboarding started'); onClose() }, onError: (e) => toast.error('Not started', e.message) })}
          >
            Start
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field id="jr-emp" label="Employee" required>
          <SelectInput id="jr-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Pick an employee</option>
            {candidates.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.employeeNo}</option>)}
          </SelectInput>
        </Field>
        <Field id="jr-tpl" label="Template">
          <SelectInput id="jr-tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Best match</option>
            {(opts.data?.templates ?? []).filter((t) => t.kind === 'onboarding').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectInput>
        </Field>
      </div>
    </Modal>
  )
}

function MyTasksTab() {
  const q = useMyJourneyTasksQuery()
  if (q.error) return <HrError error={q.error} onRetry={() => q.refetch()} />
  if (q.isPending) return <Skeleton className="h-40" />
  const tasks = q.data ?? []
  if (!tasks.length) return <EmptyState icon={<ListChecks />} title="Nothing assigned to you" body="Onboarding and offboarding items assigned to you show up here." />
  return (
    <Card>
      <CardBody>
        <ul className="divide-y divide-line" aria-label="My tasks">
          {tasks.map((t) => (
            <ItemLine key={t.item.id} journeyId={t.journeyId} employeeId={t.employeeId} item={t.item} subtitle={t.self ? `Your ${JOURNEY_KIND_LABEL[t.journeyKind].toLowerCase()}` : `${t.employeeName} · ${JOURNEY_KIND_LABEL[t.journeyKind]}`} />
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

function TemplatesTab() {
  const q = useJourneyTemplatesQuery(true)
  const [editing, setEditing] = useState<TemplateView | 'new' | null>(null)
  if (q.error) return <HrError error={q.error} onRetry={() => q.refetch()} />
  if (q.isPending) return <Skeleton className="h-40" />
  return (
    <div className="space-y-3">
      <div className="flex">
        <Button write size="sm" className="ms-auto" onClick={() => setEditing('new')}><Plus />New template</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {(q.data ?? []).map((t) => (
          <Card key={t.id}>
            <CardHeader
              title={t.name}
              description={[JOURNEY_KIND_LABEL[t.kind], t.departmentName ?? 'Any department', t.employmentType ? EMPLOYMENT_TYPE_LABEL[t.employmentType] : 'Any type', t.active ? null : 'Inactive', `${t.activeJourneys} running`].filter(Boolean).join(' · ')}
              action={<Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`}><Pencil /></Button>}
            />
            <CardBody>
              <ul className="space-y-1 text-xs">
                {t.items.map((i) => (
                  <li key={i.id} className="flex gap-2">
                    <span className="num w-12 shrink-0 text-muted">{i.dueAnchor === 'probation_end' ? `P${i.dueOffsetDays >= 0 ? '+' : ''}${i.dueOffsetDays}` : `${i.dueOffsetDays >= 0 ? '+' : ''}${i.dueOffsetDays}d`}</span>
                    <span className="min-w-0 flex-1 text-ink">{i.title}</span>
                    <span className="text-muted">{i.ownerUserName ?? OWNER_ROLE_LABEL[i.ownerRole]}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>
      {editing && <TemplateDrawer template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
