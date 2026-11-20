import { useEffect, useState, type FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import {
  CONTENT_CHANNELS,
  CONTENT_CHANNEL_LABEL,
  CONTENT_TYPES,
  CONTENT_TYPE_LABEL,
  type ContentChannel,
  type ContentInput,
  type ContentItem,
  type ContentStatus,
  type ContentType,
} from '@/modules/marketing/creative/types'
import { useCreateContent, useUpdateContent } from '@/modules/marketing/creative/hooks'
import { useMarketingOptions } from '@/modules/marketing/hooks/useMarketing'
import { can } from '@/shared/lib/permissions'
import { cn } from '@/shared/lib/utils'
import type { Role } from '@/shared/types'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Button } from '@/shared/components/ui/Button'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { AssetPicker } from './AssetPicker'

interface Draft {
  title: string
  type: ContentType
  channels: ContentChannel[]
  status: ContentStatus
  ownerId: string
  reviewerId: string
  date: string
  time: string
  campaignId: string
  body: string
  notes: string
  assetIds: string[]
}

function draftOf(c: ContentItem | null, defaults: { ownerId: string; date?: string; campaignId?: string }): Draft {
  const [date, time] = c?.publishLocal ? c.publishLocal.split('T') : [defaults.date ?? '', defaults.date ? '10:00' : '']
  return {
    title: c?.title ?? '',
    type: c?.type ?? 'social_post',
    channels: c?.channels ?? ['linkedin'],
    status: c?.status ?? 'draft',
    ownerId: c?.ownerId ?? defaults.ownerId,
    reviewerId: c?.reviewerId ?? '',
    date,
    time,
    campaignId: c?.campaignId ?? defaults.campaignId ?? '',
    body: c?.body ?? '',
    notes: c?.notes ?? '',
    assetIds: c?.assetIds ?? [],
  }
}

/** Create or edit a content item. Publish time is wall time in the company's timezone. */
export function ContentForm({
  open,
  onClose,
  item,
  currentUserId,
  defaultDate,
  defaultCampaignId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  item: ContentItem | null
  currentUserId: string
  defaultDate?: string
  defaultCampaignId?: string
  onSaved?: (c: ContentItem) => void
}) {
  const options = useMarketingOptions()
  const create = useCreateContent()
  const update = useUpdateContent()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(() => draftOf(item, { ownerId: currentUserId, date: defaultDate, campaignId: defaultCampaignId }))
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setDraft(draftOf(item, { ownerId: currentUserId, date: defaultDate, campaignId: defaultCampaignId }))
      setError('')
    }
  }, [open, item, currentUserId, defaultDate, defaultCampaignId])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const owners = options.data?.owners ?? []
  const reviewers = owners.filter((o) => can(o.role as Role, 'marketing', 'edit'))
  const pending = create.isPending || update.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft.title.trim()) return setError('Give the content a title.')
    if (draft.channels.length === 0) return setError('Pick at least one channel.')
    if (!!draft.date !== !!draft.time) return setError('Set both the publish date and time, or neither.')
    const input: ContentInput = {
      title: draft.title.trim(),
      type: draft.type,
      channels: draft.channels,
      ownerId: draft.ownerId || undefined,
      reviewerId: draft.reviewerId || null,
      publishAt: draft.date ? `${draft.date}T${draft.time}` : null,
      campaignId: draft.campaignId || null,
      body: draft.body,
      notes: draft.notes,
      assetIds: draft.assetIds,
      ...(item ? {} : { status: draft.status }),
    }
    const done = {
      onSuccess: (c: ContentItem) => {
        toast.success(item ? 'Content saved' : 'Content created', c.title)
        onSaved?.(c)
        onClose()
      },
      onError: (err: Error) => setError(err.message),
    }
    if (item) update.mutate({ id: item.id, input }, done)
    else create.mutate(input, done)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={item ? 'Edit content' : 'New content'}
      description={`Publish time is in the company’s timezone (${options.data?.timezone ?? '…'}).`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="content-form" loading={pending}>
            {item ? 'Save content' : 'Create content'}
          </Button>
        </div>
      }
    >
      <form id="content-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:bg-danger-500/10 dark:text-danger-500">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {item && (item.status === 'approved' || item.status === 'scheduled') && (
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
            Changing the title, type, channels or copy sends it back to review.
          </p>
        )}
        <Field id="ci-title" label="Title" required>
          <TextInput id="ci-title" value={draft.title} maxLength={200} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Customer story: Al Noor Clinics" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="ci-type" label="Type" required>
            <SelectInput id="ci-type" value={draft.type} onChange={(e) => set('type', e.target.value as ContentType)}>
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CONTENT_TYPE_LABEL[t]}
                </option>
              ))}
            </SelectInput>
          </Field>
          {!item && (
            <Field id="ci-status" label="Start as">
              <SelectInput id="ci-status" value={draft.status} onChange={(e) => set('status', e.target.value as ContentStatus)}>
                <option value="idea">Idea</option>
                <option value="draft">Draft</option>
                <option value="in_review">In review</option>
              </SelectInput>
            </Field>
          )}
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[0.8125rem] font-medium text-ink">Channels</legend>
          <div className="flex flex-wrap gap-1.5">
            {CONTENT_CHANNELS.map((c) => {
              const on = draft.channels.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set('channels', on ? draft.channels.filter((x) => x !== c) : [...draft.channels, c])}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    on ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'border-line-strong text-muted hover:bg-hover',
                  )}
                >
                  {CONTENT_CHANNEL_LABEL[c]}
                </button>
              )
            })}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="ci-date" label="Publish date">
            <TextInput id="ci-date" type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field id="ci-time" label="Publish time">
            <TextInput id="ci-time" type="time" value={draft.time} onChange={(e) => set('time', e.target.value)} />
          </Field>
          <Field id="ci-owner" label="Owner">
            <SelectInput id="ci-owner" value={draft.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.role}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id="ci-reviewer" label="Reviewer" hint="Any marketing manager can approve; not the owner (except a Company Admin).">
            <SelectInput id="ci-reviewer" value={draft.reviewerId} onChange={(e) => set('reviewerId', e.target.value)}>
              <option value="">No reviewer</option>
              {reviewers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <Field id="ci-campaign" label="Campaign">
          <SelectInput id="ci-campaign" value={draft.campaignId} onChange={(e) => set('campaignId', e.target.value)}>
            <option value="">No campaign</option>
            {(options.data?.campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field id="ci-body" label="Copy">
          <TextArea id="ci-body" rows={5} value={draft.body} onChange={(e) => set('body', e.target.value)} placeholder="The post, article outline or script" />
        </Field>
        <Field id="ci-notes" label="Notes">
          <TextArea id="ci-notes" rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <div>
          <p className="mb-1.5 text-[0.8125rem] font-medium text-ink">Brand assets</p>
          <AssetPicker value={draft.assetIds} onChange={(ids) => set('assetIds', ids)} />
        </div>
      </form>
    </Drawer>
  )
}
