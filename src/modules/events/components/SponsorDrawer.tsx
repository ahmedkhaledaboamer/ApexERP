import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ListChecks, Trash2 } from 'lucide-react'
import type { SponsorDeal, SponsorPackage, SponsorStage } from '@/modules/events/sponsorTypes'
import { DELIVERABLE_STATUSES, DELIVERABLE_STATUS_LABEL, SPONSOR_STAGES, SPONSOR_STAGE_LABEL } from '@/modules/events/sponsorTypes'
import { useDeleteSponsor, useDeliverableTask, useMoveSponsor, useSponsorQuery, useUpdateDeliverable, useUpdateSponsor } from '@/modules/events/hooks/useSponsorsLogistics'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { SponsorStageBadge, offsetLabel, sponsorMoveProblem } from '@/modules/events/components/sponsorMeta'
import { LostReasonModal } from '@/modules/events/components/SponsorForms'
import { customerPath, eventPath, leadPath } from '@/app/paths'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'

/** Sponsor drawer: organization, package and amount, stage, owner, payment dates, notes and deliverables. */
export function SponsorDrawer({ eventId, sponsorId, packages, onClose }: { eventId: string; sponsorId: string | null; packages: SponsorPackage[]; onClose: () => void }) {
  const q = useSponsorQuery(eventId, sponsorId)
  const d = q.data
  return (
    <Drawer open={!!sponsorId} onClose={onClose} title={d?.organizationName ?? 'Sponsor'} description={d ? `${d.eventName} · ${d.packageName}` : undefined} width="lg">
      {q.isPending ? (
        <Skeleton className="h-64 rounded-card" />
      ) : q.error ? (
        <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
      ) : d ? (
        <SponsorDetail key={`${d.id}-${d.updatedAt}`} deal={d} packages={packages.filter((p) => p.eventId === d.eventId)} onDeleted={onClose} />
      ) : null}
    </Drawer>
  )
}

