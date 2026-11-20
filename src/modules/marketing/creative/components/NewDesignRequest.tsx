import { useEffect, useState, type FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import {
  DESIGN_PRIORITIES,
  DESIGN_PRIORITY_LABEL,
  DESIGN_TYPES,
  DESIGN_TYPE_LABEL,
  type DesignInput,
  type DesignPriority,
  type DesignRequest,
  type DesignType,
} from '@/modules/marketing/creative/types'
import { useCreateDesign, useDesignOptions, useUpdateDesign } from '@/modules/marketing/creative/hooks'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Button } from '@/shared/components/ui/Button'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { AssetPicker } from './AssetPicker'

interface Draft {
  title: string
  type: DesignType
  brief: string
  formats: string
  dueDate: string
  priority: DesignPriority
  assigneeId: string
  campaignId: string
  contentItemId: string
  assetIds: string[]
}

const draftOf = (r: DesignRequest | null, defaults: { campaignId?: string; contentItemId?: string }): Draft => ({
  title: r?.title ?? '',
  type: r?.type ?? 'social_post',
  brief: r?.brief ?? '',
  formats: r?.formats.join(', ') ?? '',
  dueDate: r?.dueDate ?? '',
  priority: r?.priority ?? 'medium',
  assigneeId: r?.assigneeId ?? '',
  campaignId: r?.campaignId ?? defaults.campaignId ?? '',
  contentItemId: r?.contentItemId ?? defaults.contentItemId ?? '',
  assetIds: r?.assetIds ?? [],
})

/**
 * New / edit design request. Open to every active user (the user menu and the New menu open it);
 * the assignee, campaign, content item and asset fields show only to roles the API lets set them.
 */
export function DesignRequestForm({
  open,
  onClose,
  request,
  defaults = {},
  onSaved,
}: {
  open: boolean
  onClose: () => void
  request: DesignRequest | null
  defaults?: { campaignId?: string; contentItemId?: string }
  onSaved?: (r: DesignRequest) => void
}) {
  const options = useDesignOptions()
  const create = useCreateDesign()
  const update = useUpdateDesign()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(() => draftOf(request, defaults))
  const [error, setError] = useState('')
  const opts = options.data

  useEffect(() => {
    if (open) {
      setDraft(draftOf(request, defaults))
      setError('')
    }
  }, [open, request]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft.title.trim()) return setError('Give the request a title.')
    if (!draft.brief.trim()) return setError('Describe what you need in the brief.')
    const input: DesignInput = {
      title: draft.title.trim(),
      type: draft.type,
      brief: draft.brief.trim(),
      formats: draft.formats.split(',').map((f) => f.trim()).filter(Boolean),
      dueDate: draft.dueDate || null,
      priority: draft.priority,
    }
    if (opts?.canManage) input.assigneeId = draft.assigneeId || null
    if (opts?.canViewAll) {
      input.campaignId = draft.campaignId || null
      input.contentItemId = draft.contentItemId || null
      input.assetIds = draft.assetIds
    }
    const done = {
      onSuccess: (r: DesignRequest) => {
        toast.success(request ? 'Request saved' : 'Design request sent', r.title)
        // Close first: the page's onSaved may change the URL after the close cleared `?new`.
        onClose()
        onSaved?.(r)
      },
      onError: (err: Error) => setError(err.message),
    }
    if (request) update.mutate({ id: request.id, input }, done)
    else create.mutate(input, done)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={request ? 'Edit design request' : 'New design request'}
      description="Ask the design team for a visual, banner, brochure, deck or video. You’ll see its progress under Design requests."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="design-form" loading={create.isPending || update.isPending}>
            {request ? 'Save request' : 'Send request'}
          </Button>
        </div>
      }
    >
      <form id="design-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:bg-danger-500/10 dark:text-danger-500">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        <Field id="dr-title" label="Title" required>
          <TextInput id="dr-title" value={draft.title} maxLength={200} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Banner for the healthcare webinar" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field id="dr-type" label="Type" required>
            <SelectInput id="dr-type" value={draft.type} onChange={(e) => set('type', e.target.value as DesignType)}>
              {DESIGN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DESIGN_TYPE_LABEL[t]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id="dr-priority" label="Priority">
            <SelectInput id="dr-priority" value={draft.priority} onChange={(e) => set('priority', e.target.value as DesignPriority)}>
              {DESIGN_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {DESIGN_PRIORITY_LABEL[p]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id="dr-due" label="Due date">
            <TextInput id="dr-due" type="date" value={draft.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
        </div>
        <Field id="dr-brief" label="Brief" required>
          <TextArea id="dr-brief" rows={5} value={draft.brief} onChange={(e) => set('brief', e.target.value)} placeholder="What is it for, who is it for, key message, references…" />
        </Field>
        <Field id="dr-formats" label="Formats / sizes" hint="Comma separated, e.g. 1080×1080 PNG, A4 PDF">
          <TextInput id="dr-formats" value={draft.formats} onChange={(e) => set('formats', e.target.value)} />
        </Field>
        {opts?.canManage && (
          <Field id="dr-assignee" label="Designer">
            <SelectInput id="dr-assignee" value={draft.assigneeId} onChange={(e) => set('assigneeId', e.target.value)}>
              <option value="">Not assigned</option>
              {opts.designers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.title ? ` · ${d.title}` : ''}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}
        {opts?.canViewAll && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="dr-campaign" label="Campaign">
                <SelectInput id="dr-campaign" value={draft.campaignId} onChange={(e) => set('campaignId', e.target.value)}>
                  <option value="">No campaign</option>
                  {opts.campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field id="dr-content" label="Content item">
                <SelectInput id="dr-content" value={draft.contentItemId} onChange={(e) => set('contentItemId', e.target.value)}>
                  <option value="">None</option>
                  {opts.contentItems.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            </div>
            <div>
              <p className="mb-1.5 text-[0.8125rem] font-medium text-ink">Reference assets</p>
              <AssetPicker value={draft.assetIds} onChange={(ids) => set('assetIds', ids)} />
            </div>
          </>
        )}
      </form>
    </Drawer>
  )
}
