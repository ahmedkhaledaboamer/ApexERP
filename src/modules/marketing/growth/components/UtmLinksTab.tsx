import { useState, type FormEvent } from 'react'
import { Link2, Save, Trash2 } from 'lucide-react'
import { buildUtmUrl, utmSlug } from '@/modules/marketing/growth/types'
import { useCreateUtmLink, useDeleteUtmLink, useGrowthAccess, useUtmLinksQuery } from '@/modules/marketing/growth/hooks'
import { useMarketingOptions } from '@/modules/marketing/hooks/useMarketing'
import { CopyButton, CopyField } from '@/modules/marketing/growth/components/bits'
import { fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'

const EMPTY = { name: '', baseUrl: '', utmSource: '', utmMedium: '', utmCampaign: '', utmTerm: '', utmContent: '', campaignId: '' }

/** Lead generation › UTM links: build a tagged URL (a campaign fills utm_campaign) and keep it in a list. */
export function UtmLinksTab() {
  const { canEdit } = useGrowthAccess()
  const options = useMarketingOptions()
  const links = useUtmLinksQuery()
  const create = useCreateUtmLink()
  const remove = useDeleteUtmLink()
  const toast = useToast()
  const [v, setV] = useState(EMPTY)
  const set = (k: keyof typeof EMPTY, value: string) => setV((x) => ({ ...x, [k]: value }))
  const valid = /^https?:\/\/\S+$/i.test(v.baseUrl.trim()) && !!v.utmSource.trim() && !!v.utmMedium.trim()
  const preview = v.baseUrl.trim() ? buildUtmUrl(v.baseUrl, v) : ''

  function pickCampaign(id: string) {
    const c = options.data?.campaigns.find((x) => x.id === id)
    setV((x) => ({ ...x, campaignId: id, utmCampaign: c ? utmSlug(c.name) : x.utmCampaign }))
  }

  function save(e: FormEvent) {
    e.preventDefault()
    create.mutate(
      { ...v, campaignId: v.campaignId || null },
      {
        onSuccess: () => {
          toast.success('Link saved')
          setV(EMPTY)
        },
        onError: (err) => toast.error('Not saved', (err as Error).message),
      },
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,28rem)_1fr]">
      <Card className="h-fit">
        <CardHeader title="UTM link builder" description="Tag links in ads, posts and emails so the leads they bring show where they came from." icon={<Link2 aria-hidden />} />
        <CardBody>
          <form onSubmit={save} className="space-y-4" aria-label="UTM link builder">
            <Field id="utm-base" label="Page URL" required>
              <TextInput id="utm-base" value={v.baseUrl} placeholder="https://yourcompany.com/offer" onChange={(e) => set('baseUrl', e.target.value)} />
            </Field>
            <Field id="utm-campaign-pick" label="Campaign" hint="Fills utm_campaign from the campaign name.">
              <SelectInput id="utm-campaign-pick" value={v.campaignId} onChange={(e) => pickCampaign(e.target.value)}>
                <option value="">No campaign</option>
                {(options.data?.campaigns ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="utm-source" label="utm_source" required>
                <TextInput id="utm-source" value={v.utmSource} placeholder="linkedin" onChange={(e) => set('utmSource', e.target.value)} />
              </Field>
              <Field id="utm-medium" label="utm_medium" required>
                <TextInput id="utm-medium" value={v.utmMedium} placeholder="paid" onChange={(e) => set('utmMedium', e.target.value)} />
              </Field>
              <Field id="utm-campaign" label="utm_campaign">
                <TextInput id="utm-campaign" value={v.utmCampaign} onChange={(e) => set('utmCampaign', e.target.value)} />
              </Field>
              <Field id="utm-term" label="utm_term">
                <TextInput id="utm-term" value={v.utmTerm} onChange={(e) => set('utmTerm', e.target.value)} />
              </Field>
            </div>
            <Field id="utm-content" label="utm_content">
              <TextInput id="utm-content" value={v.utmContent} onChange={(e) => set('utmContent', e.target.value)} />
            </Field>
            <Field id="utm-name" label="Name in the list">
              <TextInput id="utm-name" value={v.name} placeholder="Optional" onChange={(e) => set('name', e.target.value)} />
            </Field>
            {preview && <CopyField label="Tagged URL" value={preview} testId="utm-preview" />}
            {canEdit && (
              <Button write type="submit" disabled={!valid} loading={create.isPending}>
                <Save />
                Save link
              </Button>
            )}
          </form>
        </CardBody>
      </Card>

      <Card className="h-fit">
        <CardHeader title="Saved links" description={`${links.data?.length ?? 0} links`} />
        <CardBody className="p-0">
          {links.isPending ? (
            <Skeleton className="m-4 h-24" />
          ) : !links.data?.length ? (
            <EmptyState icon={<Link2 aria-hidden />} title="No saved links" body="Build a link on the left and save it to reuse it later." />
          ) : (
            <ul className="divide-y divide-line" aria-label="Saved links">
              {links.data.map((l) => (
                <li key={l.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.8125rem] font-medium text-ink">{l.name}</p>
                    <p className="truncate font-mono text-xs text-muted" title={l.url}>
                      {l.url}
                    </p>
                    <p className="text-xs text-subtle">
                      {l.campaignName ? `${l.campaignName} · ` : ''}
                      {l.createdByName} · {fmtDate(l.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <CopyButton text={l.url} size="xs" />
                    {canEdit && (
                      <Button write variant="ghost" size="xs" iconOnly title="Delete link" aria-label={`Delete ${l.name}`} onClick={() => remove.mutate(l.id)}>
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