function SponsorDetail({ deal: d, packages, onDeleted }: { deal: SponsorDeal; packages: SponsorPackage[]; onDeleted: () => void }) {
  const toast = useToast()
  const users = useUsersQuery()
  const update = useUpdateSponsor()
  const move = useMoveSponsor()
  const remove = useDeleteSponsor()
  const deliverable = useUpdateDeliverable()
  const task = useDeliverableTask()
  const [lost, setLost] = useState(false)
  const [form, setForm] = useState({
    packageId: d.packageId,
    amount: String(d.amount),
    ownerId: d.ownerId ?? '',
    contactName: d.contactName,
    contactEmail: d.contactEmail,
    expectedPaymentDate: d.expectedPaymentDate ?? '',
    actualPaymentDate: d.actualPaymentDate ?? '',
    notes: d.notes,
  })
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const ids = { eventId: d.eventId, sponsorId: d.id }
  const onError = (title: string) => (err: Error) => toast.error(title, err.message)

  function toStage(stage: SponsorStage, lostReason?: string) {
    const problem = sponsorMoveProblem(d, stage, packages)
    if (problem) return toast.error('Not moved', problem)
    if (stage === 'lost' && !lostReason) return setLost(true)
    move.mutate({ ...ids, input: { stage, lostReason } }, { onSuccess: (r) => { setLost(false); toast.success(`${r.organizationName}: ${SPONSOR_STAGE_LABEL[r.stage]}`) }, onError: onError('Not moved') })
  }

  function save() {
    update.mutate(
      {
        ...ids,
        input: {
          packageId: form.packageId,
          amount: Number(form.amount || 0),
          ownerId: form.ownerId || null,
          contactName: form.contactName,
          contactEmail: form.contactEmail,
          expectedPaymentDate: form.expectedPaymentDate || null,
          actualPaymentDate: form.actualPaymentDate || null,
          notes: form.notes,
        },
      },
      { onSuccess: () => toast.success('Sponsor saved'), onError: onError('Not saved') },
    )
  }

  return (
    <div className="space-y-6">
      <section aria-label="Stage" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <SponsorStageBadge stage={d.stage} />
          <span className="num text-[0.9375rem] font-semibold">{moneyIn(d.amount, d.currency)}</span>
          {d.discount > 0 && <span className="text-xs text-muted">({moneyIn(d.discount, d.currency)} discount)</span>}
          {d.lostReason && <span className="text-xs text-muted">· {d.lostReason}</span>}
        </div>
        {d.canManage && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Move to stage">
            {SPONSOR_STAGES.filter((s) => s !== d.stage).map((s) => (
              <Button key={s} write variant="secondary" size="xs" disabled={move.isPending} onClick={() => toStage(s)}>
                {SPONSOR_STAGE_LABEL[s]}
              </Button>
            ))}
          </div>
        )}
        <p className="text-xs text-muted">
          {d.leadId && d.canOpenOrganization ? <Link className="font-medium text-brand-700 hover:underline dark:text-brand-300" to={leadPath(d.leadId)}>Open the lead</Link> : null}
          {d.customerId && d.canOpenOrganization ? <Link className="font-medium text-brand-700 hover:underline dark:text-brand-300" to={customerPath(d.customerId)}>Open the customer</Link> : null}
          {' '}
          <Link className="font-medium text-brand-700 hover:underline dark:text-brand-300" to={eventPath(d.eventId, 'sponsors')}>Event sponsors</Link>
        </p>
      </section>

      <section aria-label="Details" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="sd-package" label="Package">
          <SelectInput id="sd-package" disabled={!d.canManage} value={form.packageId} onChange={(e) => set({ packageId: e.target.value, amount: String(packages.find((p) => p.id === e.target.value)?.price ?? form.amount) })}>
            {packages.map((p) => <option key={p.id} value={p.id}>{p.name} · {moneyIn(p.price, p.currency)}</option>)}
          </SelectInput>
        </Field>
        <Field id="sd-amount" label={`Amount (${d.currency})`} hint={`Package price ${moneyIn(d.packagePrice, d.currency)}`}>
          <TextInput id="sd-amount" type="number" min={0} disabled={!d.canManage} value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
        </Field>
        <Field id="sd-contact" label="Contact">
          <TextInput id="sd-contact" disabled={!d.canManage} value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} />
        </Field>
        <Field id="sd-email" label="Contact email">
          <TextInput id="sd-email" type="email" disabled={!d.canManage} value={form.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} />
        </Field>
        <Field id="sd-owner" label="Owner">
          <SelectInput id="sd-owner" disabled={!d.canManage} value={form.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
            <option value="">No owner</option>
            {(users.data ?? []).filter((u) => u.active !== false || u.id === d.ownerId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </SelectInput>
        </Field>
        <Field id="sd-expected" label="Expected payment">
          <TextInput id="sd-expected" type="date" disabled={!d.canManage} value={form.expectedPaymentDate} onChange={(e) => set({ expectedPaymentDate: e.target.value })} />
        </Field>
        <Field id="sd-paid" label="Paid on">
          <TextInput id="sd-paid" type="date" disabled={!d.canManage} value={form.actualPaymentDate} onChange={(e) => set({ actualPaymentDate: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="sd-notes" label="Notes">
            <TextArea id="sd-notes" rows={2} disabled={!d.canManage} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
        {d.canManage && (
          <div className="flex items-center justify-between gap-2 sm:col-span-2">
            <Button
              write
              variant="ghost"
              size="sm"
              onClick={() => remove.mutate(ids, { onSuccess: () => { toast.success('Sponsor removed'); onDeleted() }, onError: onError('Not removed') })}
            >
              <Trash2 />
              Remove sponsor
            </Button>
            <Button write size="sm" loading={update.isPending} onClick={save}>Save</Button>
          </div>
        )}
      </section>

      <section aria-label="Deliverables" className="space-y-2">
        <h3 className="flex items-center gap-2 text-[0.8125rem] font-semibold"><ListChecks className="size-4" aria-hidden />Deliverables</h3>
        {d.deliverables.length === 0 ? (
          <p className="text-[0.8125rem] text-muted">Signing the sponsor creates the package’s deliverables.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {d.deliverables.map((x) => (
              <li key={x.id} className="grid grid-cols-1 gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_8.5rem_7rem_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-[0.8125rem] font-medium">{x.title}</p>
                  <p className="text-xs text-muted">
                    <CalendarClock className="me-1 inline size-3" aria-hidden />
                    {x.dueDate} · {offsetLabel(x.offsetDays)}
                    {x.ownerName ? ` · ${x.ownerName}` : ''}
                    {x.overdue && <Badge tone="red" className="ms-2">Overdue</Badge>}
                  </p>
                </div>
                <TextInput
                  aria-label={`${x.title} due date`}
                  type="date"
                  disabled={!d.canManage}
                  defaultValue={x.dueDate}
                  onBlur={(e) => e.target.value && e.target.value !== x.dueDate && deliverable.mutate({ ...ids, deliverableId: x.id, input: { dueDate: e.target.value } }, { onError: onError('Not saved') })}
                />
                <SelectInput aria-label={`${x.title} status`} disabled={!d.canManage} value={x.status} onChange={(e) => deliverable.mutate({ ...ids, deliverableId: x.id, input: { status: e.target.value as never } }, { onError: onError('Not saved') })}>
                  {DELIVERABLE_STATUSES.map((s) => <option key={s} value={s}>{DELIVERABLE_STATUS_LABEL[s]}</option>)}
                </SelectInput>
                {x.taskId ? (
                  <Badge tone="green">Task linked</Badge>
                ) : d.canManage ? (
                  <Button write variant="secondary" size="xs" onClick={() => task.mutate({ ...ids, deliverableId: x.id }, { onSuccess: () => toast.success('Task created', x.title), onError: onError('No task') })}>
                    Create task
                  </Button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {lost && <LostReasonModal name={d.organizationName} busy={move.isPending} onClose={() => setLost(false)} onConfirm={(r) => toStage('lost', r)} />}
    </div>
  )
}
