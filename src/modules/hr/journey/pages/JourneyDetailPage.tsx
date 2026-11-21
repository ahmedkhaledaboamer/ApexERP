import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Plus, Route, Trash2 } from 'lucide-react'
import { useCompleteOffboarding } from '@/modules/hr/hooks/useHrPeople'
import { EmploymentStatusBadge, HrError } from '@/modules/hr/components/PeopleBits'
import { fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { useActivateJourney, useAddJourneyItem, useCancelJourney, useDeleteJourneyItem, useJourneyOptionsQuery, useJourneyQuery, useUpdateJourneyItem } from '../hooks'
import { JOURNEY_KIND_LABEL, OWNER_ROLES, OWNER_ROLE_LABEL, type JourneyDetail, type JourneyItem, type OwnerRole } from '../types'
import { ItemLine, JourneyStatusBadge, ProgressBar } from '../components/JourneyBits'

/** `/hr/journeys/:id`: one onboarding / offboarding, items grouped by owner. */
export default function JourneyDetailPage() {
  const { id = '' } = useParams()
  const q = useJourneyQuery(id)
  if (q.error) return <PageBody><HrError error={q.error} onRetry={() => q.refetch()} /></PageBody>
  if (!q.data) return <PageBody><Skeleton className="h-64" /></PageBody>
  return <Detail j={q.data} />
}

function Detail({ j }: { j: JourneyDetail }) {
  const toast = useToast()
  const activate = useActivateJourney()
  const cancel = useCancelJourney()
  const offboard = useCompleteOffboarding()
  const opts = useJourneyOptionsQuery(j.canManage)
  const update = useUpdateJourneyItem()
  const remove = useDeleteJourneyItem()
  const [adding, setAdding] = useState(false)
  const running = j.status === 'active'
  const groups = OWNER_ROLES.map((role) => ({ role, items: j.items.filter((i) => i.ownerRole === role) })).filter((g) => g.items.length)
  const err = (title: string) => (e: Error) => toast.error(title, e.message)

  const manageActions = (item: JourneyItem) =>
    j.canManage && running && !item.system ? (
      <span className="flex shrink-0 items-center gap-1">
        <SelectInput
          aria-label={`Assignee of ${item.title}`}
          value={item.assigneeUserId ?? ''}
          onChange={(e) => update.mutate({ journeyId: j.id, itemId: item.id, input: { assigneeUserId: e.target.value || null } }, { onError: err('Not reassigned') })}
          className="h-7 w-36 text-xs"
        >
          <option value="">HR team</option>
          {(opts.data?.assignees ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </SelectInput>
        <Button variant="ghost" size="xs" iconOnly aria-label={`Remove ${item.title}`} onClick={() => remove.mutate({ journeyId: j.id, itemId: item.id }, { onError: err('Not removed') })}><Trash2 /></Button>
      </span>
    ) : null

  return (
    <>
      <PageHeader
        icon={<IconTile><Route /></IconTile>}
        title={`${JOURNEY_KIND_LABEL[j.kind]}: ${j.employeeName}`}
        description={[j.jobTitle, j.departmentName, j.managerName ? `manager ${j.managerName}` : null, j.anchorDate ? `${j.kind === 'onboarding' ? 'hire date' : 'last day'} ${fmtDate(j.anchorDate)}` : null, j.templateName].filter(Boolean).join(' · ')}
        actions={
          j.canManage && running && (
            <>
              <Button write variant="secondary" size="sm" onClick={() => setAdding(true)}><Plus />Add item</Button>
              {j.kind === 'onboarding' ? (
                <Button write size="sm" disabled={!j.canFinish} title={j.canFinish ? undefined : `Open: ${j.finishBlockers.join(', ')}`} loading={activate.isPending} onClick={() => activate.mutate(j.id, { onSuccess: () => toast.success('Onboarding completed', `${j.employeeName} is active`), onError: err('Not completed') })}>
                  {j.employeeStatus === 'onboarding' ? 'Mark active' : 'Complete onboarding'}
                </Button>
              ) : (
                <Button write size="sm" disabled={!j.canFinish} loading={offboard.isPending} onClick={() => offboard.mutate(j.employeeId, { onSuccess: () => toast.success('Offboarding completed'), onError: err('Not completed') })}>
                  Complete offboarding
                </Button>
              )}
              {!(j.kind === 'offboarding') && <Button write variant="ghost" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate(j.id, { onError: err('Not cancelled') })}>Cancel</Button>}
            </>
          )
        }
      />
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[0.8125rem]">
          <JourneyStatusBadge status={j.status} />
          <EmploymentStatusBadge status={j.employeeStatus} />
          <ProgressBar pct={j.progress.pct} label="Progress" />
          <span className="text-muted">{j.progress.done}/{j.progress.total} done · {j.progress.requiredDone}/{j.progress.requiredTotal} required{j.overdue ? ` · ${j.overdue} overdue` : ''}</span>
          <Link to={`/hr/employees/${encodeURIComponent(j.employeeId)}`} className="ms-auto text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">Employee profile</Link>
        </div>
        {running && !j.canFinish && j.finishBlockers.length > 0 && (
          <p className="mb-3 text-xs text-muted" role="status">
            {j.kind === 'onboarding' ? 'Before marking active: ' : 'Blocking the offboarding: '}
            {j.finishBlockers.join(' · ')}
          </p>
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.role}>
              <CardHeader title={OWNER_ROLE_LABEL[g.role]} description={`${g.items.filter((i) => i.status === 'done').length}/${g.items.length} done`} />
              <CardBody>
                <ul className="divide-y divide-line" aria-label={`${OWNER_ROLE_LABEL[g.role]} items`}>
                  {g.items.map((i) => <ItemLine key={i.id} journeyId={j.id} employeeId={j.employeeId} item={i} actions={manageActions(i)} />)}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      </PageBody>
      {adding && <AddItemModal j={j} onClose={() => setAdding(false)} />}
    </>
  )
}

function AddItemModal({ j, onClose }: { j: JourneyDetail; onClose: () => void }) {
  const toast = useToast()
  const add = useAddJourneyItem()
  const opts = useJourneyOptionsQuery(true)
  const [title, setTitle] = useState('')
  const [ownerRole, setOwnerRole] = useState<OwnerRole>('hr')
  const [assigneeUserId, setAssignee] = useState('')
  const [dueDate, setDueDate] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      title="Add an item"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={add.isPending} onClick={() => add.mutate({ journeyId: j.id, input: { title, ownerRole, ...(assigneeUserId ? { assigneeUserId } : {}), ...(dueDate ? { dueDate } : {}) } }, { onSuccess: () => { toast.success('Item added'); onClose() }, onError: (e) => toast.error('Not added', e.message) })}>Add item</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field id="ji-title" label="Title" required><TextInput id="ji-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field id="ji-owner" label="Owner">
          <SelectInput id="ji-owner" value={ownerRole} onChange={(e) => setOwnerRole(e.target.value as OwnerRole)}>
            {OWNER_ROLES.map((o) => <option key={o} value={o}>{OWNER_ROLE_LABEL[o]}</option>)}
          </SelectInput>
        </Field>
        <Field id="ji-user" label="Person" hint="Empty: the employee / manager for those owners, else the HR team.">
          <SelectInput id="ji-user" value={assigneeUserId} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Default</option>
            {(opts.data?.assignees ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </SelectInput>
        </Field>
        <Field id="ji-due" label="Due date" hint={`Empty: the ${j.kind === 'onboarding' ? 'hire' : 'exit'} date.`}><TextInput id="ji-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
