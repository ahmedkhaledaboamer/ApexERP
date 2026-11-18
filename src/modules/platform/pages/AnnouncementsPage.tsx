import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Pencil, Plus, Square } from 'lucide-react'
import type { Announcement, AnnouncementInput, AnnouncementTone } from '@/modules/platform/types'
import type { CountryCode } from '@/modules/tenancy/types'
import { createAnnouncement, endAnnouncement, updateAnnouncement } from '@/modules/platform/api'
import { platformKeys, useAnnouncements, usePlatform, usePlatformPlans } from '@/modules/platform/hooks'
import { announcementStatus, validateAnnouncement, type AnnouncementStatus } from '@/modules/platform/announcements'
import { COUNTRIES, COUNTRY_LABEL, fmtDateTime, fromLocalInput, toLocalInput } from '@/modules/platform/format'
import { ConfirmReasonDialog } from '@/modules/platform/components/ConfirmReasonDialog'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

const STATUS: Record<AnnouncementStatus, { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'sky' },
  live: { label: 'Live', tone: 'green' },
  ended: { label: 'Ended', tone: 'neutral' },
}
const TONE: Record<AnnouncementTone, { label: string; tone: Tone }> = {
  info: { label: 'Info', tone: 'blue' },
  warning: { label: 'Warning', tone: 'amber' },
  success: { label: 'Success', tone: 'green' },
}

