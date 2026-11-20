import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Mic2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useSpeakersQuery } from '@/modules/events/hooks/useEventLibrary'
import { speakerPath } from '@/app/paths'
import { Segmented } from '@/shared/components/ui/Segmented'
import type { EventDetail, EventSession, EventSpeaker } from '@/modules/events/types'
import { useAgendaQuery, useRemoveSession, useRemoveSpeaker, useSaveSession, useSaveSpeaker } from '@/modules/events/hooks/useEventsAdvanced'
import { fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'

/** Agenda: sessions (company timezone) by day, and the event's speakers. Editors add / change both. */
export function AgendaTab({ event: e }: { event: EventDetail }) {
  const query = useAgendaQuery(e.id)
  const removeSession = useRemoveSession()
  const removeSpeaker = useRemoveSpeaker()
  const toast = useToast()
  const [session, setSession] = useState<EventSession | 'new' | null>(null)
  const [speaker, setSpeaker] = useState<EventSpeaker | 'new' | null>(null)
  const writable = e.canEdit && e.status !== 'cancelled'

  if (query.isPending) return <Skeleton className="h-48 rounded-card" />
  if (query.error) return <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
  const a = query.data
  const days = [...new Set(a.sessions.map((s) => s.date))]

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="self-start">
        <CardHeader
          title="Agenda"
          icon={<CalendarClock />}
          description={`Times in ${a.timezone}. Sessions in the same room can’t overlap.`}
          action={
            writable && (
              <Button write size="sm" onClick={() => setSession('new')}>
                <Plus />
                Add session
              </Button>
            )
          }
        />
        {a.sessions.length === 0 ? (
          <CardBody>
            <EmptyState icon={<CalendarClock />} title="No sessions yet" body="Add talks, panels and breaks; the public registration page shows them." />
          </CardBody>
        ) : (
          days.map((day) => (
            <section key={day} aria-label={`Sessions on ${fmtDate(day)}`} className="border-t border-line first:border-t-0">
              <h3 className="bg-sunken/60 px-5 py-1.5 text-xs font-medium text-muted">{fmtDate(day)}</h3>
              <ul className="divide-y divide-line">
                {a.sessions
                  .filter((s) => s.date === day)
                  .map((s) => (
                    <li key={s.id} className="flex items-start gap-3 px-5 py-3">
                      <span className="num w-24 shrink-0 pt-0.5 text-xs text-ink-2">
                        {s.startTime}–{s.endTime}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.8125rem] font-medium">{s.title}</p>
                        {s.speakers.length > 0 && <p className="text-xs text-muted">{s.speakers.map((x) => x.name).join(', ')}</p>}
                        {s.description && <p className="mt-0.5 text-xs text-muted">{s.description}</p>}
                      </div>
                      {s.room && <Badge tone="neutral">{s.room}</Badge>}
                      {writable && (
                        <div className="flex">
                          <Button write variant="ghost" size="xs" iconOnly aria-label={`Edit ${s.title}`} onClick={() => setSession(s)}>
                            <Pencil />
                          </Button>
                          <Button
                            write
                            variant="ghost"
                            size="xs"
                            iconOnly
                            aria-label={`Remove ${s.title}`}
                            onClick={() => removeSession.mutate({ id: e.id, sessionId: s.id }, { onError: (err) => toast.error('Not removed', err.message) })}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          ))
        )}
      </Card>
      <Card className="self-start">
        <CardHeader
          title="Speakers"
          icon={<Mic2 />}
          action={
            writable && (
              <Button write variant="secondary" size="sm" onClick={() => setSpeaker('new')}>
                <Plus />
                Add
              </Button>
            )
          }
        />
        <CardBody>
          {a.speakers.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">No speakers yet.</p>
          ) : (
            <ul className="space-y-3" aria-label="Speakers">
              {a.speakers.map((s) => (
                <li key={s.id} className="flex items-start gap-2.5">
                  {s.photoUrl ? <img src={s.photoUrl} alt="" className="size-8 rounded-full object-cover" /> : <Avatar name={s.name} size="sm" />}
                  <div className="min-w-0 flex-1">
                    <Link to={speakerPath(s.id)} className="block truncate text-[0.8125rem] font-medium hover:underline">{s.name}</Link>
                    <p className="truncate text-xs text-muted">{[s.title, s.company].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                  {writable && (
                    <>
                      {a.canEditSpeakers && (
                        <Button write variant="ghost" size="xs" iconOnly aria-label={`Edit ${s.name}`} onClick={() => setSpeaker(s)}>
                          <Pencil />
                        </Button>
                      )}
                      <Button write variant="ghost" size="xs" iconOnly aria-label={`Remove ${s.name}`} onClick={() => removeSpeaker.mutate({ id: e.id, speakerId: s.id }, { onError: (err) => toast.error('Not removed', err.message) })}>
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {session && <SessionModal event={e} session={session === 'new' ? null : session} speakers={a.speakers} onClose={() => setSession(null)} />}
      {speaker && <SpeakerModal eventId={e.id} speaker={speaker === 'new' ? null : speaker} roster={a.speakers.map((s) => s.id)} onClose={() => setSpeaker(null)} />}
    </div>
  )
}

function SessionModal({ event: e, session, speakers, onClose }: { event: EventDetail; session: EventSession | null; speakers: EventSpeaker[]; onClose: () => void }) {
  const save = useSaveSession()
  const toast = useToast()
  const [v, setV] = useState({
    title: session?.title ?? '',
    date: session?.date ?? e.startDate,
    startTime: session?.startTime ?? e.startTime ?? '09:00',
    endTime: session?.endTime ?? '10:00',
    room: session?.room ?? '',
    description: session?.description ?? '',
    speakerIds: session?.speakerIds ?? [],
  })
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }))
  return (
    <Modal
      open
      onClose={onClose}
      title={session ? 'Edit session' : 'Add session'}
      description={`Between ${fmtDate(e.startDate)} and ${fmtDate(e.endDate)}, company time.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            loading={save.isPending}
            onClick={() => save.mutate({ id: e.id, input: v, sessionId: session?.id }, { onSuccess: () => { toast.success('Agenda saved', v.title); onClose() }, onError: (err) => toast.error('Not saved', err.message) })}
          >
            Save session
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field id="ses-title" label="Title" required>
          <TextInput id="ses-title" value={v.title} onChange={(ev) => set('title', ev.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field id="ses-date" label="Date">
            <TextInput id="ses-date" type="date" min={e.startDate} max={e.endDate} value={v.date} onChange={(ev) => set('date', ev.target.value)} />
          </Field>
          <Field id="ses-start" label="Starts">
            <TextInput id="ses-start" type="time" value={v.startTime} onChange={(ev) => set('startTime', ev.target.value)} />
          </Field>
          <Field id="ses-end" label="Ends">
            <TextInput id="ses-end" type="time" value={v.endTime} onChange={(ev) => set('endTime', ev.target.value)} />
          </Field>
        </div>
        <Field id="ses-room" label="Room / track">
          <TextInput id="ses-room" value={v.room} onChange={(ev) => set('room', ev.target.value)} />
        </Field>
        <Field id="ses-desc" label="Description">
          <TextArea id="ses-desc" rows={2} value={v.description} onChange={(ev) => set('description', ev.target.value)} />
        </Field>
        {speakers.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-[0.8125rem] font-medium">Speakers</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {speakers.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-[0.8125rem]">
                  <Checkbox
                    checked={v.speakerIds.includes(s.id)}
                    onChange={(ev) => set('speakerIds', ev.target.checked ? [...v.speakerIds, s.id] : v.speakerIds.filter((x) => x !== s.id))}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Modal>
  )
}

/**
 * Add a speaker to the event: pick one from the company's speaker directory, or add a new one (which
 * creates the directory entry). Editing an existing speaker changes the directory profile (marketing full).
 */
function SpeakerModal({ eventId, speaker, roster, onClose }: { eventId: string; speaker: EventSpeaker | null; roster: string[]; onClose: () => void }) {
  const save = useSaveSpeaker()
  const toast = useToast()
  const directory = useSpeakersQuery(!speaker)
  const available = (directory.data ?? []).filter((s) => !roster.includes(s.id))
  const [mode, setMode] = useState<'pick' | 'new'>(speaker ? 'new' : 'pick')
  const [pickId, setPickId] = useState('')
  const [v, setV] = useState({ name: speaker?.name ?? '', title: speaker?.title ?? '', company: speaker?.company ?? '', bio: speaker?.bio ?? '', photoUrl: speaker?.photoUrl ?? '' })
  const set = (k: keyof typeof v, val: string) => setV((x) => ({ ...x, [k]: val }))
  const picking = !speaker && mode === 'pick'
  function submit() {
    if (picking) {
      if (!pickId) return toast.error('Pick a speaker', 'Choose one from the directory, or add a new speaker.')
      const picked = available.find((s) => s.id === pickId)
      save.mutate({ id: eventId, input: { speakerId: pickId } as never }, { onSuccess: () => { toast.success('Speaker added', picked?.name); onClose() }, onError: (err) => toast.error('Not added', err.message) })
      return
    }
    save.mutate({ id: eventId, input: v, speakerId: speaker?.id }, { onSuccess: () => { toast.success('Speaker saved', v.name); onClose() }, onError: (err) => toast.error('Not saved', err.message) })
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={speaker ? 'Edit speaker' : 'Add speaker'}
      description={speaker ? 'This changes the speaker’s profile in the company’s speaker directory.' : 'Speakers come from the company’s speaker directory.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={submit}>
            {picking ? 'Add to agenda' : 'Save speaker'}
          </Button>
        </>
      }
    >
      {!speaker && (
        <div className="mb-4">
          <Segmented<'pick' | 'new'>
            label="Speaker source"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'pick', label: 'From the directory' },
              { value: 'new', label: 'New speaker' },
            ]}
          />
        </div>
      )}
      {picking ? (
        <Field id="spk-pick" label="Speaker" hint={directory.isPending ? 'Loading the directory…' : available.length ? undefined : 'Everyone in the directory is already on this event. Add a new speaker instead.'}>
          <SelectInput id="spk-pick" value={pickId} onChange={(ev) => setPickId(ev.target.value)}>
            <option value="">Choose a speaker…</option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.company ? ` · ${s.company}` : ''}
              </option>
            ))}
          </SelectInput>
        </Field>
      ) : (
      <div className="space-y-3">
        <Field id="spk-name" label="Name" required>
          <TextInput id="spk-name" value={v.name} onChange={(ev) => set('name', ev.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="spk-title" label="Title">
            <TextInput id="spk-title" value={v.title} onChange={(ev) => set('title', ev.target.value)} />
          </Field>
          <Field id="spk-company" label="Company">
            <TextInput id="spk-company" value={v.company} onChange={(ev) => set('company', ev.target.value)} />
          </Field>
        </div>
        <Field id="spk-photo" label="Photo URL">
          <TextInput id="spk-photo" value={v.photoUrl} placeholder="https://…" onChange={(ev) => set('photoUrl', ev.target.value)} />
        </Field>
        <Field id="spk-bio" label="Bio">
          <TextArea id="spk-bio" rows={3} value={v.bio} onChange={(ev) => set('bio', ev.target.value)} />
        </Field>
        {!speaker && <p className="text-xs text-muted">The new speaker is added to the directory too (the same name + company is reused, never duplicated).</p>}
      </div>
      )}
    </Modal>
  )
}
