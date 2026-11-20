import { useState } from 'react'
import { ListChecks, Pencil, Plus, Ticket, Trash2, Users } from 'lucide-react'
import type { EventDetail, QuestionType, RegistrationQuestion, TicketType } from '@/modules/events/types'
import { QUESTION_TYPE_LABEL } from '@/modules/events/types'
import { useDeleteTicketType, useSaveTicketType, useTicketTypesQuery } from '@/modules/events/hooks/useEventsAdvanced'
import { useUpdateEvent } from '@/modules/events/hooks/useEvents'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, TextInput } from '@/shared/components/form/Field'

/** Tickets & registration: capacity, ticket types (seats, price, sales window) and custom questions. */
export function TicketsTab({ event: e }: { event: EventDetail }) {
  const writable = e.canEdit && e.status !== 'cancelled'
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <TicketTypesCard event={e} writable={writable} />
      <div className="space-y-6">
        <CapacityCard event={e} writable={writable} />
        <QuestionsCard event={e} writable={writable} />
      </div>
    </div>
  )
}

function TicketTypesCard({ event: e, writable }: { event: EventDetail; writable: boolean }) {
  const query = useTicketTypesQuery(e.id)
  const remove = useDeleteTicketType()
  const toast = useToast()
  const [editing, setEditing] = useState<TicketType | 'new' | null>(null)
  return (
    <Card className="self-start">
      <CardHeader
        title="Ticket types"
        icon={<Ticket />}
        description="Registration picks one. A full ticket (or a full event) puts people on the waitlist; a cancellation moves the first in line up."
        action={
          writable && (
            <Button write size="sm" onClick={() => setEditing('new')}>
              <Plus />
              Add ticket
            </Button>
          )
        }
      />
      {query.isPending ? (
        <CardBody><Skeleton className="h-24" /></CardBody>
      ) : query.error ? (
        <CardBody><ErrorState message={query.error.message} onRetry={() => query.refetch()} /></CardBody>
      ) : query.data.length === 0 ? (
        <CardBody><p className="text-[0.8125rem] text-muted">No ticket types: everyone registers for a general seat.</p></CardBody>
      ) : (
        <ul className="divide-y divide-line" aria-label="Ticket types">
          {query.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[0.8125rem] font-medium">{t.name}</p>
                <p className="text-xs text-muted">
                  {t.price ? moneyIn(t.price, t.currency) : 'Free'} · {t.capacity === null ? 'Unlimited' : `${t.capacity} seats`}
                  {(t.salesOpen || t.salesClose) && ` · on sale ${t.salesOpen ?? '…'} → ${t.salesClose ?? '…'}`}
                </p>
              </div>
              <span className="num text-xs text-ink-2">{t.registered} registered · {t.checkedIn} in</span>
              {t.waitlisted > 0 && <Badge tone="amber">{t.waitlisted} waiting</Badge>}
              {t.remaining === 0 && <Badge tone="red">Full</Badge>}
              {!t.onSale && <Badge tone="neutral">Not on sale</Badge>}
              {writable && (
                <div className="flex">
                  <Button write variant="ghost" size="xs" iconOnly aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                    <Pencil />
                  </Button>
                  <Button write variant="ghost" size="xs" iconOnly aria-label={`Delete ${t.name}`} onClick={() => remove.mutate({ id: e.id, ticketTypeId: t.id }, { onError: (err) => toast.error('Not deleted', err.message) })}>
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <TicketModal event={e} ticket={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function TicketModal({ event: e, ticket, onClose }: { event: EventDetail; ticket: TicketType | null; onClose: () => void }) {
  const save = useSaveTicketType()
  const toast = useToast()
  const [v, setV] = useState({
    name: ticket?.name ?? '',
    capacity: ticket?.capacity === null || !ticket ? '' : String(ticket.capacity),
    price: ticket ? String(ticket.price) : '0',
    salesOpen: ticket?.salesOpen ?? '',
    salesClose: ticket?.salesClose ?? '',
  })
  const set = (k: keyof typeof v, val: string) => setV((x) => ({ ...x, [k]: val }))
  return (
    <Modal
      open
      onClose={onClose}
      title={ticket ? `Edit ${ticket.name}` : 'Add a ticket type'}
      description={`Prices in ${e.currency}; 0 = free. No payment is taken.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                {
                  id: e.id,
                  ticketTypeId: ticket?.id,
                  input: { name: v.name, capacity: v.capacity === '' ? null : Number(v.capacity), price: Number(v.price || 0), salesOpen: v.salesOpen || null, salesClose: v.salesClose || null },
                },
                { onSuccess: () => { toast.success('Ticket saved', v.name); onClose() }, onError: (err) => toast.error('Not saved', err.message) },
              )
            }
          >
            Save ticket
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field id="tt-name" label="Name" required>
            <TextInput id="tt-name" value={v.name} onChange={(ev) => set('name', ev.target.value)} />
          </Field>
        </div>
        <Field id="tt-cap" label="Seats" hint="Empty = unlimited">
          <TextInput id="tt-cap" type="number" min={1} value={v.capacity} onChange={(ev) => set('capacity', ev.target.value)} />
        </Field>
        <Field id="tt-price" label={`Price (${e.currency})`}>
          <TextInput id="tt-price" type="number" min={0} value={v.price} onChange={(ev) => set('price', ev.target.value)} />
        </Field>
        <Field id="tt-open" label="Sales open">
          <TextInput id="tt-open" type="date" value={v.salesOpen} onChange={(ev) => set('salesOpen', ev.target.value)} />
        </Field>
        <Field id="tt-close" label="Sales close">
          <TextInput id="tt-close" type="date" value={v.salesClose} onChange={(ev) => set('salesClose', ev.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function CapacityCard({ event: e, writable }: { event: EventDetail; writable: boolean }) {
  const update = useUpdateEvent()
  const toast = useToast()
  const [cap, setCap] = useState(e.capacity === null ? '' : String(e.capacity))
  const [hours, setHours] = useState(String(e.reminderHours))
  const [days, setDays] = useState(String(e.followUpDays))
  return (
    <Card>
      <CardHeader title="Capacity & automation" icon={<Users />} description={`${e.attendeeCount} registered · ${e.waitlistCount} on the waitlist${e.remainingSeats !== null ? ` · ${e.remainingSeats} seats left` : ''}`} />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field id="ev-capacity" label="Event capacity" hint="Empty = unlimited">
            <TextInput id="ev-capacity" type="number" min={1} disabled={!writable} value={cap} onChange={(ev) => setCap(ev.target.value)} />
          </Field>
          <Field id="ev-reminder" label="Reminder (h before)">
            <TextInput id="ev-reminder" type="number" min={0} disabled={!writable} value={hours} onChange={(ev) => setHours(ev.target.value)} />
          </Field>
          <Field id="ev-followup" label="Follow-up (days after)">
            <TextInput id="ev-followup" type="number" min={0} disabled={!writable} value={days} onChange={(ev) => setDays(ev.target.value)} />
          </Field>
        </div>
        {writable && (
          <Button
            write
            size="sm"
            variant="secondary"
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                { id: e.id, input: { capacity: cap === '' ? null : Number(cap), reminderHours: Number(hours), followUpDays: Number(days) } },
                { onSuccess: () => toast.success('Saved', e.name), onError: (err) => toast.error('Not saved', err.message) },
              )
            }
          >
            Save
          </Button>
        )}
      </CardBody>
    </Card>
  )
}

type QRow = Omit<RegistrationQuestion, 'id' | 'options'> & { id?: string; key: string; options: string }
let qSeq = 0

function QuestionsCard({ event: e, writable }: { event: EventDetail; writable: boolean }) {
  const update = useUpdateEvent()
  const toast = useToast()
  const [rows, setRows] = useState<QRow[]>(() => e.questions.map((q) => ({ ...q, key: q.id, options: q.options.join(', ') })))
  const setRow = (key: string, patch: Partial<QRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  return (
    <Card>
      <CardHeader title="Registration questions" icon={<ListChecks />} description="Asked on the public page; answers show in the attendees table and export." />
      <CardBody className="space-y-2">
        {rows.length === 0 && <p className="text-[0.8125rem] text-muted">No custom questions.</p>}
        {rows.map((r, i) => (
          <div key={r.key} className="space-y-1.5 rounded-lg border border-line p-2">
            <TextInput aria-label={`Question ${i + 1}`} disabled={!writable} placeholder="Question" value={r.label} onChange={(ev) => setRow(r.key, { label: ev.target.value })} />
            <div className="flex items-center gap-2">
              <SelectInput aria-label={`Question ${i + 1} type`} disabled={!writable} value={r.type} onChange={(ev) => setRow(r.key, { type: ev.target.value as QuestionType })}>
                {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
              </SelectInput>
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                <Checkbox disabled={!writable} checked={r.required} onChange={(ev) => setRow(r.key, { required: ev.target.checked })} />
                Required
              </label>
              {writable && (
                <Button variant="ghost" size="xs" iconOnly className="ms-auto" aria-label={`Remove question ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                  <Trash2 />
                </Button>
              )}
            </div>
            {r.type !== 'text' && (
              <TextInput aria-label={`Question ${i + 1} choices`} disabled={!writable} placeholder="Choices, separated by commas" value={r.options} onChange={(ev) => setRow(r.key, { options: ev.target.value })} />
            )}
          </div>
        ))}
        {writable && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, { key: `new-${++qSeq}`, label: '', type: 'text', required: false, options: '' }])}>
              <Plus />
              Add question
            </Button>
            <Button
              write
              size="sm"
              loading={update.isPending}
              onClick={() =>
                update.mutate(
                  {
                    id: e.id,
                    input: {
                      questions: rows.map((r) => ({ id: r.id, label: r.label, type: r.type, required: r.required, options: r.options.split(',').map((o) => o.trim()).filter(Boolean) })),
                    },
                  },
                  { onSuccess: () => toast.success('Questions saved'), onError: (err) => toast.error('Not saved', err.message) },
                )
              }
            >
              Save questions
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
