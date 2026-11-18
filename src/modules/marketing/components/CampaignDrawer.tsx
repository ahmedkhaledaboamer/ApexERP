import { useEffect, useState, type FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABEL,
  CHANNEL_LABEL,
  type Campaign,
  type CampaignChannel,
  type CampaignInput,
  type CampaignStatus,
} from '@/modules/marketing/types'
import { useCreateCampaign, useMarketingOptions, useUpdateCampaign } from '@/modules/marketing/hooks/useMarketing'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Button } from '@/shared/components/ui/Button'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'

interface Draft {
  name: string
  channel: CampaignChannel
  status: CampaignStatus
  budget: string
  startDate: string
  endDate: string
  goal: string
  targetLeads: string
  ownerId: string
  sourceDetail: string
}

function draftOf(c: Campaign | null, ownerId: string): Draft {
  return {
    name: c?.name ?? '',
    channel: c?.channel ?? 'email',
    status: c?.status ?? 'draft',
    budget: c?.budget != null ? String(c.budget) : '',
    startDate: c?.startDate ?? '',
    endDate: c?.endDate ?? '',
    goal: c?.goal ?? '',
    targetLeads: c?.targetLeads != null ? String(c.targetLeads) : '',
    ownerId: c ? (c.ownerId ?? '') : ownerId,
    sourceDetail: c?.sourceDetail ?? '',
  }
}

/** Create or edit a campaign (name, channel, budget, dates, goal, owner). */
export function CampaignDrawer({
  open,
  onClose,
  campaign,
  currentUserId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  campaign: Campaign | null
  currentUserId: string
  onSaved?: (c: Campaign) => void
}) {
  const options = useMarketingOptions()
  const create = useCreateCampaign()
  const update = useUpdateCampaign()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(() => draftOf(campaign, currentUserId))
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setDraft(draftOf(campaign, currentUserId))
      setError('')
    }
  }, [open, campaign, currentUserId])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const pending = create.isPending || update.isPending
  const currency = campaign?.currency ?? options.data?.currency ?? ''

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft.name.trim()) return setError('Give the campaign a name.')
    const input: CampaignInput = {
      name: draft.name.trim(),
      channel: draft.channel,
      status: draft.status,
      budget: draft.budget.trim() === '' ? null : Number(draft.budget),
      startDate: draft.startDate || null,
      endDate: draft.endDate || null,
      goal: draft.goal,
      targetLeads: draft.targetLeads.trim() === '' ? null : Number(draft.targetLeads),
      ownerId: draft.ownerId || null,
      sourceDetail: draft.sourceDetail,
    }
    const done = {
      onSuccess: (c: Campaign) => {
        toast.success(campaign ? 'Campaign saved' : 'Campaign created', c.name)
        onSaved?.(c)
        onClose()
      },
      onError: (err: Error) => setError(err.message),
    }
    if (campaign) update.mutate({ id: campaign.id, input }, done)
    else create.mutate(input, done)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={campaign ? 'Edit campaign' : 'New campaign'}
      description="Channel, budget, dates, goal and owner. Leads that name this campaign count toward its cost per lead."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="campaign-form" loading={pending}>
            {campaign ? 'Save campaign' : 'Create campaign'}
          </Button>
        </div>
      }
    >
      <form id="campaign-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:bg-danger-500/10 dark:text-danger-500">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        <Field id="cmp-name" label="Name" required>
          <TextInput id="cmp-name" value={draft.name} maxLength={120} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Q1 LinkedIn outreach" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="cmp-channel" label="Channel" required>
            <SelectInput id="cmp-channel" value={draft.channel} onChange={(e) => set('channel', e.target.value as CampaignChannel)}>
              {CAMPAIGN_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id="cmp-status" label="Status">
            <SelectInput id="cmp-status" value={draft.status} onChange={(e) => set('status', e.target.value as CampaignStatus)}>
              {CAMPAIGN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CAMPAIGN_STATUS_LABEL[s]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id="cmp-budget" label={currency ? `Budget (${currency})` : 'Budget'} hint="Planned spend; actual spend comes from cost entries.">
            <TextInput id="cmp-budget" type="number" inputMode="decimal" min={0} step="0.01" value={draft.budget} onChange={(e) => set('budget', e.target.value)} />
          </Field>
          <Field id="cmp-target" label="Target leads" hint="Optional goal in leads.">
            <TextInput id="cmp-target" type="number" inputMode="numeric" min={0} step={1} value={draft.targetLeads} onChange={(e) => set('targetLeads', e.target.value)} />
          </Field>
          <Field id="cmp-start" label="Start date">
            <TextInput id="cmp-start" type="date" value={draft.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Field id="cmp-end" label="End date">
            <TextInput id="cmp-end" type="date" value={draft.endDate} min={draft.startDate || undefined} onChange={(e) => set('endDate', e.target.value)} />
          </Field>
        </div>
        <Field id="cmp-owner" label="Owner">
          <SelectInput id="cmp-owner" value={draft.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
            <option value="">No owner</option>
            {(options.data?.owners ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.role}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field id="cmp-goal" label="Goal">
          <TextArea id="cmp-goal" rows={3} value={draft.goal} onChange={(e) => set('goal', e.target.value)} placeholder="What should this campaign achieve?" />
        </Field>
        <Field id="cmp-source" label="Source detail / UTM" hint="e.g. utm_source=linkedin&utm_campaign=q1">
          <TextInput id="cmp-source" value={draft.sourceDetail} maxLength={255} onChange={(e) => set('sourceDetail', e.target.value)} />
        </Field>
      </form>
    </Drawer>
  )
}
