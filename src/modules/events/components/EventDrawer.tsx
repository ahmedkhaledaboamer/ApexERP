import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EventDetail, EventInput, EventStatus, EventType } from '@/modules/events/types'
import { EVENT_STATUS_LABEL, EVENT_TYPES, EVENT_TYPE_LABEL } from '@/modules/events/types'
import { useCreateEvent, useUpdateEvent } from '@/modules/events/hooks/useEvents'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { eventPath } from '@/app/paths'
import { useRegion } from '@/modules/tenancy/hooks'
import { companyDay } from '@/shared/lib/companyDay'
import { useCurrentUser } from '@/store/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, Switch, TextArea, TextInput } from '@/shared/components/form/Field'

interface Draft {
  name: string
  type: EventType
  status: EventStatus
  isOrganizer: boolean
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  location: string
  onlineUrl: string
  budget: string
  actualCost: string
  description: string
  ownerId: string
  teamIds: string[]
  registrationOpen: boolean
}

function draftOf(e: EventDetail | null, today: string, me: string): Draft {
  if (!e) {
    return {
      name: '', type: 'exhibition', status: 'planned', isOrganizer: false, startDate: today, startTime: '', endDate: '', endTime: '',
      location: '', onlineUrl: '', budget: '', actualCost: '', description: '', ownerId: me, teamIds: [], registrationOpen: false,
    }
  }
  return {
    name: e.name, type: e.type, status: e.status, isOrganizer: e.isOrganizer, startDate: e.startDate, startTime: e.startTime ?? '',
    endDate: e.endDate === e.startDate ? '' : e.endDate, endTime: e.endTime ?? '', location: e.location, onlineUrl: e.onlineUrl,
    budget: e.budget === null ? '' : String(e.budget), actualCost: e.actualCost === null ? '' : String(e.actualCost),
    description: e.description, ownerId: e.ownerId ?? '', teamIds: [], registrationOpen: e.registrationOpen,
  }
}