/** In-app announcements to companies (by plan and country), shown as a banner in the company app. */
export default function AnnouncementsPage() {
  const query = useAnnouncements()
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null)
  const [ending, setEnding] = useState<Announcement | null>(null)
  const now = Date.now()
  const rows = query.data ? [...query.data].sort((a, b) => b.startsAt.localeCompare(a.startsAt)) : []

  return (
    <>
      <PageHeader
        title="Announcements"
        description="A banner in the company app for the companies you pick. Users can dismiss it."
        actions={
          <Button id="announcement-new" onClick={() => setEditing('new')}>
            <Plus />
            New announcement
          </Button>
        }
      />
      <PageBody>
        {query.isPending ? (
          <Skeleton className="h-64 rounded-card" />
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState icon={<Megaphone />} title="No announcements" body="Create one to tell companies about maintenance, new features or policy changes." />
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table id="announcements-table" className="w-full min-w-[56rem] text-[0.8125rem]">
              <thead className="bg-sunken/70 text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">Announcement</th>
                  <th className="px-3 py-2.5 text-start font-medium">Status</th>
                  <th className="px-3 py-2.5 text-start font-medium">Audience</th>
                  <th className="px-3 py-2.5 text-start font-medium">Window</th>
                  <th className="px-3 py-2.5 text-end font-medium">Reach</th>
                  <th className="px-4 py-2.5 text-end font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((a) => {
                  const status = announcementStatus(a, now)
                  return (
                    <tr key={a.id} data-announcement-id={a.id} data-status={status}>
                      <td className="max-w-[22rem] px-4 py-3">
                        <p className="flex items-center gap-1.5 font-medium text-ink">
                          <Badge tone={TONE[a.tone].tone}>{TONE[a.tone].label}</Badge>
                          <span className="truncate">{a.title}</span>
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted">{a.body}</p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={STATUS[status].tone} variant="dot">
                          {STATUS[status].label}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-2">
                        <p>{a.audience.plans.length ? `Plans: ${a.audience.plans.join(', ')}` : 'All plans'}</p>
                        <p className="text-muted">{a.audience.countries.length ? `Countries: ${a.audience.countries.join(', ')}` : 'All countries'}</p>
                      </td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap text-muted">
                        <p>{fmtDateTime(a.startsAt)}</p>
                        <p>→ {fmtDateTime(a.endsAt)}</p>
                      </td>
                      <td className="num px-3 py-3 text-end">{a.reach ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {status !== 'ended' && (
                            <>
                              <Button size="sm" variant="ghost" iconOnly aria-label={`Edit ${a.title}`} data-edit-announcement={a.id} onClick={() => setEditing(a)}>
                                <Pencil />
                              </Button>
                              <Button size="sm" variant="secondary" data-end-announcement={a.id} onClick={() => setEnding(a)}>
                                <Square />
                                End now
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </PageBody>
      <AnnouncementDrawer target={editing} onClose={() => setEditing(null)} />
      <EndDialog target={ending} onClose={() => setEnding(null)} />
    </>
  )
}

function EndDialog({ target, onClose }: { target: Announcement | null; onClose: () => void }) {
  const { token } = usePlatform()
  const qc = useQueryClient()
  const toast = useToast()
  const end = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => endAnnouncement(token, id, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: platformKeys.announcements })
      toast.success('Announcement ended')
      onClose()
    },
  })
  return (
    <ConfirmReasonDialog
      open={!!target}
      onClose={() => {
        end.reset()
        onClose()
      }}
      title="End announcement now"
      description={target ? `“${target.title}” disappears from every company right away. It stays in the list and the audit log.` : undefined}
      confirmLabel="End now"
      danger
      pending={end.isPending}
      error={end.isError ? end.error.message : null}
      onConfirm={(reason) => target && end.mutate({ id: target.id, reason })}
    />
  )
}

interface Draft {
  title: string
  body: string
  tone: AnnouncementTone
  plans: string[]
  countries: CountryCode[]
  startsAt: string
  endsAt: string
}

function draftOf(a: Announcement | null): Draft {
  const now = new Date()
  return {
    title: a?.title ?? '',
    body: a?.body ?? '',
    tone: a?.tone ?? 'info',
    plans: a?.audience.plans ?? [],
    countries: a?.audience.countries ?? [],
    startsAt: toLocalInput(a?.startsAt ?? now.toISOString()),
    endsAt: toLocalInput(a?.endsAt ?? new Date(now.getTime() + 7 * 86_400_000).toISOString()),
  }
}

function AnnouncementDrawer({ target, onClose }: { target: Announcement | 'new' | null; onClose: () => void }) {
  const { token } = usePlatform()
  const qc = useQueryClient()
  const toast = useToast()
  const plans = usePlatformPlans(!!target)
  const existing = target && target !== 'new' ? target : null
  const [draft, setDraft] = useState<Draft>(() => draftOf(existing))
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => {
    if (target) {
      setDraft(draftOf(target === 'new' ? null : target))
      setSubmitted(false)
    }
  }, [target])

  const input: AnnouncementInput = {
    title: draft.title.trim(),
    body: draft.body.trim(),
    tone: draft.tone,
    audience: { plans: draft.plans, countries: draft.countries },
    startsAt: fromLocalInput(draft.startsAt) ?? '',
    endsAt: fromLocalInput(draft.endsAt) ?? '',
  }
  const errors = validateAnnouncement(input)
  const err = (k: string) => (submitted ? errors[k] : undefined)

  const save = useMutation({
    mutationFn: () => (existing ? updateAnnouncement(token, existing.id, input) : createAnnouncement(token, input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: platformKeys.announcements })
      toast.success(existing ? 'Announcement updated' : 'Announcement created')
      onClose()
    },
  })

  const toggle = <T extends string>(list: T[], v: T, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v))

  return (
    <Drawer
      open={!!target}
      onClose={onClose}
      title={existing ? 'Edit announcement' : 'New announcement'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            id="announcement-save"
            loading={save.isPending}
            onClick={() => {
              setSubmitted(true)
              if (Object.keys(errors).length === 0) save.mutate()
            }}
          >
            {existing ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <form id="announcement-form" noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        <Field id="announcement-title" label="Title" required error={err('title')}>
          <TextInput id="announcement-title" value={draft.title} maxLength={120} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
        </Field>
        <Field id="announcement-body" label="Message" required error={err('body')}>
          <TextArea id="announcement-body" value={draft.body} maxLength={1000} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
        </Field>
        <Field id="announcement-tone" label="Tone">
          <SelectInput id="announcement-tone" value={draft.tone} onChange={(e) => setDraft((d) => ({ ...d, tone: e.target.value as AnnouncementTone }))}>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="success">Success</option>
          </SelectInput>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="announcement-start" label="Starts" required error={err('startsAt')}>
            <TextInput id="announcement-start" type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft((d) => ({ ...d, startsAt: e.target.value }))} />
          </Field>
          <Field id="announcement-end" label="Ends" required error={err('endsAt')}>
            <TextInput id="announcement-end" type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft((d) => ({ ...d, endsAt: e.target.value }))} />
          </Field>
        </div>
        <fieldset id="announcement-plans">
          <legend className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Plans</legend>
          <p className="mb-2 text-xs text-muted">None selected = all plans.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {plans.isError && <p className="text-xs text-danger-600">{plans.error.message}</p>}
            {(plans.data ?? []).map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-[0.8125rem]">
                <Checkbox
                  id={`announcement-plan-${p.id}`}
                  checked={draft.plans.includes(p.id)}
                  onChange={(e) => setDraft((d) => ({ ...d, plans: toggle(d.plans, p.id, e.target.checked) }))}
                />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset id="announcement-countries">
          <legend className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Countries</legend>
          <p className="mb-2 text-xs text-muted">None selected = all countries.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {COUNTRIES.map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-[0.8125rem]">
                <Checkbox
                  id={`announcement-country-${c}`}
                  checked={draft.countries.includes(c)}
                  onChange={(e) => setDraft((d) => ({ ...d, countries: toggle(d.countries, c, e.target.checked) }))}
                />
                {COUNTRY_LABEL[c]}
              </label>
            ))}
          </div>
        </fieldset>
        {save.isError && (
          <p role="alert" id="announcement-error" className="text-[0.8125rem] text-danger-600">
            {save.error.message}
          </p>
        )}
      </form>
    </Drawer>
  )
}