/** Client checks; the server validates again (422 messages are shown as they come). */
function problems(d: Draft): Partial<Record<keyof Draft, string>> {
  const out: Partial<Record<keyof Draft, string>> = {}
  if (d.name.trim().length < 2) out.name = 'Give the event a name.'
  if (!d.startDate) out.startDate = 'Pick the start date.'
  if (d.endDate && d.endDate < d.startDate) out.endDate = 'The end date is before the start.'
  if (d.endTime && !d.startTime) out.startTime = 'Set a start time too.'
  if (d.onlineUrl && !/^https?:\/\//i.test(d.onlineUrl)) out.onlineUrl = 'Use a full link (https://…).'
  for (const k of ['budget', 'actualCost'] as const) if (d[k] && !(Number(d[k]) >= 0)) out[k] = 'Enter a positive amount.'
  return out
}

/** Create or edit an event. Dates and times are the company's (regional timezone). */
export function EventDrawer({ open, onClose, event }: { open: boolean; onClose: () => void; event: EventDetail | null }) {
  const me = useCurrentUser()
  const region = useRegion()
  const today = companyDay({ timezone: region.timezone, weekStartsOn: region.weekStartsOn }).today
  const users = useUsersQuery()
  const create = useCreateEvent()
  const update = useUpdateEvent()
  const toast = useToast()
  const navigate = useNavigate()
  const [d, setD] = useState<Draft>(() => draftOf(event, today, me?.id ?? ''))
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!open) return
    setD(draftOf(event, today, me?.id ?? ''))
    setTouched(false)
    create.reset()
    update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const errs = touched ? problems(d) : {}
  const people = (users.data ?? []).filter((u) => u.active !== false)
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (Object.keys(problems(d)).length) return
    const input: EventInput = {
      name: d.name.trim(),
      type: d.type,
      isOrganizer: d.isOrganizer,
      startDate: d.startDate,
      startTime: d.startTime || null,
      endDate: d.endDate || null,
      endTime: d.endTime || null,
      location: d.location,
      onlineUrl: d.onlineUrl.trim(),
      budget: d.budget === '' ? null : Number(d.budget),
      description: d.description,
      registrationOpen: d.registrationOpen,
    }
    if (event) {
      const patch = { ...input, status: d.status, actualCost: d.actualCost === '' ? null : Number(d.actualCost), ...(event.canManage ? { ownerId: d.ownerId } : {}) }
      update.mutate(
        { id: event.id, input: patch },
        {
          onSuccess: () => {
            toast.success('Event updated', d.name)
            onClose()
          },
        },
      )
    } else {
      create.mutate(
        { ...input, ownerId: d.ownerId || undefined, teamIds: d.teamIds },
        {
          onSuccess: (created) => {
            toast.success('Event created', created.name)
            onClose()
            navigate(eventPath(created.id))
          },
        },
      )
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={event ? 'Edit event' : 'New event'}
      description={event ? event.name : 'Exhibitions, conferences, meetings and webinars you attend or organize.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="event-form" loading={pending}>
            {event ? 'Save changes' : 'Create event'}
          </Button>
        </>
      }
    >
      <form id="event-form" noValidate onSubmit={submit} className="space-y-5">
        <Field id="ev-name" label="Name" required error={errs.name}>
          <TextInput id="ev-name" value={d.name} invalid={!!errs.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. GITEX Global 2027" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="ev-type" label="Type">
            <SelectInput id="ev-type" value={d.type} onChange={(e) => set('type', e.target.value as EventType)}>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABEL[t]}
                </option>
              ))}
            </SelectInput>
          </Field>
          {event ? (
            <Field id="ev-status" label="Status" hint={event.status === 'cancelled' ? 'Reopen by picking another status (owner or marketing).' : undefined}>
              <SelectInput id="ev-status" value={d.status} onChange={(e) => set('status', e.target.value as EventStatus)}>
                {(['planned', 'confirmed', 'completed', ...(event.status === 'cancelled' ? (['cancelled'] as const) : [])] as EventStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {EVENT_STATUS_LABEL[s]}
                  </option>
                ))}
              </SelectInput>
            </Field>
          ) : (
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
                <Switch checked={d.isOrganizer} onChange={(v) => set('isOrganizer', v)} label="We organize it" />
                We organize it
              </label>
            </div>
          )}
        </div>
        <fieldset className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <legend className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">
            When <span className="font-normal text-muted">({region.timezone})</span>
          </legend>
          <Field id="ev-start" label="Start date" required error={errs.startDate}>
            <TextInput id="ev-start" type="date" value={d.startDate} invalid={!!errs.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Field id="ev-start-time" label="Start time" hint="Empty = all day" error={errs.startTime}>
            <TextInput id="ev-start-time" type="time" value={d.startTime} onChange={(e) => set('startTime', e.target.value)} />
          </Field>
          <Field id="ev-end" label="End date" error={errs.endDate}>
            <TextInput id="ev-end" type="date" value={d.endDate} min={d.startDate} invalid={!!errs.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </Field>
          <Field id="ev-end-time" label="End time">
            <TextInput id="ev-end-time" type="time" value={d.endTime} onChange={(e) => set('endTime', e.target.value)} />
          </Field>
        </fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="ev-location" label="Location">
            <TextInput id="ev-location" value={d.location} onChange={(e) => set('location', e.target.value)} placeholder="Venue, hall, city" />
          </Field>
          <Field id="ev-url" label="Online link" error={errs.onlineUrl}>
            <TextInput id="ev-url" type="url" inputMode="url" value={d.onlineUrl} invalid={!!errs.onlineUrl} onChange={(e) => set('onlineUrl', e.target.value)} placeholder="https://…" />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="ev-budget" label={`Budget (${region.currency})`} error={errs.budget}>
            <TextInput id="ev-budget" inputMode="decimal" value={d.budget} invalid={!!errs.budget} onChange={(e) => set('budget', e.target.value)} />
          </Field>
          {event && (
            <Field id="ev-cost" label={`Actual cost (${region.currency})`} error={errs.actualCost}>
              <TextInput id="ev-cost" inputMode="decimal" value={d.actualCost} invalid={!!errs.actualCost} onChange={(e) => set('actualCost', e.target.value)} />
            </Field>
          )}
        </div>
        <Field id="ev-owner" label="Owner" hint={event && !event.canManage ? 'Only the owner or a marketing manager can change the owner.' : 'The owner is always on the team.'}>
          <SelectInput id="ev-owner" value={d.ownerId} disabled={!!event && !event.canManage} onChange={(e) => set('ownerId', e.target.value)}>
            {d.ownerId && !people.some((u) => u.id === d.ownerId) && <option value={d.ownerId}>{event?.ownerName ?? 'Current owner'}</option>}
            {people.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.role}
              </option>
            ))}
          </SelectInput>
        </Field>
        {!event && (
          <fieldset>
            <legend className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Team</legend>
            <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
              {people
                .filter((u) => u.id !== d.ownerId)
                .map((u) => (
                  <label key={u.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-[0.8125rem] hover:bg-hover">
                    <Checkbox
                      checked={d.teamIds.includes(u.id)}
                      onChange={(e) => set('teamIds', e.target.checked ? [...d.teamIds, u.id] : d.teamIds.filter((x) => x !== u.id))}
                    />
                    <span className="truncate">{u.name}</span>
                  </label>
                ))}
            </div>
          </fieldset>
        )}
        <Field id="ev-desc" label="Description">
          <TextArea id="ev-desc" className="min-h-20" value={d.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-[0.8125rem] text-ink-2">
          <Switch checked={d.registrationOpen} onChange={(v) => set('registrationOpen', v)} label="Public registration open" />
          <span>
            Public registration open
            <span className="block text-xs text-muted">Anyone with the event’s link can register; each registration becomes a lead with the source Event.</span>
          </span>
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {error.message}
          </p>
        )}
      </form>
    </Drawer>
  )
}
